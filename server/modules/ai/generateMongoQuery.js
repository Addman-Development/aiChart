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

        Current Date: ${new Date().toISOString().split("T")[0]}
        Use this when interpreting relative date references (e.g. "YTD" means January 1 of the current year to today, "last month", "this quarter", etc.).

        Database Schema:
        ${formattedSchema}

        IMPORTANT RULES:
        - Output ONLY the raw Mongo query. No explanations, no markdown, no code fences, no comments, no descriptions of what changed.
        - Never wrap the output in \`\`\`javascript or \`\`\` blocks. Return plain query only.
        - When a current query is provided, treat it as the BASE. Apply ONLY the specific change the user requested. Preserve all existing stages, fields, filters, sorts, and structure. Do NOT rewrite, simplify, or restructure the query beyond what was asked.
        - Output format: collection('collectionName').operation()
        - FORMATTING: Always output queries with line breaks and indentation for readability. Each method call on a new line, each aggregation stage on its own line, nested objects indented. Example:
          collection('movies')
            .find({ status: "active" })
            .sort({ createdAt: -1 })
            .limit(10)
        - For aggregation pipelines, put each stage on its own line:
          collection('orders').aggregate([
            { $match: { status: "active" } },
            { $group: { _id: "$category", total: { $sum: "$amount" } } },
            { $sort: { total: -1 } }
          ])
        - If the user asks for a query with variables, use the variables in the query.
        - Example: collection('movies').find({status: {{status}}}).limit(10)
        - Don't add variables if not specified by the user.
        - ADDMAN-SmartChart supports a "Scope dates to query" feature using the reserved variables {{start_date}} and {{end_date}}. These are automatically converted to new Date() objects at runtime, so use them directly without wrapping in new Date() or quotes.
        - DEFAULT BEHAVIOR: When the schema contains date/timestamp fields that can logically scope the result set (e.g. created_at, updated_at, order_date, timestamp), ALWAYS include {{start_date}} and {{end_date}} in the query filters. This is the preferred pattern for all time-series or date-bound queries.
        - Example: collection('orders').find({created_at: {$gte: {{start_date}}, $lte: {{end_date}}}}).sort({created_at: 1})
        - The system will automatically enable date scoping on the chart. These variables are populated from the chart's date picker.
        - Do NOT add {{start_date}}/{{end_date}} only when: (1) there are no date fields in the queried collections, (2) the user explicitly asks for ALL data without date filtering, (3) the query is a simple total count/aggregate not meant to be time-bound, or (4) the date fields are not relevant for scoping.
        - When in doubt, include them — users can always adjust the date range later.
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
