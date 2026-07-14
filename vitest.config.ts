import { defineConfig } from "vitest/config";
import fs from "fs";
import path from "path";

function resolveNirs4allUiSourceRoot(): string {
  const ciCheckout = path.resolve(__dirname, "nirs4all-ui-lib/src");
  if (fs.existsSync(ciCheckout)) return ciCheckout;
  return path.resolve(__dirname, "../nirs4all-ui/src");
}

const nirs4allUiSourceRoot = resolveNirs4allUiSourceRoot();

export default defineConfig({
  resolve: {
    alias: {
      "nirs4all-ui/score": path.resolve(nirs4allUiSourceRoot, "score/index.ts"),
      "nirs4all-ui/runtime": path.resolve(nirs4allUiSourceRoot, "runtime/index.ts"),
      "nirs4all-ui/conformal": path.resolve(nirs4allUiSourceRoot, "conformal/index.ts"),
      "nirs4all-ui/robustness": path.resolve(nirs4allUiSourceRoot, "robustness/index.ts"),
      "nirs4all-ui/keywordRegistry": path.resolve(nirs4allUiSourceRoot, "keywordRegistry/index.ts"),
      "nirs4all-ui/tuning": path.resolve(nirs4allUiSourceRoot, "tuning/index.ts"),
      "nirs4all-ui/components": path.resolve(nirs4allUiSourceRoot, "components/index.ts"),
      "nirs4all-ui": path.resolve(nirs4allUiSourceRoot, "index.ts"),
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
