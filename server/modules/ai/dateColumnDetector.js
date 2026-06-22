/**
 * Date Column Detector
 *
 * Scans a connection schema and/or query to determine the best date/timestamp
 * column to use for {{start_date}} / {{end_date}} scoping.
 *
 * Supports:
 *  - SQL schemas (postgres, mysql, mssql): { description: { table: { col: type } | [col] } }
 *  - MongoDB schemas: { collections: { col: { fields: { field: { type } } } } }
 *  - Query parsing: extracts referenced tables/collections from a query string
 */

// ── Column-name scoring tiers ──────────────────────────────────────────────
// Higher score = better candidate for date-range scoping.
const NAME_PATTERNS = [
  // Tier 1 — Record-creation timestamps (best for scoping)
  { pattern: /^created[_-]?(at|on|date|time|ts)?$/i, score: 100 },
  { pattern: /^creation[_-]?(date|time|ts)?$/i, score: 100 },
  { pattern: /^date[_-]?created$/i, score: 100 },
  { pattern: /^inserted[_-]?(at|on|date)?$/i, score: 95 },

  // Tier 2 — Generic timestamp / datetime columns
  { pattern: /^timestamp$/i, score: 90 },
  { pattern: /^datetime$/i, score: 88 },
  { pattern: /^date[_-]?time$/i, score: 88 },
  { pattern: /^ts$/i, score: 85 },

  // Tier 3 — Domain-specific date columns (common in business data)
  { pattern: /^order[_-]?date$/i, score: 80 },
  { pattern: /^transaction[_-]?(date|time|ts|at)$/i, score: 80 },
  { pattern: /^event[_-]?(date|time|ts|at)$/i, score: 80 },
  { pattern: /^posted[_-]?(at|on|date)?$/i, score: 78 },
  { pattern: /^recorded[_-]?(at|on|date)?$/i, score: 78 },
  { pattern: /^occurred[_-]?(at|on|date)?$/i, score: 78 },
  { pattern: /^log[_-]?(date|time|ts|at)$/i, score: 78 },
  { pattern: /^entry[_-]?(date|time|ts|at)$/i, score: 78 },
  { pattern: /^invoice[_-]?(date|time)$/i, score: 76 },
  { pattern: /^payment[_-]?(date|time)$/i, score: 76 },
  { pattern: /^ship[_-]?(date|time)$/i, score: 75 },
  { pattern: /^received[_-]?(at|on|date)?$/i, score: 75 },
  { pattern: /^submitted[_-]?(at|on|date)?$/i, score: 75 },
  { pattern: /^completed[_-]?(at|on|date)?$/i, score: 74 },
  { pattern: /^closed[_-]?(at|on|date)?$/i, score: 74 },
  { pattern: /^start[_-]?(date|time|ts|at)$/i, score: 73 },
  { pattern: /^end[_-]?(date|time|ts|at)$/i, score: 72 },
  { pattern: /^effective[_-]?(date|time)$/i, score: 72 },
  { pattern: /^due[_-]?(date|time)$/i, score: 70 },

  // Tier 4 — Catch-all patterns (column name contains date-like tokens)
  { pattern: /date$/i, score: 60 },                 // *_date, *Date
  { pattern: /_at$/i, score: 58 },                  // *_at (common ORM suffix)
  { pattern: /time$/i, score: 55 },                 // *_time, *Time
  { pattern: /^date$/i, score: 50 },                // just "date"

  // Tier 5 — Modification timestamps (less ideal for scoping, but usable)
  { pattern: /^updated[_-]?(at|on|date|time|ts)?$/i, score: 40 },
  { pattern: /^modified[_-]?(at|on|date|time|ts)?$/i, score: 40 },
  { pattern: /^last[_-]?modified$/i, score: 38 },
  { pattern: /^changed[_-]?(at|on|date)?$/i, score: 38 },

  // Tier 6 — Unlikely but possible
  { pattern: /^period$/i, score: 20 },
  { pattern: /^month$/i, score: 15 },
  { pattern: /^year$/i, score: 15 },
];

// Column types that confirm a column is a date (boosts score)
const DATE_TYPE_PATTERNS = [
  /timestamp/i,
  /datetime/i,
  /^date$/i,
  /timestamptz/i,
  /timestamp with(out)? time zone/i,
  /smalldatetime/i,
  /datetimeoffset/i,
];

// ── Helper: score a single column ──────────────────────────────────────────
function scoreColumn(columnName, columnType) {
  let nameScore = 0;

  for (const { pattern, score } of NAME_PATTERNS) {
    if (pattern.test(columnName)) {
      nameScore = score;
      break; // first (highest-priority) match wins
    }
  }

  // If we have type information, use it to boost or filter
  if (columnType) {
    const isDateType = DATE_TYPE_PATTERNS.some((p) => p.test(columnType));
    if (isDateType) {
      // Known date type: boost the name score, or give a base score if name didn't match
      nameScore = nameScore > 0 ? nameScore + 10 : 45;
    } else if (nameScore > 0 && nameScore < 60) {
      // Name looks date-ish but type is NOT a date — demote heavily
      nameScore = Math.floor(nameScore * 0.3);
    }
  }

  return nameScore;
}

// ── Helper: extract table names referenced in a SQL query ──────────────────
function extractSqlTableNames(query) {
  if (!query) return [];
  const tables = new Set();

  // Match FROM / JOIN table references (with optional schema prefix and alias)
  const tablePattern = /\b(?:FROM|JOIN)\s+(?:["']?(\w+)["']?\.)?["']?(\w+)["']?(?:\s+(?:AS\s+)?(\w+))?/gi;
  let match;
  while ((match = tablePattern.exec(query)) !== null) {
    const schemaName = match[1];
    const tableName = match[2];
    if (schemaName) {
      tables.add(`${schemaName}.${tableName}`);
    }
    tables.add(tableName);
  }

  return [...tables];
}

// ── Helper: extract collection name from a MongoDB query ───────────────────
function extractMongoCollectionName(query) {
  if (!query) return null;
  const match = query.match(/collection\s*\(\s*['"](\w+)['"]\s*\)/i);
  return match ? match[1] : null;
}

// ── Helper: get columns for a table from a SQL schema ──────────────────────
// Handles both formats:
//   { table: { col: "TYPE", ... } }   (rich — includes types)
//   { table: ["col1", "col2", ...] }  (legacy — names only)
function getColumnsForTable(schema, tableName) {
  const desc = schema?.description || schema;
  if (!desc || typeof desc !== "object") return [];

  // Try exact match first
  let tableData = desc[tableName];

  // Try schema-qualified match (e.g. "dbo.TableName")
  if (!tableData) {
    const qualified = Object.keys(desc).find((k) => {
      const parts = k.split(".");
      return parts[parts.length - 1].toLowerCase() === tableName.toLowerCase();
    });
    if (qualified) tableData = desc[qualified];
  }

  // Case-insensitive fallback
  if (!tableData) {
    const lower = tableName.toLowerCase();
    const key = Object.keys(desc).find((k) => k.toLowerCase() === lower);
    if (key) tableData = desc[key];
  }

  if (!tableData) return [];

  // Rich format: { colName: "TYPE" }
  if (!Array.isArray(tableData) && typeof tableData === "object") {
    return Object.entries(tableData).map(([name, type]) => ({
      name,
      type: typeof type === "string" ? type : type?.type || null,
    }));
  }

  // Legacy format: ["col1", "col2"]
  return tableData.map((name) => ({ name, type: null }));
}

// ── Helper: get fields for a MongoDB collection from schema ────────────────
function getMongoFields(schema, collectionName) {
  const collections = schema?.collections;
  if (!collections || !collectionName) return [];

  const collData = collections[collectionName];
  if (!collData?.fields) return [];

  return Object.entries(collData.fields).map(([name, info]) => ({
    name,
    type: info?.type || null,
  }));
}

// ── Main: detect the best date column ──────────────────────────────────────
/**
 * Detect the best date column for {{start_date}} / {{end_date}} scoping.
 *
 * @param {Object} options
 * @param {Object} options.schema       - The connection's stored schema object
 * @param {string} options.query        - The current SQL or Mongo query
 * @param {string} options.dialect      - "postgres" | "mysql" | "mssql" | "mongodb"
 * @param {string} [options.dateField]  - Existing dateField from Dataset (if any)
 * @returns {{ column: string|null, table: string|null, score: number, candidates: Array }}
 */
function detectBestDateColumn({ schema, query, dialect, dateField } = {}) {
  // If a dateField is already set and looks reasonable, prefer it
  const cleanDateField = dateField?.replace(/^root\[\]\./, "") || null;

  let columns = [];
  let contextTable = null;

  if (dialect === "mongodb") {
    const collectionName = extractMongoCollectionName(query);
    contextTable = collectionName;
    if (schema && collectionName) {
      columns = getMongoFields(schema, collectionName);
    }
  } else {
    // SQL dialects
    const referencedTables = extractSqlTableNames(query);
    if (schema && referencedTables.length > 0) {
      // Collect columns from all referenced tables, tagged with table name
      for (const table of referencedTables) {
        const tableCols = getColumnsForTable(schema, table);
        tableCols.forEach((col) => {
          columns.push({ ...col, table });
        });
      }
      contextTable = referencedTables[0]; // primary table (FROM)
    }

    // If no tables found in query but schema has tables, scan all
    if (columns.length === 0 && schema?.description) {
      const desc = schema.description;
      for (const table of Object.keys(desc)) {
        const tableCols = getColumnsForTable(schema, table);
        tableCols.forEach((col) => {
          columns.push({ ...col, table });
        });
      }
    }
  }

  // Score all columns
  const scored = columns
    .map((col) => ({
      column: col.name,
      table: col.table || contextTable,
      type: col.type,
      score: scoreColumn(col.name, col.type),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  // If we have an existing dateField, check if it's among the candidates
  if (cleanDateField) {
    const existing = scored.find(
      (c) => c.column.toLowerCase() === cleanDateField.toLowerCase()
    );
    if (existing) {
      // Boost the existing dateField since the user/system already selected it
      return {
        column: existing.column,
        table: existing.table,
        score: existing.score + 20,
        candidates: scored.slice(0, 5),
      };
    }
    // dateField set but not found in schema — still use it (trust the user)
    return {
      column: cleanDateField,
      table: contextTable,
      score: 50,
      candidates: scored.slice(0, 5),
    };
  }

  // Return top candidate
  if (scored.length > 0) {
    return {
      column: scored[0].column,
      table: scored[0].table,
      score: scored[0].score,
      candidates: scored.slice(0, 5),
    };
  }

  return { column: null, table: null, score: 0, candidates: [] };
}

module.exports = {
  detectBestDateColumn,
  extractSqlTableNames,
  extractMongoCollectionName,
  scoreColumn,
};
