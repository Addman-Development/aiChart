const logger = require("./logger").child({ module: "applyVariables" });

const escapeForDoubleQuotedString = (value) => String(value)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, "\\\"");

const escapeForAlreadyQuotedString = (value) => String(value)
  .replace(/\\/g, "\\\\")
  .replace(/"/g, "\\\"")
  .replace(/'/g, "\\'");

const applyPostgresVariables = (dataRequest, variables = {}) => {
  // Don't modify the original dataRequest at all
  const originalDataRequest = dataRequest;

  // Check if there are runtime variables to substitute even without bindings
  const hasRuntimeVariables = variables && Object.keys(variables).length > 0;

  // If there's no query, or no variable bindings AND no runtime variables, return original
  if (!originalDataRequest.query
    || ((!originalDataRequest.VariableBindings
      || originalDataRequest.VariableBindings.length === 0) && !hasRuntimeVariables)
  ) {
    return {
      dataRequest: originalDataRequest,
      processedQuery: originalDataRequest.query
    };
  }

  let processedQuery = originalDataRequest.query;

  // Find all variable placeholders in the query using regex
  const variableRegex = /\{\{([^}]+)\}\}/g;
  let match;
  const foundVariables = [];

  // Extract all variables from the query
  // eslint-disable-next-line no-cond-assign
  while ((match = variableRegex.exec(processedQuery)) !== null) {
    const variableName = match[1].trim();
    const startIndex = match.index;
    const endIndex = match.index + match[0].length;

    // Check if the variable is already quoted
    const beforeChar = startIndex > 0 ? processedQuery[startIndex - 1] : "";
    const afterChar = endIndex < processedQuery.length ? processedQuery[endIndex] : "";
    const isAlreadyQuoted = (beforeChar === "'" && afterChar === "'") || (beforeChar === "\"" && afterChar === "\"");

    foundVariables.push({
      placeholder: match[0],
      name: variableName,
      startIndex,
      endIndex,
      isAlreadyQuoted
    });
  }

  // Replace variables with their values using priority: runtime > default > error/removal
  foundVariables.forEach((variable) => {
    const binding = originalDataRequest.VariableBindings.find((vb) => vb.name === variable.name);

    // Check for runtime variable value first
    const runtimeValue = variables[variable.name];
    const hasRuntimeValue = runtimeValue !== null && runtimeValue !== undefined && runtimeValue !== "";

    // Check for default value
    const hasDefaultValue = binding?.default_value !== null
      && binding?.default_value !== undefined
      && binding?.default_value !== "";

    if (hasRuntimeValue) {
      // Priority 1: Use runtime value
      let replacementValue = runtimeValue;

      // Handle different data types based on binding type (if available)
      if (binding?.type) {
        switch (binding.type) {
          case "string":
            replacementValue = variable.isAlreadyQuoted
              ? String(runtimeValue).replace(/'/g, "''").replace(/"/g, "\"\"")
              : `'${String(runtimeValue).replace(/'/g, "''")}'`;
            break;
          case "number":
            replacementValue = Number.isNaN(Number(runtimeValue)) ? "0" : String(runtimeValue);
            break;
          case "boolean":
            replacementValue = (runtimeValue === "true" || runtimeValue === true) ? "TRUE" : "FALSE";
            break;
          case "date":
            replacementValue = variable.isAlreadyQuoted
              ? String(runtimeValue)
              : `'${String(runtimeValue)}'`;
            break;
          default:
            replacementValue = variable.isAlreadyQuoted
              ? String(runtimeValue).replace(/'/g, "''").replace(/"/g, "\"\"")
              : `'${String(runtimeValue).replace(/'/g, "''")}'`;
        }
      } else {
        // No binding type info, treat as string
        replacementValue = variable.isAlreadyQuoted
          ? String(runtimeValue).replace(/'/g, "''").replace(/"/g, "\"\"")
          : `'${String(runtimeValue).replace(/'/g, "''")}'`;
      }

      processedQuery = processedQuery.replace(variable.placeholder, replacementValue);
    } else if (hasDefaultValue && binding) {
      // Priority 2: Use default value
      let replacementValue = binding.default_value;

      switch (binding.type) {
        case "string":
          replacementValue = variable.isAlreadyQuoted
            ? binding.default_value.replace(/'/g, "''").replace(/"/g, "\"\"")
            : `'${binding.default_value.replace(/'/g, "''")}'`;
          break;
        case "number":
          replacementValue = Number.isNaN(Number(binding.default_value)) ? "0" : binding.default_value;
          break;
        case "boolean":
          replacementValue = binding.default_value === "true" || binding.default_value === true ? "TRUE" : "FALSE";
          break;
        case "date":
          replacementValue = variable.isAlreadyQuoted
            ? binding.default_value
            : `'${binding.default_value}'`;
          break;
        default:
          replacementValue = variable.isAlreadyQuoted
            ? binding.default_value.replace(/'/g, "''").replace(/"/g, "\"\"")
            : `'${binding.default_value.replace(/'/g, "''")}'`;
      }

      processedQuery = processedQuery.replace(variable.placeholder, replacementValue);
    } else {
      // Priority 3: No runtime value and no default value
      if (binding?.required) {
        // Required variable without value - throw error
        throw new Error(`Required variable '${variable.name}' has no value provided and no default value`);
      }

      // Not required and no value - remove the placeholder
      processedQuery = processedQuery.replace(variable.placeholder, "");
    }
  });

  return {
    dataRequest: originalDataRequest, // Original unchanged
    processedQuery // Query with variables resolved
  };
};

const applyMongoVariables = (dataRequest, variables = {}) => {
  // Don't modify the original dataRequest at all
  const originalDataRequest = dataRequest;

  // Check if there are runtime variables to substitute even without bindings
  const hasRuntimeVariables = variables && Object.keys(variables).length > 0;

  // If there's no query, or no variable bindings AND no runtime variables, return original
  if (!originalDataRequest.query
    || ((!originalDataRequest.VariableBindings
      || originalDataRequest.VariableBindings.length === 0) && !hasRuntimeVariables)
  ) {
    return {
      dataRequest: originalDataRequest,
      processedQuery: originalDataRequest.query
    };
  }

  let processedQuery = originalDataRequest.query;

  // Find all variable placeholders in the query using regex
  const variableRegex = /\{\{([^}]+)\}\}/g;
  let match;
  const foundVariables = [];

  // Extract all variables from the query
  // eslint-disable-next-line no-cond-assign
  while ((match = variableRegex.exec(processedQuery)) !== null) {
    const variableName = match[1].trim();
    const startIndex = match.index;
    const endIndex = match.index + match[0].length;

    // Check if the variable is already quoted
    const beforeChar = startIndex > 0 ? processedQuery[startIndex - 1] : "";
    const afterChar = endIndex < processedQuery.length ? processedQuery[endIndex] : "";
    const isAlreadyQuoted = (beforeChar === "'" && afterChar === "'") || (beforeChar === "\"" && afterChar === "\"");

    foundVariables.push({
      placeholder: match[0],
      name: variableName,
      startIndex,
      endIndex,
      isAlreadyQuoted
    });
  }

  // Replace variables with their values using priority: runtime > default > error/removal
  foundVariables.forEach((variable) => {
    const binding = originalDataRequest.VariableBindings?.find((vb) => vb.name === variable.name);

    // Check for runtime variable value first
    const runtimeValue = variables[variable.name];
    const hasRuntimeValue = runtimeValue !== null && runtimeValue !== undefined && runtimeValue !== "";

    // Check for default value
    const hasDefaultValue = binding?.default_value !== null
      && binding?.default_value !== undefined
      && binding?.default_value !== "";

    // Determine if this is a known date variable (reserved or typed)
    const isDateVariable = binding?.type === "date"
      || variable.name === "start_date"
      || variable.name === "end_date";

    if (isDateVariable) {
      logger.debug({
        variable: variable.name,
        runtimeValue,
        hasRuntimeValue,
        isDateVariable,
      }, "applyMongoVariables: date variable resolved");
    }

    if (hasRuntimeValue) {
      // Priority 1: Use runtime value
      let replacementValue = runtimeValue;

      if (isDateVariable) {
        if (variable.isAlreadyQuoted) {
          // Placeholder is inside quotes (e.g. "{{start_date}}") — field stores dates as strings
          // Just substitute the raw value; the surrounding quotes handle formatting
          replacementValue = String(runtimeValue);
        } else {
          // Bare placeholder — field stores native Date objects; wrap in new Date()
          replacementValue = `new Date("${String(runtimeValue)}")`;
        }
      } else if (binding?.type) {
        // Handle different data types based on binding type
        switch (binding.type) {
          case "string":
            // For MongoDB, strings need to be properly quoted
            replacementValue = variable.isAlreadyQuoted
              ? escapeForAlreadyQuotedString(runtimeValue)
              : `"${escapeForDoubleQuotedString(runtimeValue)}"`;
            break;
          case "number":
            replacementValue = Number.isNaN(Number(runtimeValue)) ? "0" : Number(runtimeValue);
            break;
          case "boolean":
            replacementValue = (runtimeValue === "true" || runtimeValue === true) ? "true" : "false";
            break;
          default:
            replacementValue = variable.isAlreadyQuoted
              ? escapeForAlreadyQuotedString(runtimeValue)
              : `"${escapeForDoubleQuotedString(runtimeValue)}"`;
        }
      } else {
        // No binding type info, treat as string
        replacementValue = variable.isAlreadyQuoted
          ? escapeForAlreadyQuotedString(runtimeValue)
          : `"${escapeForDoubleQuotedString(runtimeValue)}"`;
      }

      processedQuery = processedQuery.replace(variable.placeholder, replacementValue);
    } else if (hasDefaultValue && binding) {
      // Priority 2: Use default value
      let replacementValue = binding.default_value;

      if (isDateVariable) {
        if (variable.isAlreadyQuoted) {
          replacementValue = String(binding.default_value);
        } else {
          replacementValue = `new Date("${String(binding.default_value)}")`;
        }
      } else {
        switch (binding.type) {
          case "string":
            replacementValue = variable.isAlreadyQuoted
              ? escapeForAlreadyQuotedString(binding.default_value)
              : `"${escapeForDoubleQuotedString(binding.default_value)}"`;
            break;
          case "number":
            replacementValue = Number.isNaN(Number(binding.default_value)) ? "0" : Number(binding.default_value);
            break;
          case "boolean":
            replacementValue = binding.default_value === "true" || binding.default_value === true ? "true" : "false";
            break;
          default:
            replacementValue = variable.isAlreadyQuoted
              ? escapeForAlreadyQuotedString(binding.default_value)
              : `"${escapeForDoubleQuotedString(binding.default_value)}"`;
        }
      }

      processedQuery = processedQuery.replace(variable.placeholder, replacementValue);
    } else {
      // Priority 3: No runtime value and no default value
      if (binding?.required) {
        // Required variable without value - throw error
        throw new Error(`Required variable '${variable.name}' has no value provided and no default value`);
      }

      // Not required and no value - remove the placeholder
      processedQuery = processedQuery.replace(variable.placeholder, variable.isAlreadyQuoted ? "" : "\"\"");
    }
  });

  return {
    dataRequest: originalDataRequest, // Original unchanged
    processedQuery // Query with variables resolved
  };
};

const applyApiVariables = (dataRequest, variables = {}) => {
  // Don't modify the original dataRequest at all
  const originalDataRequest = dataRequest;

  // Check if there are runtime variables to substitute even without bindings
  const hasRuntimeVariables = variables && Object.keys(variables).length > 0;

  // If there's no variable bindings AND no runtime variables, return original unchanged
  if ((!originalDataRequest.VariableBindings
    || originalDataRequest.VariableBindings.length === 0) && !hasRuntimeVariables
  ) {
    return {
      dataRequest: originalDataRequest,
      processedRoute: originalDataRequest.route,
      processedHeaders: originalDataRequest.headers,
      processedBody: originalDataRequest.body
    };
  }

  // Helper function to process variables in a string
  const processVariablesInString = (str) => {
    if (!str || typeof str !== "string") return str;

    const variableRegex = /\{\{([^}]+)\}\}/g;
    let match;
    const foundVariables = [];

    // Extract all variables from the string
    // eslint-disable-next-line no-cond-assign
    while ((match = variableRegex.exec(str)) !== null) {
      const variableName = match[1].trim();
      foundVariables.push({
        placeholder: match[0],
        name: variableName,
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    }

    let processedStr = str;

    // Replace variables with their values using priority: runtime > default > error/removal
    foundVariables.forEach((variable) => {
      // Skip reserved date variables when no runtime value is provided
      // (legacy behavior - ConnectionController handles them separately)
      // When runtime values exist (e.g. from scopeDateToQuery), substitute them normally
      if ((variable.name === "start_date" || variable.name === "end_date")
        && !variables[variable.name]) {
        return;
      }

      const binding = originalDataRequest.VariableBindings.find((vb) => vb.name === variable.name);

      // Check for runtime variable value first
      const runtimeValue = variables[variable.name];
      const hasRuntimeValue = runtimeValue !== null && runtimeValue !== undefined && runtimeValue !== "";

      // Check for default value
      const hasDefaultValue = binding?.default_value !== null
        && binding?.default_value !== undefined
        && binding?.default_value !== "";

      if (hasRuntimeValue) {
        // Priority 1: Use runtime value
        let replacementValue = runtimeValue;

        // Handle different data types based on binding type (if available)
        if (binding?.type) {
          switch (binding.type) {
            case "string":
              replacementValue = String(runtimeValue);
              break;
            case "number":
              replacementValue = Number.isNaN(Number(runtimeValue)) ? "0" : String(runtimeValue);
              break;
            case "boolean":
              replacementValue = (runtimeValue === "true" || runtimeValue === true) ? "true" : "false";
              break;
            case "date":
              replacementValue = String(runtimeValue);
              break;
            default:
              replacementValue = String(runtimeValue);
          }
        } else {
          // No binding type info, treat as string
          replacementValue = String(runtimeValue);
        }

        processedStr = processedStr.replace(variable.placeholder, replacementValue);
      } else if (hasDefaultValue && binding) {
        // Priority 2: Use default value
        let replacementValue = binding.default_value;

        switch (binding.type) {
          case "string":
            replacementValue = String(binding.default_value);
            break;
          case "number":
            replacementValue = Number.isNaN(Number(binding.default_value)) ? "0" : String(binding.default_value);
            break;
          case "boolean":
            replacementValue = binding.default_value === "true" || binding.default_value === true ? "true" : "false";
            break;
          case "date":
            replacementValue = String(binding.default_value);
            break;
          default:
            replacementValue = String(binding.default_value);
        }

        processedStr = processedStr.replace(variable.placeholder, replacementValue);
      } else {
        // Priority 3: No runtime value and no default value
        if (binding?.required) {
          // Required variable without value - throw error
          throw new Error(`Required variable '${variable.name}' has no value provided and no default value`);
        }

        // Not required and no value - remove the placeholder
        processedStr = processedStr.replace(variable.placeholder, "");
      }
    });

    return processedStr;
  };

  // Process route/URL
  const processedRoute = processVariablesInString(originalDataRequest.route);

  // Process headers
  let processedHeaders = originalDataRequest.headers;
  if (processedHeaders && typeof processedHeaders === "object") {
    processedHeaders = {};
    Object.keys(originalDataRequest.headers).forEach((key) => {
      const processedKey = processVariablesInString(key);
      const processedValue = processVariablesInString(originalDataRequest.headers[key]);
      processedHeaders[processedKey] = processedValue;
    });
  }

  // Process body
  const processedBody = processVariablesInString(originalDataRequest.body);

  return {
    dataRequest: originalDataRequest, // Original unchanged
    processedRoute,
    processedHeaders,
    processedBody
  };
};

const applyVariables = (dataRequest, variables = {}) => {
  // Check the connection type instead of dataset type
  const connectionType = dataRequest.Connection?.type;

  switch (connectionType) {
    case "postgres":
    case "mssql":
      return applyPostgresVariables(dataRequest, variables);
    case "mongodb":
      return applyMongoVariables(dataRequest, variables);
    case "api":
      return applyApiVariables(dataRequest, variables);
    default:
      return {
        dataRequest,
        processedQuery: dataRequest.query
      };
  }
};

module.exports = {
  applyVariables,
  applyPostgresVariables,
  applyMongoVariables,
  applyApiVariables,
};
