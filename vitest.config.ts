import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "nirs4all-ui/score": path.resolve(__dirname, "../nirs4all-ui/src/score/index.ts"),
      "nirs4all-ui/runtime": path.resolve(__dirname, "../nirs4all-ui/src/runtime/index.ts"),
      "nirs4all-ui/components": path.resolve(__dirname, "../nirs4all-ui/src/components/index.ts"),
      "nirs4all-ui": path.resolve(__dirname, "../nirs4all-ui/src/index.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 10_000,
    include: ["src/**/*.test.{ts,tsx}", "electron/**/*.test.ts"],
    exclude: ["node_modules", "dist", "dist-electron", "e2e"],
  },
});
