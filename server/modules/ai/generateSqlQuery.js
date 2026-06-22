const { format: formatSql } = require("sql-formatter");

const { aiClient, aiModel } = require("./aiClient");
const logger = require("../logger").child({ module: "generateSqlQuery" });

function _formatterLanguage(dbType) {
  if (dbType === "postgres") return "postgresql";
  if (dbType === "mysql") return "mysql";
  if (dbType === "mssql") return "tsql";
  return "sql";
}

function _safeFormatSql(query, dbType) {
  if (!query) return query;
  try {
    return formatSql(query, {
      language: _formatterLanguage(dbType),
      keywordCase: "upper",
      tabWidth: 2,
    });
  } catch (e) {
    logger.warn({ err: e, dbType }, "SQL formatting failed; returning unformatted query");
    return query;
  }
}

function _compactSchema(schema, maxChars = 80000) {
  // First try full schema
  const full = JSON.stringify(schema).replace(/\\/g, "").replace(/"/g, "");
  if (full.length <= maxChars) return full;

  // If too large, send table names with columns but limit column count
  const description = schema?.description || schema;
  if (description && typeof description === "object") {
    const tables = Object.keys(description);

    // Try with truncated columns (first 10 per table)
    const truncated = {};
    for (const table of tables) {
      const cols = Array.isArray(description[table]) ? description[table] : Object.keys(description[table] || {});
      truncated[table] = cols.slice(0, 10);
      if (cols.length > 10) {
        truncated[table].push(`... and ${cols.length - 10} more columns`);
      }
    }
    const compact = JSON.stringify(truncated).replace(/\\/g, "").replace(/"/g, "");
    if (compact.length <= maxChars) return compact;

    // Still too large — table names only
    return `Tables: ${tables.join(", ")}`;
  }

  // Fallback: truncate
  return full.substring(0, maxChars) + "\n... (schema truncated)";
}

async function generateSqlQuery(schema, question, conversationHistory = [], currentQuery = "", dbType = "") {
  if (!aiClient) {
    throw new Error("AI client is not initialized. Please check your CB_AI_API_KEY environment variable.");
  }

  const formattedSchema = _compactSchema(schema);

  try {
    const messages = [
      {
        role: "system",
        content: `You are an expert SQL query generator. Use the following database schema to generate an SQL query that matches the user's intent.

Current Date: ${new Date().toISOString().split("T")[0]}
Use this when interpreting relative date references (e.g. "YTD" means January 1 of the current year to today, "last month", "this quarter", etc.).

Database Schema:
${formattedSchema}

IMPORTANT RULES:
- Output ONLY the raw SQL query. No explanations, no markdown, no code fences, no comments outside the query, no descriptions of what changed.
- FORMATTING: Always output SQL with line breaks for readability. Each major clause (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, LIMIT) should start on its own line. Indent continued lines.
- When a current query is provided, treat it as the BASE. Apply ONLY the specific change the user requested. Preserve all existing columns, joins, WHERE clauses, GROUP BY, ORDER BY, and structure. Do NOT rewrite, simplify, or restructure the query beyond what was asked.
- If the user's request is ambiguous, make a reasonable assumption and generate the query. Do NOT ask clarifying questions.
- If the user asks for a query with variables, use the variables in the query. Example: SELECT * FROM movies WHERE status = {{status}} LIMIT 10;
- Don't add variables if not specified by the user.
- Never wrap the output in \`\`\`sql or \`\`\` blocks. Return plain SQL only.
- Edison supports a "Scope dates to query" feature using the reserved variables {{start_date}} and {{end_date}}.
- DEFAULT BEHAVIOR: When the schema contains date/timestamp/datetime columns that can logically scope the result set (e.g. created_at, updated_at, order_date, timestamp), ALWAYS include {{start_date}} and {{end_date}} in the WHERE clause. This is the preferred pattern for all time-series or date-bound queries. Example: SELECT * FROM orders WHERE created_at >= {{start_date}} AND created_at <= {{end_date}} ORDER BY created_at;
- These variables are automatically populated from the chart's date picker. The system will enable date scoping on the chart automatically.
- Do NOT add {{start_date}}/{{end_date}} only when: (1) there are no date columns in the queried tables, (2) the user explicitly asks for ALL data without date filtering, (3) the query is a simple total count/aggregate not meant to be time-bound, or (4) the date columns are not relevant for scoping (e.g. birth_date in a demographics query).
- When in doubt, include them — users can always adjust the date range later.`,
      },
      ...conversationHistory,
    ];

    if (currentQuery) {
      messages.push({
        role: "system",
        content: `The user has an existing query that MUST be used as the base. Apply only the changes they request. Preserve everything else exactly as-is.\n\nCurrent Query:\n${currentQuery}`,
      });
    }

    messages.push({
      role: "user",
      content: question,
    });

    const startedAt = Date.now();
    const response = await aiClient.chat.completions.create({
      model: aiModel,
      messages,
    });
    const latencyMs = Date.now() - startedAt;

    const sqlQuery = response.choices[0].message.content;

    logger.info({
      model: response.model || aiModel,
      latencyMs,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens,
      hasCurrentQuery: Boolean(currentQuery),
      schemaChars: formattedSchema.length,
    }, "SQL query generated");

    conversationHistory.push({
      role: "user",
      content: question,
    });

    if (currentQuery) {
      conversationHistory.push({
        role: "system",
        content: `Current Query: ${currentQuery}`,
      });
    }

    conversationHistory.push({
      role: "assistant",
      content: sqlQuery,
    });

    // Extract only the SQL from the response, handling cases where the AI
    // wraps it in code fences or adds conversational text around it
    let cleanedQuery = sqlQuery;

    // If the response contains a fenced SQL block, extract just that
    const fencedMatch = sqlQuery.match(/```(?:sql)?\s*\n([\s\S]*?)```/);
    if (fencedMatch) {
      cleanedQuery = fencedMatch[1].trim();
    } else {
      // Remove any leading/trailing code fences
      cleanedQuery = cleanedQuery.replace(/^```sql\s*\n?/i, "").replace(/\n?```\s*$/g, "").trim();
    }

    // If the AI still added conversational text, try to extract lines that look like SQL
    if (cleanedQuery.match(/^(I'd|I would|Here|Sure|Let me|However|Please|Based on)/i)) {
      const sqlMatch = cleanedQuery.match(/(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|EXEC|DECLARE)\b[\s\S]*?;?\s*$/im);
      if (sqlMatch) {
        cleanedQuery = sqlMatch[0].trim();
      }
    }

    const formattedQuery = _safeFormatSql(cleanedQuery, dbType);

    return { query: formattedQuery, conversationHistory };
  } catch (error) {
    logger.error({
      err: error,
      status: error.status,
      code: error.code,
      model: aiModel,
    }, "SQL query generation failed");
    return { query: "", conversationHistory };
  }
}

module.exports = {
  generateSqlQuery,
};
