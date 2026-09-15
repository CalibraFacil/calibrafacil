# Math-engine 0.4.0 — release note

Successor to 0.3.0 (dossier CF-VAL-MATH-ENGINE-0.3.0 rev. 1.1). Validation dossier: `validation/math-engine/v0.4.0/` (rev. 1.0). Branch `feat/math-engine-0.4.0`, stacked on PR #902.

## Why a new version

The 0.3.0 audit remediation (PR #902) was done under a byte-stability rule: no result the 0.3.0 engine already produced correctly could change, so every exact path (decimal derivative, exact Type A statistics, exact rational rounding, scale-normalized Welch–Satterthwaite) was gated to engage only on inputs a double cannot carry. That kept 0.3.0 snapshots reproducible but left two code paths per computation and one probe-detected drift (finding 14). 0.4.0 removes the gating: decimal mode is exact everywhere, and the version — not a heuristic — separates the two result sets.

## What changed

1. **Exact arithmetic throughout decimal mode.**
   - Symbolic sensitivities are evaluated with `DecimalBackend` for every estimate (`gum/measurement.ts`); `roundTripsThroughDouble` is no longer consulted on this path (it remains the guard for the numerical-derivative fallback, which is inherently double).
   - `typeAFromRepeatedObservations` always centres and squares exactly; the result gains `canonicalMean` (exact rational mean rendered at `decimalPrecision`), which decimal-mode models now use as the quantity estimate instead of the double mean.
   - `DeterministicDecimal.toCanonicalString` rounds the rational itself (exact half-up) whenever the terminating expansion exceeds 120 places; nothing goes through a double. `-2/3` is now `…667` (was `…666`).
2. **Welch–Satterthwaite for correlated input quantities.** New `generalizedWelchSatterthwaiteDegreesOfFreedom(u_c², b_i = c_i·u_i, ρ, ν)` implementing Castrup (2010, rev. 2020) Eq. 46, cf. Willink (2007). `evaluateMeasurementModel` uses it whenever `correlations`/`covariances` are declared (`correlatedDegreesOfFreedom: "generalized"`, default, recorded in the canonical input) and emits `EFFECTIVE_DEGREES_OF_FREEDOM_GENERALIZED`. `"diagonal"` keeps GUM G.2b on the diagonal contributions (pre-0.4.0 behaviour) with the existing limitation warning. Method definitions declare it via `measurementModels[].options.correlatedDegreesOfFreedom`. Assumption stated in the dossier: uncertainty _estimates_ of correlated components are statistically independent (Castrup §3.2); paired Type A from the same observation series is out of scope (Willink: ν = n − 1).
3. **`welchSatterthwaiteDegreesOfFreedom`** keeps only the scale-normalized form (the 0.3.0-first gate is gone).
4. **Execution guard** (`packages/method-definition/src/execute.ts`): `executeCompiledMethod` returns `ok: false` with `ENGINE_VERSION_MISMATCH` when the running engine reports a version different from `method.engine.version`. Methods compiled without engine metadata (`"unknown"`) and engines without `options.engineVersion` are not checked. Before this, a 0.3.0 snapshot would have executed under 0.4.0 code while stamping `0.3.0`.
5. `ENGINE_VERSION = "0.4.0"`, package version 0.4.0, new dossier directory with `manifest.json` fingerprint `sha256:cad84413…055716` for the reference model, generated under `METHOD_ENGINE_OPTIONS`.

## Delta vs 0.3.0 (rev. 1.1), eight decimal-mode models

| Model                         | Changed                                                                                                                                                        | Max relative difference |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| mass (2 Type A + 3 Type B)    | `c_s` `2.000000000066393e-4 → 2e-4` (exact); `u_I_x`, `u_I_ref` (were spuriously unequal for identical spreads, now equal and exact); `u_c`, `ν_eff`, `k`, `U` | 1.5e-12                 |
| electrical (4 Type B)         | `c_V`, `c_I`, `c_alpha`, `u_c`, `U`                                                                                                                            | 3e-16                   |
| volume (7 inputs)             | `y`, `c_gamma`                                                                                                                                                 | 6e-16                   |
| geometric (sqrt, cos)         | `c_a`                                                                                                                                                          | 4e-16                   |
| repeatability (Type A, n = 3) | `u_x`, `u_c`, `U`                                                                                                                                              | 4e-15                   |
| correlated, ν = ∞             | none (policy recorded in canonical input)                                                                                                                      | 0                       |
| mixed dof                     | `u_a`, `u_b`, `u_c`, `ν_eff`, `k`, `U`                                                                                                                         | 2e-14                   |
| **correlated, finite ν**      | `ν_eff` 39.85 → 46.29; `k` 2.0213 → 2.0126; `U` 0.07232 → 0.07200                                                                                              | 4.3e-3 in `U`           |

Every calculation fingerprint changes (the version is part of the digest). The only metrological change is the last row; no published method declares correlations today (`volume-glassware` and `humidity-magnus` carry empty arrays).

## Codex review round

1. **Shared-index terms in the correlated ν_eff (P1).** The pairwise sum omitted the cross-products that arise when one quantity takes part in more than one relationship: with `B_i = Σ_j ρ_ij b_j`, the denominator is the first-order propagation `Σ_i (b_i·B_i)²/ν_i` plus the second-order pair terms `1/(2ν_iν_j)`, and expanding it leaves `2 Σ_i (1/ν_i) Σ_{j<k, j,k≠i} ρ_ij ρ_ik b_i² b_j b_k` — absent from the two-component form. Three equal components with ν = 10 and every ρ = 0.5 give ν*eff ≈ 29.907, not the 34.16 the pairwise-only sum produced. Two-component models (every hand-computed case in the dossier and the release probe) are unchanged; models with three or more correlated quantities were overstating ν_eff, i.e. understating k and U. Tests: \_includes the shared-index terms…*, _reduces to the pairwise form when no component shares two relationships_.
2. **Non-PSD correlation matrices in the exported helper (P2).** Bounds, unit diagonal and symmetry admit matrices with a negative eigenvalue (every off-diagonal −0.9 in a 3×3). `evaluateMeasurementModel` already validated PSD before calling, but the helper is exported. The Cholesky test is now a shared module (`gum/psd.ts`) used by both the covariance validation and the helper — the same algorithm, one copy. Test: _rejects a correlation matrix that is not positive semidefinite_.
3. **Empty relationship collections (P2).** `correlations: []` / `covariances: []` — exactly what `volume-glassware` and `humidity-magnus` ship — declared no relationship yet routed the model through the generalized path, emitted `EFFECTIVE_DEGREES_OF_FREEDOM_GENERALIZED` and fingerprinted a correlation policy. The decision is now made on the parsed off-diagonal entries. Test: _treats empty relationship collections as an uncorrelated model_.
4. **The DOF policy was not fingerprinted (P2).** `compileMeasurementModels` excluded `model.options` from `modelFingerprint`, so `"generalized"` and `"diagonal"` compilations of the same model were indistinguishable. The whole options object is now hashed (this also covers `allowNonSmoothWithExplicitSensitivities`, which had the same defect). Test: _fingerprints the model options, so two policies are two models_.
5. **The execution guard ignored the engine options (P1).** A compiled method is validated against one version _and_ one normalized configuration; a changed `METHOD_ENGINE_OPTIONS` (or a number-mode engine of the same version) would recompute the method under a different numeric contract while stamping the compiled options fingerprint. `executeCompiledMethod` now compares both and reports `ENGINE_OPTIONS_MISMATCH`. Tests: _refuses to execute when the numeric contract changed under the same version_ (+ the local-server fixture now compiles with the real engine identity instead of a made-up one, which is why it was the only suite left red).
6. **Open job snapshots would have been stranded (P1).** Every job freezes its own copy of the compiled method, so recompiling and re-approving a published method never reaches jobs already open: after the 0.4.0 deploy they could not be submitted again. `reconcileCompiledMethodEngine` (method-definition) adopts the method's current compilation into a stale snapshot when — and only when — the canonical normalized method text with the engine block removed is byte-identical, which proves the metrology did not move and only the engine contract did. Wired into the cloud submit/save routes (`apps/api/src/lib/method-snapshot-engine.ts`, resolved by the snapshot's own method id **and** version, persisted with the job and recorded in `job_audit_log.changes.methodSnapshotEngine`), into the desktop-sync execution, and into the offline local-server execution. A method that really changed is still refused — swapping it under a job in flight is the outcome we do not want. Tests: four in `method-definition`, three in `local-server`.
7. **The dossier gate authenticated the wrong configuration (P1).** `computeEngineReferenceFingerprint` compiled the reference model with the engine defaults while every certificate-producing path uses `METHOD_ENGINE_OPTIONS`, and formula fingerprints include the normalized compilation options — so the gate could not catch production-option drift. It now compiles under `METHOD_ENGINE_OPTIONS` (manifest fingerprint `sha256:ca131aeb…30ce72` → `sha256:cad84413…055716`) and the manifest records the configuration itself in `engineOptions`, compared by the gate. Tests: _the current manifest records the production engine configuration_, _drifted production options SHALL be reported as a mismatch_.

## Tests

- math-engine 149 (dossier gate on `v0.4.0/manifest.json`; former byte-stability pins converted to exactness pins — `c_k = "0.023"`, `s = 0.001` exact; new `gum/correlated-dof.spec.ts`: reduction to G.2b, hand-computed two-component cases for ρ ∈ {0.5, 1, −0.5}, ν = ∞ term cancellation, scale invariance, invalid matrices, policy plumbing and fingerprinting).
- method-definition 166 (execution guard: version mismatch, options mismatch, agreement, `"unknown"` skip, version-less engine skip; option pass-through and fingerprinting; snapshot reconciliation).
- method-templates 129 (Exemplo method id=6 fingerprint fixture bumped: `method:c867d03d… → method:37a5f84f…`).
- apps/api 1375 (KAT pin 0.4.0; int-spec fixtures now import `ENGINE_VERSION`), apps/local-server 38 (incl. the new `execution.test.ts` for snapshot reconciliation), apps/web jobs + method-runtime 184. `tsc` clean in all six packages.

## Operator steps (production)

1. Deploy API + worker + web together (the engine is a workspace package).
2. Re-seed Exemplo's method id=6 (`EXEMPLO_FORCE_METHOD_TEMPLATE_UPDATE`) and recompile/re-approve every published method — until then `ENGINE_VERSION_MISMATCH` blocks execution of 0.3.0 snapshots. Jobs already open pick the recompiled method up automatically on their next save/submit (reconciliation above) as long as the method definition itself did not change; a method that did change must be handled deliberately. Issued certificates are untouched; their snapshots stay reproducible with 0.3.0.
3. Sign dossier `v0.4.0` rev. 1.0 (`make` in the directory; PDF is gitignored).
4. Desktop/local-server ships the same package; release a desktop build so offline execution matches.

## References

- Castrup, H., _A Welch-Satterthwaite Relation for Correlated Errors_, Proc. Measurement Science Conference, Pasadena, 2010; rev. 2020-05-08 (open access, ISG).
- Willink, R., _A generalization of the Welch–Satterthwaite formula for use with correlated uncertainty components_, Metrologia 44 (2007) 340–349, doi:10.1088/0026-1394/44/5/010 (paywalled; not consulted in full — implementation follows Castrup, which reproduces the derivation).
- JCGM 100:2008 §G.4 (Eq. G.2b, G.3).
