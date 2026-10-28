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

Neither has a menu item of its own; both work inside VERTEX Smart Debugger, as in VS Code:

- **Forward** - *Analyze flow path* on a breakpoint: how the value chosen in Variables is computed,
  down from that line across calls, as FLOW, Formula or Expression. A breakpoint the flow reaches
  stops it and asks: stop the analysis there, continue to the next breakpoint, or ignore
  breakpoints; Escape is Stop, and what was found so far is shown.
- **Backward** - *Where used* on a breakpoint: where the value chosen in Variables, or with none the
  routine's parameters and the attributes it uses, goes in its callers, up through theirs, followed
  through SAP's where-used. Customer code is walked with no depth limit; standard SAP code is where
  the walk stops. The editor's breakpoints stop it the same way.

Both read the active source over ADT and analyse it in the window; nothing of VERTEX's ABAP is
needed. While one runs, **Cancel** beside its status stops it.

All VERTEX commands of a context menu stand in one **VERTEX** submenu, beside GitHub, Team and Run
As: VERTEX Tools, Path to This Line, Run Select,
VERTEX Smart Debugger, Review & Activate, VERTEX Assistant and Session Logs. The commands below are named as they appear there.

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
values - is left out and named above the rows. SelecTor results show the SELECT fields plus fields used by WHERE, JOIN ON and ORDER BY, without duplicates. ABAP structure components on the value side of WHERE are not result columns. The selection panel starts folded; grouped queries retain their pivot shape.

## VERTEX Assistant

**VERTEX Assistant** opens the chat beside the editor, on the system of the object selected in Project
Explorer or shown in the active editor; with neither, it asks which ABAP project. The same chat is **Ask AI**
in VERTEX Tools. It runs Claude Code or Codex, set in **Window → Preferences → VERTEX Assistant**, where the
log folder and what is logged - questions, answers, SAP tool calls, and what is sent to the model (VERTEX's
instructions, the prompt with its context, the tools) - are chosen too; nothing is logged until a folder is set. The log icon in the chat's header opens Session Logs, or says
where to set the folder when none is set.

## Session Logs

**VERTEX: Session Logs** (Quick Access, or **Window → Show View → VERTEX → Session Logs**) shows the
assistant's conversations from the log folder set in **Window → Preferences → VERTEX Assistant**:
each session with its prompts, answers, models and token usage, and the objects a prompt named, which
open in ADT - on the system the log names when the workspace has a project of that name, otherwise
on the one you pick. Recorded diagram and metrics context opens in the window. **Clear selected
conversations** deletes their log files after asking. Recorded transpiler runs and SAP debug sessions
open in VS Code only.
The FLOW and Value Origin diagrams can render large graphs with more than 500 edges.
Opening VERTEX Tools from the VERTEX submenu of an ADT class or program editor selects that object and follows the editor's cursor. A method in a UML diagram opens its class at that method; a plain click reuses the editor the previous plain click opened (closing it unless it holds unsaved changes, and never one you had open already), Ctrl+click opens the class in a tab of its own. Opened from Project Explorer or by **Window → Show View → VERTEX → VERTEX Tools**, Tools shows the object type and name fields - from Show View filled with the active editor's object - - a name or a mask such as `ZV*LAB` finds any object - and the Parts list, where Logic view takes its method. VERTEX Tools, the assistant and the VERTEX functions open docked right of the editors, half the width, all in one stack - the editor and VERTEX side by side, nothing covering the screen. A window already open is only brought to the front, wherever you moved or dragged it. Opening it also reveals hidden containing layout areas in the current perspective.

## Versions and code review

**Versions** in VERTEX Tools lists an object's parts and their versions from ADT's revision feed and
shows the change a version made. The diff is Eclipse's own Text Compare (`RangeDifferencer` of
`org.eclipse.compare.core`, the comparison ADT's *Compare With* shows): whole lines, a shortest edit
script, nothing on top. The VS Code extension computes the same kind of diff with VERTEX's own
implementation, because Eclipse's comparer is under the EPL and cannot be carried into VERTEX's MIT
code.

**The review of a transport** is built from ADT when none is saved - every part the request changed except code SAP generated,
the pair of versions chosen by AVE's rule, diffed and cut into blocks by AVE's walk - and the status
line says which part is being read. The **Blame** toggle beside Versions | Review, off by default,
names the developer who wrote each changed line: the versions between the pair are replayed (one
more read per version, so a long history takes longer), and a version is credited to the owner of
the task it came from - a transport of copies to the task of the request it copies. A block belongs
to whoever wrote most of its lines, and **Developers** counts each developer's own lines and blocks;
hover the name for the version, date and request. With Blame off, a block is the author's of the new
version. A review saved by AVE with Blame shows its line authors when the toggle is on.
**Save** keeps it; a saved review takes Approve, Decline,
comments and taking a verdict back, made the way AVE makes them, so AVE and every VERTEX window read
the same review. A saved review of an open request is checked against the request when it is opened,
by each part's versions, and a part that changed since, joined the request or left it is named above
the table; a released request is not checked. **Rebuild from ADT**, under the line that says when and
by whom the review was saved, replaces the saved review with one built from the request as it is
now and drops its verdicts. A review kept both in the table and in a file is shown with both copies
named - who saved each and when - and a **Table | File** switch opens either; nothing is merged, and
a change goes back to the copy shown. Where reviews are kept is set in **Window → Preferences → VERTEX Code Review**: the
`ZAVE_REVIEW` table (needs VERTEX's ABAP on the system, `ZCL_VX_ADT_RES_STORE`), files - one
`<project>/<request>.json` each, in the folder chosen there or in `.vertex/reviews` of the workspace -
or both. A system without VERTEX's ABAP keeps reviews in files whatever is chosen, and the review page
says so. Two people saving the same review at once do not overwrite each other: the second save is
refused.

The VS Code 0.8.0 Value Origin adds Expression alongside FLOW and Formula. The shared analysis UI continues to evolve in VS Code; this guide's version-specific notes below describe Eclipse source or packaged builds where stated.

The shared diagram pages changed too. Their source is shared, but the published Eclipse archive
currently contains the older 0.8.0 build; rebuild and publish the plugin to deliver the current
pages to Eclipse users.

The VS Code-only right-hand VERTEX Smart Debugger panel and its F5-F8 shortcuts in the source editor are not
available in Eclipse; in Eclipse the keys work in the VERTEX Smart Debugger window itself.
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
then regenerate. The feature and bundle sources are at `0.9.36.qualifier`; the checked-in update site carries build `0.9.31.20261024182823`.

The local install archive is version `0.9.36.20261027090001`. Install its ZIP through
Help → Install New Software → Add → Archive.

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

For building and exporting the plugin, see [BUILD.md](../BUILD.md).
Install an update-site archive with **Help > Install New Software > Add > Archive**.

## VERTEX Smart Debugger

**VERTEX → VERTEX Smart Debugger** in an ADT editor's context menu opens the same VERTEX Smart Debugger page
as VS Code. It does not open a debugger of its own: it drives the ADT debug session Eclipse already
has, through SAP's `IAbapThread` / `IAbapStackFrame` / `IAbapVariable` and Eclipse debug events, so
there is still one listener per user.

For a fast recorded run, turn off **Window → Preferences → Run/Debug → Activate the debug view when a
breakpoint is hit**. With it on, Eclipse brings its Debug view back at every stop - every step of a
run is one - and redraws it each time, whatever VERTEX hides.

- Stack, frame switching, scopes, variables and table rows come from the stopped ADT thread. Opened
  with no debug session, it reads the declared variables of the source at the editor's line, a
  structure opened to its type's fields.
- Single Step, Execute, Return and Continue call ADT's own stepping - also with **F5**, **F6**,
  **F7** and **F8** while the window has the focus; Detach and Exit program go to the same thread.
- Breakpoints set or cleared in the page are ADT breakpoints, and ADT's own appear in the page.
  Only your breakpoints stop a run: a stop ADT makes for itself (returning from SAP's code with
  **Z only**) does not.
- Switching a diagram between Top-down and Left-right automatically fits the new drawing after rendering.
- The switches at the very top show or hide Main (Clear, help, diagnostics and the run controls) and the sections - Stack,
  Breakpoints, Variables, Diagram, Dump. Variables and Diagram each have a button that takes the
  whole window; Esc gives it back.
- **Run in SAP** starts the program as **Run As → ABAP Application** does; for a class or a function
  module with the program field empty it opens SE24 or SE37 for its test. Run with ABAP Transpiler is
  VS Code only.
- With several ADT debug sessions at once, the stopped one is shown; a thread selector appears in
  the page header when it is not clear which.
- Each stop opens its line in the editor - when it stops, and where a run ends, not at every step.
  An editor of the object already open, ADT's debugger editor included, is used rather than a new tab.
- **Rec steps** and **Steps & values** record a run of steps (Continue under recording). Steps &
  values keeps at each stop only the values that changed since the last stop of the same routine,
  a structure's fields one level down; after a statement that writes no variable - WRITE without TO,
  SKIP, ULINE, NEW-LINE, NEW-PAGE, FORMAT - nothing is read. The player rebuilds a stop's values and
  marks the ones that stop wrote.
- **Visual** (off by default) draws the window at every step of a run. Off, the window is drawn when
  the run stops, and Eclipse's own Debug, Variables and Expressions windows, if open, are hidden for
  the run and come back after it - they would otherwise answer every step too. The run's speed shows
  above the player.
- Closing the window while the program stands stopped asks whether to end the program, leave it
  stopped in ADT, or keep the window; meanwhile its tab shows a `*`.
- Right-click a node or a routine frame of the diagram for *Show from here*, *Expand this branch*
  and *Collapse this branch*.
- With a value chosen in Variables, Formula and Expression after a run keep only the path the run
  took, with the recorded values in brackets (With values switches them); with no path analysed they
  are written out from the record. Every name in them links to its statement. A formula from the
  record follows the player: an assignment that has run by the stop shown has a green `=` and its
  value, one still to run a red `=`; decimal values are shown without trailing zeros.
- Several values can be followed - a structure as its components - and a list on the chip and at the
  left of the diagram toolbar switches between them. Analyze flow path works from a single point, to
  the end of the flow when no other checked point is met. Variable trees start closed.
- **Clear** starts the window again for its object: the record, the analysed path, the values
  followed and the output are dropped; the breakpoints and the ADT debug session stay. So are Save session,
  watchpoints, All BP, restoring a session: the page offers them, Eclipse
  does not answer them yet.

Differences from VS Code: no step prediction (Eclipse reads the stack at every suspend, so a step
is not shortened). **Run** needs an active breakpoint: it switches on ADT debugging, sends the
breakpoints to SAP and starts the object in Eclipse's embedded SAP GUI instead of WebGUI. A short
dump opens the same way.


## Code and data views

UML, metrics, Calls, Logic, Parts and Value Origin use standard ADT source reads
and the shared abaplint analysis engine. The SAP connection belongs to the
selected Eclipse project. See Versions and code review above for review storage.
Package Metrics has an **Expand all / Collapse all** button above Objects for the unit tables.
Package Metrics includes classes, interfaces and programs. **Visual** sizes each object by the selected metric and subdivides it into methods, forms and events. Double-click a unit or press Enter to open its source; click the object header to open its unit table. A program's forms and events, including those in its INCLUDEs, count toward its program. Indicators without fixed risk thresholds use one relative colour scale for all visible units in the package. The Visual Objects filter can hide classes, programs, interfaces or individual objects without rerunning analysis. The map heading shows the sum of the selected indicator for visible objects, such as total LOC.
For a class or program, Metrics switches between **Table** and **Visual**. In Visual, tile area scales with the selected indicator and each tile shows its unit name and value. CC and MI colours follow the table's risk grades; other indicators use a relative ranking within the object. Single-click a tile to select it; double-click or press Enter to open its ADT source.
Visual has a 2–300% scale control and a Fit button that fits the whole map into the pane. Fit and the ± buttons animate scale changes; Ctrl+wheel changes scale immediately, as in UML, while ordinary scrolling moves around the map. Zoom changes tile space and reveals more labels without enlarging text.
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
