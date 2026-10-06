# VS Code 0.8.1 release preparation — 2026-10-06

## Included

- Standard ADT and bundled abaplint for source analysis.
- Visual Debug Classes / Methods with a separate embedded Tools Logic toggle.
- Active-editor routine selection and source navigation.
- Logic only, nested branches, calls in conditions, RETURN and procedure ends.
- Focus-driven scrolling, range and loop-frame highlights, theme-aware controls.
- 10–100% zoom, effective 70% lens limit, theme changes without autofit.
- Three-second analysis progress, diagnostic logs and state-aware Detach.
- Consolidated repository, Marketplace, website, release history and built-in help.

## Artifact

`vscode/vertex-abap-0.8.1.vsix` replaces the existing package. Packaging copies shared resources, verifies the archive and licences, and runs the packaged Scheme navigation gate.

## Verification limits

Inline JavaScript syntax was checked during preparation. Package checks do not establish live SAP behavior, diagram appearance in both themes, or editor navigation at runtime. Those remain release verification items. Existing analysis limitations are tracked in [ACE port audit](ace-port-audit.md). No Eclipse release, Marketplace publication, tag or Git commit is part of this preparation.
