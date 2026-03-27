const { aiClient, aiModel } = require("./aiClient");

async function generateMongoQuery(schema, question, conversationHistory = [], currentQuery = "") {
  if (!aiClient) {
    throw new Error("AI client is not initialized. Please check your CB_AI_API_KEY environment variable.");
  }

  const formattedSchema = JSON.stringify(schema).replace(/\\/g, "").replace(/"/g, "");

  try {
    const messages = [
      {
        role: "system",
        content: `
        You are an expert MongoDB query generator. Use the following database schema to generate a Mongo Shell query that matches the user's intent.
        Database Schema:
        ${formattedSchema}

        IMPORTANT RULES:
        - Output ONLY the raw Mongo query. No explanations, no markdown, no code fences, no comments, no descriptions of what changed.
        - Never wrap the output in \`\`\`javascript or \`\`\` blocks. Return plain query only.
        - When a current query is provided, treat it as the BASE. Apply ONLY the specific change the user requested. Preserve all existing stages, fields, filters, sorts, and structure. Do NOT rewrite, simplify, or restructure the query beyond what was asked.
        - Output format: collection('collectionName').operation()
        - Example: collection('movies')
                  .find()
                  .limit(10)
        - Try to format the query in a way that is easy to read and understand.
        - If the user asks for a query with variables, use the variables in the query.
        - Example: collection('movies').find({status: {{status}}}).limit(10)
        - Don't add variables if not specified by the user.
        - ADDMAN-SmartChart supports a "Scope dates to query" feature. When the user asks to filter by date range or wants the chart date range applied at the query level, use the reserved variables {{start_date}} and {{end_date}} in query filters. These are automatically converted to new Date() objects at runtime, so use them directly without wrapping in new Date() or quotes.
        - Example: collection('orders').find({created_at: {$gte: {{start_date}}, $lte: {{end_date}}}}).sort({created_at: 1})
        - Only use {{start_date}} and {{end_date}} when the user explicitly asks for date-scoped queries or mentions filtering by the chart's date range.
      `,
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

    const response = await aiClient.chat.completions.create({
      model: aiModel,
      messages,
    });

    const mongoQuery = response.choices[0].message.content;

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
      content: mongoQuery,
    });

    // Extract only the Mongo query from the response, handling cases where
    // the AI wraps it in code fences or adds conversational text around it
    let cleanedQuery = mongoQuery;

    // If the response contains a fenced code block, extract just that
    const fencedMatch = mongoQuery.match(/```(?:javascript|js|mongo)?\s*\n([\s\S]*?)```/);
    if (fencedMatch) {
      cleanedQuery = fencedMatch[1].trim();
    } else {
      // Remove any leading/trailing code fences
      cleanedQuery = cleanedQuery.replace(/^```(\w+)?\s*\n?/i, "").replace(/\n?```\s*$/g, "").trim();
    }

    // If the AI added conversational text, extract lines starting with collection(
    if (cleanedQuery.match(/^(Here|I|The|This|Sure|Let me|Updated|What changed|Note|\*\*)/im)) {
      const queryMatch = cleanedQuery.match(/(collection\s*\([\s\S]*)/im);
      if (queryMatch) {
        cleanedQuery = queryMatch[1].trim();
        // Remove any trailing explanation text after the query closes
        // Find the last closing paren that balances the query
        let depth = 0;
        let lastClose = -1;
        for (let i = 0; i < cleanedQuery.length; i++) {
          if (cleanedQuery[i] === "(" || cleanedQuery[i] === "[") depth++;
          if (cleanedQuery[i] === ")" || cleanedQuery[i] === "]") {
            depth--;
            if (depth === 0) lastClose = i;
          }
        }
        if (lastClose > 0 && lastClose < cleanedQuery.length - 1) {
          cleanedQuery = cleanedQuery.substring(0, lastClose + 1);
        }
      }
    }

    return { query: cleanedQuery, conversationHistory };
  } catch (error) {
    console.error("[generateMongoQuery] AI error:", error.message, error.status || "", error.code || "");
    return { query: "", conversationHistory };
  }
}

module.exports = {
  generateMongoQuery,
};
