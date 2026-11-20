# Building the VSIX

How to build and verify `vscode/vertex-abap-<version>.vsix`. Read this before any "rebuild the VSIX" task. Background and publishing: `BUILD.md`.

For a VERTEX chat request, Jev chooses either a build at the current version or a version change followed by a build. VERTEX executes that workflow locally, without a second LLM call. For the latter, follow [`vsix-version.md`](vsix-version.md) first.

## Command

Run from the repository root, in the real project folder (not a temporary copy: `node_modules` is git-ignored and absent from copies).

| Host | Command |
|---|---|
| Windows | `./vscode/package.ps1` |
| macOS / Linux (no `pwsh`) | `./vscode/package.sh` or `node vscode/package.js` |

All three run `vscode/package.js`. Optional arguments: `--target universal|win32-x64|darwin-arm64` (default `universal`) and `--keep-node-modules`.

Never call `vsce` directly and never pass `--no-dependencies`: the extension installs but cannot load `abap-adt-api`. Do not upload a hand-built `.vsix`.

## What the wrapper does

1. `npm ci` from the lockfile.
2. Checks the `sap-rfc-lite` prebuilt bindings (`win32-x64`, `darwin-arm64` for universal) and removes the other platforms.
3. `vsce package` into `vertex-abap-<version>.candidate.vsix` (`vscode:prepublish` runs `copy-pages.js`, which copies the shared pages from `org.vertex.abap.ui/resources/` into `vscode/resources/`).
4. Verifies the candidate ZIP: structure and CRC of every entry, no SAP SDK libraries or RFC logs, the required files and dependency licences (including `sap-debug-history.js`, the skill matcher, the VSIX workflow executor, the change-checking module, ESLint and globals), the packaged `metrics.html` against `test/scheme-navigation.test.js`, and that `extension/package.json` has the version of `vscode/package.json`.
5. Renames the candidate to `vscode/vertex-abap-<version>.vsix`, prints `Verified VSIX: <path>`, then restores the developer install with `npm ci`.

If any check fails, the candidate is deleted and the existing `.vsix` of that version is not replaced.

## Before building

- Version: keep the current one unless the user requests a change. Follow [`vsix-version.md`](vsix-version.md) for `+1` or a specified version.
- Uncommitted edits made in a working copy reach the real folder only after review. A build in the real folder does not include unapproved files.
- Tests are separate from the build. A full `npm test` in `vscode/` takes about five minutes; run it only when asked, once, into a file.

## Timing and output

- Allow at least 10 minutes: two `npm ci` runs and `vsce` itself.
- Do not pipe the command through `tail` or similar: the exit status must stay visible.
- Success is the line `Verified VSIX: .../vscode/vertex-abap-<version>.vsix` and exit code 0. Confirm the file exists and report its path and version.
- Do not report a VSIX as built without that line. This document covers the VSIX only; the Eclipse update site is built separately (`BUILD.md`).
