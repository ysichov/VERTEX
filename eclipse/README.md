# Built-in Eclipse Assistant

The VS Code 0.7.12 Value Origin loader distinguishes foreign class declarations from complete implementations. Its Type is now FLOW or Formula, with a Depth slider that opens the tree along the call stack or along the derivation. Both are client changes and require no additional Eclipse build.

The shared diagram pages changed too, and they are the same pages this plugin shows. A method
clicked in the Calls diagram now draws its Logic diagram inside that canvas, joined to the block
it came from. The magnifier is an explicit *Lens off* / *Lens on* toggle in the diagram toolbar
instead of a rule that measured the text on screen, and Shift with the wheel sets its strength.
A Logic diagram no longer emits a node for a statement whose text is left with nothing to show —
one such empty node was a mermaid syntax error that failed the whole diagram. Eclipse was not
rebuilt for these; they arrive with the next build of this plugin.

The VS Code 0.7.12 test build includes ACE-backed Value Origin analysis in its ABAP
editor. It requires the updated `ZCL_VX_ADT_RES_FLOW` backend (`mode=origin`).
That backend also supplies ACE's concrete class-to-interface relation for interface dispatch.
It labels the owner of every ACE include so VS Code can load a foreign class's complete pool.
The VS Code navigation layer does not open an interface `METHODS` declaration for an invocation.
It also keeps ordinary contextual navigation in the same VS Code editor group.
This analysis UI, including standard VS Code editor navigation and gutter-breakpoint
synchronization, is not available in Eclipse; no Eclipse release was built for it.
The VS Code-only right-hand Visual Debug panel, its stopped-line highlight and
its F5-F8 source-editor shortcuts are also not available in Eclipse.
The VERTEX Tools window no longer has a View source function in Eclipse either: the source is the
ADT editor. That change to the plugin was not built for Eclipse.

![VERTEX architecture: VS Code and Eclipse ADT, the VERTEX MCP server between them and the AI assistants (Claude Code, Codex, GitHub Copilot), the six VERTEX Web UI tools, and the ADT hub on SAP at /sap/bc/adt/vertex/*](../docs/architecture.jpg)

The Selector and Versions Assistant panels launch Codex or Claude Code directly.
Copilot is not involved. The existing standalone MCP registration is independent.

For **GitHub Copilot Chat in Eclipse**, see [VERTEX MCP setup](MCP.md).

1. Install Node.js 22 or newer.
2. Install and log in to Codex CLI or Claude Code. The assistant runs on your
   ChatGPT or Claude subscription, and a subscription has no public API: it
   works only through the vendor's own client, so without one of them the
   Assistant cannot answer. Existing VS Code extension binaries are also
   discovered automatically; VS Code need not be running.
3. Open **Window > Preferences > VERTEX Assistant**. Set the Node executable
   if `node` is not on Eclipse's PATH. Optionally select native Codex/Claude
   executables; on Windows select `.exe`, not `.cmd` wrappers.
4. Open Selector or Versions on your ABAP project and click **Assistant**.
   Choose the assistant/model and send a request. For Claude the list holds the
   newest model of each family by full id (Haiku, Sonnet, Opus, Fable); another
   version is added with **Specify version...**, which checks it with one short
   request before keeping it.

SAP reads use that window's ADT project and login. No SAP password is put into
the child environment or its temporary files. Each request starts a private,
authenticated loopback MCP server and uses the same tools, instructions,
schema and plan validation as VS Code. Selector receives metadata only.
Validated plans are applied by the existing HTML page.

Model discovery and CLI work run in background threads. Closing the view stops
its child processes. A request has an overall five-minute deadline (including
metadata preparation); the model call retains its existing three-minute limit.
If a CLI is missing, configure its executable here and log in externally first.

Build: run `node eclipse/prepare.js` before PDE export. The generated
`org.vertex.abap.ui/assistant/` files are committed so an ordinary Eclipse export
also includes the runtime. Edit their originals in `vscode/` and `eclipse/`,
then regenerate. The feature and bundle are prepared at `0.8.1.qualifier`; the VS Code extension remains 0.8.1.

For a local installable archive without replacing the published `docs/` site:

```powershell
./eclipse/package.ps1 -Javac 'path/to/javac.exe' -BundlePool 'path/to/.p2/pool/plugins'
```

This compiles Java 21 classes, uses the existing PDE repository as the
metadata template, and creates a new timestamped site and ZIP under `target/`.
It refreshes bundled resources, sources, versions and SHA-256 download checksums.
Install via **Help > Install New Software > Add > Archive** and restart Eclipse.

### Shared diagram help

The shared Tools pages include help for source links, Logic only, procedure exits, range and loop-frame highlighting, direction, zoom and the magnifier. The VS Code 0.8.1 release preparation also updates Visual Debug and embedded Tools navigation. The 0.8.1 test archive is built below; it has not been published or checked in a running Eclipse.

## Eclipse 0.8.1 — Visual Flow Analysis

A separate **VERTEX: Visual Flow Analysis** editor-context command opens static Calls with Classes / Methods and a **Logic** toggle. Logic uses the standard Tools page and follows the selected routine in the ADT editor. Source links open ADT source and reveal the requested line or method. Value Origin now bundles the shared ABAP control and call modules required by FLOW.

This preparation retains Eclipse's existing SAP ACE analysis endpoints. It does not claim the VS Code ADT + abaplint host adapter has been ported. Runtime Debug, recording and debugger controls are outside this release. ADT editor scrolling and runtime behavior still require checking in Eclipse.

### Export 0.8.1

Run `node eclipse/prepare.js`, refresh the UI and feature projects in Eclipse, then export `org.vertex.abap.feature` as a deployable feature/update site. Bundle and feature versions are **0.8.1.qualifier**, with Java 21 as the export target. Export to a new directory; install into a test Eclipse before replacing the published update site.

Verify Visual Flow Analysis, Classes / Methods, Logic toggling, cursor and range highlighting, cross-object source navigation, Value Origin FLOW, and both light and dark themes. Eclipse uses its own navigation Back command; it is not the VS Code Alt+Left host implementation.

### Prepared test archive

Java sources compiled successfully with `--release 21` against the installed Eclipse/ADT bundle pool. The packaging script completed and verified the install archive: [vertex-eclipse-0.8.1.20261006202315.zip](../target/eclipse-0.8.1.20261006202315/vertex-eclipse-0.8.1.20261006202315.zip). Install via **Help > Install New Software > Add > Archive**, restart, and run the export checks above. No live Eclipse/SAP validation or publication has been performed.

### Eclipse Debug Monitor prototype

**VERTEX: Debug Monitor** observes an existing SAP ADT debug session using exported SAP `IAbapThread` / `IAbapStackFrame` and Eclipse debug events. It does not establish a second connection or change breakpoints. Open it from an ABAP editor context menu after starting the normal ADT debugger. It reads stopped frames and up to 100 top-frame variables in background jobs; Refresh retries the read. If multiple threads are present, choose one explicitly. Large displayed values are truncated at 2,000 characters, and variable children are not fetched recursively.

When an ABAP class frame supplies its class URI and absolute source line, the monitor passes that coordinate to the Tools Logic view. Include-local coordinates are not guessed. Editor selection remains available for source following. Step, Continue, terminate, recording, table expansion and frame-selection control remain in the normal ADT debugger for this prototype.

The installed SAP ADT 3.60 interfaces were inspected locally, and Java 21 compilation and archive packaging passed. No live debug session or light/dark runtime check has been performed. Install the test archive before using this as a release feature.


### Eclipse Tools: standard ADT analysis

Tools UML, metrics, Calls, Logic and Parts now use the shared VS Code frontend-analysis and abaplint parser in a browser worker. Source and package reads use the selected Eclipse project’s standard ADT session. These analysis views no longer require `/sap/bc/adt/vertex/class`, `/metrics`, `/flow` or `/versions` handlers. Versions/Diff, Review and other backend services retain their existing routes. Value Origin also uses standard ADT source and the shared abaplint worker. Eclipse/SAP runtime and light/dark rendering remain unverified.


Eclipse follow-up: corrected Debug Monitor / Visual Flow Analysis registration under `org.eclipse.ui.views`. Value Origin now reads standard ADT source and uses the shared abaplint worker; it no longer requests the custom origin endpoint or requires ZCL_VX_ADT_RES_FLOW. Java compilation and archive creation passed; live Eclipse/SAP behavior is pending.

Eclipse Origin fix: ADT metadata reads now send `Accept: */*`; source reads send `Accept: text/plain`, including class includes. This fixes the server’s “Accept header missing” rejection. Live SAP verification is pending.

Eclipse Tools fix: standard ADT object metadata uses `Accept: */*`, matching the VS Code ADT client; `application/xml` was rejected by servers requiring ADT vendor media types. Source reads remain `text/plain`. This Java transport change does not affect VS Code.

Eclipse ADT bridge: added String content handlers for standard SAP vendor XML metadata, including programs v3, classes and interfaces. Shared by Tools, Visual Flow Analysis, Debug Monitor and Origin; negotiated vendor XML versions are registered on response. This change is confined to Java transport. Live SAP verification is pending.

Eclipse browser bundle fix: UMD dependencies now receive the local module loader as `require`, fixing “require is not defined” during abaplint initialization. The VS Code runtime is unchanged.

Eclipse module loader: failed initialization no longer leaves partial exports in the cache. This prevents a failed abaplint load from turning subsequent requests into misleading “MemoryFile is not a constructor” errors. Restart the PDE runtime or installed Eclipse after updating generated resources.

Eclipse browser runtime: added the Buffer.from hex/UTF-8 operations used by abaplint built-in constants, allowing dependent class parsing to continue. Origin reports its ADT + abaplint engine correctly. VS Code runtime unchanged; live SAP verification pending.

Eclipse browser bundler: generated module imports now use a distinct loader name, avoiding collision with frontend-analysis’s SAP source load function. This fixes Calls palette and Logic module loading; shared VS Code analysis sources are unchanged.

Shared FLOW theme fix: theme overrides now outrank Mermaid SVG-scoped styles, so routine frames and labels follow the active editor theme. Theme changes retain zoom and scroll. VS Code package version 0.8.2. Live light/dark rendering pending.

FLOW diagram correction: parameter transfers remain in the analysis tree but no longer form disconnected diagram nodes; call edges bypass them and connect the call statement to its callee. ELK cluster fills use active editor theme CSS variables, overriding inline Mermaid fills; theme updates preserve zoom and scroll. Live light/dark rendering pending.

FLOW source-only correction: both tree and diagram contain source statements and nested routines, without synthetic parameter-transfer rows or repeated-routine arrow markers. Formula and Expression retain data relationships.

FLOW collapse controls use the canonical independent toggle style with compact, centered icon geometry; removed the single-button segmented wrapper.

2026-10-07 — VS Code 0.8.3: FLOW initializes Mermaid with the active editor theme’s background, container, border, label and edge colours. Removes the initial dark-theme container background; theme changes preserve zoom. Live theme verification pending.

2026-10-07 — FLOW rendering fix: shared script now defines its ABAP identifier normalizer before variable label highlighting, fixing the reported “canonical is not defined” runtime error. VS Code package remains 0.8.3. Live rendering pending.

2026-10-07 — VS Code 0.8.3: Value origin FLOW has the reading levels of Visual Debug: Classes, Methods, Logic and Statements (the default, the previous view). All four are folds of one source — the analysis's code-flow rows — by the one flow builder the debugger uses (`vertex-flow-graph.js`); the switch changes the tree and the diagram together and keeps the depth control in step. Logic keeps branches, loops, calls and control transfers. Eclipse uses the same page and builder; its bundle is prepared, the plugin was not built.

2026-10-07 — VS Code 0.8.3: FLOW routine frames follow the theme in the ELK layout too. ELK draws a routine as a subgraph, not a cluster, so the theme rules never reached it and Mermaid's own fill stayed (light grey on a dark theme). Both kinds of frame now take a light tint of the theme's focus colour over the editor background — light blue on a light theme, a dark blue on a dark one — with a focus-colour border and editor-foreground captions. Shared by Value origin and Visual Debug.

2026-10-07 — VS Code 0.8.3: Value origin opens FLOW at Methods; the Analysis log is a technical section now, shown with the bug control like the other ones. The Depth control stands beside Fit when the diagram is shown, and stays in the toolbar for a tree, which has no diagram row. The magnifier shows the diagram's colours again: the theme rules were scoped to the diagram's container, which the magnifier's copy is not in; they are scoped to the drawing's own id now, which the copy shares.

2026-10-07 — VS Code 0.8.3: Expand all and Collapse all are two buttons side by side, as SAP GUI draws them — chevrons down and chevrons up — instead of one switch that turned over; the one in force is active. They stand at the root of the FLOW and Formula trees and in the diagram's toolbar, in Value origin and Visual Debug.

2026-10-07 — VS Code 0.8.3: in a tree the Depth control stands at the root beside Expand all / Collapse all (by Fit in the diagram), and a click on it does not fold the root. The FLOW buttons say what they do on hover: each reading (Classes, Methods, Logic, Statements), Full / BSE, FLOW / Formula, Tree / Diagram, Fit, Expand all and Collapse all.

2026-10-07 — VS Code 0.8.3: Show from here. A right click on a node of the FLOW diagram offers Show from here, which draws only that node and what it leads to, in the same reading and depth. A path bar above the diagram (Whole flow › … › the node) goes back to any level, and Esc goes back one step. The tree is unchanged. Shared by Value origin and Visual Debug.

2026-10-07 — VS Code 0.8.3: in the FLOW diagram a WHEN is drawn once, as the label on the line from its CASE to the branch's first statement; the separate WHEN box that repeated it is gone. The tree keeps WHEN as the parent of its branch.

2026-10-07 — VS Code 0.8.3: a click on a node in a VERTEX Tools diagram (Logic, Calls, Parts) scrolls the editor that already shows that source, in whatever column it is, instead of opening a second copy in the first column. A source not on screen opens in the column the ABAP sources already live in.

2026-10-07 — VS Code 0.8.3: the FLOW diagram takes its Mermaid colours from the editor theme only. When the theme lacks one of the variables it needs, the diagram area says which one, instead of substituting the CSS system colours `Canvas`, `CanvasText` and `GrayText` — Mermaid rejected those and the error also stopped the depth control. The drawn diagram's own repainting no longer falls back to `#ffffff` / `#111111` either: a missing editor background or foreground variable is reported in the diagram area, also when it is noticed on a theme change.

2026-10-07 — VS Code 0.8.3: Tree / Diagram is the first switch of the FLOW toolbar. Show from here survives a change of reading: the chosen node is found again in the new one — itself, else the routine it stands in, else its class — so Classes / Methods / Logic / Statements redraw that branch, not the whole flow. The last hex colour fallback (`#4f8cff` for variable highlighting) is gone; a missing link colour is reported like the others.

2026-10-07 — VS Code 0.8.3: diagram direction Auto, the default. Auto draws the diagram both top-down and left-right and shows the one that fits the window at the larger scale (fit = min(window width / drawing width, window height / drawing height)); its tooltip says which one it chose. Top-down and Left-right still fix the direction by hand; Auto returns to the choice.

2026-10-07 — VS Code 0.8.3: Auto / Top-down / Left-right form one segmented switch, so they no longer wrap in a narrow window. Expand all / Collapse all is one button again; its icon shows what a click does (chevrons up to collapse, down to expand). The node menu of the FLOW diagram also has Expand this branch and Collapse this branch, which open or close only that node and what is under it. The menu opens on a routine frame too, in every reading.

2026-10-07 — VS Code 0.8.3: a click on a label in the Value origin FLOW diagram opens that code in the editor beside it again. The click named only the diagram's own node, which the window could not find among the analysis nodes, so nothing opened; it now carries the node's source and line, as the tree's links do.

2026-10-07 — VS Code 0.8.3: the hover of a name declared inline (`DATA(x) = …`, `FINAL(x) = …`) shows the whole declaring statement and the type SAP's element info gives it (for example `TYPE ZIF_CALC_TYPES=>TY_CONTEXT`), and for a structure each component SAP lists.

2026-10-07 — VS Code 0.8.3: Visual Debug's flow has the same controls as Value origin's: one Classes / Methods / Logic / Statements switch over the same readings of the record (or of the analysis before a run), Show from here and Expand / Collapse this branch in the node menu, Auto direction, and BSE without Logic. The separate Logic button, which opened the Tools logic diagram of one method, is gone from the toolbar.

2026-10-07 — VS Code 0.8.3: the readings of a flow are built when they are first asked for, in Value origin and Visual Debug alike: the window builds the reading it shows, and another one is built from the same source when the switch is turned to it, then kept. Back (Alt+Left) returns from code opened from a diagram — Value origin's or a Tools diagram — to where the cursor was. When SAP gives no type, the hover says so. Before, it showed a cut-off piece of the assignment (`x) = …`) and no type.

2026-10-07 — VS Code 0.8.3: Go to Type Definition (context menu) on a variable opens the declaration of its type: SAP's element info names the type (`abapType`), the class or interface that owns `OWNER=>TYPE` is opened through ADT, and the cursor lands on its `TYPES` (or `TYPES BEGIN OF`) statement. A dictionary or built-in type, or a value SAP names no type for, is said in a message. F12 (Go to Definition) on the name in its own inline declaration (`DATA(x)`, `FINAL(x)`) does the same, since the definition is where the cursor already is; on any other use F12 still goes to the declaration.

2026-10-07 — VS Code 0.8.3: edge labels in the FLOW diagram stand on a backing in the editor background, so the line no longer runs through them. This works in every reading; an early build broke Classes and Methods with an insertBefore error. Dragging the diagram no longer selects text in the toolbar and frame captions.

2026-10-07 — VS Code 0.8.3: in the BSE scope a block that is kept is drawn whole — its ENDIF, ENDCASE, ENDLOOP, ENDDO, ENDWHILE, ENDSELECT or ENDTRY comes with it, in the tree and the diagram. BSE has no Logic reading: the slice is statements, so Logic is hidden while BSE is on, a Logic view turns to Statements, and Logic returns with Full.
