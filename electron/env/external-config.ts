/* eslint-disable @typescript-eslint/no-require-imports */
import * as fs from "fs";
import * as path from "path";

/**
 * Loaders for config files that live OUTSIDE the compiled bundle, at the
 * application root (asar root in packaged builds, repo root in dev):
 * scripts/python-runtime-config.cjs and recommended-config.json — both listed
 * in electron-builder's `files:` so they ship at the asar root.
 *
 * The compiled bundle executes from dist-electron/ (ONE level below that
 * root), while the TS sources live in electron/env/ (TWO levels below). A
 * literal relative require can only be correct for one of those contexts —
 * `require("../../scripts/...")` resolved OUTSIDE the asar in packaged builds
 * and broke every all-in-one launch — so resolve against __dirname, trying
 * both depths. (fs.existsSync sees inside asar via Electron's patched fs.)
 */
function requireExternal<T>(relativeFromRoot: string): T {
  const candidates = [
    path.join(__dirname, "..", relativeFromRoot), // dist-electron bundle (packaged + dev)
    path.join(__dirname, "..", "..", relativeFromRoot), // TS sources under electron/env (vitest)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate) as T;
    }
  }
  // Let the error name the path that matters (the bundle-relative one).
  return require(candidates[0]) as T;
}

export function loadPythonRuntimeConfig<T>(): T {
  return requireExternal<T>(path.join("scripts", "python-runtime-config.cjs"));
}

export function loadRecommendedConfig<T>(): T {
  return requireExternal<T>("recommended-config.json");
}
