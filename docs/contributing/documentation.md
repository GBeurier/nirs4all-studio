# Documentation

The public documentation is built with MkDocs and published by Read the Docs.

## Build locally

```bash
python -m pip install -r docs/requirements.txt
mkdocs serve
```

Build without the development server:

```bash
mkdocs build
```

## Read the Docs files

| File | Purpose |
| --- | --- |
| `.readthedocs.yaml` | Read the Docs v2 build configuration. |
| `mkdocs.yml` | Site navigation, theme, extensions, validation, excluded legacy notes. |
| `docs/requirements.txt` | Python packages needed to build the docs. |
| `docs/index.md` | Home page for the published documentation. |

## Writing standards

- Document the current code, not the intended roadmap.
- Link to stable pages instead of duplicating large sections.
- Prefer task-oriented pages over implementation dumps.
- Keep commands copy-pasteable.
- Include expected ports, paths, and environment variables.
- Mark limitations explicitly.
- Keep internal reviews and roadmap fragments out of the public nav.

## Page ownership

| Area | Page |
| --- | --- |
| User onboarding | `getting-started/installation.md` |
| Developer onboarding | `getting-started/development.md` |
| User workflows | `user-guide/*.md` |
| Backend and API contracts | `reference/api.md`, `development/backend.md` |
| Runtime configuration | `reference/configuration.md` |
| Desktop packaging | `development/electron.md`, `development/releasing.md` |
| Troubleshooting | `troubleshooting.md` |

## Legacy notes

Older Markdown notes still exist in `docs/` and internal subdirectories, but
they are excluded from the public MkDocs build. Promote useful material into the
new structure before linking it from the public navigation.

## Documentation quality checklist

Before merging doc changes:

1. Run `mkdocs build`.
2. Check that new pages are in `mkdocs.yml`.
3. Check links to moved pages.
4. Verify commands against `package.json`.
5. Verify paths against the current code.
6. Avoid documenting old command names unless they still exist.
