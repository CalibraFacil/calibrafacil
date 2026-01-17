import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/routes/billing/**/*.ts",
        "src/routes/webhooks.ts",
        "src/services/asaas/**/*.ts",
      ],
      exclude: ["**/*.spec.ts", "**/types.ts"],
    },
    setupFiles: ["./test/setup.ts"],
  },
});
