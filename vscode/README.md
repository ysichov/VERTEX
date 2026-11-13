# SAP ABAP VERTEX Tools

**Version: 0.9.89**


[**VERTEX**](https://github.com/ysichov/VERTEX) is a new set of plugins for VS Code and Eclipse ADT.

**Standalone AI Code Agent for local Git projects — any programming language (VS Code).**

VERTEX can work as an AI coding agent for an ordinary local Git repository: Python, JavaScript, TypeScript, Java, C#, Go, ABAP or another language. Open the project folder in VS Code, choose a provider and a model that supports tool calls, and give the agent a task in the VERTEX chat. No SAP system or ABAP project is required.

- Search and read project files, explain code, implement changes and work with Git diffs.
- Review the agent's edits in an isolated Git working copy, then approve files and **Apply** them to your folder; declined changes can be returned for rework with your reason.
- Run the project's own build and test commands after Apply; failures can be sent back to the agent for correction.
- Use Claude Code, Codex / ChatGPT subscription, EPAM CodeMie, GitHub Copilot or a supported API provider, with optional session logs.

**Quick start:** open a local Git folder → open the VERTEX panel → choose a provider/model in **LLM Providers** → ask for a change → review the diff → **Apply**.

**Serverless, in VS Code** - the ABAP transpiler runs ABAP on your machine:

- runs a report (its selection screen, then the list), a method of a local class or a function module; for a method or a function module the panel asks the parameters, and their values can be saved as named variants to run again
- only SELECTs go to the SAP system, read through ADT; the logic runs locally
- every step and every value change recorded: step, set breakpoints, replay the run to any step
- a value followed back to a clickable formula of how it was calculated, each part opening the line that produced it

**Against SAP:**

- AI assistant over any SAP system, and an MCP server for Claude Code, Codex and Copilot
- enhanced ABAP editor: ABAP Unit, ATC, block-by-block review before activation
- AI-driven ADT debugger: conditions SAP evaluates, a verdict naming the line
- VERTEX Smart Debugger with recording and replay
- forward and backward usage analysis, down to the formula of a value (BSE)
- the path to a line: the conditions inside its METHOD or FORM under which it runs
- version history, diff and transport review
- code explorer: metrics, UML, Logic and Calls diagrams
- data explorer (SelecTor): tables, joins, pivots

Several of them grew out of earlier SAP GUI tools.

![VERTEX architecture: VS Code and Eclipse ADT connect to shared VERTEX Web UI tools, with an MCP server for AI assistants and an optional SAP backend](https://raw.githubusercontent.com/ysichov/VERTEX/main/docs/architecture2.png)

The ABAP side, this repository's [`src/`](https://github.com/ysichov/VERTEX/tree/main/src), is
optional: everything works over ADT alone. With it, a transport's review can also be saved to SAP,
in the `ZAVE_REVIEW` table AVE uses; without it, reviews are saved to files. The last column says
what needs it.

| Tool | Grew out of | What it does | ABAP backend |
|---|---|---|---|
| **Enhanced Code Editor** | — | Hover with a data element's domain resolved, Go to (F12) with SAP-resolved interface method implementations, Outline, Save & Activate and block-by-block Review & Activate, ABAP Unit into the Test Explorer (Ctrl+Shift+F10), ATC into Problems (Ctrl+Shift+F2), where-used (Shift+F12), SAP's keyword documentation (F1) | not needed |
| **AI-driven ADT debugger** | [Smart Debugger](https://github.com/ysichov/Smart-Debugger) | Breakpoints with conditions SAP evaluates, ADT variable watchpoints with optional value conditions, the run started in WebGUI, the stops, a short dump reported instead of silence, a verdict naming the line and the values; the VERTEX chat has it built in, Claude Code and Codex reach it over MCP as `vertex-debug` | not needed |
| **VERTEX Smart Debugger** | — | The same session on screen: source, breakpoints, stack, every variable, tables as grids, and the flow chart and player for a recorded run. The first recorded SAP stop includes Globals such as selection-screen values. SAP & Transpiler Logs lists SAP recordings and available transpiler runs for replay or deletion; SAP recordings can also be renamed. | not needed |
| **Value Origin** | [ACE](https://github.com/ysichov/ACE) | Forward Usage Analysis - how a value is computed, down from a line across calls: the static call stack, the derivation as *FLOW*, *Formula* or *Expression*, each as a tree or a diagram; Backward Usage Analysis - where the values of a routine go in its callers, by SAP's where-used | not needed |
| **Path to This Line** | — | The conditions inside a METHOD or FORM under which the line at the cursor runs - enclosing branches, earlier branches that must be false or must not be taken because they leave, CHECKs - written as in the code; in the Diagram the Reachability toggle lights up that path | not needed |
| **Block folding** | — | IF, CASE, LOOP, TRY, METHOD, FORM and other ABAP blocks and their branches fold by the code's structure, so unformatted code folds too | not needed |
| **AI Assistant** | [ABAP-AI-Code](https://github.com/ysichov/ABAP-AI-Code) | Chat over any configured SAP system: reads, explains and changes code — the change lands in the tab, reviewed block by block before activation — runs the tests and ATC on an object, and drives the debugger | not needed |
| **Versions / Reviewer** | [AVE](https://github.com/ysichov/AVE) | Version history, the diff between two versions, the review of a whole transport with approve, decline and comments, each block's author and, with Blame, the developer who wrote each changed line, and the two MCP transport tools | to save reviews in SAP |
| **Code Explorer** | [ACE](https://github.com/ysichov/ACE) | Metrics (McCabe, Halstead, maintainability), UML, the Calls diagram of an object and the Logic diagram of one method, report event, FORM or MODULE; a method opened from Calls draws its Logic diagram in the same picture | not needed |
| **Data Explorer (SelecTor)** | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, a join built from the dictionary's foreign keys, a pivot over either | not needed |

**Grew out of** names where a tool's ideas were worked out first; those projects are not developed
further. VERTEX does not depend on them: nothing from Simple Data Explorer, ACE, AVE, Smart
Debugger or ABAP-AI-Code has to be installed, and none of their code is called. Code Explorer,
Value Origin and VERTEX Smart Debugger read ADT source and analyse it with abaplint in the editor; SelecTor
builds its statements and reads them through ADT's standard data preview; the version history and its diff
come from ADT's revision feed, as in Eclipse's Revision History, and the review of a transport is
built from them in the window. Saving a review to SAP needs one resource of VERTEX's own ABAP,
`src/`, because ADT's data preview can read a table but not write it; the AVE repository itself is
not needed.


## Getting started

### Git and external tools (VS Code)

Install Git and make the `git` executable available on the VS Code extension host's `PATH` for Git History, diffs, commits and isolated local Git history/working copies. Isolated storage is still real Git: a folder without `.git` does not remove this dependency.

GitHub access, a remote repository and publishing are not required for local Git operations. For GitHub HTTPS operations, authenticate on the VS Code extension host (including the remote host for SSH, WSL or containers): run `gh auth login --hostname github.com --git-protocol https --web`, complete browser sign-in, then run `gh auth setup-git --hostname github.com`. Retry the operation in VERTEX. Install GitHub CLI first if `gh` is unavailable, or configure a Git credential manager. VERTEX runs Git without interactive credential prompts; GitHub account passwords are not accepted for Git authentication.

Check `git --version` in the environment where VERTEX runs, then fully restart VS Code after installing Git or changing `PATH`. On Windows, make Git available from other programs; on macOS/Linux, install Git through the system tools or package manager. With Remote SSH, WSL or a container, Git must be installed on that extension host, not only on the desktop computer.

Ordinary API chat needs the configured provider credentials and network access; it does not require Git, SAP, Python or a separate Node.js installation. Claude Code, Codex and CodeMie modes require their installed client and authentication. Project builds/tests require that project's own toolchain. VERTEX local commands use Windows PowerShell 5.1 on Windows and `/bin/sh` elsewhere; commands and paths must match that host. The bundled Node runtime does not mean an external `node` command is installed. Taking the chat's SAP tools from ARC-1 or mcp-abap-adt (the panel's MCP list) needs Node.js installed, for `npx`; vibing-steampunk needs its `vsp` executable.


Recommended companion extension:
[ABAP by Lars Hvam](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abap)
(`larshp.vscode-abap`). It is optional; VERTEX registers ABAP independently.

Open Welcome with **VERTEX: Get Started** in the Command Palette.

## Code Agent and Git

**Agent.** The agent works in an isolated Git working copy of your folder. Review its edits file by file, **Apply** the approved ones to your folder or decline them with a reason for rework. After Apply it can run the project's own build and test commands and fix failures.

**Git History** (VERTEX panel, beside **Folder**) lists the folder's commits with date, author and message, filtered by date range, month or author. **Uncommitted changes** at the top opens the working changes against HEAD.

**Git review.** A commit or the uncommitted changes open as a file tree beside the diff of the selected file, in **Compact** (changed blocks) or **Full** view. **Open** on a block, or a line number in the diff, opens the file at that line: the working file for uncommitted changes, the file as the commit has it (read-only) for a commit. **ASK AI** asks about a block, a file or the whole change; **ASK Jev** gives a quick advisory assessment of a block. Files hidden by `vertex.git.hiddenExtensions` (by default `.md`, `.log`) and files marked `linguist-generated` in `.gitattributes` are kept out of the AI context.

**Review prompts.** A prompt bar above the blocks chooses what **ASK AI** and **Copy prompt** ask for: **Technical review** (bug hunt), **Business review** (against requirements pasted one per line), **Documentation**, **Test plan** or **Release notes**. A question typed in the chat refines the chosen prompt. With TypeSafe Jev set up, **Sort blocks with Jev** puts the most significant blocks first and, for a business review, points at the blocks that likely implement each requirement. **Prompts…** edits all prompt texts, including the commit message and pull request generators; user versions are saved in `~/.vertex/prompts/`.

**Commit, Push, PR.** **Commit** opens Summary and Description fields; **Generate with AI** drafts them from the reviewed diff. The branch selector creates or switches branches. **Push** previews what it sends and sends committed changes only, never with force. **PR** (github.com remotes) opens GitHub's comparison page with a generated title and description; you publish it on GitHub.

**Web search** (Vercel AI Gateway): ask explicitly to search the web; only the question is sent, with source links in the answer.

**Usage & Cost** (the **$** icon in the VERTEX title bar) shows tokens and USD cost by date, activity, provider and model. Anthropic API costs in the chat panel and Session Logs are calculated from actual tokens at published list prices, including caching; account discounts are not included. Existing logs are calculated when opened.


## Local ABAP execution

VERTEX runs ABAP on your machine with the bundled abaplint transpiler: open a local `.abap` report, choose **Run with ABAP Transpiler**, fill in the selection screen and read the output. With a breakpoint set the same panel is the debugger, and every step is recorded for replay. Only SELECTs go to the SAP system; an SAP program, class method or function module can run the same way.

Setup, what runs and the debugger: [Local ABAP execution](https://github.com/ysichov/VERTEX/blob/main/vscode/docs/local-execution.md).

## The ABAP backend

The [repository's `src/`](https://github.com/ysichov/VERTEX/tree/main/src) is needed for what ADT
cannot do: saving a transport's review to SAP, and the versions of data elements, domains and tables
on releases where ADT keeps none of them. It carries the `ZAVE_REVIEW` table, which AVE uses too,
`ZCL_VX_ADT_RES_STORE`, which writes a review into it, and `ZCL_VX_ADT_RES_DDIC`, which gives the
text of a dictionary object's version and of a method's own version; pull it with [abapGit](https://abapgit.org) and activate
it. On a system without it, reviews are saved to files (see *Code review of a transport*), and a
data element, domain or table ADT keeps no versions of is listed as needing the backend. With it, a
method in a review or in Versions has its own versions, as SE80 and AVE list them; without it, it is cut from the
versions of its class. The extension updates itself, the ABAP does not: a backend older than 0.9.46 reads no
method versions, so the method is cut from its class's versions, and Versions and the review's Build log say so and
ask for `src/` to be pulled with abapGit.
Everything else - Code Explorer, Value Origin, SelecTor, the version history, its diff and building
a review - reads SAP over ADT and needs no backend.

## First run

1. **Install the extension** from the Marketplace and reload the window.
2. **To save reviews in SAP, install the ABAP backend**: pull the
   [VERTEX repository's `src/`](https://github.com/ysichov/VERTEX/tree/main/src) with
   [abapGit](https://abapgit.org) on the SAP system and activate it. Nothing else waits for this
   step; without it, reviews are saved to files.
3. **Name your system**: **Ctrl+Shift+P → Preferences: Open User Settings (JSON)**, and add
   `vertex.systems` and `vertex.active` as in *Settings* below. The `url` is the ICM port, not the
   one SAP GUI connects to.
4. **Open VERTEX** from its icon in the Activity Bar, or **Ctrl+Shift+P → VERTEX: Open Panel**.
   The top line shows the active system; **VERTEX: Switch System** picks another.
5. **Open an object**: **VERTEX Tools** in the panel, pick a type, type a name - `Z*` lists what
   matches - and pick a function. For basic, VERTEX asks for the password once per system and keeps it in the
   operating system's credential store; SNC logs on through Secure Login Client without a prompt. Or just ask the chat: *open table SFLIGHT*, or type the name alone - a single word such as `SCARR` is looked up in the system first and opened without a model (an exact name is found among programs, classes, interfaces, packages and tables; a table opens on its data); only a word the system does not know goes to the model. When a name resolves to one object, the answer links its name and package to their SAP tabs; opening a source uses the current editor group.

## Settings

In the VERTEX panel's title, the server icon opens the **SAP Systems** table, the sparkle opens **LLM Providers**, and the gear opens every VERTEX setting in the Settings editor.

### Animations

`vertex.animations` sets the turning VERTEX logo and the waiting scenes (chat, VERTEX Smart Debugger, Tools):
`auto` (default) follows Windows and VS Code - when they ask for reduced motion, the animations are not shown;
`on` shows them even then, which a remote desktop or VDI usually needs, since Windows animations are off there;
`off` shows none. A view already open takes the change when it is opened again.

### Connecting

Configure `vertex.systems` in VS Code settings. `authType` defaults to `basic`: use
your SAP user and password. VERTEX asks for the password once and keeps it in the
OS credential store through VS Code SecretStorage, never in settings. A refused
password is discarded; the next operation asks again. Basic also works on remote
extension hosts. **VERTEX: Forget Credentials** clears the active system's stored
credentials.

**SAP Systems** (the server icon in the VERTEX panel's title) lists the configured systems. Per row: make it active, switch SNC or password logon, switch it off, **Log in** (the password is kept in the OS credential store), **Test** and **Delete**. Above the table: **Import from SAP Logon and Eclipse**, **Edit in settings.json** and the connection log.

In **SAP Systems**, the **SNC** checkbox switches a system between SNC single sign-on and password authentication.
Turning SNC off keeps its connection details in settings; turning it back on
requires `snc.partnerName` and an RFC address (`rfc.ashost`/`rfc.sysnr` or `rfc.mshost`/`rfc.sysid`). The checkbox changes only
that system's `authType`, without deleting or re-importing it. Basic authentication
asks for a password on the next request.

The universal VSIX carries prebuilt RFC bindings for Windows x64 and macOS on
Apple silicon. SNC requires local VS Code, Secure Login Client, and the SAP NW
RFC library installed on your computer. On Windows, VERTEX looks for
`sapnwrfc.dll` in `SAPNWRFC_HOME`, Windows System32, SAP GUI and `PATH`. On macOS,
put the SDK's `lib` directory on `DYLD_LIBRARY_PATH` before starting VS Code.
Your SAP account needs RFC authorization for `SADT_REST_RFC_ENDPOINT`.

Over RFC, hover and navigation send the whole source of the open object to SAP, and `SADT_REST_RFC_ENDPOINT` can dump (`XML_FORMAT_ERROR`) on a large one. `vertex.rfc.maxAnalysedLines` (default `0`, no limit) sets the longest source sent; an object whose source once made SAP dump is not sent again until the window is reloaded. For such a source, hover reports that it was not sent, and double-click and F12 find the name with abaplint inside that source - a name declared in another object is reached only through the static and instance calls VERTEX resolves itself.

The direct SNC connection builds on [fr0ster-forks' auth-broker PR #1](https://github.com/ysichov/VERTEX/pull/1): VERTEX sends ADT requests over RFC through `sap-rfc-lite` and `SADT_REST_RFC_ENDPOINT`. This path does not use SAP ADT for VS Code. The universal VSIX includes Windows x64 and macOS Apple silicon bindings, searches for an installed `sapnwrfc.dll` on Windows, and imports SNC/RFC settings from SAP Logon. The SAP RFC library itself stays outside the VSIX. A separate SDK installation may be unnecessary when a compatible library is already present, but that library is still required at runtime.

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

**Several clients of one system.** List them in `clients` next to the default `client`: `"client": "600", "clients": ["600", "610"]`, or add one with **+** in the SAP Systems table. Choose the client in the VERTEX panel beside the system; each client keeps its own password, and a VERTEX window names its client in its tab (`VERTEX A4H 200`).

For SNC, `user` identifies the ABAP user the debugger targets; no password is
prompted for. Secure Login Client supplies the logon. `snc.partnerName` and
an RFC address are required; the RFC address is never derived from `url`. It is an application
server - `rfc.ashost` and `rfc.sysnr` - or, as for a SAP Logon group entry, a message server: `rfc.mshost`,
`rfc.sysid`, `rfc.group` (default `PUBLIC`) and, when its port is not `sapms<SID>`, `rfc.msserv` (e.g. `"3600"`).
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

The Eclipse plugin inherits its connection from the ABAP project. There is no
project to inherit from here, so the systems are a list and one of them is
active. They live in VS Code's own settings file: **Ctrl+Shift+P →
Preferences: Open User Settings (JSON)**, and the entries below go into it.
Workspace settings (`.vscode/settings.json`) work too and override the user's.

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

The `url` is the ICM port, not the one SAP GUI connects to.
`allowInsecureCertificate` accepts a certificate that cannot be verified, which
development systems often have; it is off by default on purpose.

### Systems with SNC single sign-on

A system that logs on with SNC single sign-on - SAP Logon's *Activate Secure Network
Communication* without *SNC logon with user/password* - has no password VERTEX could use over HTTP.
**VERTEX: Import SAP Systems** reads a SAP Logon entry's SNC name, protection level and RFC address into VERTEX's own SNC connection: the application server and instance of a direct entry, the message server, system ID and logon group of a group entry. It finds the ADT HTTP address; the client and user come from the selected Eclipse workspace or are asked.
When an SNC connection fails, its message names the address it used, and the VERTEX output (**Open connection log**
in **SAP Systems**) records each connection. `vertex.rfcTrace` `1`-`3` has the SAP NW RFC SDK write its own trace,
`dev_rfc*.log`, into `vertex.rfcTraceFolder` (by default `vertex-rfc-trace` in the system temporary folder) from the
next connection; **Open RFC trace folder** opens it.

Code reviews are saved where `vertex.review.storage` says: `table` (default) - SAP's
`ZAVE_REVIEW`, shared with AVE; `file` - one JSON file per request; `both` - the table is read
first and every save writes both. A system without VERTEX's ABAP keeps reviews in files whatever
the setting says. `vertex.review.folder` is where the files go, one `<system>/<request>.json`
each; empty means `.vertex/reviews` in the first workspace folder.

```json
"vertex.review.storage": "file",
"vertex.review.folder": "C:/reviews"
```

## Commands

**VERTEX: Open Panel** (or the VERTEX icon in the Activity Bar) opens the chat. **VERTEX Tools** opens the tools window: choose an object type and a name, then a function - Object Navigator, Data (SelecTor), UML, Metrics, Calls and Logic diagrams, Diff, Versions and the review of a transport.

Every command and window: [Commands and the VERTEX Tools window](https://github.com/ysichov/VERTEX/blob/main/vscode/docs/commands.md).

## Clickable ABAP source

The old SAP GUI was great because every meaningful name was something that could be clicked.
VERTEX applies that idea to the editable `vertex-sap` source document rather than replacing the
editor with a read-only code viewer. The aim is that ABAP names become hoverable and clickable as
their context becomes known.

Currently supported:

- Hover a local variable or conventional class attribute to see its `TYPE` or `LIKE` declaration.
  Lookup prefers the current method, then its parameters, and finally the class sections. The
  popup shows the compact declaration result without unrelated call-site text.
- Hover a method to see only its parameter sections, with one parameter per line. This applies to
  multiline and chained `METHODS:` declarations as well as local methods; a supported static
  `CLASS=>method` call is resolved after its target class has been read.
- Press **F12**, double-click, or run **VERTEX: Go to (by context)** on `METHOD` / `METHODS` to
  switch between a method declaration and implementation in the same class document. The same
  action follows an unqualified local call such as `build_layout( )`, and follows a supported
  variable to its declaration.
- A name declared in another object - `abap_bool` from the type pool, an interface constant,
  another class's attribute - shows its declaration in the hover, and double-click or Go to
  opens it there: a class or a program as its VERTEX tab, any other kind read-only.
- Hover a data element such as `versno` to see its domain, type and length.
- Hover, double-click and Go to work inside a read-only view too.
- Interfaces open as editable VERTEX tabs, like programs and classes; creating one is not offered.
- Double-click the class in `NEW zcl_foo( )` to open its constructor.
- The Outline view lists a class's sections and methods, or a program's events, forms, modules and
  local classes; a click goes to the implementation. Ctrl+Shift+O, the breadcrumbs and sticky
  scroll use the same list.
- Double-click `IF` or `CASE` to jump to `ENDIF` / `ENDCASE` and back; Ctrl+click or F12 walks
  through `ELSEIF`, `ELSE` and `WHEN`.
- A static call such as `ZCL_FOO=>bar( )` opens the target class at the implementation of `bar`.
  An instance call such as `mo_splitter->set_row_sash( )` does the same when `mo_splitter` has a
  visible `TYPE REF TO` declaration. `CALL FUNCTION 'Z_FOO'` opens the function module source,
  including systems that expose it through an alternate `FUGR/*` ADT reference.
- **VERTEX: Back** (`Alt+Left`) returns along the locations opened by VERTEX. On a variable
  declaration, repeating Go to also returns to the previous VERTEX location.

Interface method calls navigate to the implementation reported by SAP, including calls on references inferred from factory results. The target can be an interface-qualified `METHOD interface~method`. If SAP supplies no implementation, VERTEX does not substitute the interface declaration.

Navigation is provided only for source read through VERTEX and therefore does not depend on an
ADT project being open. If SAP ABAP Development Tools is available, its own editor navigation and
context-menu commands remain available too.

### Source view versus editable source

Every object does not have the same action set. The object type determines the available VERTEX
functions: transports focus on Versions and review; classes and programs can offer source,
metrics, flow/scheme and diff; packages offer their package-level views. This keeps unavailable
or meaningless actions out of the toolbar.

**There is no View source function.** The source is the editor: choosing an object to read opens its
VERTEX tab (ask the chat to open it, as below), and the structure of that tab - a class's
sections and methods, a program's forms, events and local classes - is VS Code's **Outline**, Ctrl+Shift+O and
the breadcrumbs, with a click to go to the line. In Tools an object starts on its first function: UML for a
class, Metrics for a program. The Parts list at the left of Tools stays for the functions that follow one
part: the Logic and Calls diagrams. Metrics and UML draw the whole object and have none.

The chat context follows the active function. UML sends the diagram's object, nodes, method names and relationships instead — not
a method signature — so it can be analysed directly. Ask the chat explicitly to *open* or *edit*
an object — for example, *Open ZCL_FOO please* — to open a normal, editable VS Code tab instead.
Changes made there are still sent to SAP only through **VERTEX: Review & Activate** or **VERTEX: Save & Activate**.

## Value Origin

In VS Code the analysis is reached through **VERTEX Smart Debugger**: a breakpoint's *Analyze flow path* is
Forward Usage Analysis from that point - to the next checked point the flow meets, else to the end - for the value
chosen in Variables, and its *Where used* is Backward Usage
Analysis. Neither has an editor menu or palette entry of its own. What follows describes the analysis itself.

Without a value chosen in Variables, Analyze flow path offers FLOW with Full scope; Formula, Expression and BSE are disabled until a value is chosen.

Both Value Origin windows expose **Analysis log** directly above the flow. **Copy log** copies the engine, source loading and parsing times, source closure, definitions, dependency edges, traversal, warnings, and Formula/Expression diagnostics. The log is accessible without enabling the technical sections.

Choose a value in Variables of **VERTEX Smart Debugger** and click *Analyze flow path* on a breakpoint
(Forward Usage Analysis, formerly *Analyze Variable Value Origin*). It answers how that value is computed, down from the breakpoint across calls, without running
the program: the sources are read through standard ADT and parsed with the bundled abaplint, customer code (`Z*`, `Y*`, `/namespace/`)
is followed, and standard ABAP objects stay analysis boundaries.
With no value chosen it draws the flow forward from the breakpoint - the routine from there on and every customer routine it calls - without a slice of a value.

The result has a **Type**. *FLOW* is what the program does - its statements grouped by class and
method, nested by blocks and their branches, with a node on each call edge naming what that call
passes (`lv_scenario -> IV_SCENARIO`); it narrows from *Full* to *BSE*, which is what the
analysis found and the path that led to it. *Formula* is how the value was computed: `a = b + c`
at the top, and the definitions of `b` and `c` as its branches. *Tree* and *Diagram* are two
views of whichever Type is chosen; **Depth**, a number field that stops at the deepest level the flow has, decides how far the tree opens - along the call
stack in FLOW, along the derivation in Formula - and one button beside it, which offers *Collapse all* and then *Expand all*, says whether the levels shown are open, whatever
the depth. Breakpoints in the editor stop the flow where a run would stop: VERTEX names the breakpoint reached and asks whether to stop the analysis there, continue to the next breakpoint or ignore the breakpoints.

*Where used* (Backward Usage Analysis) goes the other way: from the routine up into its callers, found by SAP's where-used, following the value - the variable under the cursor, or else the routine's parameters and attributes - through each caller and further up. Standard SAP code is not followed. Breakpoints stop the walk one level of callers at a time. The tab must be saved.

**Run Select.** **VERTEX: Run Select** (editor context menu) runs the SELECT at the cursor read only through ADT's data preview and shows the rows beside the code. Values only the running program supplies are dropped from the WHERE, and the dropped parts are listed. A SELECT on one table, view or CDS entity opens in SelecTor with its conditions as selection lines; a SELECT with joins opens in SelecTor's Join when the dictionary supports it.

**Expression** is a third Type beside FLOW and Formula: the derivation written out as one formula,
by substitution alone. Each definition stands where its value is read; a step that adds or takes
off a share of the value before it (`a = a + a * p`) is written as that value times one plus (minus)
the share, so the formula grows by a factor per step, not by a copy of everything before it. A value
that every statement of a step reads stays a named step. Type conversions (`CONV decfloat34( ... )`)
are left out of Formula and Expression alike. Under the formula, each value that comes from a table
is a link to the statement that reads it, written by its own name (`WEIGHT_KG`; the class shows on
the pointer, and only two values of one name carry the class), with the `SELECT` cut to the field
that concerns it, the table and the conditions. When the order of the steps is data, as in a loop
over a configured pipeline, **Load selected configuration** reads `ZLOG_PIPELINE` for the chosen
scenario: the steps then stand in the order the pipeline runs them, and a step the pipeline lacks is
named above the tree as not run. Without it the definitions stay side by side - their order is not
in the code.

The debugger's *Analyze flow path* draws Flow, Formula and Expression with the same code: only
where the rows come from differs. The assistant is given what is on screen - the flow, the formula
or the expression, within the depth set - labelled as analysis, not a run.

What it does not claim: a concrete database-dependent iteration order, a runtime value, or which
branch a dispatch takes. Those stay explicit boundaries, and the analysis log below the tree
says what was read and where it stopped.

## VERTEX chat

In VS Code chat, each newly attached screenshot is recognized independently by the selected Vision-capable model, without conversation history, workspace context or tools. Jev identifies screenshot topics by the recognized scene and retains visual evidence and the latest answer when assessing follow-ups. Jev and the answering model receive its factual description; conversation context retains only a file reference and description. You can send a screenshot without text: the assistant identifies the visible problem or asks a specific clarifying question. Recognition is a separate model request with its own usage accounting. **New conversation** clears the chat context.

Remote API model catalogs are saved locally after the first load and reused when switching providers or restarting VS Code. Rebuild a catalog explicitly in LLM Providers to discover changes. Model selections apply immediately to the saved catalog. Each API credential has its own catalog; local servers keep a live list of loaded models.

The **VERTEX** panel in the Activity Bar has a free-prompt chat. The panel's title holds
three icons: **SAP Systems**, **LLM Providers**, and the gear for every VERTEX
setting. The top line holds the **SAP system** list. The question
box, the provider and model lists and **New conversation** stay at the bottom of the panel; the
answers scroll above them, questions and answers in different colours. Asking for a VERTEX
function — *open table SFLIGHT*, *show the diff of ZCL_FOO* — opens a **VERTEX Tools** window on
it. To begin with a package or program, name it in the first request, for example *open package
Z_BILLING* or *open program Z_INVOICE*. A single match opens in Object Navigator; if a plain
name has no exact match, VERTEX tries a prefix and then a contained-name search. An explicit
wildcard is used as written.

With an ABAP source active - a local `.abap` file, or a source another extension opened (SAP's ADT
extension, ABAP remote filesystem) - the chat receives its current editor text, including unsaved
edits (up to 24,000 characters). It can explain that source without a configured SAP system;
with no SAP system in VERTEX, UML, Metrics, Logic and Calls in the editor's **VERTEX Tools** menu analyse
another extension's source from its text, as they do a local file;
SAP search, changes, tests and debugger actions require a system.
Set `vertex.ai.logPath` to keep a JSONL log of each conversation; `vertex.ai.log.questions`, `.answers`, `.tools` and `.request` choose what is kept. Program source from SAP is never logged. **Session Logs** (the scroll icon in the panel's title) shows sessions, prompts, steps and token usage by day, with filters. Each conversation is logged with the place it was held in — the local folder, or the SAP system and client. Session Logs shows every conversation and offers those places above the table, each with its number of conversations: pick one to read a single project or system, or **All folders and systems** to return to the full list. Each conversation also shows its place under its question, so a mixed list stays readable. The choice appears only when the log folder holds more than one place; conversations recorded before VERTEX kept this are listed under **Without context** and show no place. A request that failed is shown in the error colour, so a failed step is visible without opening the conversation. **Context ≈tok** shows the prepared request size before sending, estimated as characters / 4; hover for the exact character count. It includes instructions, history, prompt, tools and answer schema, but excludes provider-added wrappers, binary image data and later tool steps. Older logs without this measurement show a dash. **New in** and **Cache read** are cumulative token usage across model calls, not context sizes. **Duration** shows the time from each question to its last recorded assistant response in minutes and seconds, excluding pauses before later questions. **Continue** reopens a conversation in the chat, and selected conversations can be deleted. **Continue** also restores unanswered questions and saved screenshots after a failed or quota-limited request; missing screenshot files are reported. The chat shows the current topic by default; **Show conversation** switches to another topic or **All topics**, without changing what Jev sends to the model. SAP object names in answers are clickable: known destinations open directly, while other identifiers are resolved by exact SAP search; multiple object types offer a choice. Bare object-name navigation uses no LLM and retains the current topic. The left chat panel also has **Conversations · Continue a chat** below the project selector: expand it, search saved conversations, and select one to restore it. It offers only the conversations held where the chat is working now — the selected folder, or the active SAP system — so continuing a chat never reaches into another project or system; Session Logs is where every conversation is listed. Conversations recorded before VERTEX kept the place are not offered here; continuing one from Session Logs gives the whole conversation the place it is continued in. **Refresh** reloads the list from the configured log folder. Conversation details are rendered when expanded; closed entries keep the report compact. The Conversation column prioritizes prompt text; Model is compact, with the full provider and model available on hover. Drag a column’s right header edge: a guide follows the pointer and the width is applied on release; neighbouring columns retain their widths. Open a conversation to show its **Continue** and **Tag topics (Jev)** actions in one shared panel above the table. Long conversations show 30 questions per page; **Previous / Next** changes the page, and sorting applies to the whole conversation. Scroll horizontally to see columns outside a narrow panel. Expand a question to see its section names. Its full record is fetched only when you open an inner section such as **Model answer**, **Steps** or **Request and context**; closed steps are not rendered. In SAP mode, entering an object name alone searches SAP and opens a unique match without a model request; screenshots from earlier messages do not change this. A screenshot attached to the current message keeps it as a question for the model. In VS Code, SAP debug steps recorded by VERTEX Smart Debugger are saved automatically as they arrive, with recorded values and source snapshots. They appear in **SAP & Transpiler Logs** without requiring **Save session**; closing the debugger does not discard saved steps.

**Context protection.** VERTEX masks credential fields such as `I_APIKEY`, `PASSWORD`, `ACCESS_TOKEN`, `LV_TOKEN`, `LV_AUTH`, `ACCESS_KEY`, `JWT` and `AUTHORIZATION`, plus explicit Bearer/Basic credentials, JSON Web Tokens and private-key blocks, before AI context and tool responses are sent and before conversation logs or SAP recordings are written. A marker retains type, value length, empty status and an opaque identity so equal values can still be compared. Known copies of a detected value in the same context are masked too; arbitrary random strings are not classified as secrets. Code that builds a credential - a header written as an expression such as `Authorization:'Bearer '+key`, a scheme word alone, an empty value - stays readable, so a review sees it.

Additional field names and case-insensitive `*` patterns can be configured per project in VS Code settings:

```json
"vertex.ai.context.secretFields": ["Z_PRIVATE_*", "I_MY_CREDENTIAL"]
```

Live debugger values and SAP source are unchanged. Existing SAP recordings are protected when loaded, but existing files are not rewritten automatically. The filter does not inspect screenshots or other binary content, and cannot intercept an external agent's own filesystem tools.

The left chat panel has **Main / AI Review** modes. **Main / AI Review** appears only after a review is requested. **Close review** closes it and returns to Main; switching to **Main** keeps the review available. **ASK AI** in Assistant changes switches to AI Review with the selected block, file or all changes attached. Both modes retain their own conversation, draft and scroll position; provider and model settings are shared. Review uses its own log identity and excludes the main chat history. Enter optional requirements under **Requirements for this review**; non-empty requirements are included automatically. Requirements, review type and Send stay together below the scrolling conversation. The same review prompts as Git review are available. ASK AI attaches the selected changes without sending a request. The selected prompt appears in the chat input: edit or replace it, then press Send. Choosing another review type loads its prompt. Review settings collapse when the request starts, leaving more room for the answer and a compact follow-up field below it. Expand **Review settings** to change the type or requirements; entered settings are preserved. **Check again** refreshes the snapshot and starts a new review. Reviewing does not apply or edit files. The file tree starts at the selected project root; ASK Jev results appear above the diff. **Discuss in Main** under a review answer attaches that result and its reviewed snapshot to the next Main question. Expand **Attached review result** to inspect it, or remove it with the attachment’s × button. Your Main draft is preserved; nothing is sent until you submit the question.

Local ABAP programs and classes also have VERTEX navigation in the editor: Outline,
Go to Definition for local method and class calls, and Back. The **VERTEX Tools** context
menu opens UML for classes, metrics, Logic and Calls diagrams from local source using the
bundled ABAP parser. **Forward Usage Analysis** and **Backward Usage Analysis** run on local
workspace files and include unsaved editor text. Backward usage locates callers by textual
call matching within the workspace, so check ambiguous calls. Diagram links return to local
source lines. Diff/version history, SAP where-used, tests, ATC, debugger and activation
require a configured SAP system.

**VERTEX: Path to This Line** (editor context menu) shows the conditions under which the line at the cursor runs inside its METHOD or FORM: enclosing branches, earlier branches that must be false or must not leave, and CHECKs, written as in the code. **Value sources** shows where each variable in those conditions gets its value. In the Diagram, the **Reachability** toggle lights up the same path. No SAP system is needed.

ABAP blocks fold in the editor by their structure, not by indentation, so unformatted code folds as well as formatted: IF, CASE, LOOP, DO, WHILE, SELECT loops, TRY, METHOD, FORM, FUNCTION, MODULE, CLASS and INTERFACE from the opening statement to the line before the closing one, and each ELSEIF, ELSE, WHEN, CATCH and CLEANUP up to the next branch. A condition written over several lines stays visible when its block is folded.

For a folder of local ABAP files, choose **VERTEX Tools: Analyze Local ABAP Package**
from its Explorer context menu. UML includes its classes and interfaces; Metrics summarizes
all recognized `.abap` objects in that folder and subfolders. Source links open files from
the selected tree. If the same object name appears in more than one subfolder, select the
specific package folder. For navigation from a single file, its own folder is searched first.
If the folder is shown in a custom Explorer view, run **VERTEX Tools: Analyze Local ABAP Package**
from the Command Palette and select the folder in the dialog.
In the main **VERTEX Tools** window, choose **Local Folder** from the object type list
to pick a folder directly. The selected folder stays visible beside a **Browse...** button;
switch between UML diagram and Metrics in the function list.
Both views show analysis progress, the object count and elapsed time. Switching views reuses parsed local source until a file changes.
In package Metrics, **Expand all / Collapse all** above Objects opens or closes every object's unit table.
Package Metrics includes classes, interfaces and programs. **Visual** sizes each object by the selected metric and subdivides it into methods, forms and events. Double-click a unit or press Enter to open its source; click the object header to open its unit table. A program's forms and events, including those in its INCLUDEs, count toward its program. Indicators without fixed risk thresholds use one relative colour scale for all visible units in the package. The Visual Objects filter can hide classes, programs, interfaces or individual objects without rerunning analysis. The map heading shows the sum of the selected indicator for visible objects, such as total LOC.
Click a method in UML to open its source, whether the object is in SAP or a local ABAP folder.
The source opens beside UML while focus stays on the diagram.
Metrics method links also open source beside the table and keep focus on Metrics.
UML shows interface method implementations in their implementing classes.
The FLOW and Value Origin diagrams can render large graphs with more than 500 edges.

The chat also runs the two checks the editor has: *run the tests for ZCL_FOO* runs ABAP Unit on
the object and answers with how many test methods passed, how many failed and why, and *run ATC
on ZCL_FOO* answers with the variant and the findings by priority. Both need no open tab, both
show the same run in the Test Explorer and the Problems view, and both are refused while that
object's tab holds unsaved edits — the run needs the active SAP source. Where-used and the
keyword documentation stay editor commands, Shift+F12 and F1 in a source tab: SAP answers them
for a position in the source, not for a name, so the chat says which key does it instead.

### Providers

| Provider | What is paid for | What has to be installed |
|---|---|---|
| **Claude subscription (Claude Code)** | Your Claude subscription | The Claude Code extension, signed in |
| **ChatGPT subscription (Codex)** | Your ChatGPT subscription | The Codex (OpenAI) extension, signed in |
| **GitHub Copilot (VS Code)** | Your Copilot access | The Copilot extension, signed in |
| **EPAM CodeMie (CodeMie CLI)** | Your CodeMie project | Claude Code and the CodeMie CLI (`npm install -g @codemieai/code`), with a profile made by `codemie setup` |
| **Anthropic API (key)** | Tokens, billed to the API key | Nothing — only the key |
| **OpenAI, Mistral, Gemini, Groq, Cerebras, OpenRouter, NVIDIA, Vercel AI Gateway APIs** | Usage billed by the selected provider | That provider's API key |
| **LM Studio (local server)** | Free; runs on your computer | [LM Studio](https://lmstudio.ai) with a downloaded model and **Developer → Start Server** on (`http://localhost:1234/v1`) |
| **Ollama (local server)** | Free; runs on your computer | [Ollama](https://ollama.com) running with a pulled model, e.g. `ollama pull qwen2.5-coder` (`http://localhost:11434/v1`) |

A provider offers in chat only the models ticked in **LLM Providers**. A model the provider adds to its catalog later appears in the table marked **new** and stays off until you tick it; the VERTEX panel says how many new models are waiting and links to LLM Providers. A ticked model the catalog no longer lists stays in the table marked **not in catalog** and is not offered; if it is the chosen model, the panel says so and asks for another one. The catalog is read again each time the VERTEX panel opens.

LM Studio and Ollama start switched off in **VERTEX: LLM Providers**; switch one on there to offer it in the provider picker. When LM Studio or Ollama is picked, VERTEX says at once whether it is installed, whether its server answers and how many models it has; when it is not installed, **Download** opens its site. A local server on another address or port is set in `vertex.ai.lmstudioUrl` or `vertex.ai.ollamaUrl`.
VERTEX does not load local models: start one in LM Studio (`lms load <model>`) or Ollama (`ollama run <model>`). The panel offers only running models; choose one that supports tool calls for SAP and folder work.

A subscription is used through its installed client. VERTEX runs the Claude Code
or Codex CLI from its VS Code extension or a native installation. Copilot models
come from VS Code's Language Model API. For EPAM CodeMie, VERTEX runs
`codemie-claude` - found on PATH, in npm's global folder or in nvm's - which signs
in with the CodeMie profile; the model list is the profile's (`codemie models
list`), and **CodeMie default** is the model chosen in `codemie setup`. **Profile**
in LLM Providers picks one of the CodeMie profiles (`codemie setup` makes one per
project or account), shown when there are two or more; **Active in CodeMie** follows `codemie profile switch`, and so does a chosen profile CodeMie no longer has. The
choice is kept in `vertex.ai.codemieProfile`. While EPAM CodeMie is the chosen
provider, the provider list and the VERTEX Tools button in the VERTEX panel show
CodeMie's indigo-to-magenta gradient in light and dark themes, as does EPAM CodeMie's row in LLM Providers;
a high-contrast theme keeps its own colours.
With `vertex.ai.showCodemieCost` on (off by default), the token line under each
CodeMie answer ends with its cost (`≈ $0.0022`). It is Claude Code's estimate
from the model's list price, not what CodeMie charges; the budget and spending
are on the CodeMie site, under Profile → Your personal spending. VERTEX never reads the clients' login
tokens. Each API provider can keep several named keys in VS Code SecretStorage.
Choose the active name manually in **LLM Providers**; VERTEX uses that key for
model loading and requests. Existing single keys appear as `DEFAULT`. API
requests go directly to the selected provider.

The panel shows the provider's short name. Changing the provider there
switches at once and clears the chosen model (`vertex.ai.provider`, `vertex.ai.model`).

#### TypeSafe Jev API

TypeSafe Jev is a decision model, not a chat. Add a TypeSafe API key in LLM Providers, then pick TypeSafe Jev and a Jev model in the panel: it turns into a form with a context, questions (Yes / No, Choose an option, Rate on a scale) and **Run Jev**. Answers come with confidence and probabilities. Only the entered context and questions are sent. Jev is also used by **ASK Jev** in reviews and **Sort blocks with Jev** in Git review.

#### OpenCode Console

OpenCode Console takes a named OpenCode API key in LLM Providers; its catalog can be filtered by provider, availability and free models.

### Which models are offered

Open **VERTEX: LLM Providers** from the VERTEX panel's sparkle icon. **Check models** sends one short paid request to each model of a provider and switches off the ones that fail, with the reason; **Stop** keeps the results so far, and **Hide unavailable** hides failed models. **Save** applies the choices to the chat.
Vercel AI Gateway and OpenRouter list their models by provider, with capability icons (tools, JSON, reasoning, image input, web search, context size) and input/output prices per million tokens; click a column heading to sort. In the chat, **ⓘ** beside a model shows its details.

**LLM Providers** shows every provider with its own checkbox, **In use** switch,
and a fold button for its model list. Each provider can be expanded or collapsed
independently. **Clear all / Select all** switches that provider's model checks
in one click; after clearing, tick the models you want before saving. Only the
ticked models appear in the model lists; with no model
chosen, the first enabled model is used. A provider switched off
keeps its model ticks but is left out of every provider choice; the one in use cannot be switched
off - choose another first. With no provider switched on, the chat panel shows no provider, model or
effort choice; the same holds when the provider in use has no models - its error stays in the panel, and **VERTEX: LLM Providers** switches to another. While no provider with models is available, review pages hide their **ASK AI** buttons and keep the prompt buttons. Save refuses a provider with no model ticked, and resets a chosen
model that is no longer offered. The choice is kept in `vertex.ai.modelConfig`.
If a provider has no model entries, the panel explains that instead of showing a blank table.
Model-loading errors in the sidebar appear below the model selector.

- **Claude subscription** lists Claude versions by full id (`claude-opus-5`, `claude-sonnet-4-6`,
  ...). Claude Code reports no list of its own, so this list is VERTEX's, in `assistant.js`
  (`CLAUDE_VERSIONS`), and is updated when a new model comes out. The newest of each family is
  ticked by default. **Check and add** takes any other id and keeps it only after Claude Code has
  answered one short request with it.
- **ChatGPT subscription** lists the catalog Codex reports. A model named in
  `~/.codex/config.toml` is offered too, because VERTEX runs Codex without that file.
- **API providers** list models returned by their `/models` endpoint. Add or
  replace named keys in that provider's section, then select the active key.
  VERTEX does not rotate keys automatically. Models without chat and tool
  calling support may appear in a provider's catalog; leave those unticked.

### Several systems

The chat can publish an OData V2 or V4 service binding (`publish_sap_service_binding`), as the Publish button of
ADT's binding editor does; VS Code asks you to confirm first, and the answer is SAP's own message. SAP refuses it in a
customizing client. The tool works on the system and client active in VERTEX, also when the chat's SAP tools come from
an MCP server, since none of them publishes.

The chat can also read table contents itself: its `run_sap_select` tool runs one SELECT through the same ADT data preview as Run Select, read only, and returns the rows (100 by default, at most 1,000) - for customizing, texts and repository tables.

The panel's chat can reach every system in `vertex.systems`. Name one in the question — *copy
ZCL_FOO from E19 to QAS* — and the SAP tools run against it; without a name they use the system
chosen in the panel. A copy is a read in one system and a change in the other: it goes into the
target system's tab, unsaved, and nothing is written until you save it there. A new object has
no tab yet: it opens as a draft in the **Code Change** reviewer, with the target system in its
title.

A **VERTEX Tools** window keeps the system that was active when it opened, and its tab is named
after it — *VERTEX E19*. Everything started from the window works against that system; choosing
another system in the panel affects only windows opened later. The window has no chat of its own:
the chat is the one in the VERTEX panel. **ASK AI** inside a review — on a block, an object or a
developer's or reviewer's blocks — opens that panel with the selection on the chip above the input;
you write the question and send it yourself.

**Enter** sends a question and **Ctrl+Enter** inserts a new line. The question box grows with
what you type or paste and then scrolls; **⤢** in its corner expands it to most of the panel, and
**⤡** shrinks it back.

Ask in any language, for example *show ZCL_TR_TEXT_DATA*, *explain this method*
or *add a check for an empty table here*. The chat searches and reads SAP
source itself and opens the object in an editable tab on the right. Follow-up
requests about "this code" use the active SAP editor tab as context. The chat
never writes to SAP on its own: a change it makes goes into the object's tab, unsaved, and you
save it with **VERTEX: Save & Activate** or **VERTEX: Review & Activate** - or undo it with Ctrl+Z. If the tab
already holds edits that SAP does not have, the chat's change is refused rather than written over
them: save or undo yours first.

## Code reviewer

**ASK Jev** beside ASK AI (when TypeSafe Jev is set up) gives a quick advisory assessment of a block: change type, review priority, whether the context is enough, and a recommendation. It never approves, declines or applies anything.

Edit SAP source in a VERTEX editor tab, then choose **VERTEX: Review & Activate** in the
editor title or context menu (or ask the chat to save your edits). The
**Code Change** panel shows the edits against the current SAP source, cut into
blocks with context lines:

- **Approve** / **Decline** each block, or approve all;
- **ASK AI** on a block puts it on a chip above the chat's input - *Review · object · block 2*; ASK AI
  on another block of the same review adds it, and **ASK AI** beside Approve All takes every block.
  Type your question and press Enter: the chat shows the question, and the blocks - each with its
  method, line and surrounding lines - go to the model with it. Enter with nothing typed asks what the
  change does and whether it has a real problem. Answers about the blocks have no headings and name at most
  three real problems; ask for detail to get more. The chip's × asks without the blocks;
- **VERTEX: Save & Activate** writes only the approved blocks. SAP locks the object,
  checks syntax, saves, activates and verifies the active source. If the active
  or inactive source changed since it was read, nothing is overwritten.

Ctrl+S saves the local copy only, never SAP.

## Development status

### Review instructions and conversations

In Versions' Assistant, choose a review profile above the conversation. Expand
**Review instructions** to edit it. **Save profile** updates the profile with that
name; enter a new name to create another. The current text is sent with each
request, including unsaved edits. Built-in profiles cover general review,
SQL/performance, security and tests.

Follow-up requests include previous messages and their object/version context.
Profiles and the conversation are kept in the webview's local storage when
available. **New conversation**, or sending `new conversation`, clears the
conversation while keeping profiles. This clears messages, not the current view.
Tool outputs are not archived in the conversation; the assistant can reread sources.

The tested integrations are GitHub Copilot in VS Code, Claude Code, and Codex in VS Code.
Claude web, ChatGPT web, Claude Desktop, and other MCP clients are not supported or tested yet.
The remote HTTP host is experimental and documented for future development only.

## Where MCP comes in

| Who | Uses MCP | Setup |
|---|---|---|
| The SelecTor, Versions and Metrics windows, used by hand | No: they read SAP directly over ADT | — |
| The **Assistant** panels in SelecTor and Versions | Yes, internally | None: for each request the extension hands Claude Code or Codex the window's own MCP address, `/selector` or `/versions` |
| Supported assistants | Yes | GitHub Copilot in VS Code, Claude Code, and Codex in VS Code |
| The debugger | Yes: `/chat` for the VERTEX chat, `/debug` for Claude Code and Codex | None for the chat; one command for the others — [Debug with an assistant](#debug-with-an-assistant) |
| Other chats and MCP clients | Not supported/tested yet | Claude web, ChatGPT web, Claude Desktop, and other clients are development work |

MCP is how Claude Code and Codex are given tools in both cases. The difference is
who connects them: the extension, for one request, or you, once.

## Choose the chat's SAP tools

The **MCP** list in the VERTEX panel, beside the SAP system and client, picks
where the VERTEX chat's SAP tools come from:

- **VERTEX** (default) - VERTEX's own tools.
- **ARC-1** - the [ARC-1](https://github.com/arc-mcp/arc-1) SAP ADT MCP server.
- **mcp-abap-adt** - fr0ster's [mcp-abap-adt](https://github.com/fr0ster/mcp-abap-adt) server.
- **vibing-steampunk** - oisee's [vibing-steampunk](https://github.com/oisee/vibing-steampunk) (`vsp`),
  started in its hyperfocused mode: one `SAP` tool instead of many.
- **SAP ADT** - the ADT MCP Server of SAP's own
  [ABAP Development Tools for VS Code](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode).

The **⚙** beside the list opens the settings of the picked server: its write access (ARC-1, mcp-abap-adt,
vibing-steampunk and its path), SAP's `adt.mcpServer` settings for SAP ADT, or the chat's settings for VERTEX.

With an MCP server picked, its tools replace VERTEX's SAP read and write
tools in the chat; the debugger and ABAP transpiler tools stay VERTEX's.

Picking a server opens a window that first asks what the server may change in
SAP; every choice is read-only by default, so pressing **Start** without a change
keeps it read-only. The server then starts in the same window with an install
scene. The choices are kept in the settings below and can be changed there later.
A server left picked starts again in the background when VS Code starts; if it
fails, an error message says why.
A started server keeps running until VS Code closes: switching to another server
and back, or enabling its toolset from the orchestrator, does not start it again.
The servers need nothing installed except [Node.js](https://nodejs.org): `npx`
downloads the pinned package on its first start (this can take a few minutes)
and takes it from npm's cache afterwards. While a package is downloaded the window shows gears dropping into a container; a server that is already installed is shown as an orbiter on the runway with the server's name on its hull, revving its engines. When the server is up, the container closes or the orbiter takes off, with a check, before the result. Without Node.js the window says so and
offers **Get Node.js**; a server that fails to start shows its error, and the
chat does not fall back to other tools.

vibing-steampunk is a single executable, not an npm package: download `vsp` for
your platform from [its releases](https://github.com/oisee/vibing-steampunk/releases),
then set `vertex.chat.vspPath` to the file's full path, or name it `vsp` (`vsp.exe` on Windows) and put its folder on PATH. VERTEX does
not download it; when it is not found, the window says where to get it. Servers run
in an empty folder of VERTEX's own, so a `.env` or `.vsp.json` you keep for the
`vsp` command line is not read; the connection comes from VERTEX.

The server works on the active SAP system with its url, user, client and the
password VERTEX keeps in the OS credential store; nothing is entered again.
mcp-abap-adt reads its connection only from a file, so VERTEX writes a temporary
`.env` in its own storage while that server runs and deletes it when it stops.
Systems that log on with SNC have no password to hand over and cannot use these
servers.

SAP ADT is different: SAP's extension runs that server itself and logs on with its
own systems (destinations), so VERTEX hands over no system or password and asks for
no write access - SAP's settings decide. To use it:

1. Install ABAP Development Tools for VS Code and log on to a system there.
2. Set `adt.mcpServer.enabled` to `true`; SAP's extension starts the server at
   `http://localhost:2236/mcp` (`adt.mcpServer.port`) and keeps its token in
   `adt.mcpServer.token`, which VERTEX reads.
3. Allow the system in `adt.mcpServer.accessRestrictions` (`destinations`, for
   example `MYSYS_*` or `*`); packages that may be changed go in
   `packages-objectChanges`. Without this SAP refuses every tool call.
4. For changes to existing sources (for example the fields of a new table), turn on
   `adt.mcpServer.enableEditFileToolForABAPObjects`; without it SAP ADT can create
   objects but not write their source.

The **⚙** beside the MCP list opens these settings when SAP ADT is picked. After a
change to them SAP's extension restarts its server and logs off: log on to the
system there again.

The chat then works on the systems logged on in SAP's extension, which may differ
from the system active in VERTEX; SAP's tools name their system in `destination`.
If nothing answers, the start window says what to switch on.

### Toolsets: extra tools on demand

The MCP list replaces VERTEX's SAP tools with one server's. Toolsets add a few
tools of another server only when a task needs them: the chat gets one small
`enable_toolset` tool listing the sets, and the model enables a set when it sees
a matching task - for example a RAP service to generate. The set's tools join from
the next step (in Claude Code and Codex from the next question) and stay for the
session; questions that need none do not carry their descriptions.

The default set **SAP RAP** takes from the SAP ADT server its RAP generators (table,
CDS view, behavior definition, service definition and binding in one go), the
service-binding tools (publish, OData details), object actions, activation and the
transport-request tools - about a fifth of that server's tool descriptions. It needs
the SAP ADT server set up as above and works on SAP's extension's systems; the model
is told to name the system it changes. Sets are defined in `vertex.chat.toolsets`:
the server from `vertex.chat.mcpServers`, a short description for the model, tool
names (`*` and `?` allowed) and a note. A failed start of a set's server is reported
to the model and the user, not skipped.

In every choice but one, only sets marked `always` are offered (by default SAP
RAP). The last choice of the MCP list, **VERTEX Orchestrator**, keeps VERTEX's own
SAP tools and offers every set: the model gets a catalog of the configured servers -
what each is for, its version and its toolsets - and enables only the set a task
needs. mcp-abap-adt, which has over 250 tools, is split into twelve sets (read
objects, search and where-used, versions, data and SQL, change code, change DDIC and
CDS, change RAP, packages, tests and checks, transports, run and runtime analysis,
debugger); ARC-1 and vibing-steampunk are one set each. A set may take tools from a
server's newer version as long as their names match its patterns; a tool no set
matches is listed as in no toolset.


In **VERTEX Orchestrator**, a separate planning model prepares a plan and completion checks before the chat's model runs the task, and steps in when tool calls keep failing. Choose the planner with the gear beside the MCP list or **VERTEX: Configure Orchestrator Planner** (`vertex.chat.orchestratorProvider`, `…Model`, `…Effort`); an empty provider turns planning off.

### MCP Servers window

The ⓘ button beside the MCP list opens **VERTEX: MCP Servers**: every server with
its description, version, toolsets and a table of its tools - the toolset each is
in and whether it may change SAP. Versions and tool lists are those kept from each
server's last start in VERTEX, so nothing has to run to show them; **Read tools**
starts a server once to read them. After VS Code loads, and again each time this window opens, VERTEX asks npm whether
a newer ARC-1 or mcp-abap-adt is out; if so, **Update** appears beside the MCP list
and in the window. Nothing is installed until you press it: the newer version is
written to `vertex.chat.mcpVersions`, the server starts on it and its tool list is
kept. SAP ADT updates with SAP's extension and vibing-steampunk with its own
executable; for them the window shows the version the server reports.

Settings:

- `vertex.chat.arc1Access` - what ARC-1 may do: `read-only` (default),
  `write-tmp` (writes and activation in `$TMP`) or `write` (everything: any
  package, transports, table preview, free SQL and Git writes).
- `vertex.chat.abapAdtAccess` - what mcp-abap-adt may change: `read-only`
  (default; runs `@mcp-abap-adt/core-ro`, which has no write tools) or `write`
  (runs `@mcp-abap-adt/core`, which creates, changes and activates objects).
- `vertex.chat.vspAccess` - what vibing-steampunk may change: `read-only`
  (default; every write refused) or `write` (create, change, delete, activate and
  transports).
- `vertex.chat.vspPath` - the `vsp` executable: `vsp` on PATH (default) or its
  full path.
- `vertex.chat.mcpServers` - the servers in the list: name, command, arguments
  and environment, with `${sapUrl}`, `${sapUser}`, `${sapPassword}`,
  `${sapClient}` and the other placeholders filled from the active system. Add an
  entry to put another MCP server into the list.
- `vertex.chat.mcpServer` - the server picked in the panel.
- `vertex.chat.toolsets` - the sets the chat may enable on demand: name, server,
  description, tool patterns, a note, and `always` to offer it with every choice
  (default: SAP RAP, always; the mcp-abap-adt sets, ARC-1 and vibing-steampunk for
  the orchestrator).
- `vertex.chat.mcpVersions` - package versions that replace the ones in
  `vertex.chat.mcpServers`, written by **Update**.
- A server's `description` in `vertex.chat.mcpServers` is what the orchestrator's
  catalog and the MCP Servers window say about it.

## Review transports with Copilot, Claude Code or Codex

VERTEX serves two read-only MCP tools. `sap_transport_changes` lists what a
transport request changed; `sap_transport_diff` gives the changes of one object,
cut into review blocks, with saved verdicts and comments when available.
They read `ZAVE_REVIEW` through standard ADT data preview; without a saved review
or the table, they build an unsaved review from ADT version history. VERTEX's
ABAP classes and custom review resource are not required. The tools cannot save
reviews or approve blocks; ADT failures are reported as errors, not as a clean transport.

The same tools come from two servers. Which one depends on where the assistant
runs:

| Assistant | Server | Setup |
|---|---|---|
| Copilot in this VS Code | this extension | none |
| Claude Code or Codex, with VS Code open | this extension | one command, below |
| Claude Code or Codex with VS Code closed | [`mcp/server.js`](https://github.com/ysichov/VERTEX/blob/main/mcp/README.md) | Development/standalone mode; not part of the tested VS Code workflow |

The **Assistant** panels in SelecTor and Versions need neither: the extension
starts Claude Code or Codex for them itself.

### The server in this extension

It starts with VS Code, on `127.0.0.1` at the port `vertex.mcp.port` (default
`37777`), and answers only requests that carry its token, which VS Code keeps in
SecretStorage. It reads the SAP system chosen with **VERTEX: Switch System**, so a
VS Code window with VERTEX has to stay open while an assistant uses it.

- **Copilot** (VS Code 1.101 or newer): nothing to do. In Copilot Chat's Agent
  mode, the tools picker lists the server as **VERTEX SAP**.
- **Claude Code**: in Settings, search `vertex.mcp.port` and click **Add the VERTEX MCP server to Claude Code or Codex**,
  choose **Claude Code**, and run the copied command in a terminal. If `vertex`
  is registered already, run `claude mcp remove vertex --scope user` first.
  `claude mcp list` shows it; start a new conversation.
- **Codex**: the same command, choose **Codex**, and paste the copied section into
  `~/.codex/config.toml` (`%USERPROFILE%\.codex\config.toml` on Windows),
  replacing an existing `[mcp_servers.vertex]` rather than adding a second one.
  Restart the Codex extension and start a new conversation. The section carries
  the token, so keep that file out of version control. It uses Codex's
  [HTTP MCP configuration](https://developers.openai.com/codex/mcp/).

A window reload changes nothing about a registration. After changing
`vertex.mcp.port`, reload VS Code and copy the address again. Two VERTEX windows
at once need two ports: a port that is already taken is reported, rather than
the assistant silently reaching another window's SAP system. Port `0` takes a
temporary port, and then the address has to be copied again after every reload.

Then ask, for example: **Review transport DEVK900123 using the VERTEX SAP tools.**

## Debug with an assistant

An assistant can run the ABAP debugger by itself: set breakpoints with conditions SAP evaluates, start the program in WebGUI, read what the program held where it stopped, and end with a verdict that names the line and the values that prove it. You describe the problem; you do not step through the code. **VERTEX Smart Debugger** shows the same session on screen, and records a run for replay.

Setup, how a run is caught, breakpoints, dumps and the tools: [Debug with an assistant](https://github.com/ysichov/VERTEX/blob/main/vscode/docs/debugging.md).

## Set up SelecTor or Versions with a sentence

**Assistant** in SelecTor's bar opens a chat. It uses the provider and model chosen in the VERTEX
panel; write what to show, for example *SFLIGHT for carrier AA, joined with SCARR*.

The assistant reads only the table's layout — fields, keys, texts, the tables the dictionary
offers to join — and no row of any table. It answers with the state SelecTor is to be put in;
the extension checks it against the dictionary, and the window fills in the selection panel, the
join and the pivot and runs the query as if it had been clicked. A plan naming something the
table does not have is shown as an error and changes nothing.

Versions has the same **Assistant**: *the last change of CALCULATE in ZCL_MY_CLASS*, *the
review of DEVK900123, the CALCULATE part*, *describe the method GET*. It reads what the window
can show — parts, versions, the change a version made, whole sources, and a saved review with its
blocks and verdicts — so it describes and reviews code, and it moves the window to what it talks
about the way the clicks would. That source goes to the model you chose, as it does with the MCP
review tools; SelecTor's assistant never sees a table row.

### Examples

A request can be written in any language; the answer comes back in the language of the
request.

SelecTor:

- *SFLIGHT for carrier AA, joined with SCARR*
- *keep only the key fields and the airline name*
- *SBOOK joined with SCARR: smokers per airline as a pivot*
- *sum of prices by airline and plane type in SFLIGHT for 2026*
- *SFLIGHT from 01.01.2026 to 31.03.2026, without carrier LH*

Versions:

- *the last change of CALCULATE in ZCL_MY_CLASS*
- *versions of program Z_ANY_PROG*
- *what does transport DEVK900123 change?*
- *the review of DEVK900123, the CALCULATE part*
- *describe the method GET*, with its review open
- *review the change of ZCL_MY_CLASS=>CALCULATE: risks and open questions*

A subscription provider needs the Claude Code or Codex extension installed in this VS Code:
VERTEX starts the copy that comes with it, with your login, in an empty folder, with no other MCP
server and no shell. See [Providers](#providers).

## What it writes

Everything reads, with one exception: saving a code review - and approving, declining and
commenting in it - writes the review to `ZAVE_REVIEW` through this repository's
`ZCL_VX_ADT_RES_STORE`, or to a file, as `vertex.review.storage` says.

## Acknowledgements

The experimental client BSE parser uses [abaplint](https://github.com/abaplint/abaplint) by Lars Hvam and contributors (MIT). `@abaplint/core` is bundled in the VSIX; no separate installation or lint extension is required. Its licence is included in `licenses/abaplint-MIT.txt`.


The VS Code extension talks to SAP ADT through
[abap-adt-api](https://github.com/marcellourbani/abap-adt-api) by Marcello Urbani (MIT): reading
and writing source, activation, the debugger, ABAP Unit, ATC, where-used, keyword documentation. It travels inside the VSIX with its
licence, as do the other npm packages it depends on (MIT, Apache-2.0, BSD-3-Clause), each in its
own folder. The Eclipse plugin does not use it: it works through the platform and ADT only.

The direct SNC transport uses fr0ster's [@mcp-abap-adt/connection](https://github.com/fr0ster/mcp-abap-connection), [auth broker](https://github.com/fr0ster/mcp-abap-adt-auth-broker) and `sap-rfc-lite`, integrated into VERTEX through [PR #1](https://github.com/ysichov/VERTEX/pull/1). [Enrico Andreoli's adt-rfc-bridge](https://github.com/enricoandreoli/adt-rfc-bridge) independently documents ADT over `SADT_REST_RFC_ENDPOINT` and pointed us to the possibility of finding `sapnwrfc.dll` in an existing SAP GUI installation. VERTEX does not include its Python bridge. We have not established whether either implementation drew from the other.

## Release notes

What changed in each version: [history.md](https://github.com/ysichov/VERTEX/blob/main/history.md).

## Licence

MIT. See [the project](https://github.com/ysichov/VERTEX).
