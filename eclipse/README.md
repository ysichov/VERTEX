# Built-in Eclipse Assistant

**Version: 0.9.89**

**Looking for the standalone AI Code Agent for local Git projects in any programming language?** Use the [VS Code extension](../vscode/README.md): that workflow reads, searches and edits an isolated working copy, with review and Apply, without a SAP connection. This document describes the Eclipse ADT plugin and its SAP workflows.

SelecTor offers **Technical names / Text** for selection labels and table headers. The choice is remembered.

**Fields** (a table's function beside Data) lists the fields of a table or structure as SE11 does - key, data element, type, length, decimals, short text - and an `.INCLUDE` or `.APPEND` row names the structure it brings in as a link that opens that structure's fields. A structure has no rows, so it opens on Fields; the chat opens a structure that way too.

The plugin depends on none of the projects VERTEX grew out of - Simple Data Explorer, ACE, AVE:
nothing from them has to be installed, and none of their code is called. Code Explorer and Value
Origin analyse ADT source in the plugin, and SelecTor in VERTEX Tools reads through ADT's standard
data preview once the plugin is built from the current repository. Versions and the review of a
transport read ADT too, as in VS Code: the version history from ADT's revision feed, the review built
from it in the window. VERTEX's own ABAP, `src/`, is needed to save a review to SAP and, where ADT keeps no versions of
data elements, domains and tables, to read theirs. The AVE
repository itself is not needed.

## Forward and Backward Usage Analysis

Neither has a menu item of its own; both work inside VERTEX Smart Debugger, as in VS Code:

- **Forward** - *Analyze flow path* on a breakpoint: how the value chosen in Variables is computed,
  down from that line across calls, as FLOW, Formula or Expression. A breakpoint the flow reaches
  stops it and asks: stop the analysis there, continue to the next breakpoint, or ignore
  breakpoints; Escape is Stop, and what was found so far is shown. While it runs, the VERTEX logo
  turns at the start of its progress line.
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
leaves the last path shown and says why. The code is coloured as in the Diagram's Code. A line number
in the window shows the line in the editor.

**Value sources** colours each variable read in the conditions and puts the statement that gives it
its value right above the condition, with a list of where each value comes from. **Window →
Preferences → VERTEX Path to This Line** numbers the lines from the METHOD or FORM statement, as
SAP GUI numbers a method.

## Run Select

**VERTEX: Run Select** runs the SELECT at the cursor, from the editor's text, saved or not, as VS Code
does: a SELECT that SelecTor can say opens in VERTEX Tools on its table, view or CDS entity, its WHERE as selection lines (a join or
a grouped SELECT in SelecTor's join or pivot); any other runs through ADT's data preview and its rows are shown
with the statement as run. What only the running program knows - INTO, FOR ALL ENTRIES, conditions on program
values - is left out and named above the rows. SelecTor results show the SELECT fields plus fields used by WHERE, JOIN ON and ORDER BY, without duplicates. ABAP structure components on the value side of WHERE are not result columns. The selection panel starts folded; grouped queries retain their pivot shape.

## VERTEX Assistant

**VERTEX Assistant** opens the chat beside the editor, on the system of the object selected in Project
Explorer or shown in the active editor; with neither, it asks which ABAP project. The same chat is **Ask AI**
in VERTEX Tools; its question box grows with what you type or paste and then scrolls. It runs Claude Code, Codex, EPAM CodeMie through the CodeMie CLI (`npm install -g @codemieai/code`, then
`codemie setup`) or the Anthropic API with your own key. Set them up in **Window → Preferences → VERTEX Assistant**: the Anthropic API key
is entered there and kept in Eclipse secure storage. The same page sets the
log folder and what is logged - questions, answers, SAP tool calls, and what is sent to the model (VERTEX's
instructions, the prompt with its context, the tools) - are chosen too; nothing is logged until a folder is set. The log icon in the chat's header opens Session Logs, or says
where to set the folder when none is set.

## Session Logs

**VERTEX: Session Logs** (Quick Access, or **Window → Show View → VERTEX → Session Logs**) shows the
assistant's conversations from the log folder set in **Window → Preferences → VERTEX Assistant**:
each session with its prompts - several as one narrow line each, which opens the prompt's conversation - answers, models and token usage, and the objects a prompt named, which
open in ADT - on the system the log names when the workspace has a project of that name, otherwise
on the one you pick. Recorded diagram and metrics context opens in the window. **Clear selected
conversations** deletes their log files after asking. Recorded transpiler runs and SAP debug sessions
open in VS Code only. The **Duration** column shows the elapsed time from each prompt to its last recorded assistant response in minutes and seconds.
The FLOW and Value Origin diagrams can render large graphs with more than 500 edges.
Opened from the VERTEX submenu of an ADT editor, VERTEX Tools selects that object and follows the cursor; opened from Project Explorer or **Window → Show View → VERTEX → VERTEX Tools**, it shows object type and name fields (a mask such as `ZV*LAB` works) and the Parts list. A method in UML opens its class at that method; Ctrl+click opens it in a tab of its own. VERTEX windows open docked to the right of the editors. Conversation details are rendered when expanded. Offscreen session layout is deferred by the browser. The Conversation column prioritizes prompt text; Model is compact, with the full provider and model available on hover. Table columns retain stable sizing in narrow panels; scroll horizontally to see additional columns.

## Versions and code review

**Versions** in VERTEX Tools lists an object's parts and their versions from ADT's revision feed and
shows the change a version made; a part opens on its newest change, the latest version against the one
before it. The diff is Eclipse's own Text Compare (`RangeDifferencer` of
`org.eclipse.compare.core`, the comparison ADT's *Compare With* shows): whole lines, a shortest edit
script, nothing on top. The VS Code extension computes the same kind of diff with VERTEX's own
implementation, because Eclipse's comparer is under the EPL and cannot be carried into VERTEX's MIT
code.

**The review of a transport** is built from ADT with **Build review** when none is saved - opening only reads a saved one - every part the request carries - on its own object list or in a task not yet released; an object taken out of the request after its task was released is left out - except code SAP generated (SAP*'s versions, `*_MPC`, `*_MPC_EXT`, `*_DPC`, `SAPL*`, comment-only new objects, empty class sections, includes the table maintenance generator (SE54) writes for SM30, and generator stamp lines) unless **Ignore SAP generated** is cleared,
the pair of versions chosen by AVE's rule, diffed and cut into blocks by AVE's walk - each part appears as soon as
it is read, the status line says which, and a changed line shows what changed inside it. Before it is built, Review
lists the request's objects - type, class, kind, authors, tasks and dates, as AVE's report does - with objects deleted
since in red; newly created objects are green. Review ignores spacing and case outside literals. **Approve**, **Decline**, **Comment** and **Undo** act on one block; filters show approved, declined, not processed or commented blocks, also per developer or reviewer. **Ask AI** asks about a block or a whole object. A built review is saved at once where reviews are kept, and a folded **Build log** tells why a part
gave no block. **Code review** and **Technical documentation** in the saved transport summary open all changed objects with that prompt chosen. Tick objects in the summary (a row, or a group heading for the whole group) to narrow **Expand all**, **Code review**, **Technical documentation** and their prompts to them; **All / None** set or clear the ticks, and none ticked means all objects. In a transport review, **Open** on a block and a line number in its diff open the code in the editor at that line, class parts included. **ASK AI** beside that choice puts the blocks on the chat chip with the chosen prompt as its instruction; a question typed in the chat adds to it. A single block's **ASK AI** keeps the short question. There,
**Code review / Technical documentation** selects the prompt copied by **AI prompt diff / full**, and on a single object's page the one copied by **Copy prompt: diff / full**;
developer and reviewer views have the same choice. The documentation prompt keeps created objects (sent whole, described as they are) apart from modified ones, and ends with
`TR Details: <request>`. The **Prompts…** button shows and edits both prompt texts. **Save user file** writes
`~/.vertex/prompts/code-review.txt` or `~/.vertex/prompts/technical-documentation.txt`; the file takes priority
and is reread when copying. **Use built-in** removes it. Data elements, domains and tables ADT keeps no versions of are read through VERTEX's ABAP; without it
they say so. The **Blame** toggle beside Versions | Review, off by default,
names the developer who wrote each changed line: the versions between the pair are replayed (one
more read per version, so a long history takes longer), and a version is credited to the owner of
the task it came from - a transport of copies to the task of the request it copies. Only the request's own versions count: a transport of copies made from another request does not. Of the request's tasks that carry the object, a copy goes to a released one stamped at or before it, by the system's date and time. When the object sits only in tasks of one developer, every changed line is that developer's and no versions are read. A block belongs
to whoever wrote most of its lines, every line of it shows that name, and **Developers** counts each developer's own lines and blocks;
hover the name for the version, date and request. With Blame off, a block is the author's of the new
version. A review saved by AVE with Blame shows its line authors when the toggle is on.
**Save** keeps it; a saved review takes Approve, Decline,
comments and taking a verdict back, made the way AVE makes them, so AVE and every VERTEX window read
the same review. A saved review opens at once; for an open request it is checked meanwhile against the request,
by each part's versions, and a part that changed since, joined the request or left it is named above
the table; **Developers** and **Reviewers** are listed as in AVE, and each opens the objects they wrote or reviewed; a class's
heading opens the whole class's changes; a released request is not checked. **Rebuild from ADT**, under the line that says when and
by whom the review was saved, replaces the saved review with one built from the request as it is
now and drops its verdicts. A review kept both in the table and in a file is shown with both copies
named - who saved each and when - and a **Table | File** switch opens either; nothing is merged, and
a change goes back to the copy shown. Where reviews are kept is set in **Window → Preferences → VERTEX Code Review**: the
`ZAVE_REVIEW` table (needs VERTEX's ABAP on the system, `ZCL_VX_ADT_RES_STORE`), files - one
`<project>/<request>.json` each, in the folder chosen there or in `.vertex/reviews` of the workspace -
or both. A system without VERTEX's ABAP keeps reviews in files whatever is chosen, and the review page
says so. Two people saving the same review at once do not overwrite each other: the second save is
refused. While a review is built, the review waiting strip runs under the toolbar - a beam scans diff rows and a draft is typed out -.

The VS Code-only right-hand VERTEX Smart Debugger panel and its F5-F8 shortcuts in the source editor are not
available in Eclipse; in Eclipse the keys work in the VERTEX Smart Debugger window itself.
The VERTEX Tools window no longer has a View source function in Eclipse either: the source is the
ADT editor.

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
3. Open **Window > Preferences > VERTEX Assistant**. Left as `node`, the Node
   executable is found on Eclipse's PATH, in nvm's versions (the newest first),
   Volta, Homebrew or `/usr/local/bin`, so an Eclipse started from the Dock
   finds an nvm install too; set it here only for another Node. **CodeMie profile**
   chooses which CodeMie profile (project or account) the chat uses; **Active in
   CodeMie** follows `codemie profile switch`. It is enabled from two profiles.
   **Show the cost of each CodeMie answer** (off by default) ends the token line
   with `≈ $…`, Claude Code's estimate from list prices, not CodeMie's bill. While
   CodeMie is the chosen assistant, its list shows CodeMie's gradient. Optionally select native Codex/Claude
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
then regenerate. `.gitattributes` marks them `linguist-generated`, so GitHub collapses them in diffs and VERTEX Git review lists them without their diff. The feature and bundle sources are at `0.9.84.qualifier`; the checked-in update site carries build `0.9.85.20261112152534`.

The local install archive is version `0.9.85.20261112152534`. Install its ZIP through
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
  the run and come back after it - they would otherwise answer every step too. Visual can be switched during a run: it applies from the next step. The run's speed shows
  above the player.
- Closing the window while the program stands stopped asks whether to end the program, leave it
  stopped in ADT, or keep the window; meanwhile its tab shows a `*`.
- Right-click a node or a routine frame of the diagram for *Show from here*, *Expand this branch*
  and *Collapse this branch*.
- With a value chosen in Variables, Formula and Expression after a run keep only the path the run
  took. Expression has **Analyze** (the default: the complete formula without recorded values for any result) and
  **Recorded** (how the run computed the value), and the **Optimized** toggle for both: off, the derivation written
  out as one line; on, the formula reads its values by their names (`CS_CONTEXT-AMOUNT₁`, `CS_CONTEXT-AMOUNT₂`) and
  *where* gives each by its statement, the next level under an arrow. With values switches the recorded values in brackets; with no path analysed they
  come from the record: Expression is the statement that made the value; right under it, after
  *where*, the computed values it reads are given by their statements side by side, and a line's
  arrow unfolds the next level; a value built up in one variable step after step is then written
  once more, captioned, as one product of its first value, with a where of its own. A component read with several values is numbered in
  the order they were made (`amount₁`, `amount₂`); values show four decimals, the whole value on
  hover. Every name in them links to its statement. A formula from the
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
Package Metrics includes classes, interfaces and programs. **Visual** draws each object as a tile sized by the selected metric and split into its methods, forms and events; double-click a unit to open its source.
For a class or program, Metrics switches between **Table** and **Visual**. In Visual, tile area scales with the selected indicator and each tile shows its unit name and value. CC and MI colours follow the table's risk grades; other indicators use a relative ranking within the object. Single-click a tile to select it; double-click or press Enter to open its ADT source.
Visual has a 2–300% scale control and a Fit button that fits the whole map into the pane. Fit and the ± buttons animate scale changes; Ctrl+wheel changes scale immediately, as in UML, while ordinary scrolling moves around the map. Zoom changes tile space and reveals more labels without enlarging text.
UML and Metrics show the current analysis stage, object count and elapsed time while a package is processed.
UML and Metrics show the current analysis stage, object count and elapsed time while a package is processed.
Click a method in UML to open its ADT source.
UML shows interface method implementations in their implementing classes.

Tools offers Metrics, Logic diagram and Calls for function modules. In a program the Logic diagram draws any of its routines: a report event (START-OF-SELECTION, AT SELECTION-SCREEN), a FORM or a MODULE as well as a method. Clicking a method
of a class local to a program opens that program at the method. Logic follows
the visible routine in the ADT editor.

Value Origin reads the chosen value's slice. Full / BSE, Depth and Expand /
Collapse control the displayed tree; the node menu can show a branch from a
selected point. Calls depth starts at 1. Analysis is available for global and
local class code, including test classes.

Chat object names are links to their ADT editors. Copy copies an answer as Markdown.
In a two-pane diff the new version is on the left; review blocks offer Approve,
Decline and Comment. Inline / 2 pane is shared with the version diff.

For a method with no separate version directory, Diff uses the class history and extracts that method, with a notice identifying the source of the history.

Session logs render Markdown in questions, answers and reasoning; user text is blue, answers green and reasoning indigo.

**Host scope:** VERTEX Code Agent (alpha), with native Claude Code tools and VERTEX file tools for the other providers, Git working-copy review and builds after Apply, is available in the VS Code extension. The Eclipse assistant continues to use its documented SAP workflow.

Session Logs groups provider files by conversation, with combined usage and each prompt’s provider and model. Clearing a selected conversation removes all its provider files and branches. Older logs without a conversation identifier remain separate.
