Full qualification runs locally on Linux/WSL and Windows. GitHub builds the
installers, checks their actual unpacked UI/runtime contract, and publishes
reviewed bytes. Its UI smoke never qualifies HPO, scientific journeys or migration.

The required gates and their exact commands are in `policy.json`. Preserve the
raw Playwright JSON, direct logs, reports, host/tool versions and input captures
under this directory. The shared verifier checks the retained evidence before
publication:

```sh
python3 scripts/verify_local_qualification.py --project studio --receipt qualification/local-qualification.json --root .
```

`qualify-local-packaged.cjs` and `qualify-local-application-migration.cjs` take
`--config` pointing to the platform's configuration file in this directory. Use
absolute script/config paths from the repository root, as anchored by the policy.
Each configuration records `platform`, actual host ID, `source_sha`, a retained
`input_evidence` descriptor (relative path, bytes, SHA256), a new `output` report
path, and verified `owned_root`, ownership marker SHA256, `run_root`, `app_root`,
installer path/SHA256 and `installer_cycle: false`.
Pin `sdk_wheel_path` to the retained public SDK wheel under the owned root;
the runner rehashes those actual bytes against the embedded cohort.

The scientific configuration also pins the provider oracle's path, source SHA
and SHA256. Migration adds a `baseline` object with the public 0.15.0 extracted
application root and installer path/SHA256. Root paths and their ancestors must
be plain, owned paths. Never execute NSIS or install a baseline locally.

Before Electron starts, the runner creates/selects its workspace through the
actual verified sidecar API and pins config/data/log paths to the isolated
profile. This prevents Electron's OS Documents default from touching the real
user's workspace. Both migration processes use one explicit isolated Chromium
profile; datasets, active workspace and preferences must survive the transition.
Failed profiles, sidecar logs and reports remain available for diagnosis.

The compiled application source stamp, SDK wheel/oracle, installed dependency
versions and runtime contract must match the fingerprinted runtime cohort.
Old payload diagnostics cannot be converted into qualification of another cohort.
Runtime input equality permits retaining unchanged local results when only CI
or documentation changes; it never permits retaining results across runtime,
dependency, fixture or relevant test-helper changes. Final OS build smokes bind
the final artifacts to the same runtime inputs without repeating full E2E.
