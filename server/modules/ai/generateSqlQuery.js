const { aiClient, aiModel } = require("./aiClient");

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

async function generateSqlQuery(schema, question, conversationHistory = [], currentQuery = "") {
  if (!aiClient) {
    throw new Error("AI client is not initialized. Please check your CB_AI_API_KEY environment variable.");
  }

  const formattedSchema = _compactSchema(schema);

  try {
    const messages = [
      {
        role: "system",
        content: `You are an expert SQL query generator. Use the following database schema to generate an SQL query that matches the user's intent.
The user might also provide a current query, which you should use to generate the final query but only if it's relevant.

Database Schema:
${formattedSchema}

IMPORTANT RULES:
- Output ONLY the raw SQL query. No explanations, no markdown, no code fences, no comments outside the query.
- If the user's request is ambiguous, make a reasonable assumption and generate the query. Do NOT ask clarifying questions.
- If the user asks for a query with variables, use the variables in the query. Example: SELECT * FROM movies WHERE status = {{status}} LIMIT 10;
- Don't add variables if not specified by the user.
- Never wrap the output in \`\`\`sql or \`\`\` blocks. Return plain SQL only.`,
      },
      ...conversationHistory,
    ];

    messages.push({
      role: "user",
      content: question,
    });

    if (currentQuery) {
      messages.push({
        role: "user",
        content: `Current Query: ${currentQuery}`,
      });
    }

    const response = await aiClient.chat.completions.create({
      model: aiModel,
      messages,
    });

    const sqlQuery = response.choices[0].message.content;

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

    return { query: cleanedQuery, conversationHistory };
  } catch (error) {
    console.error("[generateSqlQuery] AI error:", error.message, error.status || "", error.code || "");
    return { query: "", conversationHistory };
  }
}

module.exports = {
  generateSqlQuery,
};
