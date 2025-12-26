# @calibra-facil/math-engine

![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)
![Environment](https://img.shields.io/badge/Environment-Universal%20%2F%20Edge-green)
![Compliance](https://img.shields.io/badge/Compliance-ISO%2FIEC%2017025-orange)
![Precision](https://img.shields.io/badge/Precision-BigNumber%20(64)-purple)

A secure, deterministic, and GUM-compliant (Guide to the Expression of Uncertainty in Measurement) calculation engine designed for regulated calibration environments.

This package provides the core mathematical logic for the Calibra Fácil platform. It runs isomorphically on **Cloudflare Workers**, **Bun**, and the **Browser**.

---

## 🔒 Core Philosophy

1.  **Safety First:** No `eval()`, no `new Function()`, and no `isolated-vm`. Security is enforced via a strict `mathjs` allow-list and Regex pre-validation.
2.  **Absolute Determinism:** Inputs produce the exact same output, bit-for-bit, every time.
3.  **BigNumber Precision:** All internal calculations use 64-digit floating point precision (IEEE 754 bypass) to prevent rounding errors (e.g., `0.1 + 0.2 === 0.3`).
4.  **Traceability:** Every execution returns metadata regarding the engine version and exact inputs used, satisfying ISO 17025 Clause 7.11.

---

## 📦 Installation

```bash
pnpm add @calibra-facil/math-engine
```

---

## 🚀 Usage

### 1. Basic Formula Execution
Execute user-defined formulas securely. Variables are injected via a context object.

```typescript
import { createEngine } from "@calibra-facil/math-engine";

const engine = createEngine();

const result = engine.evaluateFormula({
  formula: "(reading + offset) * factor",
  context: {
    reading: 10.005,
    offset: 0.001,
    factor: 1.002
  }
});

if (result.success) {
  console.log(result.data.result); // BigNumber string representation
  console.log(result.data.executionTimeMs); // Performance metric
}
```

### 2. GUM Type A (Statistical Uncertainty)
Calculate uncertainty based on repeated measurements ($u_A = s / \sqrt{n}$).

```typescript
import { calculateTypeA } from "@calibra-facil/math-engine";

const result = calculateTypeA({
  readings: [100.01, 100.02, 99.99, 100.00, 100.01]
});

console.log(result);
// {
//   mean: 100.006,
//   standardDeviation: 0.0114...,
//   standardUncertainty: 0.0051...,
//   degreesOfFreedom: 4,
//   sampleSize: 5
// }
```

### 3. GUM Type B (Systematic Uncertainty)
Calculate uncertainty from non-statistical sources (certificates, resolution, drift).

```typescript
import { calculateTypeB } from "@calibra-facil/math-engine";

const result = calculateTypeB([
  {
    name: "resolution",
    value: 0.01,
    distribution: "rectangular" // Divisor: √3
  },
  {
    name: "reference_cert",
    value: 0.05,
    distribution: "normal",
    coverageFactor: 2 // Divisor: 2
  }
]);

console.log(result.totalTypeB); // Combined RSS
```

### 4. Full Calibration Workflow
The `performCalibration` method orchestrates the entire flow: Data Flattening -> Type A -> Type B -> Combined -> Custom Formulas.

```typescript
const result = engine.performCalibration(
  // 1. Raw Data (Nested)
  {
    readings: [{ value: 10.1 }, { value: 10.2 }, { value: 10.1 }],
    environment: { temperature: 23.5 },
    instrument: { resolution: 0.01 }
  },
  // 2. Type B Components
  [
    { name: "resolution", value: 0.01, distribution: "rectangular" }
  ],
  // 3. Custom Formulas to Execute
  [
    "mean + 0.05",          // Correction
    "u_combined * 2"        // Expanded Uncertainty
  ]
);

// Returns structured data with ISO traceability metadata
console.log(result.data.meta);
// { engineVersion: "1.0.0", timestamp: "...", inputsUsed: ["readings_0", "env_temperature", ...] }
```

---

## 📐 Data Flattening & Normalization

The engine automatically "flattens" complex JSON objects into a single-layer scope for math execution.

**Input:**
```json
{
  "point1": { "reading": "500 g" },
  "environment": { "temp": 20 }
}
```

**Flattened Scope:**
```js
{
  "point1_reading": 0.5, // Automatically normalized to SI (kg)
  "env_temp": 20
}
```

### Supported Unit Normalizations
The engine attempts to normalize strings to **SI Base Units** before calculation.

| Input Unit | Base Unit | Factor |
| :--- | :--- | :--- |
| `g`, `mg`, `lb` | `kg` | Mass |
| `mm`, `cm`, `in` | `m` | Length |
| `mL`, `L` | `m^3` | Volume |
| `mV` | `V` | Potential |
| `bar`, `psi` | `Pa` | Pressure |

---

## 🛡 Security & Compliance

### 1. The Sandbox
The engine does **not** use `vm` or `isolated-vm`, ensuring compatibility with Edge runtimes (Cloudflare Workers). Instead, it uses a restricted `mathjs` instance:
*   **Blocked:** `import`, `evaluate`, `parse`, `createUnit`, `simplify`.
*   **Allowed:** Arithmetic, Trigonometry, Statistics, Logic.
*   **Prototype Defense:** Regex pre-validation blocks access to `__proto__`, `constructor`, and `Function()`.

### 2. Traceability (ISO 17025 Clause 7.11)
Every calculation result includes a `meta` object containing:
*   **Engine Version:** The semantic version of the math engine.
*   **Timestamp:** ISO 8601 execution time.
*   **Inputs Used:** A list of every variable key that was actually available in the scope.

### 3. Verification
The package includes a comprehensive test suite (`vitest`) verifying:
*   **Precision:** `0.1 + 0.2 === 0.3` (Proven via BigNumber).
*   **Security:** Attempts to inject malicious code (e.g., `import('fs')`) throw explicitly typed `SECURITY_VIOLATION` errors.
*   **GUM Logic:** Verification against known dataset standards.

---

## 📚 API Reference

### `CalibrationEngine`
The main class.
*   `evaluateFormula(input: FormulaExecutionInput)`: Sync execution.
*   `performCalibration(data, typeB, formulas)`: Full workflow.

### `flattenForExecution(data, options)`
Utility to convert nested objects into flat math scopes.
*   `options.normalizeUnits`: (default: `true`) Converts "10 mm" to `0.01`.
*   `options.excludeKeys`: (default: `['nominal', 'reference', 'target']`) Prevents metadata from polluting math scope.

### `calculateCombinedUncertainty(input)`
Performs RSS (Root Sum Squares) combination and Welch-Satterthwaite effective degrees of freedom calculation.

---

## ⚠️ Error Handling

The engine returns a `Discriminated Union` result type:

```typescript
type EngineResult<T> =
  | { success: true; data: T }
  | { success: false; error: MathEngineError };
```

**Error Codes:**
*   `SECURITY_VIOLATION`: User attempted to run forbidden code.
*   `FORMULA_ERROR`: Syntax error in the math expression.
*   `INVALID_INPUT`: Zod validation failure.
*   `PRECISION_ERROR`: BigNumber conversion failure.
