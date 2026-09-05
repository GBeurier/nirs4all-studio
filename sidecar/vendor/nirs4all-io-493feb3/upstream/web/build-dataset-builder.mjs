#!/usr/bin/env node
/*
 * Build the self-contained Dataset Builder bundle for the io.nirs4all.org site.
 *
 * The io web app is a no-build static site, so we pre-bundle the React component
 * from the sibling `nirs4all-ui` package (its built `dist/`) plus React into a
 * single ESM file committed at `vendor/dataset-builder.mjs`, and copy the
 * component stylesheet next to it. esbuild + React are borrowed from the sibling
 * `nirs4all-ui/node_modules` (this repo has none of its own).
 *
 * Prereq: run `npm run build` in ../../nirs4all-ui first (produces dist/).
 * Usage:  node web/build-dataset-builder.mjs
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(here, "../../nirs4all-ui");
const uiNodeModules = resolve(uiDir, "node_modules");

const require = createRequire(resolve(uiNodeModules, "index.js"));
const esbuild = require("esbuild");

const outDir = resolve(here, "vendor");
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [resolve(here, "builder-app/main.tsx")],
  bundle: true,
  format: "esm",
  outfile: resolve(outDir, "dataset-builder.mjs"),
  jsx: "automatic",
  minify: true,
  target: ["es2020"],
  nodePaths: [uiNodeModules],
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

copyFileSync(
  resolve(uiDir, "assets/datasetBuilder.css"),
  resolve(outDir, "dataset-builder.css"),
);

console.log("Dataset Builder bundle written to web/vendor/dataset-builder.mjs");
