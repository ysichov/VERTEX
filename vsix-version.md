# Changing the VERTEX version

Use this procedure when Jev decides the request needs a version change before building. VERTEX calculates and stages the version in a review copy; the selected assistant is not called. A version change applies to the VS Code extension and Eclipse host together. Build the VSIX afterward using [`vsix.md`](vsix.md).

## Choose the version

- Read the current version from `vscode/package.json`.
- For `+1`, increment the patch number once (for example, `0.9.104` becomes `0.9.105`).
- For a specified `major.minor.patch`, use that exact version.
- Without either request, keep the current version.

## Update the version

| File | Value |
|---|---|
| `vscode/package.json` | Top-level `version`: `major.minor.patch` |
| `vscode/package-lock.json` | Both the top-level and root-package `version`: `major.minor.patch` |
| `org.vertex.abap.feature/feature.xml` | Feature `version`: `major.minor.patch.qualifier` |
| `org.vertex.abap.ui/META-INF/MANIFEST.MF` | `Bundle-Version`: `major.minor.patch.qualifier` |

The local workflow also updates the current-version labels in `README.md` and `vscode/README.md` and adds release entries to `history.md` and `dev_history.md` when those files are present. Published update-site numbers in other pages are changed only when that site is published. Preserve unrelated changes in these files. Check the four version values agree, then run the build wrapper from [`vsix.md`](vsix.md). The VSIX build alone does not build the Eclipse update site; its procedure is in [`BUILD.md`](BUILD.md).
