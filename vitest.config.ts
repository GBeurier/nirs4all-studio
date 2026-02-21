import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 10_000,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "dist-electron", "e2e"],
  },
});
