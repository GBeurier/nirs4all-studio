No code findings. Looks clean.

Checked:
- Barrel re-exports all original public symbols: 13 `Nirs4all*` types plus `exportToNirs4all`, `importFromNirs4all`, `validateRoundTrip`, `parsePipelineString`, `serializePipeline`.
- Import graph is acyclic: `shared` has no local imports; `fromNirs4all`/`toNirs4all` depend on `shared`; `utils` depends on `shared` + both directions; barrel only re-exports.
- Function/type bodies match the `HEAD` monolith exactly after normalizing helper `export` keywords in `shared.ts`.
- No public duplicate export/name collision in the barrel; duplicated helper names remain module-local where applicable.

One git-status note: `src/utils/pipelineConverter/` is currently untracked, so a literal `git diff HEAD` does not include the new split files until they’re added.