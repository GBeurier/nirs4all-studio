# Docs site

The documentation site is built with MkDocs and published by Read the Docs.
This page documents the RTD-specific maintenance workflow.

## Files

| File | Purpose |
| --- | --- |
| `.readthedocs.yaml` | RTD v2 configuration. |
| `mkdocs.yml` | Navigation, theme, extensions, validation, excluded pages. |
| `docs/requirements.txt` | MkDocs and theme dependencies. |
| `docs/index.md` | Public landing page. |
| `docs/getting-started/` | Install and development setup. |
| `docs/user-guide/` | User workflows. |
| `docs/reference/` | API and configuration reference. |
| `docs/development/` | Developer manual. |
| `docs/contributing/` | Contributor-facing process docs. |

## Local build

```bash
python -m pip install -r docs/requirements.txt
mkdocs build
```

Serve locally:

```bash
mkdocs serve
```

## RTD build behavior

Read the Docs reads `.readthedocs.yaml`, creates a Python environment, installs
`docs/requirements.txt`, and runs MkDocs with `mkdocs.yml`.

The build intentionally does not install the application runtime dependencies.
Docs should be written from source files and stable commands, not generated from
live imports that require the full desktop stack.

## Navigation policy

Public navigation should include:

- task-oriented user docs
- stable developer docs
- API and configuration reference
- release and troubleshooting material

The following remain excluded from RTD:

- internal reviews
- archived roadmap notes
- discrepancy analyses
- implementation scratch files
- old one-off API notes that were replaced by reference pages

Promote useful material from excluded notes into the structured pages before
linking it publicly.

## Validation policy

`mkdocs.yml` warns on broken relative links. Treat warnings as issues to fix
unless the link targets an intentional external route or runtime endpoint.

Check:

```bash
mkdocs build
```

before pushing documentation changes.

## Writing style

- Lead with the task or decision the reader needs.
- Put commands in fenced code blocks.
- Include exact paths and ports.
- Avoid roadmap promises unless they are explicitly labelled as future work.
- Keep generated API lists short and point to FastAPI `/docs` for exhaustive
  route schemas.
- Do not expose internal-only notes in public navigation.
