# Project rules

- Documentation lives in several places, and a change that users can see is written into each
  one it concerns, in the same landing: `README.md` (the repository on GitHub),
  `vscode/README.md` (the VS Code Marketplace page), `docs/index.html` and `eclipse/README.md`
  (the Eclipse update site and plugin), `history.md` (the release notes) and `dev_history.md`
  (the development history, a stage per landing). Do not state a version for a host that was
  not built.
- In the VS Code extension, every interface element must use a theme-aware background color. Do not hard-code a light or dark background that breaks with the active VS Code theme; use VS Code theme variables or inherited colors.
