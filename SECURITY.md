# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.11.x  | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in nirs4all-webapp, please **do not open a public GitHub issue**.

Instead, report it privately via one of the following channels:

- **GitHub Security Advisories**: Use the "Report a vulnerability" button on the [Security tab](https://github.com/GBeurier/nirs4all/security/advisories/new) of this repository.
- **Email**: Contact the maintainer directly at [gregory.beurier@cirad.fr](mailto:gregory.beurier@cirad.fr) with the subject line `[SECURITY] nirs4all-webapp vulnerability`.

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any suggested mitigations (if known)

We aim to acknowledge reports within **5 business days** and to provide a fix or mitigation within **30 days** for confirmed issues.

## Scope

This policy covers:
- The nirs4all-webapp frontend (React/TypeScript)
- The Rust Studio sidecar and its bounded CPython stdio plugin host
- The Electron desktop shell and IPC layer

Security issues in the nirs4all Python library should be reported via the [nirs4all security policy](../nirs4all/SECURITY.md).
Security issues in third-party dependencies should be reported directly to those projects.

The dependency advisories temporarily accepted for this release, their product
exposure, and their removal criteria are documented in
[`docs/DEPENDENCY_SECURITY_HOLDS.md`](docs/DEPENDENCY_SECURITY_HOLDS.md).

The desktop session credential, loopback trust model, and reverse-proxy limits
are documented in [`docs/NATIVE_HTTP_ACCESS.md`](docs/NATIVE_HTTP_ACCESS.md).
