# Project rules

- Before creating anything new (a control, an icon or image, a style, an animation, a helper, a module), search the project for an existing solution that already does the job - in both hosts, `vscode/`, `org.vertex.abap.ui/` and its `resources/` - and reuse it. Create something new only when nothing suitable exists, and say what you searched.

- Before adding or restyling an interface control, find the same working control already used in the project and reuse its markup, behavior, and theme styling. Do not invent a separate variant for the same action. Check the result in its actual host and theme.

- After fixes or changes to the VS Code extension, always rebuild and verify the VSIX before handing off. Keep the current version unless the user requests a version change.

- When the user names a new version, bump it on both hosts together: `vscode/package.json`,
  `org.vertex.abap.feature/feature.xml` and `org.vertex.abap.ui/META-INF/MANIFEST.MF`. Build
  both the VSIX and the Eclipse update site, and in the same landing write the release into
  the docs listed below (`history.md`, `dev_history.md`, and every page that states the version).
  

## Documentation: update by purpose

Update documentation when the meaning of a change affects its readers; no separate request is needed. Update only the relevant documents and existing sections, not every document for every fix.

| Document | Purpose and when to update |
|---|---|
| `history.md` (root) | User-facing release/change history: what changed and its visible effect. |
| `dev_history.md` (root) | Engineering history: implementation decisions, reasons, validation and remaining limitations. |
| `README.md` (root) | GitHub project overview and shared usage. Update relevant capabilities and instructions when they change. |
| `vscode/README.md` | Marketplace description and VS Code user guide. A new feature needs a short how-to in its relevant section: where to open it, what to do, and the expected result. |
| `eclipse/README.md` | Eclipse ADT user guide; update only Eclipse capabilities and instructions. |
| `docs/index.html` | Public GitHub Pages landing page and Eclipse update-site installation entry. Keep installation, advertised capabilities and published versions accurate; not a development diary or full manual. |
| `INSTALL.md` | Installation prerequisites, recovery and uninstall guidance, especially Eclipse p2. |
| `BUILD.md` | Maintainer guide: repository layout, building, packaging and publishing. |
| `ADT_TECH.md` | Developer reference for Eclipse/Java ADT APIs and integration. |
| `mcp/README.md` | Standalone MCP server setup, connections, tools and assistant integrations. |
| `eclipse/MCP.md` | Setup and troubleshooting of the MCP connection from Eclipse Copilot. |
| `vscode/docs/commands.md` | User reference for commands and Tools window actions. |
| `vscode/docs/debugging.md` | User guide for assistant-driven debugging. |
| `vscode/docs/local-execution.md` | User guide for local ABAP execution. |
| `vscode/walkthrough/{systems,test,ai,mcp}.md` | In-product onboarding: systems, connection test, assistant choice and optional MCP setup. Keep steps aligned with the UI. |
| `Next.md` | Unfinished work and priorities; remove or adjust items as their status changes. |
| `AGENTS.md` | Repository working rules for agents. |
| `ace-port-audit.md` | ACE/frontend parity audit and verification status. |
| `docs/debugger-tests-findings.md` | Verified debugger-demo findings and investigation evidence. |
| `eclipse/VISUAL_DEBUG_ASSESSMENT.md` | Historical feasibility/implementation assessment of Eclipse Visual Debug; preserve dated conclusions. |
| `design/auth-broker/{GOAL,SPEC,PLAN,GATES,HISTORY,HANDOFF}.md` | Historical integration records: goal, specification, work plan, feasibility evidence, session history and handoff. Not current user instructions. |
| `probe/AUTH_BROKER_NOTES.md` | Historical auth-broker research and measurements. |
| `probe/{snc,host}/README.md` | Developer-only probe prerequisites and run instructions; not shipped product features. |
| `vscode/THIRD-PARTY-NOTICES.md`, licence files | Dependency attribution and licensing; update when bundled dependencies/licences change. |
| `vscode/prompts/tools/sap-code.md` | Runtime assistant instructions for SAP tools; product behavior, not user documentation. |

For a new feature, add a concise mini-instruction to the appropriate user guide, plus the change narrative to root `history.md` and technical details to root `dev_history.md`. For a bug fix, change user instructions only if the actual usage or behavior changes. User guides describe the current product, not the sequence of fixes, implementation internals or test reports.

Edit the appropriate section in place. Never append unrelated paragraphs after Licence or at the end of a README. Add a section only when the feature needs one, under the appropriate parent heading. Do not duplicate the same explanation across unrelated guides. Keep history entries in the histories. Do not claim a host/version was built when it was not.

The extension README is `vscode/README.md`. Release and development histories belong only in root `history.md` and `dev_history.md`; never create or copy history files into `vscode/`. Product HTML pages under `resources/`, `vscode/pages/`, `eclipse/*.html` and their bundled copies are UI/runtime assets, not prose documentation. Test fixtures and build output are not manuals.

- In the VS Code extension, every interface element must use a theme-aware background color. Do not hard-code a light or dark background that breaks with the active VS Code theme; use VS Code theme variables or inherited colors.
- Diagram and Lens mode controls use the shared compact toggle style already used by VERTEX Smart Debugger: adjacent modes form a group; an active mode uses the theme focus colour, while inactive modes remain quiet. Do not introduce a separate toggle appearance for a diagram or Lens.
- A toggle is for a control that switches what the view shows or how it reads (a mode, a lens); a plain option that is simply on or off - a setting applied when something is built or run - is a checkbox (`<input type="checkbox">` with its label), not a toggle.
- Two shared toggle types are canonical: independent on/off view controls use `vertex-toggle` / `.on`; mutually exclusive choices use `vertex-segment-toggle` / `.active`. Both live in `org.vertex.abap.ui/resources/vertex-controls.css` and are copied to `vscode/resources/` at packaging. Do not redefine either style in a view; use the class unchanged.
- Every diagram and its controls (including Mermaid SVGs, range tracks and thumbs) must follow the active VS Code theme through VS Code CSS variables. Never hard-code a light/dark Mermaid theme or fixed surface colours; verify both light and dark rendering before packaging.

- The repository is public: never publish a Claude Code session link (`https://claude.ai/code/session_...`) - not in commit messages (no `Claude-Session:` trailer), pull request descriptions, comments, documentation or code. The link is private to its owner and is a dead link for everyone else.
