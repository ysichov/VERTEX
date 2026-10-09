# Built-in Eclipse Assistant

The shared SelecTor source now offers **Technical names / Text** for Selection labels and table headers. The choice is remembered; Eclipse receives this change when its plugin is rebuilt.

The plugin depends on none of the projects VERTEX grew out of - Simple Data Explorer, ACE, AVE:
nothing from them has to be installed, and none of their code is called. Code Explorer and Value
Origin analyse ADT source in the plugin, and SelecTor in VERTEX Tools reads through ADT's standard
data preview once the plugin is built from the current repository. Versions and the review of a
transport read ADT too, as in VS Code: the version history from ADT's revision feed, the review built
from it in the window. VERTEX's own ABAP, `src/`, is needed only to save a review to SAP. The AVE
repository itself is not needed. Notes below that name a backend route describe the build they were
written for.

## Forward and Backward Usage Analysis

In an ADT source editor's context menu, as in VS Code:

- **VERTEX: Forward Usage Analysis** - how the value under the cursor is computed, down from that
  line across calls, as FLOW, Formula or Expression. With no variable under the cursor - or on a
  method's name, a called method or a keyword - it draws the flow from that line on. A breakpoint
  of the editor that the flow reaches stops it and asks: stop the analysis there, continue to the
  next breakpoint, or ignore breakpoints; Escape is Stop, and what was found so far is shown.
- **VERTEX: Backward Usage Analysis** - where the values of the routine at the cursor go in its
  callers, up through theirs: the variable under the cursor, or with none the routine's
  parameters and the attributes it uses, followed through SAP's where-used. Customer code is walked
  with no depth limit; standard SAP code is where the walk stops. The editor's breakpoints stop it
  the same way.

Both read the active source over ADT and analyse it in the window; nothing of VERTEX's ABAP is
needed.

## Versions and code review

**Versions** in VERTEX Tools lists an object's parts and their versions from ADT's revision feed and
shows the change a version made. The diff is Eclipse's own Text Compare (`RangeDifferencer` of
`org.eclipse.compare.core`, the comparison ADT's *Compare With* shows): whole lines, a shortest edit
script, nothing on top. The VS Code extension computes the same kind of diff with VERTEX's own
implementation, because Eclipse's comparer is under the EPL and cannot be carried into VERTEX's MIT
code.

**The review of a transport** is built from ADT when none is saved - every part the request changed,
the pair of versions chosen by AVE's rule, diffed and cut into blocks by AVE's walk - and the status
line says which part is being read. **Save** keeps it; a saved review takes Approve, Decline,
comments and taking a verdict back, made the way AVE makes them, so AVE and every VERTEX window read
the same review. Where reviews are kept is set in **Window → Preferences → VERTEX Code Review**: the
`ZAVE_REVIEW` table (needs VERTEX's ABAP on the system, `ZCL_VX_ADT_RES_STORE`), files - one
`<project>/<request>.json` each, in the folder chosen there or in `.vertex/reviews` of the workspace -
or both. A system without VERTEX's ABAP keeps reviews in files whatever is chosen, and the review page
says so. Two people saving the same review at once do not overwrite each other: the second save is
refused.

The VS Code 0.8.0 Value Origin adds Expression alongside FLOW and Formula. The shared analysis UI continues to evolve in VS Code; this guide's version-specific notes below describe Eclipse source or packaged builds where stated.

The shared diagram pages changed too. Their source is shared, but the published Eclipse archive
currently contains the older 0.8.0 build; rebuild and publish the plugin to deliver the current
pages to Eclipse users.

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
then regenerate. The feature and bundle sources are at `0.8.8.qualifier`, the same number as the VS Code extension; the checked-in update site carries build `0.8.8.202610092043`.

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

### Shared with VS Code 0.8.7

The VERTEX Tools window offers Metrics, Logic diagram and Calls diagram for a function module too, and opens it on Metrics; before, only Diff.

Value origin's FLOW, with a variable chosen, goes into a call only where the value is computed, and for a method's local variable shows that method alone; between breakpoints it shows the routine they stand in and everything it calls.

In the Calls diagram, a click on a method of a class local to a program opens that program at the method; before, Eclipse looked for a global class of that name ("ZCL_AVE_POPUP (Class) does not exist").

### Eclipse editor menu

Eclipse: the VERTEX items - VERTEX Tools, VERTEX: Activate, Forward Usage Analysis (then called Analyze Variable Value Origin), Visual Flow Analysis, Debug Monitor - are in the context menu of the ADT class and program editors again (with ADT 3.60 in Eclipse 2025-03 none of them showed there). In a class's Global Class tab the analyses are offered too: ADT 3.60 labels that tab otherwise than CLAS/OC, so the object's kind is also read from its ADT address. In build 0.8.1.20261008145448.

Value origin, Visual Flow Analysis and Debug Monitor are offered in every ADT editor, and Value origin runs in a class's method code: ADT 3.60 opens a class's Global Class tab as its main include (CLAS/I), which is now taken for the class itself. The local types, local implementations and test classes of a class are analysed too; a command that cannot run on an object says so and names its type and address.

Value origin reads only what the chosen value's slice reaches, as in VS Code - not every customer object the source names, which for a local variable meant half the system and a window that seemed to hang.

### Shared with VS Code 0.8.5

The Logic diagram is the shared page: RETURN, LEAVE PROGRAM and an EXIT outside a loop end their branch and are drawn in the theme's error colour, instead of a line across the whole diagram to ENDMETHOD. In build 0.8.1.20261008145448. SAP system setup is VS Code only: Eclipse takes its systems from the ABAP project.

### Shared with VS Code 0.8.4 (Value origin page)

FLOW tree: switching between Full and BSE keeps the branches open as Expand all / Collapse all and Depth set them (BSE used to show everything collapsed). The tree's root keeps Expand all and Depth even when nothing is left under it, so the depth slider no longer disappears. Depth for calls starts at 1. In build 0.8.1.20261008145448.

Logic diagram: a TRY is drawn as a branch - the TRY body and each CATCH start from the TRY and meet at ENDTRY. A RETURN inside a CATCH no longer ends the whole diagram; the method goes on after ENDTRY.

Eclipse: opening a function module from VERTEX (Tools, the chat) failed with "Function module ... was not found" for every function module; it opens now, a standard one too: when the search by type leaves it out, the exact name is searched without the type, as in VS Code.

Eclipse chat, as in VS Code: names in a list of found objects are links that open the object, and every answer has a Copy button that copies its Markdown through Eclipse's clipboard.

2 pane (version diff and review): the new version is always on the left and the old one on the right, and the heading names the new one first.

Review: the Inline | 2 pane switch of the version diff is in a request's review too; in 2 pane each block's bar with Approve, Decline and Comment spans both columns above its change. The choice is shared with the version diff.

Tools: while the window asks the SAP system what it offers, the page says so in its main area (it used to say it only in the small status line).

ABAP: the ACE core (`ZCL_VX_ACE_*`, `ZIF_VX_ACE_*`, `Z_VX_ACE_SCHEME_TEST`) and the hub routes that served it - `metrics`, `class`, `package`, `flow` (`ZCL_VX_ADT_RES_METRICS`, `_CLASS`, `_PACKAGE`, `_FLOW`) - are removed from the repository. VS Code and Eclipse compute UML, metrics, Calls, Logic, FLOW and the statement map themselves from ADT source with abaplint. The other routes stay: table, join, versions, review, prepare, requests, about. Installs older than the move to client-side analysis still ask for the removed routes.

### Shared with VS Code 0.8.3 (Value origin page)

The Eclipse plugin's Value origin runs the VS Code page and flow builder, so plugin build 0.8.1.20261008145448 carries the FLOW changes of VS Code 0.8.3 and the Value origin fixes below: the Classes / Methods / Logic / Statements switch, the node menu (Show from here, Expand / Collapse this branch), Auto direction, labels written as in the code, and theme-following frames.

Tools Logic now follows the ADT editor while it scrolls, as in VS Code 0.8.3: the line a third down the visible range is sent to the page, and when it lies in another method that method's logic diagram replaces the shown one. Also in build 0.8.1.20261008145448.

