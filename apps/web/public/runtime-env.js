// Runtime settings for a prebuilt image. In Docker, scripts/static-server.ts
// answers this path with the container's VITE_* variables; everywhere else this
// empty default applies and the values baked in at build time are used.
window.calibraRuntimeEnv = window.calibraRuntimeEnv || {};
