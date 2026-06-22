import React, { useState, useRef, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Input, Listbox, ListboxItem, ListboxSection } from "@heroui/react";

// Supported formulas from hot-formula-parser
// https://github.com/handsontable/formula-parser/blob/develop/src/supported-formulas.js
const SUPPORTED_FORMULAS = [
  "ABS", "ACCRINT", "ACOS", "ACOSH", "ACOT", "ACOTH", "ADD", "AGGREGATE", "AND", "ARABIC",
  "ASIN", "ASINH", "ATAN", "ATAN2", "ATANH", "AVEDEV", "AVERAGE", "AVERAGEA", "AVERAGEIF",
  "AVERAGEIFS", "BASE", "BESSELI", "BESSELJ", "BESSELK", "BESSELY", "BETA.DIST", "BETA.INV",
  "BIN2DEC", "BIN2HEX", "BIN2OCT", "BINOM.DIST", "BINOM.DIST.RANGE", "BINOM.INV",
  "CEILING", "CHAR", "CHISQ.DIST", "CHISQ.INV", "CHOOSE", "CLEAN", "CODE", "COMBIN",
  "COMBINA", "COMPLEX", "CONCATENATE", "CONFIDENCE", "CONFIDENCE.NORM", "CONFIDENCE.T",
  "CONVERT", "CORREL", "COS", "COSH", "COT", "COTH", "COUNT", "COUNTA", "COUNTBLANK",
  "COUNTIF", "COUNTIFS", "COUNTUNIQUE", "CSC", "CSCH", "CUMIPMT", "CUMPRINC",
  "DATE", "DATEVALUE", "DAY", "DAYS", "DAYS360", "DB", "DDB", "DEC2BIN", "DEC2HEX",
  "DEC2OCT", "DECIMAL", "DEGREES", "DELTA", "DEVSQ", "DIVIDE", "DOLLARDE", "DOLLARFR",
  "E", "EDATE", "EFFECT", "EOMONTH", "EQ", "ERF", "ERFC", "EVEN", "EXACT", "EXP",
  "EXPON.DIST", "F.DIST", "F.DIST.RT", "F.INV", "F.INV.RT", "FACT", "FACTDOUBLE",
  "FALSE", "FIND", "FISHER", "FISHERINV", "FLATTEN", "FLOOR", "FORECAST", "FREQUENCY",
  "FV", "FVSCHEDULE", "GAMMA", "GAMMA.DIST", "GAMMA.INV", "GAMMALN", "GAUSS", "GCD",
  "GEOMEAN", "GESTEP", "GROWTH", "GTE", "HARMEAN", "HEX2BIN", "HEX2DEC", "HEX2OCT",
  "HOUR", "HYPGEOM.DIST", "IF", "IMABS", "IMAGINARY", "IMARGUMENT", "IMCONJUGATE",
  "IMCOS", "IMCOSH", "IMCOT", "IMCSC", "IMCSCH", "IMDIV", "IMEXP", "IMLN", "IMLOG10",
  "IMLOG2", "IMPOWER", "IMPRODUCT", "IMREAL", "IMSEC", "IMSECH", "IMSIN", "IMSINH",
  "IMSQRT", "IMSUB", "IMSUM", "IMTAN", "INT", "INTERCEPT", "INTERVAL", "IPMT", "IRR",
  "ISBLANK", "ISEVEN", "ISLOGICAL", "ISNONTEXT", "ISNUMBER", "ISODD", "ISOWEEKNUM",
  "ISPMT", "ISTEXT", "KURT", "LARGE", "LCM", "LEFT", "LEN", "LINEST", "LN", "LOG",
  "LOG10", "LOGEST", "LOGNORM.DIST", "LOGNORM.INV", "LOWER", "LT", "LTE",
  "MATCH", "MAX", "MAXA", "MEDIAN", "MID", "MIN", "MINA", "MINUS", "MINUTE", "MIRR",
  "MOD", "MODE.MULT", "MODE.SNGL", "MONTH", "MROUND", "MULTINOMIAL", "MULTIPLY",
  "NE", "NEGBINOM.DIST", "NETWORKDAYS", "NOMINAL", "NORM.DIST", "NORM.INV",
  "NORM.S.DIST", "NORM.S.INV", "NOT", "NOW", "NPER", "NPV",
  "OCT2BIN", "OCT2DEC", "OCT2HEX", "ODD", "OR", "PDURATION", "PEARSON",
  "PERCENTILEEXC", "PERCENTILEINC", "PERCENTRANKEXC", "PERCENTRANKINC",
  "PERMUT", "PERMUTATIONA", "PHI", "PI", "PMT", "POISSON.DIST", "POWER", "PPMT",
  "PROB", "PRODUCT", "PROPER", "PV",
  "QUARTILE.EXC", "QUARTILE.INC", "QUOTIENT", "RADIANS", "RAND", "RANDBETWEEN",
  "RANK.AVG", "RANK.EQ", "RATE", "REGEXEXTRACT", "REGEXMATCH", "REGEXREPLACE",
  "REPLACE", "REPT", "RIGHT", "ROMAN", "ROUND", "ROUNDDOWN", "ROUNDUP", "ROW",
  "ROWS", "RRI", "RSQ",
  "SEARCH", "SEC", "SECH", "SECOND", "SERIESSUM", "SIGN", "SIN", "SINH", "SKEW",
  "SKEW.P", "SLN", "SLOPE", "SMALL", "SPLIT", "SQRT", "SQRTPI", "STANDARDIZE",
  "STDEV.P", "STDEV.S", "STDEVA", "STEYX", "SUBSTITUTE", "SUBTOTAL", "SUM", "SUMIF",
  "SUMIFS", "SUMPRODUCT", "SUMSQ", "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "SWITCH", "SYD",
  "T", "T.DIST", "T.DIST.2T", "T.DIST.RT", "T.INV", "T.INV.2T", "TAN", "TANH",
  "TBILLEQ", "TBILLPRICE", "TBILLYIELD", "TIME", "TIMEVALUE", "TODAY", "TRANSPOSE",
  "TREND", "TRIM", "TRIMMEAN", "TRUE", "TRUNC",
  "UNICHAR", "UNICODE", "UNIQUE", "UPPER",
  "VAR.P", "VAR.S", "VARA", "WEEKDAY", "WEEKNUM", "WEIBULL.DIST", "WORKDAY",
  "XIRR", "XNPV", "XOR", "YEAR", "YEARFRAC",
];

// Built-in variables available in formula expressions
const VARIABLES = [
  { name: "val", description: "current data point value" },
  { name: "index", description: "position of current data point (0-based)" },
  { name: "count", description: "total number of data points" },
  { name: "sum", description: "sum of all data point values" },
  { name: "avg", description: "average of all data point values" },
  { name: "min", description: "minimum data point value" },
  { name: "max", description: "maximum data point value" },
];

const VARIABLE_NAMES = VARIABLES.map((v) => v.name);
const ALL_SUGGESTIONS = [...VARIABLE_NAMES, ...SUPPORTED_FORMULAS];

/**
 * Extract the current token being typed at the cursor position within {} braces.
 * Returns { token, startIndex } or null if cursor is not inside braces.
 */
function getTokenAtCursor(value, cursorPos) {
  // Find the innermost { before cursor
  let braceStart = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    if (value[i] === "{") { braceStart = i; break; }
    if (value[i] === "}") break;
  }
  if (braceStart === -1) return null;

  // Find where the current token starts (after operators, parens, commas, spaces)
  const delimiters = /[+\-*/(),\s{]/;
  let tokenStart = cursorPos;
  for (let i = cursorPos - 1; i > braceStart; i--) {
    if (delimiters.test(value[i])) {
      tokenStart = i + 1;
      break;
    }
    if (i === braceStart + 1) {
      tokenStart = i;
    }
  }
  // Handle cursor right after the opening brace
  if (tokenStart > cursorPos) tokenStart = cursorPos;

  const token = value.substring(tokenStart, cursorPos).toUpperCase();
  return { token, startIndex: tokenStart, endIndex: cursorPos };
}

function FormulaInput({ value, onChange, placeholder, variant, fullWidth }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tokenInfo, setTokenInfo] = useState(null);
  const inputRef = useRef(null);
  const popoverRef = useRef(null);

  const updateSuggestions = useCallback((inputValue, cursorPos) => {
    const info = getTokenAtCursor(inputValue, cursorPos);
    if (!info || info.token.length === 0) {
      setShowSuggestions(false);
      setTokenInfo(null);
      return;
    }

    setTokenInfo(info);
    const filtered = ALL_SUGGESTIONS.filter(
      (f) => f.toUpperCase().startsWith(info.token) && f.toUpperCase() !== info.token
    );

    if (filtered.length > 0 && info.token.length > 0) {
      setSuggestions(filtered.slice(0, 8));
      setSelectedIndex(0);
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, []);

  const applySuggestion = useCallback((suggestion) => {
    if (!tokenInfo) return;
    const before = value.substring(0, tokenInfo.startIndex);
    const after = value.substring(tokenInfo.endIndex);
    // Add opening paren for functions, not for variables
    const isVariable = VARIABLE_NAMES.includes(suggestion);
    const insert = isVariable ? suggestion : `${suggestion}(`;
    const newValue = `${before}${insert}${after}`;
    onChange({ target: { value: newValue } });
    setShowSuggestions(false);

    // Refocus input and place cursor after insertion
    setTimeout(() => {
      if (inputRef.current) {
        const el = inputRef.current.querySelector("input") || inputRef.current;
        el.focus();
        const pos = tokenInfo.startIndex + insert.length;
        el.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [tokenInfo, value, onChange]);

  const handleKeyDown = (e) => {
    if (!showSuggestions) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (suggestions[selectedIndex]) {
        e.preventDefault();
        applySuggestion(suggestions[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const handleChange = (e) => {
    onChange(e);
    const el = e.target;
    // Use setTimeout to read cursor position after React updates
    setTimeout(() => {
      updateSuggestions(el.value, el.selectionStart || el.value.length);
    }, 0);
  };

  const handleClick = (e) => {
    updateSuggestions(value, e.target.selectionStart || 0);
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target)
        && inputRef.current && !inputRef.current.contains(e.target)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={inputRef}>
      <Input
        labelPlacement="outside"
        placeholder={placeholder || "Enter your formula here: {val}"}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        variant={variant || "bordered"}
        fullWidth={fullWidth}
        autoComplete="off"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute z-50 mt-1 w-full max-h-[200px] overflow-auto rounded-lg border border-default-200 bg-content1 shadow-lg"
        >
          <Listbox
            aria-label="Formula suggestions"
            onAction={(key) => applySuggestion(key)}
            selectedKeys={new Set([suggestions[selectedIndex]])}
            selectionMode="single"
          >
            <ListboxSection title="Suggestions">
              {suggestions.map((s, i) => (
                <ListboxItem
                  key={s}
                  className={i === selectedIndex ? "bg-primary-100 dark:bg-primary-50/20" : ""}
                  textValue={s}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{s}</span>
                    <span className="text-xs text-default-400">
                      {VARIABLES.find((v) => v.name === s)?.description || "function"}
                    </span>
                  </div>
                </ListboxItem>
              ))}
            </ListboxSection>
          </Listbox>
        </div>
      )}
    </div>
  );
}

FormulaInput.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  variant: PropTypes.string,
  fullWidth: PropTypes.bool,
};

export default FormulaInput;
