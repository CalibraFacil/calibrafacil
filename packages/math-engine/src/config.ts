import { create, all, type MathJsInstance, type ConfigOptions } from "mathjs";

// ============================================
// SECURITY: List of functions to disable
// ============================================
const BLOCKED_FUNCTIONS = [
  "import",
  "createUnit",
  "reviver",
  "evaluate",
  "parse",
  "simplify",
  "derivative",
  "resolve",
  "compile",
  "chain",
] as const;

// ============================================
// SECURITY: Dangerous patterns to detect in expressions
// ============================================
const DANGEROUS_PATTERNS = [
  /\.__proto__/,
  /\.constructor/,
  /\["__proto__"\]/,
  /\['__proto__'\]/,
  /\["constructor"\]/,
  /\['constructor'\]/,
  /Object\s*\.\s*getOwnPropertyDescriptor/,
  /Object\s*\.\s*defineProperty/,
  /Function\s*\(/,
  /eval\s*\(/,
  /require\s*\(/,
  /import\s*\(/,
  /process\s*\./,
  /global\s*\./,
  /globalThis\s*\./,
  /window\s*\./,
];

// ============================================
// Configuration interface
// ============================================
export interface MathEngineConfig {
  precision: number;
  predictable: boolean;
  /** Enable verbose mode to log calculation traces for audit trails */
  verbose?: boolean;
}

const DEFAULT_CONFIG: MathEngineConfig = {
  precision: 32,
  predictable: true,
};

// ============================================
// Secure Math Instance
// ============================================
export interface SecureMath {
  math: MathJsInstance;
  evaluate: (expr: string, scope?: Record<string, unknown>) => unknown;
}

const NUMERIC_STRING_PATTERN =
  /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?$/i;

function isBigNumberLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    "toString" in value
  );
}

function normalizeScopeValue(value: unknown, math: MathJsInstance): unknown {
  if (typeof value === "number") {
    return math.bignumber(value.toString());
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (NUMERIC_STRING_PATTERN.test(trimmed)) {
      return math.bignumber(trimmed);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeScopeValue(item, math));
  }

  if (isBigNumberLike(value)) {
    return value;
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeScopeValue(item, math),
      ]),
    );
  }

  return value;
}

function normalizeScope(
  scope: Record<string, unknown> | undefined,
  math: MathJsInstance,
): Record<string, unknown> {
  if (!scope) return {};

  return Object.fromEntries(
    Object.entries(scope).map(([key, value]) => [
      key,
      normalizeScopeValue(value, math),
    ]),
  );
}

function normalizeExpression(expr: string): string {
  return expr.replace(/\s*&&\s*/g, " and ").replace(/\s*\|\|\s*/g, " or ");
}

// ============================================
// Create secure math instance
// ============================================
export function createSecureMath(
  config: Partial<MathEngineConfig> = {},
): SecureMath {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const mathConfig: ConfigOptions = {
    number: "BigNumber",
    precision: mergedConfig.precision,
    predictable: mergedConfig.predictable,
  };

  const math = create(all!, mathConfig);

  // CRITICAL: Capture reference to evaluate BEFORE blocking
  const originalEvaluate = math.evaluate.bind(math);

  // Block dangerous functions by overriding them
  const blockedFunctions: Record<string, () => never> = {};
  for (const fn of BLOCKED_FUNCTIONS) {
    blockedFunctions[fn] = () => {
      throw new Error(`Security violation: Function '${fn}' is disabled`);
    };
  }

  math.import(blockedFunctions, { override: true });

  // Return secure evaluate function with pre-validation
  const secureEvaluate = (
    expr: string,
    scope?: Record<string, unknown>,
  ): unknown => {
    // Check for dangerous patterns before evaluation
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(expr)) {
        throw new Error(
          "Security violation: Dangerous pattern detected in expression",
        );
      }
    }

    // Normalize user scope to BigNumber values before mathjs evaluates it.
    // This keeps formulas readable and avoids leaking bignumber(...) calls into
    // calibration methods just to work around JavaScript floating point noise.
    return originalEvaluate(
      normalizeExpression(expr),
      normalizeScope(scope, math),
    );
  };

  return {
    math,
    evaluate: secureEvaluate,
  };
}

// ============================================
// Singleton for default usage
// ============================================
let defaultInstance: SecureMath | null = null;

export function getSecureMath(config?: Partial<MathEngineConfig>): SecureMath {
  if (!defaultInstance || config) {
    defaultInstance = createSecureMath(config);
  }
  return defaultInstance;
}

// ============================================
// Reset singleton (useful for testing)
// ============================================
export function resetSecureMath(): void {
  defaultInstance = null;
}
