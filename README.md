# ABAP VERTEX Tools

## Install

**[VS Code — the Marketplace](https://marketplace.visualstudio.com/items?itemName=YuriiSychov.vertex-abap)**
· **[Eclipse ADT — the update site](https://ysichov.github.io/VERTEX/)**

VERTEX is a set of plugins for VS Code and Eclipse ADT: an AI assistant with MCP, an enhanced ABAP
editor, an AI-driven ADT debugger, and explorers for code, versions and data. Each window reads over
the developer's existing ADT connection and renders as HTML.

![VERTEX architecture: the Web UI is built on three pillars—abap-adt-api, abaplint, and the Myers diff; SAP BAdI integration is used only to connect transport reviews with AVE in SAP GUI](docs/architecture.jpg)

The ABAP side is this repository's `src/`. It is optional: in VS Code everything works over ADT
alone, and `src/` is needed only to save a transport's review to SAP; without it, reviews are saved
to files. The Eclipse plugin still reads Versions and the review from `src/`. The last column below
says what needs it.

| Tool | Grew out of | What it does | VS Code | Eclipse | ABAP backend |
|---|---|---|---|---|---|
| **Enhanced Code Editor** | — | Hover with a data element's domain resolved, Go to (F12), Outline, Save & Activate and block-by-block Review & Activate, ABAP Unit into the Test Explorer (Ctrl+Shift+F10), ATC into Problems (Ctrl+Shift+F2), where-used (Shift+F12), SAP's keyword documentation (F1) | ✓ | — | not needed |
| **AI-driven ADT debugger** | [Smart Debugger](https://github.com/ysichov/Smart-Debugger) | Breakpoints with conditions SAP evaluates and watchpoint logs, the run started in WebGUI, the stops, a short dump reported instead of silence, a verdict naming the line and the values; the VERTEX chat has it built in, Claude Code and Codex reach it over MCP as `vertex-debug` | ✓ | — | not needed |
| **Visual Debug** | — | The same session on screen: source, breakpoints, stack, every variable, tables as grids, the flow chart of a recorded run and its player | ✓ | — | not needed |
| **Value Origin** | [ACE](https://github.com/ysichov/ACE) | Where a value came from, backwards across calls: the static call stack, the derivation as *FLOW* or *Formula*, each as a tree or a diagram | ✓ | — | not needed |
| **AI Assistant** | [ABAP-AI-Code](https://github.com/ysichov/ABAP-AI-Code) | Chat over any configured SAP system: reads, explains and changes code — the change lands in the tab, reviewed block by block before activation — runs the tests and ATC on an object, and drives the debugger | ✓ | ✓ ¹ | not needed |
| **Versions / Reviewer** | [AVE](https://github.com/ysichov/AVE) | Version history, the diff between two versions, the review of a whole transport with approve, decline and comments, and the two MCP transport tools | ✓ | ✓ ² | VS Code: to save reviews in SAP; Eclipse: Versions and the review |
| **Code Explorer** | [ACE](https://github.com/ysichov/ACE) | Metrics (McCabe, Halstead, maintainability), UML, the Calls diagram of an object and the Logic diagram of one method; a method opened from Calls draws its Logic diagram in the same picture | ✓ | ✓ ² | not needed |
| **Data Explorer (SelecTor)** | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, a join built from the dictionary's foreign keys, a pivot over either | ✓ | ✓ ² | not needed |

¹ In Eclipse the assistant is run by the Codex or Claude Code CLI on your own subscription, and
ADT is the editor: there is no VERTEX tab for it to write into, and the debugger is not part of it.
See [eclipse/README.md](eclipse/README.md).

² The three explorers are the same pages in both hosts, but the Eclipse plugin is built at
**0.7.3** and the VS Code extension at **0.8.0**. What the pages gained since 0.7.3 is in the
repository and in VS Code, and reaches Eclipse only when the plugin is built again.

**Grew out of** names where a tool's ideas were worked out first. VERTEX does not depend on those projects: nothing from Simple Data Explorer, ACE, AVE, Smart Debugger or ABAP-AI-Code has to be installed, and none of their code is called. Code Explorer, Value Origin and Visual Debug read ADT source and analyse it with abaplint in the editor; SelecTor builds its statements and reads them through ADT's standard data preview; in VS Code the version history and its diff come from ADT's revision feed, as in Eclipse's Revision History, and the review of a transport is built from them in the window, with AVE's rules for choosing the versions and cutting blocks. Saving it to SAP goes through one resource of VERTEX's own ABAP, `ZCL_VX_ADT_RES_STORE`, into the `ZAVE_REVIEW` table AVE uses too - ADT's data preview can read a table but not write it; reviews can also be kept in files. The AVE repository itself is not needed. The Eclipse plugin still reads the version history and the review from `src/`.

**Where the two hosts stand apart.** The editor, the debugger, Visual Debug and Value Origin are
VS Code only, by design: Eclipse has ADT's own editor and debugger, and VERTEX does not replace
them. The divergence that is not by design is the build — eight VS Code releases (0.7.4 Visual
Debug, 0.7.5 debugger fixes, 0.7.6 ABAP Unit, 0.7.7 the chat running tests and ATC, 0.7.9 Value
Origin and the diagram work, 0.7.12 Value Origin as one derivation, 0.7.14 the source as the editor alone - no View source, 0.8.0 one flow algorithm, Formula and Expression, the variables before the run) have landed since the
Eclipse plugin was last exported. The shared pages carry their part of that, and it is waiting on a build, not on code.

The projects named above are where the ideas were worked out first, and they are not developed
further; everything new happens here.


### SAP Systems Configuration in the VS Code

Install the extension from the Marketplace, then give it the connection Eclipse would take from the
ABAP project. There is no project here, so the systems are a list and one of them is active.
They live in VS Code's settings: **Ctrl+Shift+P → Preferences: Open User Settings (JSON)**, and
the entries go into that file.

A first install opens **Get started with VERTEX** (VS Code's Get Started page; later Help > Get Started): import the systems, test them, choose the assistant, add the VERTEX MCP server - each step with its button. The quickest way is **VERTEX: Import SAP Systems** (also a link under `vertex.systems` in Settings). It takes each
system's host and instance from SAP Logon (for a logon group, its message server's host), the client and user from an Eclipse ADT workspace - the recent workspaces of the Eclipse installations it finds are offered, another folder can be chosen - and
looks for ADT on the usual ports - 443NN and 80NN for the instance, then 44300, 8000, 50001, 50000, 443, 80, 8443,
8080 - offering only addresses that answer. **VERTEX: Test SAP Systems** then logs on to each configured system and
says what is wrong, if anything; the password it asks for is kept in the OS credential store, never in settings. The import also checks where the debugger can open WebGUI (`/sap/bc/gui/sap/its/webgui`): on the system's `url` it needs nothing; served on another address that answered - say `url` on HTTP 8000, WebGUI on HTTPS 44300 - or behind a redirect to a host this computer resolves, it writes that as `webgui`; found nowhere, it says so, and `webgui` is set by hand.
By hand, the entries look like this; the HTTP(S) port is in SMICM > Goto > Services.

```json
"vertex.systems": [
  { "name": "A4H", "url": "https://host:44300", "client": "001", "user": "DEVELOPER",
    "allowInsecureCertificate": true },
  { "name": "EXX", "url": "http://host:8XXX", "client": "100", "user": "DEVELOPER" }
],
"vertex.active": "A4H"
```

The url is the ICM port, not the one SAP GUI connects to. An empty `vertex.active` means the
first. **VERTEX: Switch System** picks another one from a list, and the password is asked once per
system - two systems are two users often enough.

### Eclipse

The update site address is pasted into **Help → Install New Software → Add → Location**; the
steps, and getting back out when a p2 install goes wrong, are in [INSTALL.md](INSTALL.md). VERTEX
then opens from **Window → Show View → Other… → VERTEX**, or right-click an object in the Project
Explorer → **VERTEX**.

### SAP

For the three explorers, pull this repository's `src/` with [abapGit](https://abapgit.org) and
activate it; nothing else has to be installed. A window that needs it and does not find it says
so, and the rest of VERTEX goes on working. The table, the join and the pivot were
carried out of Simple Data Explorer, the flow and the metrics out of ACE, and the version history,
the diff, the transport lookup and the review out of [AVE](https://github.com/ysichov/AVE) — first
into `src/` as `ZCL_VX_*`, with the SAP GUI stripped off, and since then, in VS Code, into the
window itself, read over ADT. None of the three is a prerequisite any more: they are where the
logic was written first, and they are not developed further — everything new happens on this side.
The `ZAVE_REVIEW` table reviews are saved in ships in `src/` as well.

Building either half from this repository instead: [BUILD.md](BUILD.md).

## Value Origin

Both Value Origin windows expose **Analysis log** directly above the flow. **Copy log** copies the engine, source loading and parsing times, source closure, definitions, dependency edges, traversal, warnings, and Formula/Expression diagnostics. The log is accessible without enabling the technical sections.

**Experimental client BSE.** In a VERTEX ABAP source tab, select the same variable and run **VERTEX: BSE — only ADT + linter** beside **VERTEX: Forward Usage Analysis**. The new command loads source through standard ADT, parses it locally with bundled `@abaplint/core`, and opens a separate window labelled **ADT + abaplint**. It does not request the SAP ACE origin index. It uses open editor buffers, including unsaved edits; compare saved, activated code to give both engines the same input. Source loading follows the selected value: main files first, external dependencies and local class includes only when needed, with metadata and source cached within each analysis. Full FLOW shows the loaded source closure. Interface-qualified method names are supported. The implementation shares the existing slice algorithm and reports unsupported statements. Alias analysis, dynamic dispatch and source closure are still experimental.


**VERTEX: Forward Usage Analysis** (formerly *Analyze Variable Value Origin*), on the cursor in a VERTEX ABAP source tab, answers
where that value came from - backwards across calls, without running the program. ACE indexes
and the customer sources they reference (`Z*`, `Y*`, `/namespace/`) are read from the same
system; standard ABAP objects stay analysis boundaries. It needs `ZCL_VX_ADT_RES_FLOW` in SAP
and active source. With no variable under the cursor it draws the flow forward from that line - the routine from there on and every customer routine it calls - without a slice of a value.

Value Origin takes a **Type**: *FLOW* or *Formula*. FLOW is what the program does — its
statements grouped by class and method, nested by blocks and their branches, with a node on each
call edge naming what that call passes (`lv_scenario → IV_SCENARIO`); it narrows from *Full* to
*BSE*, which is what the analysis found and the path that led to it. Formula is how the value was
computed: `a = b + c` at the top and the definitions of `b` and `c` as its two branches. The
**Depth** slider decides how far the tree opens — along the call stack in FLOW, along the
derivation in Formula — and one button beside it, offering *Collapse all* and then *Expand all*, says whether the levels shown are open, whatever the depth. *Tree* and
*Diagram* stay the two views of whichever Type is chosen. **Expression** (0.8.0) is a third Type: the derivation written out as one formula by substitution - a share added to the value before it becomes `value × (1 + share)` - with each table value a link to the statement that reads it, and, where the order of steps is configured data (a pipeline), the order of the loaded scenario.

Branches and polymorphic targets are alternatives, database-dependent loop order is a boundary.
Breakpoints in the editor stop the flow where a run would stop: VERTEX names the breakpoint reached and asks whether to stop the analysis there, continue to the next breakpoint or ignore the breakpoints. **VERTEX: Backward Usage Analysis** goes the other way: from the routine at the cursor up into the code that calls it - a where-used that follows the value. SAP's where-used finds the calls in the saved sources; in each caller the value is followed on from the call - what it is assigned to, tested in, passed to, written with - and, where it leaves the caller through a parameter of the caller's own, up again. A value passed in is followed to where each caller took it from. With a variable under the cursor that variable is followed (a local through the parameters and attributes it reaches); with none, every parameter of the routine and every attribute it uses; with neither, the calls themselves, as SAP's where-used gives them. Standard SAP code is not followed and is named. Breakpoints stop the walk as in Forward Usage Analysis, a level of callers at a time. The tab must be saved: where-used searches the saved source.

**Run Select.** **VERTEX: Run Select** (editor context menu of a VERTEX ABAP tab): the SELECT at the cursor runs through ADT's data preview, read only, as Eclipse's SQL console runs a query, and the rows open beside the code. What only the running program would supply is left out: INTO and FOR ALL ENTRIES go, UP TO n ROWS is the row limit (otherwise 100; SELECT SINGLE reads one), and a WHERE condition that reads a program value - a variable, a parameter, a select-option - is dropped, an OR holding one dropped whole. What was dropped is listed above the rows. A program value under NOT or outside WHERE, or a dynamic table, list or condition, refuses the SELECT and says why. The statement is parsed with abaplint, saved or not. A SELECT on one table whose WHERE select-options can say opens in SelecTor instead, its conditions filled in as selection lines and each program value as an empty line to fill in; any other SELECT runs in the plain window, which says why it did not open in SelecTor. A SELECT with INNER or LEFT OUTER joins opens in SelecTor's Join, its tables in order, their ON conditions and the SELECT list carried over, when SelecTor's join takes them - it joins only the tables the dictionary offers; the selection starts folded. In a table the selection panel is a list of fields, as SAP GUI's selection screen is, each with a Shown checkbox. From Run Select only the SELECT's fields are read at first; Show hidden reads every field of the table and leaves the ones the SELECT did not ask for unticked, still there to select on.

This is a static dependency
slice, not a solved runtime trace.

## What each host has

### VS Code 

- **VERTEX Tools** — pick an object type and a name; the functions offered depend on the type
  (Data, UML, Metrics, Calls and Logic diagrams, Diff, Versions). There is no View source: the source is the
  editor tab, and its parts are VS Code's Outline. Visual Debug is the panel beside the editor.
  Clicking a method in the Calls diagram opens its Logic diagram inside the same canvas, joined
  to the block it came from; the magnifier icon magnifies the diagram under the pointer, the same lens in every diagram.
- **The ABAP editor** — hover, Go to, outline, Save & Activate and the block-by-block
  Review & Activate; Ctrl+Shift+F10 runs ABAP Unit into the Test Explorer, Ctrl+Shift+F2 runs ATC
  into the Problems view, Shift+F12 shows where-used, F1 opens the keyword documentation.
- **VERTEX chat** — Claude or ChatGPT through a subscription or an Anthropic API key, over every
  system in `vertex.systems`; it reads, explains and changes code, and nothing reaches SAP until
  you save. *Run the tests for ZCL_FOO* and *run ATC on ZCL_FOO* are answered by running them:
  the result in the chat, the same run in the Test Explorer and the Problems view.
- **The debugger for an assistant** — *Z_CALC computes the wrong discount, find out why*: the
  assistant sets conditional breakpoints, runs the program in WebGUI and ends with the line and the
  values that prove it. Visual Debug shows the same session on screen, with a flow chart of the
  calls and a player for the recorded run.
- **Assistant in SelecTor and Versions** — a sentence instead of the clicks: *SFLIGHT for carrier
  AA, joined with SCARR*.

Everything, with its settings and commands: [vscode/README.md](vscode/README.md).

### Eclipse ADT

- **VERTEX Tools** — the same pages as in VS Code, opened from **Window → Show View → VERTEX** or
  the context menu of an object, on that object's own ADT project.
- **VERTEX Assistant** — the chat over the ABAP project's system, and the Assistant panels in
  SelecTor and Versions, run by Codex or Claude Code.
- **VERTEX: Activate** — ADT's activation, optionally after the block review.

Setup of the assistant: [eclipse/README.md](eclipse/README.md).

### Other assistants over MCP

The extension serves two MCP servers, and an assistant can take either.

**The transport review.** GitHub Copilot, Claude Code and Codex get two read-only tools:
`sap_transport_changes` lists what a request changed, and `sap_transport_diff` gives the diff in
review blocks with the verdicts already given. The VS Code extension serves them itself; without VS
Code, [mcp/](mcp/README.md) serves them over stdio. Setup:
[in VS Code](vscode/README.md#review-transports-with-copilot-claude-code-or-codex) ·
[Copilot in Eclipse](eclipse/MCP.md) · [without VS Code](mcp/README.md). The tested clients are
Copilot in VS Code, Claude Code and Codex; others are not supported yet.

**The debugger.** Claude Code and Codex get the whole ADT debugger as a second MCP server of the
extension, `/debug`, registered as `vertex-debug`: `debug_set_breakpoint` (with a condition SAP
evaluates, or mode `log` for a watchpoint), `debug_run`, `debug_wait`, `debug_read`, `debug_step`,
`debug_status`, `debug_log`, `debug_clear_breakpoints` and `debug_stop`. Nothing there changes a
variable or the code. It is the same session the VERTEX chat and Visual Debug drive, so a step
made in one is seen by the others. It runs on the active system, needs a VS Code window with
VERTEX open — the run is started in WebGUI and the listener has to outlive a single call — and
for that reason the standalone server in [mcp/](mcp/README.md) does not have it. Setup and the
tools one by one: [Debug with an assistant](vscode/README.md#debug-with-an-assistant).

## The explorers today

| Word | Comes from | What it does | In VERTEX | Status |
|---|---|---|---|---|
| Data | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, joins, pivot | SelecTor | A table with filters, a join built from the dictionary's own foreign keys, and a pivot over either |
| Version | [AVE](https://github.com/ysichov/AVE) | History, diff, blame, code review of a whole transport | Versions | A transport — by its number, or picked from the open or released requests of a user, yours by default — a package or one object; its parts, their versions, the diff between two of them, and the review of a request — built, saved, approved, declined and commented on block by block. No blame |
| Code | [ACE](https://github.com/ysichov/ACE) | Metrics, call maps, backward slicing, skeletons | Metrics | Three modes: the flow of a program, the branch scheme of one method, and McCabe, Halstead and the maintainability index per unit. A method opened from the Calls diagram draws its branch scheme in the same picture |

Status: **early**. All three answer, and each is a fraction of what it was cut from.

Building a review is here too, not only reading one. In VS Code a request with no saved review is
built from ADT when it is opened - every part it changed, the pair of versions chosen by AVE's rule,
diffed and cut into blocks by AVE's walk - with the status line saying which part is being read;
**Save** keeps it, in `ZAVE_REVIEW` or in files as `vertex.review.storage` says, and approving,
declining and commenting then change it the way AVE does. AVE's SAP GUI writes the same
`ZAVE_REVIEW`, so a review saved either way is read by both. The Eclipse plugin builds a review
through `src/` one object at a time.

The diff is VERTEX's own line differ: Myers' shortest edit script over whole lines, as Eclipse's
Text Compare computes it, with nothing on top. It is written from the published algorithm because
Eclipse's comparer is under the EPL and VERTEX is MIT.

## How it fits together

The division of labour is the same for all three: ABAP computes and returns JSON, the page
renders it, and the view in between is transport. Nothing about a service lives in the host, so
every page runs under the VS Code extension in `vscode/` as well — the same files, from the same
folder. And since SAP GUI 8.0 draws on the same WebView2 engine as both editors, one day inside
SAP GUI too.

Every service registers under the one `/vertex/` prefix, because that prefix is where the ADT
node is claimed and not the identity of the service: a second one would mean a second BAdI
implementation and a second filter to get wrong. The hub lives in this repository, under
`src/`, together with everything the windows read except the review — so there is one thing
to install and one registration to make. The prefix used to be `/zsde/`, from the repository
the hub was first built in; that hub is gone, and a system still carrying it answers each prefix
under its own filter.

The page receives finished JSON and knows nothing about SAP. That is what makes the second
host possible: `vscode/extension.js` reads the very same files and answers them over plain
HTTPS, and the markup, grids and filters are not written twice.

### Talking to ADT

Reading and writing an ADT resource from Java, the WebView2 callback deadlock, and how to read
signatures off the bundles when web search has nothing: [ADT_TECH.md](ADT_TECH.md).

### Layout

What each folder and file of the repository is for: [BUILD.md](BUILD.md#repository-layout).

## Acknowledgements

The experimental client BSE parser uses [abaplint](https://github.com/abaplint/abaplint) by Lars Hvam and contributors (MIT). `@abaplint/core` is bundled in the VSIX; no separate installation or lint extension is required. Its licence is included in `licenses/abaplint-MIT.txt`.


The VS Code extension talks to SAP ADT through
[abap-adt-api](https://github.com/marcellourbani/abap-adt-api) by Marcello Urbani (MIT): reading
and writing source, activation, the debugger, ABAP Unit, ATC, where-used, keyword documentation. It travels inside the VSIX with its
licence, as do the other npm packages it depends on (MIT, Apache-2.0, BSD-3-Clause), each in its
own folder. The Eclipse plugin does not use it: it works through the platform and ADT only.

## Next

What is still missing, and what has to come out before it ships: [Next.md](Next.md).

## VS Code 0.8.8: SelecTor, Run Select and Versions without the backend

- **Run Select.** New command **VERTEX: Run Select** (editor context menu of a VERTEX ABAP tab): the SELECT at the cursor runs through ADT's data preview, read only, as Eclipse's SQL console runs a query, and the rows open beside the code. What only the running program would supply is left out: INTO and FOR ALL ENTRIES go, UP TO n ROWS is the row limit (otherwise 100; SELECT SINGLE reads one), and a WHERE condition that reads a program value - a variable, a parameter, a select-option - is dropped, an OR holding one dropped whole. What was dropped is listed above the rows. A program value under NOT or outside WHERE, or a dynamic table, list or condition, refuses the SELECT and says why. The statement is parsed with abaplint, saved or not. A SELECT on one table whose WHERE select-options can say opens in SelecTor instead, its conditions filled in as selection lines and each program value as an empty line to fill in; any other SELECT runs in the plain window, which says why it did not open in SelecTor. A SELECT with INNER or LEFT OUTER joins opens in SelecTor's Join, its tables in order, their ON conditions and the SELECT list carried over, when SelecTor's join takes them - it joins only the tables the dictionary offers; the selection starts folded. In a table the selection panel is a list of fields, as SAP GUI's selection screen is, each with a Shown checkbox. From Run Select only the SELECT's fields are read at first; Show hidden reads every field of the table and leaves the ones the SELECT did not ask for unticked, still there to select on.
- **SelecTor without the backend for a table.** SelecTor reads a table - its fields with their texts, and the rows under the select-options - through ADT's data preview, as Run Select does, instead of the VERTEX resource on SAP. The answer and the window are the same; a selection SAP refuses is now an error rather than an empty table. Joins and the pivot still need the ABAP backend.
- **SelecTor's join without the backend.** The join is built and read through ADT's data preview too: the tables the dictionary offers (foreign keys out and in, text tables, from DD08L and DD05S), the proposed ON, the SELECT list and the selection, with the same window. A table the dictionary does not offer can now be joined as well, on the key fields it shares with the base or on an ON of your own - a self-join included. The pivot still needs the ABAP backend.
- **SelecTor's pivot without the backend.** The pivot is read through ADT's data preview as well: one statement grouped by its rows and columns with the measures' aggregates, the column values spread into columns in the window. Run Select opens a SELECT with GROUP BY and aggregates in the pivot, its grouped fields as rows and COUNT, SUM, MIN, MAX and AVG as measures; HAVING, DISTINCT, UNION and expressions run in the plain window. Its columns are named by the fields and its values by their domains' texts, as the ABAP pivot named them; a smallest or largest date stays a date; its selection is the same field list.
- **Versions without the backend.** The version history of a program or an include is read from ADT's revision feed, as Eclipse's Revision History reads it - number, author, time, transport - and the diff of two versions is computed in the window - VERTEX's own line differ, Myers' shortest edit script over whole lines as Eclipse's Text Compare computes it, written from the published algorithm because Eclipse's comparer is under the EPL and VERTEX under MIT; nothing is done on top of it, so a commented-out line no longer pairs with its original as in AVE; the switches for transports of copies, duplicates and case/indentation work as before. The task under a request is not shown: the feed does not carry it. A class is its sections, its methods and its local includes, as before: ADT keeps the versions of the whole class, and a section's or a method's history is the versions of the class where its text changed, cut out with abaplint - the first look at a long-lived class reads every version of it once. An interface, a function module and a CDS view read their own feeds; a function group is its main program, its function modules and its other includes, from TFDIR and TRDIR. Tables, structures, domains and data elements read their own feeds; a package is what TADIR keeps under it and a transport request what E071 holds for it and its tasks, each part opened from the feed of the object it belongs to. Finding a user's requests reads E070 through the data preview. A saved review is read through the data preview as well - the summary, the reviewers, the history and a part's blocks with their verdicts and threads, out of the ZAVE_REVIEW table AVE and VERTEX share; with none saved - or on a system without the table - the review of a request is built from ADT on the spot: each part it changed, paired by AVE's own rule - the request's newest version, or the active one when ADT records it under the request and no other request's version sits above, against the first older version that is not the request's - diffed and cut into blocks, to look at and not saved. Building a review into the table and approving, declining or commenting still go through the ABAP backend. Includes also get their parts list in VERTEX Tools.
- **A review built from ADT can be saved.** The review of a request with none saved is built in the window, and the status line now says what it is reading (the request, then each part in turn). **Save** keeps it; a saved review takes Approve, Decline, comments and taking a verdict back, made the way AVE makes them (its ZCL_VX_REVIEW_STATE carried over), so AVE and VERTEX read the same review. Two saves of the same review at once do not overwrite each other: the second is refused.
- **Where reviews are kept: `vertex.review.storage`.** `table` (default) writes SAP's `ZAVE_REVIEW` through a new resource of VERTEX's ABAP, `ZCL_VX_ADT_RES_STORE` - the one thing it is needed for in VS Code; `file` writes one JSON file per request under `vertex.review.folder` (default `.vertex/reviews` in the workspace, `<system>/<request>.json`); `both` writes both. On a system without VERTEX's ABAP reviews go to files, and the page says so. Approving, declining and commenting no longer go through `ZCL_VX_ADT_RES_REVIEW` in VS Code.

## VS Code 0.8.7: function modules in Tools

- **Function modules in VERTEX Tools.** A function module offers Metrics, Logic diagram and Calls diagram, as a program does, and opens on Metrics; before, only Diff.
- **Calls diagram navigation.** A click on a method of a class local to a program (or an include or function module) opens that program at the method, instead of looking for a global class of that name and failing.
- **Value origin FLOW.** With a variable chosen, the flow goes into a call only where the value is computed; for a variable local to its method the flow is that method alone, without its callers or the rest of the class. The run no longer reads unrelated classes.
- **Forward Usage Analysis.** Analyze Variable Value Origin is now **VERTEX: Forward Usage Analysis** (same keys and menus). With no variable under the cursor it draws the flow forward from that line, without a slice of a value. Breakpoints no longer bound the flow as a pair: the flow stops at each breakpoint it reaches, and VERTEX asks whether to stop the analysis there, continue to the next breakpoint or ignore the breakpoints.
- **Backward Usage Analysis.** New command **VERTEX: Backward Usage Analysis** (editor context menu of a VERTEX ABAP tab): from the routine at the cursor up into its callers through SAP's where-used, following the value - a variable, else every parameter and used attribute, else the plain calls - on in each caller and up through the caller's own parameters. Standard SAP code is not followed. Breakpoints stop it a level of callers at a time, with the same three answers.
- **Expression with conditions, working clicks.** Alternatives in Expression say when each holds: `{(iv_base * mv_rate) otherwise | ((iv_base * mv_rate) - 50) when lv_gross > 1000}` (ELSE reads as `NOT (…)`, a WHEN as `x = value`). A click on a node or on `</>` in a Value origin window opens the source again - a shared script had broken the page's own script, and with it every click. A script that fails in the window is now reported, and a node with no source to open says so.
- **Interface methods.** A double-click on a call through an interface reference (`lo_strategy->calculate_base(`), or on a method name in an interface's METHODS, goes to its implementation as SAP's navigate-to-implementation names it, instead of stopping at the interface.

## VS Code 0.8.5: SAP system setup, exits in Logic, long sources

- **SAP system setup.** **VERTEX: Import SAP Systems** fills `vertex.systems` from what the machine already has: each system's host and instance from SAP Logon (a logon group through its message server's host), the client and user from an Eclipse ADT workspace - the recent workspaces of the Eclipse installations found on the machine are offered - and the ADT address found by trying the usual ports (443NN and 80NN for the instance, then 44300, 8000, 50001, 50000, 443, 80, 8443, 8080). Only addresses that answer are offered, and nothing is written before the reader picks. **VERTEX: Test SAP Systems** logs on to each system and says what is wrong; the password goes to the OS credential store, never to settings. The import also checks where the debugger can open WebGUI (`/sap/bc/gui/sap/its/webgui`): on the system's `url` it needs nothing; served on another address that answered - say `url` on HTTP 8000, WebGUI on HTTPS 44300 - or behind a redirect to a host this computer resolves, it writes that as `webgui`; found nowhere, it says so, and `webgui` is set by hand. Both are links under `vertex.systems` in Settings, and a start with no system configured offers the import.
- **Logic diagram.** RETURN, LEAVE PROGRAM and an EXIT outside a loop end their branch and are drawn in the theme's error colour, instead of a line across the whole diagram to ENDMETHOD.
- **Long sources.** SAP's analysis of a source - hover, Go to Definition, F1 - is refused only above 50,000 lines (was 20,000). Above that F1 still works: SAP is sent only the statement at the cursor (a whole chain, across its lines), cut out with abaplint.
- **F1 and Go to Type Definition** wait for a hover's SAP analysis that is still running, as Go to Definition does, instead of failing with "SAP is still analysing the previous request".
- **Chat and reviews.** A question asked while a Tools window shows an object of a review carries that object's changes - the changed lines with three around them, each review block marked with its number, author and verdict - as it already did for a version diff.

## VS Code 0.8.4: FLOW tree in BSE

- The FLOW tree in Value origin: switching between Full and BSE keeps the branches open as Expand all / Collapse all and Depth set them (BSE used to show everything collapsed). The tree's root keeps Expand all and Depth even when nothing is left under it, so the depth slider no longer disappears. Depth for calls starts at 1.
- Chat: when a bare object name finds several objects, each name in the list is a link that opens the object, as a single match is opened.
- Tools: the Logic only switch no longer shows in UML or Metrics while the window is still loading; it belongs to the Logic diagram only.
- Tools UML: while a diagram loads, the diagram area says what is happening - checking the system, reading the class or the package's classes, loading the diagram library, drawing.
- Chat: every answer has a Copy button under it; it copies the answer's Markdown through VS Code's clipboard and says Copied or why it failed.
- Chat: "VERTEX:" stands on its own line, so an answer that starts with a heading or a list shows it as one.
- ABAP: the ACE core (`ZCL_VX_ACE_*`, `ZIF_VX_ACE_*`, `Z_VX_ACE_SCHEME_TEST`) and the hub routes that served it - `metrics`, `class`, `package`, `flow` (`ZCL_VX_ADT_RES_METRICS`, `_CLASS`, `_PACKAGE`, `_FLOW`) - are removed from the repository. VS Code and Eclipse compute UML, metrics, Calls, Logic, FLOW and the statement map themselves from ADT source with abaplint. The other routes stay: table, join, versions, review, prepare, requests, about. Installs older than the move to client-side analysis still ask for the removed routes.
- Review: the Inline | 2 pane switch of the version diff is in a request's review too; in 2 pane each block's bar with Approve, Decline and Comment spans both columns above its change. The choice is shared with the version diff.
- Tools: while the window asks the SAP system what it offers, the page says so in its main area (it used to say it only in the small status line).
- 2 pane (version diff and review): the new version is always on the left and the old one on the right, and the heading names the new one first.
- Eclipse chat, as in VS Code: names in a list of found objects are links that open the object, and every answer has a Copy button that copies its Markdown through Eclipse's clipboard.
- Eclipse: opening a function module from VERTEX (Tools, the chat) failed with "Function module ... was not found" for every function module; it opens now, a standard one too: when the search by type leaves it out, the exact name is searched without the type, as in VS Code.
- Logic diagram: a TRY is drawn as a branch - the TRY body and each CATCH start from the TRY and meet at ENDTRY. A RETURN inside a CATCH no longer ends the whole diagram; the method goes on after ENDTRY.

## VS Code 0.8.3: Predict past chains and loop tails, refused breakpoints

- A breakpoint SAP does not accept (a declaration line, for example) is taken off the editor's gutter again; SAP's refusal is still shown. Before, the red dot stayed though the run would never stop there.
- Predict with BSE passes a chained statement (`WRITE: / a, b, c.` over several lines) outside the slice in one F8 again. Every element of the chain was placed on the keyword's line, while SAP stops on each element's own line, so the page did not recognise the stop and stepped through the chain line by line, on every pass of a loop.
- Predict with BSE skips the rest of a loop pass once the slice has nothing more in it: from the last place of the slice in the pass, one F8 to temporary points on the first statement of the loop body (the next pass) and after the loop (the last pass), instead of stepping to ENDLOOP every time. Not over a breakpoint, and a call that is in the slice is still entered. The run's summary counts the passes skipped this way.

## VS Code 0.8.3: flow readings, diagram controls and types

- Value origin draws again. The shared flow script used its identifier normaliser before defining it, and the page stopped after the heading.
- FLOW readings: one switch, **Classes / Methods / Logic / Statements**, in Value origin and in Visual Debug. All four are readings of one source, drawn by the one shared builder. Value origin opens at Methods. A reading is built the first time it is shown. BSE has no Logic reading: Logic is hidden there, and a Logic view turns to Statements.
- Toolbar: Tree / Diagram comes first. One Expand all / Collapse all button, whose SAP GUI chevrons show what a click does. Depth stands beside it at the root of a tree and beside Fit in the diagram. Every control explains itself on hover. The Analysis log is behind the bug control, with the other technical sections.
- Node menu (right click on a node or a routine frame): **Show from here** draws only that branch, and a path bar above the diagram (or Esc) goes back. The branch is kept across readings. **Expand this branch** and **Collapse this branch** open or close one branch only.
- Diagram direction **Auto** (default) draws the diagram both ways and shows the one that fits the window at the larger scale. Top-down and Left-right fix the direction by hand.
- Diagram reading: WHEN is the label on the line from its CASE, not a second box. Edge labels stand on the editor background, so no line runs through them. Labels show the code as written — `<>`, `<fs>`, `=>`, `&` — in FLOW and in the Tools Logic diagram (no more `NE` or dots). In BSE a kept block keeps its ENDIF / ENDCASE / ENDLOOP.
- Theme: diagram colours come from the editor theme only, and a missing theme colour is reported by name. Routine frames follow the theme in every layout: light blue on light themes. The magnifier keeps the diagram colours. Dragging the diagram no longer selects text.
- Navigation: a click on a FLOW diagram label opens the code again. A click in a Tools diagram scrolls the editor that already shows that source instead of opening a second copy. Back (Alt+Left) returns from code opened from a diagram.
- Types: the hover of a name declared inline (`DATA(x) = …`) shows the declaring statement and the type SAP gives it. **Go to Type Definition** opens the `TYPES` declaration of a variable's type in its class or interface.
- Visual Debug: the separate Logic button (the Tools logic diagram of one method) is gone; Logic is a reading of the flow.
- Tools Logic follows the editor while it scrolls: when the source scrolled to is another method, its logic diagram replaces the shown one (before, only a cursor move did that). The Eclipse plugin's Tools window does the same from the ADT editor's scrolling; it is in the Eclipse plugin build 0.8.1.20261008145448.

## VS Code 0.8.1 — code diagrams and Visual Debug

### Analysis and source navigation

Metrics, UML, Calls, Logic and Value Origin read source through standard ADT and use bundled abaplint. Calls follows reached routines and enforces the selected depth during traversal; the default depth is 2. The entry routine is level 1 and each call adds one. A target at the boundary remains a leaf. Dynamic targets and unsupported constructs can remain unresolved; expand analysis warnings and copy the log for diagnostics.

Right-click an ABAP editor or object and choose a VERTEX Tools action. Tools opens beside the source and selects the method under the cursor. Click a linked label to open its source; Alt+Left returns through VS Code navigation history. Breakpoint object:line labels also open source.

### Visual Debug

- **Classes / Methods** selects how the call graph is shown. Depth and expansion are retained when switching.
- The separate **Logic** toggle embeds the standard **Tools Logic diagram** in the same panel. It starts from the active editor and follows the selected method, including changes to another ABAP object. Switch Logic off to return to the existing call graph.
- **Detach** continues a stopped program and disconnects, or cancels listening for a run. It is disabled when there is no debugger connection. Breakpoints are kept. **Exit program** is available when the program is stopped.
- The analysis status reports stage, source and parsed statement counts, and elapsed time every three seconds. Parsed counts describe analysis work, not executed steps. The bug button at the top right copies the diagnostic log.

### Tools Logic diagram

**Logic only** is on by default. It keeps branches, loops, procedure calls and control transfers; switch it off to show ordinary operations as well. Operations are shown individually. Nested IF / ELSEIF / ELSE branches retain their joins. RETURN points to the procedure end, and closing-line breakpoints remain part of FLOW.

A condition stays in one diamond, including its AND / OR terms. External calls are marked with ↗ and linked method names; nested call arguments are abbreviated. If the target cannot be resolved, navigation opens the call site.

Cursor and range selections highlight matching nodes. Selecting LOOP or ENDLOOP highlights the loop frame. The focused view drives scrolling; programmatic navigation is suppressed to avoid feedback.

Choose **Top-down** or **Left-right**, use the **10–100% zoom slider**, or press **Fit**. The lens is disabled at 70% and above; below that it magnifies up to an effective 70% scale. Changing the colour theme preserves zoom and scroll position. Controls and highlights use theme colours.

### Eclipse 0.8.1 export preparation

Prepared 0.8.1.qualifier bundle/feature metadata, the shared FLOW dependencies and an Eclipse Visual Flow Analysis command with Calls / Logic and ADT editor selection/source navigation. Eclipse retains its existing ACE backend contract; the VS Code frontend-analysis adapter and runtime Debug are not claimed ported. See [Eclipse export guide](eclipse/README.md).

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

Visual Debug Copy log now includes DEBUG HISTORY SLICE (recorded stops, selected-variable snapshots, watch reads, changes since prior reads, missing/error states) and DEBUG CONTEXT (the current assistant context). Export does not infer or carry forward values; a changed value does not identify an intervening culprit statement by itself.

Visual Debug assistant context now includes actual recorded value history (up to the context limit), with missing/error states. Watch reads always include the chosen variable alongside relevant operands; previously only the route reached chat despite recorded values being available.

Visual Debug replay slider now displays watch values read at the selected recorded stop, including missing/read-error states, rather than ignoring watch history and searching only routine scope snapshots.

## VS Code 0.8.3 — recorded values and AI debug context

Visual Debug brings the ABAP source, execution diagram and recorded variable values into one workspace.

1. Choose **Steps & values** and select a variable for BSE analysis. Relevant stop reads include the selected variable and related operands; routine snapshots provide additional scope values.
2. Use the history slider or replay buttons to revisit recorded stops. **Stack** shows the recorded location; **Variables** shows watch values read at that stop, or the available routine snapshot when there is no watch read.
3. Ask the assistant to analyse the run. Its context includes the execution route and actual variable history, with missing reads and errors identified. The value history is limited to 150 stops in assistant context.
4. Use **Copy log** to export the analysis, **DEBUG HISTORY SLICE** and **DEBUG CONTEXT** for a reproducible discussion.

BSE identifies code relevant to the selected value. Predict can skip irrelevant statements and loop tails. A recording contains values at captured stops, not every intermediate execution state; inferred steps are not measured variable values. Differences between two reads alone do not prove which intervening statement caused an error.

**Initials** is off by default. Enable it to display variables with initial values.
### Value Origin: selected assignment and Copy log

Selecting a variable on the left side of an assignment includes that assignment in its backward slice. Selecting an operand keeps the incoming-value analysis. This retains the selected calculation and its condition and dependencies in BSE. Copy log uses the VS Code host clipboard and displays success or failure instead of relying on webview clipboard permissions.
