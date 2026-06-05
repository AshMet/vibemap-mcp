import { defineConfig } from "vitest/config";

export default defineConfig({
  // This package has no CSS. Provide an inline (empty) PostCSS config so Vite
  // doesn't walk up to the repo-root postcss.config.js, which requires
  // @tailwindcss/postcss — a dep that isn't installed in the isolated
  // mcp-server CI job and would otherwise crash the test run.
  css: { postcss: { plugins: [] } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
