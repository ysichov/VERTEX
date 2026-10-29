# ABAP VERTEX Tools

## Install

**[VS Code — the Marketplace](https://marketplace.visualstudio.com/items?itemName=YuriiSychov.vertex-abap)**
· **[Eclipse ADT — the update site](https://ysichov.github.io/VERTEX/)**

For VS Code, the recommended companion is
[ABAP Syntax Highlighting by Lars Hvam](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abap)
(`larshp.vscode-abap`). 

**VERTEX: Get Started** opens the Welcome walkthrough from the Command Palette.



VERTEX is a set of plugins for VS Code and Eclipse ADT. Each window reads over the developer's existing ADT connection and renders as HTML. In Eclipse, opening a VERTEX window reveals its containing layout even when that area was hidden in the saved perspective.

**Serverless, in VS Code** - the ABAP transpiler runs ABAP on your machine:

- a report, a method of a local class or a function module, its parameters asked in a panel and kept as named variants
- only SELECTs go to the SAP system, read through ADT; the logic runs locally
- every step and every value change recorded: step, set breakpoints and conditional variable watchpoints, replay the run to any step
- a value followed back to a clickable formula of how it was calculated, each part opening the line that produced it

**Against SAP:**

- AI assistant over any SAP system, and an MCP server for Claude Code, Codex and Copilot
- enhanced ABAP editor: ABAP Unit, ATC, block-by-block review before activation
- AI-driven ADT debugger: conditions SAP evaluates, a verdict naming the line
- VERTEX Smart Debugger with recording and replay; switching diagram direction automatically fits the new drawing; Main shows or hides its entire top control panel, including Clear, help and diagnostics; after Reload Window it reconnects to its last source and restores the entered Program field without running the program
- forward and backward usage analysis, down to the formula of a value (BSE)
- the path to a line: the conditions inside its METHOD or FORM under which it runs
- version history, diff and transport review
- code explorer: metrics, UML, Logic and Calls diagrams
- data explorer (SelecTor): tables, joins, pivots

VERTEX Smart Debugger gives each recorded SAP session an ID from its first step; the chat can cite and open those steps before or after **Save session**.
Runs started in VERTEX Smart Debugger with the ABAP Transpiler are registered in transpiler history and included in chat context, so the assistant can cite and open their recorded steps.
Ordinary diagram nodes have transparent backgrounds, and their clickable labels follow the editor text color in every theme.


![VERTEX architecture: VS Code and Eclipse ADT connect to shared VERTEX Web UI tools, with an MCP server for AI assistants and an optional SAP backend](docs/architecture2.png)

The ABAP side is this repository's `src/`. It is optional: in VS Code everything works over ADT
alone, and `src/` is needed to save a transport's review to SAP and, where ADT keeps no versions of
data elements, domains and tables, to read theirs; without it, reviews are saved to files and such
parts say they need the backend. The Eclipse plugin does the same. The last column below says what needs it.

In VS Code, the built-in VERTEX Assistant can use Codex, Claude Code, a signed-in
GitHub Copilot model or API keys for Anthropic, OpenAI, Mistral, Gemini, Groq,
Cerebras, OpenRouter and NVIDIA. Provider model lists can be collapsed independently.
Each list has a Clear all / Select all control for its model checkboxes.
If a provider returns no models, LLM Providers displays an explicit empty-state message.
In the VS Code sidebar, model-loading errors appear below the model selector.
Start chat by naming the package or program to inspect; a single match opens in Object Navigator.
For a plain name without an exact match, VERTEX tries prefix and contained-name searches; explicit
wildcards are used as written.
The VS Code chat can explain an active local `.abap` file using its current editor text, even without a SAP connection.
In VS Code the chat is only in the VERTEX panel: **ASK AI** inside a review opens it with the selected blocks on a chip, and you write the question. The question box grows with pasted text; **⤢** expands it.
Local ABAP programs and classes support VERTEX Outline, definition navigation, UML, metrics, Logic and Calls diagrams, and forward/backward usage analysis. VERTEX bundles the abaplint transpiler and runtime. **VERTEX: Run with ABAP Transpiler** on a local file asks the selection screen in a popup - blocks, PARAMETERS, SELECT-OPTIONS and the program's selection texts, laid out as SAP does - and shows what the program wrote (Output); with a breakpoint set the same panel is the debugger, which stops there and steps on. **VERTEX Smart Debugger** opens that panel whole, for analysis with or without a run. Project configuration is generated automatically when absent. After a run, Formula and Expression of a chosen value keep only the path the run took and carry the recorded values in brackets; with no path analysed they are written out from the record. An SAP program, a method of an SAP class or a function module runs with the transpiler too, from **Run with ABAP Transpiler** beside Run in SAP in VERTEX Smart Debugger: its active version, its includes, the customer classes and interfaces the run can reach from where it starts and the dictionary types they use are read from SAP first - a method nothing reaches goes to the transpiler without its body -, and a step goes into an include as in SAP; a function module the code calls brings its function group. SAP program selection screens use the selection texts and text symbols maintained in SAP. See [local execution setup](vscode/README.md#local-abap-execution). SAP execution and version history still require a system.

From a SAP source tab's context menu, **VERTEX: Run SAP in web GUI** opens the program in WebGUI or a class/function module's test screen. It works without a breakpoint.


| Tool | Grew out of | What it does | VS Code | Eclipse | ABAP backend |
|---|---|---|---|---|---|
| **Enhanced Code Editor** | — | Hover with a data element's domain resolved, Go to (F12) with SAP-resolved interface method implementations, Outline, Save & Activate and block-by-block Review & Activate, ABAP Unit into the Test Explorer (Ctrl+Shift+F10), ATC into Problems (Ctrl+Shift+F2), where-used (Shift+F12), SAP's keyword documentation (F1) | ✓ | — | not needed |
| **AI-driven ADT debugger** | [Smart Debugger](https://github.com/ysichov/Smart-Debugger) | Breakpoints with conditions SAP evaluates and watchpoint logs, the run started in WebGUI, the stops, a short dump reported instead of silence, a verdict naming the line and the values; the VERTEX chat has it built in, Claude Code and Codex reach it over MCP as `vertex-debug` | ✓ | — | not needed |
| **VERTEX Smart Debugger** | — | The same session on screen: source, breakpoints, stack, every variable, tables as grids, the flow chart of a recorded run and its player. The first recorded SAP stop includes Globals such as selection-screen values. In VS Code, SAP & Transpiler Logs opens SAP recordings and transpiler runs for replay or deletion; SAP recordings can be renamed. | ✓ | ✓ ³ | not needed |
| **Value Origin** | [ACE](https://github.com/ysichov/ACE) | Forward Usage Analysis - how a value is computed, down from a line across calls: the static call stack, the derivation as *FLOW* or *Formula*, each as a tree or a diagram; Backward Usage Analysis - where the values of a routine go in its callers, by SAP's where-used | ✓ | ✓ | not needed |
| **AI Assistant** | [ABAP-AI-Code](https://github.com/ysichov/ABAP-AI-Code) | Chat over any configured SAP system: reads, explains and changes code — the change lands in the tab, reviewed block by block before activation — runs the tests and ATC on an object, and drives the debugger | ✓ | ✓ ¹ | not needed |
| **Versions / Reviewer** | [AVE](https://github.com/ysichov/AVE) | Version history, the diff between two versions, the review of a whole transport with approve, decline and comments, and the two MCP transport tools | ✓ | ✓ ² | to save reviews in SAP |
| **Code Explorer** | [ACE](https://github.com/ysichov/ACE) | Metrics (McCabe, Halstead, maintainability), UML, the Calls diagram of an object and the Logic view of one method; a method opened from Calls draws its Logic view in the same picture | ✓ | ✓ ² | not needed |
| **Data Explorer (SelecTor)** | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, a join built from the dictionary's foreign keys, a pivot over either | ✓ | ✓ ² | not needed |

¹ In Eclipse the assistant is run by the Codex or Claude Code CLI on your own subscription, and
ADT is the editor: there is no VERTEX tab for it to write into, and the debugger is not part of it.
See [eclipse/README.md](eclipse/README.md).

² The explorer pages are shared between both hosts. The Eclipse update site carries build
**0.9.42.20261029231959**; the VS Code extension is **0.9.42**.

³ In Eclipse, VERTEX Smart Debugger drives ADT's own debug session instead of a second debugger, and Run
opens the object in Eclipse's embedded SAP GUI. It is in the plugin source and a local test build,
not yet on the update site, and has not been checked on a live ADT session.
On a live stop, Eclipse opens and positions the source editor; VERTEX Smart Debugger no longer opens another class tab for each step.

**Grew out of** names where a tool's ideas were worked out first. VERTEX does not depend on those projects: nothing from Simple Data Explorer, ACE, AVE, Smart Debugger or ABAP-AI-Code has to be installed, and none of their code is called. Code Explorer, Value Origin and VERTEX Smart Debugger read ADT source and analyse it with abaplint in the editor; SelecTor builds its statements and reads them through ADT's standard data preview; in VS Code the version history and its diff come from ADT's revision feed, as in Eclipse's Revision History, and the review of a transport is built from them in the window, with AVE's rules for choosing the versions and cutting blocks. Saving it to SAP goes through one resource of VERTEX's own ABAP, `ZCL_VX_ADT_RES_STORE`, into the `ZAVE_REVIEW` table AVE uses too - ADT's data preview can read a table but not write it; reviews can also be kept in files. The AVE repository itself is not needed. The Eclipse plugin reads them the same way.

**Where the two hosts stand apart.** The editor and the AI-driven debugger are VS Code
only by design: Eclipse has ADT's own editor and debugger, and VERTEX does not replace them -
VERTEX Smart Debugger in Eclipse puts ADT's debugger session on screen rather than running its own. Eclipse
also has its own built-in assistant and standalone MCP setup. Shared Tools pages are updated in the
repository, but the published update site can lag behind the source until it is rebuilt.

The two transport-review MCP tools also use standard ADT, without VERTEX's ABAP
classes: they read a saved review from `ZAVE_REVIEW` through data preview, or build
an unsaved review from version history. They cannot save or approve reviews.
For standalone setup, including Eclipse Copilot, see [mcp/README.md](mcp/README.md).

The projects named above are where the ideas were worked out first, and they are not developed
further; everything new happens here.


### SAP Systems Configuration in the VS Code

VERTEX registers the ABAP language itself; opening SAP code does not require
another ABAP extension.
Claude Code works through its VS Code extension or a native CLI in `PATH` or
`~/.local/bin`. When both are found, VERTEX asks which one to use and remembers
the choice in `vertex.ai.claudeSource`; change that setting to switch.
The **LLM Providers** panel shows the active installation and lets you switch
there when both are available.
Restart VS Code after installing the CLI.
LLM Providers reports a missing Claude executable before offering its models.
MCP setup offers Codex or Claude Code and copies both review and debugger
registrations together. Every Welcome step has an **ⓘ Info** button explaining
system import, connection testing, assistant choice or MCP capabilities.
Codex also detects a standalone native CLI, including the native executable in
ChatGPT.app on macOS or a global npm installation found through PATH. When the
extension and CLI are both present, VERTEX asks which to use and saves the
choice in `vertex.ai.codexSource`. Restart VS Code after installing a CLI.
The same source choice appears in **LLM Providers**.
On Windows, Codex detection also checks `%APPDATA%/npm`.

### Connecting

Configure `vertex.systems` in VS Code settings. `authType` defaults to `basic`: use
your SAP user and password. VERTEX asks for the password once per system and keeps it in the
OS credential store through VS Code SecretStorage, never in settings. A refused
password is discarded; the next operation asks again. Basic also works on remote
extension hosts. **VERTEX: Forget Credentials** clears the active system's stored
credentials.

**SAP Systems** (the server icon in the VERTEX panel's title, or the link under `vertex.systems` in Settings) lists every configured system in a table. Per row: the radio button makes it the active system; **SNC** switches it between SNC single sign-on and password authentication; **On** switches it off or on - a system switched off stays in `vertex.systems` (`"disabled": true`) but is left out of every list, switch and test, and a tab opened from it says so; **Log in** asks for the password and keeps it in the OS credential store, then tests - where a password is already kept, the button reads **Save new password** (SAP is not asked to tell); **Test** asks ADT on that system alone and shows the answer in the row, kept there until the window is reloaded, also when the table is closed; **Delete** removes it from `vertex.systems` after a confirmation. **Import from SAP Logon and Eclipse** and **Edit in settings.json** stand above the table.

In **SAP Systems**, the **SNC** checkbox switches a system between SNC single sign-on and password authentication.
Turning SNC off keeps its connection details; turning it back on requires the
system's SNC partner name and RFC application-server host/instance settings. The
checkbox does not delete or re-import the system.

The universal VSIX carries prebuilt RFC bindings for Windows x64 and macOS on
Apple silicon. SNC requires local VS Code, Secure Login Client, and the SAP NW
RFC library installed on your computer. On Windows, VERTEX looks for
`sapnwrfc.dll` in `SAPNWRFC_HOME`, Windows System32, SAP GUI and `PATH`. On macOS,
put the SDK's `lib` directory on `DYLD_LIBRARY_PATH` before starting VS Code.
Your SAP account needs RFC authorization for `SADT_REST_RFC_ENDPOINT`.

Over RFC, hover and navigation send the whole source of the open object to SAP, and `SADT_REST_RFC_ENDPOINT` can dump (`XML_FORMAT_ERROR`) on a large one. `vertex.rfc.maxAnalysedLines` (default `0`, no limit) sets the longest source sent; an object whose source once made SAP dump is not sent again until the window is reloaded. For such a source, hover reports that it was not sent, and double-click and F12 find the name with abaplint inside that source - a name declared in another object is reached only through the static and instance calls VERTEX resolves itself.

VERTEX's direct SNC connection builds on [fr0ster-forks' auth-broker PR #1](https://github.com/ysichov/VERTEX/pull/1): it carries ADT requests over RFC through `sap-rfc-lite` and `SADT_REST_RFC_ENDPOINT`, without using the SAP ADT for VS Code extension. The 0.9.11 VSIX includes Windows and macOS native bindings, searches for an installed `sapnwrfc.dll` on Windows, and imports SNC/RFC settings from SAP Logon. The SAP RFC library itself is not bundled. A separate SDK installation may be unnecessary when a compatible library is already present, but that library is still required at runtime.

```json
"vertex.systems": [
  {
    "name": "<display name>",
    "url": "https://<ADT address>:<ICM port>",
    "client": "<client>",
    "user": "<ABAP user>",
    "authType": "snc",
    "snc": { "partnerName": "p:CN=SID, O=ACME", "qop": "9" },
    "rfc": { "ashost": "<application server>", "sysnr": "00" }
  }
]
```

For SNC, `user` identifies the ABAP user the debugger targets; no password is
prompted for. Secure Login Client supplies the logon. `snc.partnerName` and
`rfc.ashost`/`rfc.sysnr` are required; the RFC address is never derived from `url`.
**VERTEX: Import SAP Systems** fills those SNC and RFC fields from a direct SAP Logon entry; it asks for a client or user only when the chosen Eclipse workspace does not supply them. An SNC logon group without a named application server needs a separate direct entry before import.
Optional SNC settings are `qop` (`"1"`, `"2"`, `"3"`, `"8"`, `"9"`), `library`
(the SNC library path, discovered when omitted), and `myName` (the local SNC
name). `rfc.saprouter` is optional. `url` remains required for identity and WebGUI.

SNC can be refused before connecting:

- "SNC needs the local VS Code on Windows or macOS; this window runs on a remote host (‹remoteName›)."
- "SNC runs on Windows x64 and macOS on Apple silicon only."
- "This VERTEX package has no SNC support" if the RFC binding is missing.

If the SAP library or binding cannot load, VERTEX names the missing component
and includes the load failure.

Running a program under the debugger opens WebGUI. ADT breakpoints do not catch
a SAP GUI (SAP Logon) session. For SNC systems too, browser logon for WebGUI is
SAP's (SSO certificate/SPNego or password), independent of SNC.

Install the extension from the Marketplace, then give it the connection Eclipse would take from the
ABAP project. There is no project here, so the systems are a list and one of them is active.
They live in VS Code's settings: **Ctrl+Shift+P → Preferences: Open User Settings (JSON)**, and
the entries go into that file.

A first install opens **Get started with VERTEX** (VS Code's Get Started page; later Help > Get Started): import the systems, test them, choose the assistant, add the VERTEX MCP server - each step with its button. The quickest way is **VERTEX: Import SAP Systems** (also a button in **SAP Systems** and a link under `vertex.systems` in Settings); it offers only systems not yet configured. It takes each
system's host and instance from SAP Logon or an Eclipse ADT project (so SAP Logon is optional on macOS), and the client and user from the ADT workspace. Recent workspaces from Eclipse installations, including macOS `.app` bundles, are offered when they still contain ADT projects or logon settings; an old remembered workspace is not offered separately. Another folder can be chosen. On macOS, SAP GUI for Java connections are read automatically from `~/Library/Preferences/SAP/SAPGUILandscape.xml` (also `SAPUILandscape.xml` and `SAPUILandscapeGlobal.xml`). Choose **No Eclipse workspace** to import from SAP GUI alone; client and user are then requested. A connection without `systemid` is accepted when its name is an exact three-character SAP system ID, such as `E19`. It then
looks for ADT on the usual ports - 443NN and 80NN for the instance, then 44300, 8000, 50001, 50000, 443, 80, 8443,
8080 - offering only addresses that answer. **VERTEX: Test SAP Systems** then logs on to each configured system and
says what is wrong, if anything; for basic, the password it asks for is kept in the OS credential store, never in settings. **VERTEX: Remove SAP Systems** lets you select entries to delete from `vertex.systems`; it switches to a remaining system if the active one was removed. The original SAP Logon or ADT entries stay available for a later import. The import also checks where the debugger can open WebGUI (`/sap/bc/gui/sap/its/webgui`): on the system's `url` it needs nothing; served on another address that answered - say `url` on HTTP 8000, WebGUI on HTTPS 44300 - or behind a redirect to a host this computer resolves, it writes that as `webgui`; found nowhere, it says so, and `webgui` is set by hand.
By hand, the entries look like this; the HTTP(S) port is in SMICM > Goto > Services.

```json
"vertex.systems": [
  {
    "name": "DEV",
    "url": "https://host.example.com:44300",
    "client": "100",
    "user": "DEVELOPER"
  }
],
"vertex.active": "DEV"
```

The url is the ICM port, not the one SAP GUI connects to. An empty `vertex.active` means the
first. **VERTEX: Switch System** picks another one from a list.

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

Without a variable under the cursor, Forward Usage Analysis offers FLOW with Full scope; Formula, Expression and BSE are disabled until a variable is selected.

Both Value Origin windows expose **Analysis log** directly above the flow. Review ignores indentation and trailing-space changes while preserving changes inside literals. **Expand all** in the saved request summary opens all changed blocks with their code, even for a single class. Opening a developer or reviewer shows their changed blocks together, grouped by class/object, with **Approved**, **Declined**, **Not processed**, **Comments only**, **Expand all / Collapse all** and **AI prompt diff/full** controls. **Ask AI** beside a review block asks about that block only; **Ask AI** above the object asks about all its changed blocks. **Copy log** copies the engine, source loading and parsing times, source closure, definitions, dependency edges, traversal, warnings, and Formula/Expression diagnostics. The log is accessible without enabling the technical sections.

**Experimental client BSE.** In a VERTEX ABAP source tab, select the same variable and run **VERTEX: BSE — only ADT + linter** beside **VERTEX: Forward Usage Analysis**. The new command loads source through standard ADT, parses it locally with bundled `@abaplint/core`, and opens a separate window labelled **ADT + abaplint**. It does not request the SAP ACE origin index. It uses open editor buffers, including unsaved edits; compare saved, activated code to give both engines the same input. Source loading follows the selected value: main files first, external dependencies and local class includes only when needed, with metadata and source cached within each analysis. Full FLOW shows the loaded source closure. Interface-qualified method names are supported. The implementation shares the existing slice algorithm and reports unsupported statements. Alias analysis, dynamic dispatch and source closure are still experimental.


In VS Code both directions are reached through **VERTEX Smart Debugger** - a breakpoint's *Analyze flow path* (forward) and *Where used* (backward) - not from the editor menu or the palette.

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

**VERTEX: Path to This Line** (editor context menu, ABAP sources) opens a panel with what the line under the cursor needs to run inside its METHOD or FORM: the enclosing IF, ELSEIF, CASE/WHEN, LOOP and CATCH branches with the earlier branches that must be false, the CHECKs before it, and the earlier branches that must not be taken because they leave the routine (RETURN, RAISE, LEAVE PROGRAM, EXIT) - with conditions nested inside them shown under the branch. A CHECK, CONTINUE or EXIT that only leaves one pass of a loop counts only for lines inside that loop. Conditions are shown exactly as written in the code, their keywords, strings, numbers, comments, methods and classes coloured as in the Logic view's Code; a click on a line number goes to it. While the panel is open, a click on another line of the same source builds that line's path in it; the Value sources toggle stays as it was set. A line after a statement that always leaves is reported as not reachable. The source is parsed locally, unsaved text included, so no SAP system is needed. The path stays inside the routine: callers, dynamic calls and values changed between a check and the line are not followed. In the Logic view (VERTEX Tools), the **Reachability** toggle does the same on the picture: with it on, a click on a node of a METHOD or FORM lights up the path that reaches it - the same branches, CHECKs and avoided exits - and quiets the rest. With `vertex.pathToLine.methodRelativeLines` on, the panel numbers lines from the routine's METHOD or FORM statement (line 1), as SAP GUI numbers a method; a click still goes to the source line. The **Value sources** toggle colours each variable read in the path's conditions, one colour per variable, and shows where it gets its value: the statement that last writes it before that condition stands in the path right above the condition, its line number in the variable's colour, and a list under the path repeats them, inside the routine, that writes it - an assignment, an IMPORTING or CHANGING parameter of a call or a function module, SELECT INTO, an inline DATA( ). Constants are not marked; a variable the routine does not write is listed as a parameter, an attribute or a global. abaplint finds the reads and writes, unknown types included.

ABAP blocks fold in the editor by their structure, not by indentation, so unformatted code folds as well as formatted: IF, CASE, LOOP, DO, WHILE, SELECT loops, TRY, METHOD, FORM, FUNCTION, MODULE, CLASS and INTERFACE from the opening statement to the line before the closing one, and each ELSEIF, ELSE, WHEN, CATCH and CLEANUP up to the next branch. A condition written over several lines stays visible when its block is folded.

**Run Select.** **VERTEX: Run Select** (editor context menu of a VERTEX ABAP tab): the SELECT at the cursor runs through ADT's data preview, read only, as Eclipse's SQL console runs a query, and the rows open beside the code. What only the running program would supply is left out: INTO and FOR ALL ENTRIES go, UP TO n ROWS is the row limit (otherwise 100; SELECT SINGLE reads one), and a WHERE condition that reads a program value - a variable, a parameter, a select-option - is dropped, an OR holding one dropped whole. What was dropped is listed above the rows. A program value under NOT or outside WHERE, or a dynamic table, list or condition, refuses the SELECT and says why. The statement is parsed with abaplint, saved or not. A SELECT on one table whose WHERE select-options can say opens in SelecTor instead, its conditions filled in as selection lines and each program value as an empty line to fill in; any other SELECT runs in the plain window, which says why it did not open in SelecTor. A SELECT with INNER or LEFT OUTER joins opens in SelecTor's Join, its tables in order, their ON conditions and the SELECT list carried over, when SelecTor's join takes them - it joins only the tables the dictionary offers; the selection starts folded. In a table the selection panel is a list of fields, as SAP GUI's selection screen is, each with a Shown checkbox. From Run Select the result immediately includes the SELECT fields plus fields used by WHERE, JOIN ON and ORDER BY, without duplicates; only existing dictionary fields become result columns, and ABAP structure components used as WHERE values are not columns. Grouped queries retain their pivot shape. The selection panel starts folded. Show hidden reads every field of the table and leaves the ones the SELECT did not ask for unticked, still there to select on.

This is a static dependency
slice, not a solved runtime trace.

**Idea for use: ABAP Unit in CI.** Calculation classes and tests that work with the transpiler can run on a GitHub Actions Node.js runner after each push, without starting SAP. A CI repository installs its own npm dependencies and runs `abap_transpile` followed by `node output/index.mjs`; [open-abap-core](https://github.com/open-abap/open-abap-core/blob/main/package.json) uses this pipeline. Tests needing SAP APIs or database behavior require substitutes or a SAP-backed test job. GitHub Actions billing depends on the repository and account plan.
In VS Code, choose **Analyze Local ABAP Package** on a folder in Explorer to see UML and aggregate metrics for its `.abap` files, including subfolders.
Click a method in UML to open its source in VS Code or Eclipse; this also works for local ABAP files in VS Code.
In VS Code, UML method links open code beside the diagram and keep focus on UML.
Metrics method links use the same side-by-side opening in VS Code, including package tables.
For a class or program, Metrics switches between **Table** and **Visual**. In Visual, each unit's area scales with the selected indicator; the tile shows its name and value. CC and MI colours follow the table's risk grades; other indicators use a relative ranking within the object. Single-click a tile to select it; double-click or press Enter to open its source.
Visual has a 2–300% scale control and a Fit button that fits the whole map into the pane. Fit and the ± buttons animate scale changes; Ctrl+wheel changes scale immediately, as in UML, while ordinary scrolling moves around the map. Zoom changes tile space and reveals more labels without enlarging text.
UML includes methods implemented through interfaces as well as methods declared directly by a class.
An abapGit folder tree may contain subpackages; VERTEX combines them for this view. Source lookup prefers the opened file's folder and reports duplicate names in a selected tree.
The same command is available from the VS Code Command Palette and opens a folder picker.
The main VERTEX Tools type list also has **Local Folder**, which opens the picker and shows UML or Metrics in the same window.
UML and Metrics show the current analysis stage, object count and elapsed time. Switching between them for a local folder reuses parsed source until a file changes.
UML and Metrics show the current analysis stage, object count and elapsed time. Switching between them for a local folder reuses parsed source until a file changes.
Package Metrics has **Expand all / Collapse all** above Objects to open or close every object's unit table.
Package Metrics includes classes, interfaces and programs. **Visual** sizes each object by the selected metric and subdivides it into methods, forms and events. Double-click a unit or press Enter to open its source; click the object header to open its unit table. A program's forms and events, including those in its INCLUDEs, count toward its program. Indicators without fixed risk thresholds use one relative colour scale for all visible units in the package. The Visual Objects filter can hide classes, programs, interfaces or individual objects without rerunning analysis. The map heading shows the sum of the selected indicator for visible objects, such as total LOC.
FLOW and Value Origin diagrams support graphs with more than 500 edges in both hosts.
Eclipse Tools selects the active ADT class or program when opened from its editor.
Each API provider can have several named keys, with one selected manually.
For Mistral and other compatible APIs, the VS Code chat shows the token usage returned by the provider, summed across tool calls.
With `vertex.ai.logPath` set, the VS Code assistant writes an Anthropic-compatible JSONL log for any provider. Each direct API or Copilot model call has its own record; CLI subscriptions are recorded per VERTEX invocation. Choose the folder in LLM Providers or Settings. Raw HTTP request bodies are not stored.
The **📜 AI** button on the VERTEX panel opens a session report for these logs beside the active editor, with date, provider, model and prompt filters and token totals. Sessions and content sections start collapsed. User questions, plain model answers and technical details have three theme-aware accent colours; tools, instructions and request context open separately. Each tool call starts collapsed under its name; expand it to inspect its arguments, matching result and links. Only content enabled in log settings is shown. Program bodies are replaced by links to current ABAP objects. Assistant transpiler and SAP debug calls link to recorded runs; SAP recordings retain observed stops. Recorded UML and metrics open from saved JSON snapshots, preserving the context supplied to the assistant. **Clear selected conversations** removes selected conversation logs while keeping execution recordings. **📜 SAP** opens the separate SAP & Transpiler Logs list, where either type of recording can be opened or deleted.
Eclipse's built-in
Assistant uses Codex or Claude Code; Copilot Chat in Eclipse connects separately
through MCP.

## What each host has

### VS Code 

When the VERTEX chat resolves a single SAP object name, its answer links both the object and its package to their SAP tabs.

- **VERTEX Tools** — pick an object type and a name; the functions offered depend on the type
  (Object Navigator, Data, UML, Metrics, the Calls diagram and the Logic view, Diff, Versions). Object Navigator is the SE80
  tree of a package, transport request, program, class or interface, each entry a link to its source. There is no View source: the source is the
  editor tab, and its parts are VS Code's Outline. VERTEX Smart Debugger is the panel beside the editor.
  Clicking a method in the Calls diagram opens its Logic view inside the same canvas, joined
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
  values that prove it. VERTEX Smart Debugger shows the same session on screen, with a flow chart of the
  calls and a player for the recorded run.
- **Assistant in SelecTor and Versions** — a sentence instead of the clicks: *SFLIGHT for carrier
  AA, joined with SCARR*.

Everything, with its settings and commands: [vscode/README.md](vscode/README.md).

### Eclipse ADT

- **VERTEX Tools** — the same pages as in VS Code, opened from **Window → Show View → VERTEX** or
  the **VERTEX** submenu of an object's context menu (beside GitHub and Team), on that object's own ADT project.
  The editor's VERTEX commands, Path to This Line and Session Logs are in the same submenu.
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
evaluates, or mode `log` for a continuing line trace), `debug_watchpoint` (a SAP variable-change stop), `debug_run`, `debug_wait`, `debug_read`, `debug_step`,
`debug_status`, `debug_log`, `debug_clear_breakpoints` and `debug_stop`. Nothing there changes a
variable or the code. It is the same session the VERTEX chat and VERTEX Smart Debugger drive, so a step
made in one is seen by the others. It runs on the active system, needs a VS Code window with
VERTEX open — the run is started in WebGUI and the listener has to outlive a single call — and
for that reason the standalone server in [mcp/](mcp/README.md) does not have it. Setup and the
tools one by one: [Debug with an assistant](vscode/README.md#debug-with-an-assistant).

## The explorers today

SelecTor offers **Technical names / Text** for Selection field labels and table headers, retaining the choice between loads.

| Word | Comes from | What it does | In VERTEX | Status |
|---|---|---|---|---|
| Data | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, joins, pivot | SelecTor | A table with filters, a join built from the dictionary's own foreign keys, and a pivot over either |
| Version | [AVE](https://github.com/ysichov/AVE) | History, diff, blame, code review of a whole transport | Versions | A transport — by its number, or picked from the open or released requests of a user, yours by default — a package or one object; its parts, their versions, the diff between two of them, and the review of a request — built, saved, approved, declined and commented on block by block. |
| Code | [ACE](https://github.com/ysichov/ACE) | Metrics, call maps, backward slicing, skeletons | Metrics | Three modes: the flow of a program, the branch scheme of one method, and McCabe, Halstead and the maintainability index per unit. A method opened from the Calls diagram draws its branch scheme in the same picture |

Status: **early**. All three answer, and each is a fraction of what it was cut from.

Building a review is here too, not only reading one. In VS Code a request with no saved review is
built from ADT with **Build review** - opening only reads a saved one - every part it changed except code SAP generated (SAP*'s versions, `*_MPC`, `*_MPC_EXT`, `*_DPC`, `SAPL*`, comment-only new objects, empty class sections and generator stamp lines) unless **Ignore SAP generated** is cleared, with the **Blame** toggle each changed line with the developer who wrote it, the pair of versions chosen by AVE's rule,
diffed and cut into blocks by AVE's walk - each part appears as soon as it is read, and a changed line shows what changed
inside it. Before it is built, Review lists the request's objects - type, class, kind, authors, tasks and dates, as AVE's
report does - with newly created objects in green and objects deleted since in red. In VS Code, **Stop** cancels a build before saving; a SAP call already in progress may finish. In the request list, a request number is a link to its review when one is saved in SAP or in files for the current system. **Copy log** copies the build diagnostics. In VS Code, the chat receives the open request review's object list and saved changed lines; it can explain the request without opening every object. Select text in a Tools page or the VS Code sidebar chat and use ⌘C on macOS or Ctrl+C on Windows/Linux to copy it. **Rebuild from ADT** builds it again from
the request as it is now. A built review is saved at once, in `ZAVE_REVIEW` or in files as `vertex.review.storage` says,
and a folded **Build log** tells why a part gave no block; approving,
declining and commenting then change it the way AVE does. A saved review opens at once and is checked against the
request by each part's versions meanwhile; when the request changed since, the page names
what moved. **Developers** and **Reviewers** are listed as in AVE, and each opens the objects they wrote or reviewed;
an interface is listed as the interface, not its section include, and a class's heading opens the whole class's changes. Where ADT keeps no versions of data elements, domains
and tables, VERTEX's ABAP (`src/`) reads them; a system without it says so for those parts. **Rebuild from ADT**, on every saved review, replaces it with one built from the request
as it is now and drops its verdicts. In VS Code a released request is not checked: its versions no longer change. A review kept both in
`ZAVE_REVIEW` and in a file shows both copies with a **Table | File** switch; a change goes back to the copy shown.
The Eclipse plugin has the same check and Rebuild, and also **Path to This Line** and **Session Logs**. AVE's SAP GUI writes the same
`ZAVE_REVIEW`, so a review saved either way is read by both. The Eclipse plugin builds and saves a
review the same way; where it keeps reviews is set in Window → Preferences → VERTEX Code Review.

The diff is a shortest edit script over whole lines with nothing on top. In Eclipse it is Eclipse's
own Text Compare (`RangeDifferencer`); in VS Code it is VERTEX's own line differ, Myers' algorithm,
written from the published algorithm because Eclipse's comparer is under the EPL and VERTEX is MIT.

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

The direct SNC transport uses fr0ster's [@mcp-abap-adt/connection](https://github.com/fr0ster/mcp-abap-connection), [auth broker](https://github.com/fr0ster/mcp-abap-adt-auth-broker) and `sap-rfc-lite`, integrated into VERTEX through [PR #1](https://github.com/ysichov/VERTEX/pull/1). [Enrico Andreoli's adt-rfc-bridge](https://github.com/enricoandreoli/adt-rfc-bridge) independently documents ADT over `SADT_REST_RFC_ENDPOINT` and pointed us to the possibility of finding `sapnwrfc.dll` in an existing SAP GUI installation. VERTEX does not include its Python bridge. We have not established whether either implementation drew from the other.

## Next

What is still missing, and what has to come out before it ships: [Next.md](Next.md).

For feature instructions, see [VS Code documentation](vscode/README.md) and [Eclipse documentation](eclipse/README.md). For changes between releases, see [history.md](history.md).
