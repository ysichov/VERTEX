# Built-in Eclipse Assistant

The assistant JSONL log omits program bodies from tool arguments and results; object names and result summaries are retained. Source-code logging has no separate option.


SelecTor offers **Technical names / Text** for selection labels and table headers. The choice is remembered.

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
needed. While one runs, **Cancel** beside its status stops it.

All VERTEX commands of a context menu stand in one **VERTEX** submenu, beside GitHub, Team and Run
As: VERTEX Tools, Path to This Line, Run Select, Forward and Backward Usage Analysis, Visual Flow Analysis,
Visual Analysis / Debug, Activate, VERTEX Assistant and Session Logs. The commands below are named as they appear there.

## Path to This Line

**VERTEX: Path to This Line** in an ADT source editor's context menu shows the conditions under which
the line at the cursor runs inside its METHOD or FORM: enclosing branches, earlier branches that must
be false, CHECKs, and earlier branches that must not be taken because they leave the routine. It reads
the editor's text as it stands, saved or not, and asks nothing of SAP. While the window is open, a
click on another line of that editor builds that line's path in it; a line outside a METHOD or FORM
leaves the last path shown and says why. The code is coloured as in the Logic view's Code. A line number
in the window shows the line in the editor.

**Value sources** colours each variable read in the conditions and puts the statement that gives it
its value right above the condition, with a list of where each value comes from. **Window →
Preferences → VERTEX Path to This Line** numbers the lines from the METHOD or FORM statement, as
SAP GUI numbers a method.

## Run Select

**VERTEX: Run Select** runs the SELECT at the cursor, from the editor's text, saved or not, as VS Code
does: a SELECT that SelecTor can say opens in VERTEX Tools on its table, its WHERE as selection lines (a join or
a grouped SELECT in SelecTor's join or pivot); any other runs through ADT's data preview and its rows are shown
with the statement as run. What only the running program knows - INTO, FOR ALL ENTRIES, conditions on program
values - is left out and named above the rows.

## VERTEX Assistant

**VERTEX Assistant** opens the chat in a window of its own, on the system of the object selected in Project
Explorer or shown in the active editor; with neither, it asks which ABAP project. The same chat is **Ask AI**
in VERTEX Tools. It runs Claude Code or Codex, set in **Window → Preferences → VERTEX Assistant**, where the
log folder and what is logged - questions, answers, SAP tool calls, and what is sent to the model (VERTEX's
instructions, the prompt with its context, the tools) - are chosen too; nothing is logged until a folder is set.

## Session Logs

**VERTEX: Session Logs** (Quick Access, or **Window → Show View → VERTEX → Session Logs**) shows the
assistant's conversations from the log folder set in **Window → Preferences → VERTEX Assistant**:
each session with its prompts, answers, models and token usage, and the objects a prompt named, which
open in ADT - on the system the log names when the workspace has a project of that name, otherwise
on the one you pick. Recorded diagram and metrics context opens in the window. **Clear selected
conversations** deletes their log files after asking. Recorded transpiler runs and SAP debug sessions
open in VS Code only.
The FLOW and Value Origin diagrams can render large graphs with more than 500 edges.
Opening VERTEX Tools while an ADT class or program editor is active selects that object automatically and follows the editor's cursor. A method in a UML diagram opens its class at that method; a plain click reuses the editor the previous plain click opened (closing it unless it holds unsaved changes, and never one you had open already), Ctrl+click opens the class in a tab of its own. Opened from Project Explorer, Tools shows the object type and name fields - a name or a mask such as `ZV*LAB` finds any object - and the Parts list, where Logic view takes its method. VERTEX Tools and the VERTEX functions open in a window of their own beside the workbench, so a click in the editor never hides them; a window already open is brought to the front.

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
the same review. A saved review is checked against the request when it is opened, by each part's
versions; when the request changed since, the page names what moved and offers **Rebuild from ADT**,
which replaces the saved review and drops its verdicts. Where reviews are kept is set in **Window → Preferences → VERTEX Code Review**: the
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

![VERTEX architecture: VS Code and Eclipse ADT, the VERTEX MCP server between them and the AI assistants (Claude Code, Codex, GitHub Copilot), the six VERTEX Web UI tools, and the ADT hub on SAP at /sap/bc/adt/vertex/*](../docs/architecture2.png)

The Selector and Versions Assistant panels launch Codex or Claude Code directly.
Copilot and the additional API-key providers in the built-in VERTEX Assistant
are limited to VS Code. Eclipse
Copilot Chat can connect through the separate standalone MCP registration.

For **GitHub Copilot Chat in Eclipse**, see [VERTEX MCP setup](MCP.md).
The standalone transport-review MCP server needs standard ADT and the shared
Node dependencies (`npm ci` in `vscode/`), without VERTEX's ABAP classes. It reads
saved `ZAVE_REVIEW` data or builds an unsaved review from ADT version history;
it cannot save or approve reviews.

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
then regenerate. The feature and bundle sources are at `0.9.30.qualifier`, the VS Code extension's number; the checked-in update site carries build `0.9.30.20261023215155`.

For a local installable archive without replacing the published `docs/` site:

```powershell
./eclipse/package.ps1 -Javac 'path/to/javac.exe' -BundlePool 'path/to/.p2/pool/plugins'
```

This compiles Java 21 classes, uses the existing PDE repository as the
metadata template, and creates a new timestamped site and ZIP under `target/`.
It refreshes bundled resources, sources, versions and SHA-256 download checksums.
Install via **Help > Install New Software > Add > Archive** and restart Eclipse.

### Diagram help

Tools pages include help for source links, Logic, procedure exits, range and
loop highlighting, direction, zoom and the magnifier.

## Visual Flow Analysis

**VERTEX: Visual Flow Analysis** in the ADT editor context menu opens Calls with
Classes / Methods and a Logic toggle. Logic follows the selected routine in the
ADT editor. Source links open the requested object and reveal its line or method.
Eclipse uses its own navigation Back command.

For building and exporting the plugin, see [BUILD.md](../BUILD.md).
Install an update-site archive with **Help > Install New Software > Add > Archive**.

## Visual Debug

**VERTEX: Open Visual Debug** in an ADT editor's context menu opens the VS Code Visual Debug page
in Eclipse. It does not open a debugger of its own: it drives the ADT debug session Eclipse
already has, through SAP's `IAbapThread` / `IAbapStackFrame` / `IAbapVariable` and Eclipse debug
events, so there is still one listener per user. The view keeps Debug Monitor's ID, so existing
shortcuts open it.

- Stack, frame switching, scopes, variables and table rows come from the stopped ADT thread.
- Step Into / Over / Return / Continue and run-to-line call ADT's own stepping; Detach and
  Terminate go to the same thread.
- Breakpoints set or cleared in the page are ADT breakpoints, and ADT's own appear in the page.
- The flow chart, recording and player run on the page as in VS Code; the stopped line opens in
  the ADT editor and the Logic view follows it.
- Eclipse handles source-editor navigation on each live stop; Visual Debug does not open another
  class tab on every step. Explicit source links still open their requested object.
- With several ADT debug threads, a thread selector appears in the page header.
- Right-click a node or a routine frame of the diagram for *Show from here*, *Expand this branch*
  and *Collapse this branch*.
- Steps & values reads the values at every stop, a structure's components one level down. With a
  value chosen in Variables, Formula and Expression after a run keep only the path the run took, with
  the recorded values in brackets (With values switches them); with no path analysed they are written
  out from the record. Every name in them links to its statement.
- Several values can be followed - a structure as its components - and a list on the chip and at the
  left of the diagram toolbar switches between them. Analyze flow path works from a single point, to
  the end of the flow when no other checked point is met. Variable trees start closed.
- Where used on a breakpoint and the Clear button are VS Code only for now.

Differences from VS Code: no step prediction (Eclipse reads the stack at every suspend, so a step
is not shortened). **Run** needs an active breakpoint: it switches on ADT debugging, sends the
breakpoints to SAP and starts the object in Eclipse's embedded SAP GUI instead of WebGUI. A short
dump opens the same way.


## Code and data views

UML, metrics, Calls, Logic, Parts and Value Origin use standard ADT source reads
and the shared abaplint analysis engine. The SAP connection belongs to the
selected Eclipse project. See Versions and code review above for review storage.
Package Metrics has an **Expand all / Collapse all** button above Objects for the method tables.
UML and Metrics show the current analysis stage, object count and elapsed time while a package is processed.
UML and Metrics show the current analysis stage, object count and elapsed time while a package is processed.
Click a method in UML to open its ADT source.
UML shows interface method implementations in their implementing classes.

Tools offers Metrics, Logic and Calls for function modules. Clicking a method
of a class local to a program opens that program at the method. Logic follows
the visible routine in the ADT editor.

Value Origin reads the chosen value's slice. Full / BSE, Depth and Expand /
Collapse control the displayed tree; the node menu can show a branch from a
selected point. Calls depth starts at 1. Analysis is available for global and
local class code, including test classes.

Chat object names are links to their ADT editors. Copy copies an answer as Markdown.
In a two-pane diff the new version is on the left; review blocks offer Approve,
Decline and Comment. Inline / 2 pane is shared with the version diff.
