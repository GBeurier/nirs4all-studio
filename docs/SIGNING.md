# Code signing & notarization (Windows + macOS)

nirs4all Studio **ships unsigned by default**, and that is a fully supported
mode. Unsigned builds install and run fine; users just see a one-time OS
warning on first launch:

- **Windows** — SmartScreen: *"Windows protected your PC"* → **More info → Run anyway**.
- **macOS** — Gatekeeper: *"cannot be opened because the developer cannot be verified"* → **right-click the app → Open** (or System Settings → Privacy & Security → *Open Anyway*).
- **Linux** — no signing concept for `.deb`/AppImage; nothing to do.

Code signing **removes those warnings**. It is entirely **optional** and you can
keep publishing unsigned indefinitely.

## How it works in CI (you only add secrets — no code changes)

The release workflow (`.github/workflows/release-unified.yml`) **auto-detects**
the signing secrets:

- If the secrets are **present**, it signs (and, on macOS, notarizes + staples)
  and verifies the result before publishing.
- If they are **absent**, it logs a non-blocking `::warning::` and **publishes
  the unsigned artifacts anyway**.

So enabling signing is just: add the GitHub Actions secrets below, then cut a
release as usual (`git tag X.Y.Z && git push origin X.Y.Z`). Removing them
reverts to unsigned. Nothing in the build needs editing.

Set secrets via the CLI (`gh secret set NAME`) or **GitHub → repo → Settings →
Secrets and variables → Actions → New repository secret**.

---

## Windows

### What you need
A **code-signing certificate** from a public CA (DigiCert, Sectigo, SSL.com,
GlobalSign…). Two grades:

| Grade | SmartScreen | Cost (≈/yr) | Notes |
|---|---|---|---|
| **OV** (Organization Validation) | reputation builds over time (early downloads still warn) | ~$200–400 | cheapest, slow trust ramp |
| **EV** (Extended Validation) | **instant** SmartScreen trust | ~$350–700 | best UX, stricter vetting |

⚠️ **Important (2023+ CA/Browser Forum rule):** newly issued OV **and** EV certs
must live on FIPS-140 hardware (USB token or cloud HSM), so most CAs **no longer
let you export a `.pfx`**. This workflow's `.pfx`-based path works only with:
- a cert you can still export as `.pfx` (older certs, or a provider that allows it), **or**
- a **cloud signing service** (e.g. **Azure Trusted Signing**, ~$10/mo, or SSL.com
  **eSigner**) — these need a small workflow change (swap the local `signtool`
  step for the provider's signing action); ask and it can be wired in.

### Steps (the `.pfx` path this workflow uses today)
1. Obtain the certificate and export it as `certificate.pfx` (set an export password).
2. Base64-encode it:
   ```bash
   # Linux/macOS
   base64 -w0 certificate.pfx > cert.b64       # macOS: base64 -i certificate.pfx > cert.b64
   ```
   ```powershell
   # Windows PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("certificate.pfx")) | Set-Content cert.b64
   ```
3. Set the secrets:
   ```bash
   gh secret set WINDOWS_CERT_BASE64 < cert.b64
   gh secret set WINDOWS_CERT_PASSWORD        # paste the .pfx export password
   ```

That's it — the next tagged release signs `*.exe` with `signtool` and verifies
it with `Get-AuthenticodeSignature` (must report `Valid`) before publishing.

| Secret | Value |
|---|---|
| `WINDOWS_CERT_BASE64` | base64 of your `.pfx` |
| `WINDOWS_CERT_PASSWORD` | the `.pfx` export password |

---

## macOS

### What you need
- **Apple Developer Program** membership (~$99/yr).
- A **"Developer ID Application"** certificate — this is the one for
  *distribution outside the App Store*. (Not "Apple Distribution", which is
  App-Store-only.)
- An **app-specific password** for the notary service.

### Steps
1. **Create the certificate.** Xcode → Settings → Accounts → Manage Certificates
   → **+ → Developer ID Application** (or create it on
   developer.apple.com → Certificates).
2. **Export it from Keychain Access** as `certificate.p12` (right-click the cert
   → Export; set a password). Then base64-encode:
   ```bash
   base64 -i certificate.p12 -o cert.b64
   ```
3. **App-specific password:** appleid.apple.com → *Sign-In and Security* →
   *App-Specific Passwords* → generate one (used by `notarytool`).
4. **Team ID:** developer.apple.com → *Membership* (a 10-char string like `AB12CD34E5`).
5. Set the secrets:
   ```bash
   gh secret set APPLE_CERT_BASE64 < cert.b64
   gh secret set APPLE_CERT_PASSWORD            # the .p12 export password
   gh secret set APPLE_ID                       # your Apple ID email
   gh secret set APPLE_APP_SPECIFIC_PASSWORD    # the app-specific password
   gh secret set APPLE_TEAM_ID                  # your 10-char Team ID
   ```

On the next tagged release the workflow imports the cert, signs the `.app`,
**notarizes** the `.dmg`/archive with `xcrun notarytool`, **staples** the ticket,
and verifies with `codesign --verify --deep --strict` + `spctl --assess` +
`stapler validate` before publishing. All five secrets are required for
notarization — set them together.

| Secret | Value |
|---|---|
| `APPLE_CERT_BASE64` | base64 of your Developer ID `.p12` |
| `APPLE_CERT_PASSWORD` | the `.p12` export password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for notarytool |
| `APPLE_TEAM_ID` | your 10-char Apple Team ID |

---

## Verifying a signed build

The release workflow verifies automatically (and a tagged release will **fail**
if signing is configured but the result doesn't verify — that protects you from
shipping a broken signed artifact). To check locally:

```bash
# macOS
codesign --verify --deep --strict --verbose=2 "nirs4all Studio.app"
spctl --assess --type exec -vv "nirs4all Studio.app"
xcrun stapler validate "nirs4all Studio.dmg"
```
```powershell
# Windows
Get-AuthenticodeSignature ".\nirs4all Studio Setup.exe" | Format-List
```

## TL;DR

| | Need | Cost | Removes the warning? |
|---|---|---|---|
| **Unsigned** (current) | nothing | free | no — one-time OS prompt |
| **Windows** | code-signing cert (+ maybe cloud HSM) | ~$200–700/yr | yes (EV instant; OV over time) |
| **macOS** | Apple Developer + Developer ID cert | ~$99/yr | yes |

Signing is a "set the secrets once" operation; it does not change how you cut
releases. Until then, unsigned releases are published normally.
