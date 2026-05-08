import { format } from "sql-formatter";

function _language(dbType) {
  if (dbType === "postgres") return "postgresql";
  if (dbType === "mysql") return "mysql";
  if (dbType === "mssql") return "tsql";
  return "sql";
}

export default function formatSql(query, dbType) {
  if (!query || typeof query !== "string") return query;
  try {
    return format(query, {
      language: _language(dbType),
      keywordCase: "upper",
      tabWidth: 2,
    });
  } catch (e) {
    return query;
  }
}
