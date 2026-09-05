/*
 * Bundle entry for the io.nirs4all.org Dataset Builder demo page.
 *
 * The reusable wizard itself lives in the sibling `nirs4all-ui` package
 * (`nirs4all-ui/datasetBuilder`); this file is a thin adapter that exposes a
 * `render()` on `window` so the no-build vanilla-JS io site can mount the React
 * component. Bundled to `vendor/dataset-builder.mjs` by `build-dataset-builder.mjs`.
 *
 * The relative import into `../../../nirs4all-ui/dist` reflects the ecosystem
 * working-tree layout (sibling repos side by side) documented in the root
 * CLAUDE.md; it is resolved at build time only.
 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { DatasetBuilder, autoDetectSource } from "../../../nirs4all-ui/dist/datasetBuilder/index.js";
import type { DatasetBuilderProps, DatasetSource } from "../../../nirs4all-ui/dist/datasetBuilder/index.js";

const roots = new WeakMap<Element, Root>();

function render(el: Element, props: DatasetBuilderProps): void {
  let root = roots.get(el);
  if (!root) {
    root = createRoot(el);
    roots.set(el, root);
  }
  root.render(createElement(DatasetBuilder, props));
}

/** Run the package's pure auto-detection on a freshly-parsed source. */
function detect(source: DatasetSource): DatasetSource {
  return autoDetectSource(source);
}

declare global {
  interface Window {
    NIRS4ALL_DATASET_BUILDER: { render: typeof render; detect: typeof detect };
  }
}

window.NIRS4ALL_DATASET_BUILDER = { render, detect };

export { render, detect };
