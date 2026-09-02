#!/usr/bin/env node

import { rm } from 'node:fs/promises';

// wasm-pack writes a catch-all .gitignore next to its generated package. npm
// honors that nested file even when `files` explicitly includes `native`, so
// remove only this generated marker before npm computes the publication set.
await rm(new URL('../native/.gitignore', import.meta.url), { force: true });
