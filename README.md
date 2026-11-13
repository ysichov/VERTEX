# ABAP VERTEX Tools

## Install

**[VS Code — the Marketplace](https://marketplace.visualstudio.com/items?itemName=YuriiSychov.vertex-abap)**
· **[Eclipse ADT — the update site](https://ysichov.github.io/VERTEX/)**

Current VS Code extension: **0.9.91**.

For VS Code, the recommended companion is
[ABAP Syntax Highlighting by Lars Hvam](https://marketplace.visualstudio.com/items?itemName=larshp.vscode-abap)
(`larshp.vscode-abap`). 

**VERTEX: Get Started** opens the Welcome walkthrough from the Command Palette.



VERTEX is a set of plugins for VS Code and Eclipse ADT. Each window reads over the developer's existing ADT connection and renders as HTML. In Eclipse, opening a VERTEX window reveals its containing layout even when that area was hidden in the saved perspective.

**Standalone AI Code Agent for local Git projects — any programming language (VS Code).**

VERTEX can work as an AI coding agent for an ordinary local Git repository: Python, JavaScript, TypeScript, Java, C#, Go, ABAP or another language. Open the project folder in VS Code, choose a provider and a model that supports tool calls, and give the agent a task in the VERTEX chat. No SAP system or ABAP project is required.

- Search and read project files, explain code, implement changes and work with Git diffs.
- Review the agent's edits in an isolated Git working copy, then approve files and **Apply** them to your folder; declined changes can be returned for rework with your reason.
- Run the project's own build and test commands after Apply; failures can be sent back to the agent for correction.
- Use Claude Code, Codex / ChatGPT subscription, EPAM CodeMie, GitHub Copilot or a supported API provider, with optional session logs.

**Quick start:** open a local Git folder → open the VERTEX panel → choose a provider/model in **LLM Providers** → ask for a change → review the diff → **Apply**.

**Git** (VS Code): Git History of the folder, review of a commit or of uncommitted changes as a file tree with diffs (Open and line numbers jump to the file), **ASK AI** with ready prompts (technical review, business review against pasted requirements, documentation, test plan, release notes), commit with an AI-drafted message, branches, push and GitHub pull requests. See [the VS Code documentation](vscode/README.md#code-agent-and-git).

**Serverless, in VS Code** - the ABAP transpiler runs ABAP on your machine:

- runs a report (its selection screen, then the list), a method of a local class or a function module; for a method or a function module the panel asks the parameters, and their values can be saved as named variants to run again
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
data elements, domains and tables, to read theirs. With it, a method is reviewed from its own versions (as SE80
and AVE show them) instead of being cut from the class's; without it, reviews are saved to files and such
parts say they need the backend. The Eclipse plugin does the same. The last column below says what needs it.

In VS Code, the built-in VERTEX Assistant can use Codex, Claude Code, a signed-in
GitHub Copilot model, EPAM CodeMie through the CodeMie CLI or API keys for Anthropic, OpenAI, Mistral, Gemini, Groq,
Cerebras, OpenRouter, NVIDIA and Vercel AI Gateway, or a local model served by LM Studio or Ollama. With the active editor on a file of an open workspace folder (or no editor open and one folder in the
workspace), the selected assistant works in that folder: in a git folder it works in its own working copy and, when its answer
is done, its changes are reviewed file by file in one VERTEX review page (approved files are copied in,
declined ones go back to it with your reason; what you change in the folder yourself reaches its copy before its next turn); outside git each file edit waits for review before it is written, and each shell command (a build, a test) waits for **Allow** in a VS Code dialog. Provider model lists can be collapsed independently.
Each list has a Clear all / Select all control for its model checkboxes.
If a provider returns no models, LLM Providers displays an explicit empty-state message.
In the VS Code sidebar, model-loading errors appear below the model selector.
Start chat by naming the package or program to inspect; a single match opens in Object Navigator.
For a plain name without an exact match, VERTEX tries prefix and contained-name searches; explicit
wildcards are used as written.
The VS Code chat can explain the ABAP source of the active editor using its current text, even without a SAP connection: a local `.abap` file, or a source another extension opened (SAP's ADT extension, ABAP remote filesystem). With no SAP system in VERTEX, UML, Metrics, Logic and Calls in the editor's **VERTEX Tools** menu analyse such a source from its text, as for a local file.
In VS Code the chat is only in the VERTEX panel: **ASK AI** inside a review opens it with the selected blocks on a chip, and you write the question. The question box grows with pasted text; **⤢** expands it.
Plain `.abap` reports without a custom transpiler configuration run through a temporary program-named copy; the editor file and trace locations keep their original names. Run from the local debugger opens the separate program window.

Local ABAP programs and classes support Outline, navigation, UML, metrics, Logic and Calls diagrams and usage analysis. **VERTEX: Run with ABAP Transpiler** runs a local program on your machine - its selection screen, then its output - and with a breakpoint set the same panel is the debugger. An SAP program, class method or function module can run the same way: its code is read from SAP first. See [local execution setup](vscode/README.md#local-abap-execution).

From a SAP source tab's context menu, **VERTEX: Run SAP in web GUI** opens the program in WebGUI or a class/function module's test screen. It works without a breakpoint.


| Tool | Grew out of | What it does | VS Code | Eclipse | ABAP backend |
|---|---|---|---|---|---|
| **Enhanced Code Editor** | — | Hover with a data element's domain resolved, Go to (F12) with SAP-resolved interface method implementations, Outline, Save & Activate and block-by-block Review & Activate, ABAP Unit into the Test Explorer (Ctrl+Shift+F10), ATC into Problems (Ctrl+Shift+F2), where-used (Shift+F12), SAP's keyword documentation (F1) | ✓ | — | not needed |
| **AI-driven ADT debugger** | [Smart Debugger](https://github.com/ysichov/Smart-Debugger) | Breakpoints with conditions SAP evaluates and watchpoint logs, the run started in WebGUI, the stops, a short dump reported instead of silence, a verdict naming the line and the values; the VERTEX chat has it built in, Claude Code and Codex reach it over MCP as `vertex-debug` | ✓ | — | not needed |
| **VERTEX Smart Debugger** | — | The same session on screen: source, breakpoints, stack, every variable, tables as grids, the flow chart of a recorded run and its player. The first recorded SAP stop includes Globals such as selection-screen values. In VS Code, SAP & Transpiler Logs opens SAP recordings and transpiler runs for replay or deletion; SAP recordings can be renamed. | ✓ | ✓ ³ | not needed |
| **Value Origin** | [ACE](https://github.com/ysichov/ACE) | Forward Usage Analysis - how a value is computed, down from a line across calls: the static call stack, the derivation as *FLOW*, *Formula* or *Expression*, each as a tree or a diagram; Backward Usage Analysis - where the values of a routine go in its callers, by SAP's where-used | ✓ | ✓ | not needed |
| **Path to This Line** | — | The conditions inside a METHOD or FORM under which the line at the cursor runs - enclosing branches, earlier branches that must be false or must not be taken because they leave, CHECKs - written as in the code; in the Diagram the Reachability toggle lights up that path | ✓ | ✓ | not needed |
| **Block folding** | — | IF, CASE, LOOP, TRY, METHOD, FORM and other ABAP blocks and their branches fold by the code's structure, so unformatted code folds too | ✓ | — | not needed |
| **AI Assistant** | [ABAP-AI-Code](https://github.com/ysichov/ABAP-AI-Code) | Chat over any configured SAP system: reads, explains and changes code — the change lands in the tab, reviewed block by block before activation — runs the tests and ATC on an object, and drives the debugger | ✓ | ✓ ¹ | not needed |
| **Versions / Reviewer** | [AVE](https://github.com/ysichov/AVE) | Version history, the diff between two versions, the review of a whole transport with approve, decline and comments, each block's author and, with Blame, the developer who wrote each changed line, and the two MCP transport tools | ✓ | ✓ ² | to save reviews in SAP |
| **Code Explorer** | [ACE](https://github.com/ysichov/ACE) | Metrics (McCabe, Halstead, maintainability), UML, the Calls diagram of an object and the Logic diagram of one method, report event, FORM or MODULE; a method opened from Calls draws its Logic diagram in the same picture | ✓ | ✓ ² | not needed |
| **Data Explorer (SelecTor)** | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, a join built from the dictionary's foreign keys, a pivot over either | ✓ | ✓ ² | not needed |

¹ In Eclipse the assistant is run by the Codex, Claude Code or CodeMie CLI on your own subscription, or by the Anthropic API with your key, and
ADT is the editor: there is no VERTEX tab for it to write into, and the debugger is not part of it.
See [eclipse/README.md](eclipse/README.md).

² The explorer pages are shared between both hosts. The Eclipse update site carries build
**0.9.90.20261113185846**; the VS Code extension is **0.9.91**.

³ In Eclipse, VERTEX Smart Debugger drives ADT's own debug session instead of a second debugger, and Run
opens the object in Eclipse's embedded SAP GUI. It is on the update site and has not been checked on a live ADT session.
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


### Git and external tools (VS Code)

Install Git and make the `git` executable available on the VS Code extension host's `PATH` for Git History, diffs, commits and isolated local Git history/working copies. Isolated storage is still real Git: a folder without `.git` does not remove this dependency. Direct TypeSafe Jev requests without a reported API cost show an estimated USD cost from input tokens at $0.042 per million; output is free. The estimate is retained with the logged answer and usage metadata, separately from reported actual charges. Gateway requests retain their own billing.

For Claude Code, **Check and add** verifies an explicit model ID and marks a successful result **Checked**; **Save** keeps the model in the list.

Model names and IDs in LLM Providers can be selected and copied with Ctrl+C / Cmd+C. Focus the chat model selector and press Ctrl+C / Cmd+C to copy its selected model ID.

GitHub access, a remote repository and publishing are not required for local Git operations. For GitHub HTTPS operations, authenticate on the VS Code extension host (including the remote host for SSH, WSL or containers): run `gh auth login --hostname github.com --git-protocol https --web`, complete browser sign-in, then run `gh auth setup-git --hostname github.com`. Retry the operation in VERTEX. Install GitHub CLI first if `gh` is unavailable, or configure a Git credential manager. VERTEX runs Git without interactive credential prompts; GitHub account passwords are not accepted for Git authentication.

Check `git --version` in the environment where VERTEX runs, then fully restart VS Code after installing Git or changing `PATH`. On Windows, make Git available from other programs; on macOS/Linux, install Git through the system tools or package manager. With Remote SSH, WSL or a container, Git must be installed on that extension host, not only on the desktop computer.

Ordinary API chat needs the configured provider credentials and network access; it does not require Git, SAP, Python or a separate Node.js installation. Claude Code, Codex and CodeMie modes require their installed client and authentication. Project builds/tests require that project's own toolchain. VERTEX local commands use Windows PowerShell 5.1 on Windows and `/bin/sh` elsewhere; commands and paths must match that host. The bundled Node runtime does not mean an external `node` command is installed. Taking the chat's SAP tools from ARC-1 or mcp-abap-adt (the panel's MCP list) needs Node.js installed, for `npx`; vibing-steampunk needs its `vsp` executable.

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

**SAP Systems** (the server icon in the VERTEX panel's title, or the link under `vertex.systems` in Settings) lists every configured system in a table. Per row: the radio button makes it the active system; **SNC** switches it between SNC single sign-on and password authentication; **On** switches it off or on - a system switched off stays in `vertex.systems` (`"disabled": true`) but is left out of every list, switch and test, and a tab opened from it says so; **Log in** asks for the password and keeps it in the OS credential store, then tests - where a password is already kept, the button reads **Save new password** (SAP is not asked to tell); **Test** asks ADT on that system alone and shows the answer in the row, kept there until the window is reloaded, also when the table is closed; **Delete** removes it from `vertex.systems` after a confirmation. **Import from SAP Logon and Eclipse**, **Edit in settings.json**, **Open connection log** and **Open RFC trace folder** stand above the table.

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
an RFC address are required; the RFC address is never derived from `url`. It is an application
server - `rfc.ashost` and `rfc.sysnr` - or, as for a SAP Logon group entry, a message server: `rfc.mshost`,
`rfc.sysid`, `rfc.group` (default `PUBLIC`) and, when its port is not `sapms<SID>`, `rfc.msserv` (e.g. `"3600"`).
**VERTEX: Import SAP Systems** fills those SNC and RFC fields from a SAP Logon entry, direct or through a logon group; it asks for a client or user only when the chosen Eclipse workspace does not supply them.
When an SNC connection fails, its message names the address it used, and the VERTEX output (**Open connection log**
in **SAP Systems**) records each connection. `vertex.rfcTrace` `1`-`3` has the SAP NW RFC SDK write its own trace,
`dev_rfc*.log`, into `vertex.rfcTraceFolder` (by default `vertex-rfc-trace` in the system temporary folder) from the
next connection; **Open RFC trace folder** opens it.
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

Both Value Origin windows show an **Analysis log** above the flow.

For a saved transport review, **Code review** and **Technical documentation** open all changed objects with that prompt chosen. Its **Code review / Technical documentation** choice sets the prompt copied by **AI prompt diff / full**; the same choice is in developer and reviewer views, and on a single object's page for **Copy prompt: diff / full**. The documentation prompt keeps created objects (sent whole, described as they are) apart from modified ones, and ends with `TR Details: <request>`. Tick objects in the summary (a row, or a group heading for the whole group) to narrow **Expand all**, **Code review**, **Technical documentation** and their prompts to them; **All / None** set or clear the ticks, and none ticked means all objects. In a transport review, **Open** on a block and a line number in its diff open the code in the editor at that line, class parts included. **ASK AI** beside that choice puts the blocks on the chat chip with the chosen prompt as its instruction; a question typed in the chat adds to it. A single block's **ASK AI** keeps the short question.
**Prompts…** lets you view and edit both instructions. User files in `~/.vertex/prompts/` take priority over the built-in texts and are reread when a prompt is copied.

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
**Depth** field (a number from the first level up to the deepest the flow goes; a larger value is taken back to that maximum) decides how far the tree opens — along the call stack in FLOW, along the
derivation in Formula — and one button beside it, offering *Collapse all* and then *Expand all*, says whether the levels shown are open, whatever the depth. *Tree* and
*Diagram* stay the two views of whichever Type is chosen. **Expression** (0.8.0) is a third Type: the derivation written out as one formula by substitution - a share added to the value before it becomes `value × (1 + share)` - with each table value a link to the statement that reads it, and, where the order of steps is configured data (a pipeline), the order of the loaded scenario.

Branches and polymorphic targets are alternatives, database-dependent loop order is a boundary.
Breakpoints in the editor stop the flow where a run would stop. **VERTEX: Backward Usage Analysis** goes the other way: from the routine up into its callers, found by SAP's where-used, following the value through each caller. Standard SAP code is not followed.

**VERTEX: Path to This Line** (editor context menu) shows the conditions under which the line at the cursor runs inside its METHOD or FORM, written as in the code, and where the values in those conditions come from. In the Diagram, the **Reachability** toggle lights up the same path.

ABAP blocks fold in the editor by their structure, not by indentation, so unformatted code folds as well as formatted: IF, CASE, LOOP, DO, WHILE, SELECT loops, TRY, METHOD, FORM, FUNCTION, MODULE, CLASS and INTERFACE from the opening statement to the line before the closing one, and each ELSEIF, ELSE, WHEN, CATCH and CLEANUP up to the next branch. A condition written over several lines stays visible when its block is folded.

**Run Select.** **VERTEX: Run Select** runs the SELECT at the cursor read only through ADT's data preview, dropping what only the running program supplies; a SELECT on one table or with joins opens in SelecTor.

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
Package Metrics includes classes, interfaces and programs. **Visual** draws each object as a tile sized by the selected metric and split into its methods, forms and events.
FLOW and Value Origin diagrams support graphs with more than 500 edges in both hosts.
Eclipse Tools selects the active ADT class or program when opened from its editor.
Each API provider can have several named keys, with one selected manually.
For Mistral and other compatible APIs, the VS Code chat shows the token usage returned by the provider, summed across tool calls.
With `vertex.ai.logPath` set, the VS Code assistant writes an Anthropic-compatible JSONL log for any provider. Each direct API or Copilot model call has its own record; CLI subscriptions are recorded per VERTEX invocation. Choose the folder in LLM Providers or Settings. Raw HTTP request bodies are not stored.
**Session Logs** (the scroll icon in the VERTEX panel's title) shows the logged conversations by day, with filters and token totals; **Duration** shows each prompt's elapsed time in minutes and seconds, excluding the pause before the next question. **Continue** reopens one in the chat. **Continue** also restores unanswered questions and saved screenshots after a failed or quota-limited request; missing screenshot files are reported. The left chat panel also has **Conversations · Continue a chat** below the project selector: expand it, search saved conversations, and select one to restore it. **Refresh** reloads the list from the configured log folder. Conversation details are rendered when expanded; closed entries keep the report compact. The Conversation column prioritizes prompt text; Model is compact, with the full provider and model available on hover. Table columns retain stable sizing in narrow panels; scroll horizontally to see additional columns. In SAP mode, entering an object name alone searches SAP and opens a unique match without a model request; screenshots from earlier messages do not change this. A screenshot attached to the current message keeps it as a question for the model. In VS Code, SAP debug steps recorded by VERTEX Smart Debugger are saved automatically as they arrive, with recorded values and source snapshots. They appear in **SAP & Transpiler Logs** without requiring **Save session**; closing the debugger does not discard saved steps.

**Context protection (VS Code).** Credential fields are masked before AI requests, MCP tool responses, conversation logs and SAP recording writes. Redaction markers preserve type, length, empty status and opaque equality labels. Add project-specific field names or `*` patterns with `vertex.ai.context.secretFields`. Live SAP values stay unchanged. Screenshots and external agents’ own filesystem reads are outside this text filter; existing files are not rewritten.

In VS Code, the left chat panel has **Main / AI Review** modes. **Main / AI Review** appears only after a review is requested. **Close review** closes it and returns to Main; switching to **Main** keeps the review available. **ASK AI** in Assistant changes switches to AI Review with the selected block, file or all changes attached. Each mode keeps its own history and draft; provider and model settings are shared. Review logs have a separate conversation identifier, and requirements are entered explicitly for that review. **Check again** starts a fresh review of the current changes. **Discuss in Main** under a review answer attaches that result and its reviewed snapshot to the next Main question. Expand **Attached review result** to inspect it, or remove it with the attachment’s × button. Your Main draft is preserved; nothing is sent until you submit the question.
Eclipse's built-in
Assistant uses Codex or Claude Code; Copilot Chat in Eclipse connects separately
through MCP.

## What each host has

### VS Code 

In VS Code chat, each newly attached screenshot is recognized independently by the selected Vision-capable model, without conversation history, workspace context or tools. Jev identifies screenshot topics by the recognized scene and retains visual evidence and the latest answer when assessing follow-ups. Jev and the answering model receive its factual description; conversation context retains only a file reference and description. You can send a screenshot without text: the assistant identifies the visible problem or asks a specific clarifying question. Recognition is a separate model request with its own usage accounting. **New conversation** clears the chat context.

Remote API model catalogs are saved locally after the first load and reused when switching providers or restarting VS Code. Rebuild a catalog explicitly in LLM Providers to discover changes. Model selections apply immediately to the saved catalog. Each API credential has its own catalog; local servers keep a live list of loaded models.

Large Git changes use bounded diff memory. Entire additions and deletions are compared directly; difficult comparisons can appear as one larger block with all changed lines preserved. Preparation errors appear in the review window.

Large Git file previews load on selection and show 1,000 rows per page with Previous/Next. Hidden large previews are unloaded. New files use plain text rows instead of colouring the entire file as added; the file tree retains its added status. ASK AI and ASK Jev still use the selected complete diff block.

Large new files open in the standard VS Code editor when selected in the Git review tree (over 1,000 lines or 256K characters). Uncommitted files open from disk; historical additions open their saved content. Small new files and changes to existing files retain the review preview.

When the VERTEX chat resolves a single SAP object name, its answer links both the object and its package to their SAP tabs.

- **VERTEX Tools** — pick an object type and a name; the functions offered depend on the type
  (Object Navigator, Data, UML, Metrics, the Calls diagram and the Diagram, Diff, Versions). Object Navigator is the SE80
  tree of a package, transport request, program, class or interface, each entry a link to its source; for a request, **Show removed objects** shows in red what a released task held but the request no longer carries. There is no View source: the source is the
  editor tab, and its parts are VS Code's Outline. VERTEX Smart Debugger is the panel beside the editor.
  Clicking a method in the Calls diagram opens its Diagram inside the same canvas, joined
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

#### TypeSafe Jev API

Jev answers in Session Logs show the question text, readable answer, confidence and labeled probabilities, matching the chat result labels.

Enable question logging to retain the explicit Jev context and questions. Each saved Jev step offers **Continue** to restore its provider, model, context, question types and answer options into an editable draft. **Run Jev** creates a new step; Continue itself does not run inference. Older records without saved input cannot be restored.

**ASK Jev** beside ASK AI (when TypeSafe Jev is set up) gives a quick advisory assessment of a review block. It never approves, declines or applies anything.

TypeSafe Jev is a decision model, not a chat: with a TypeSafe API key in LLM Providers, the panel turns into a form with a context, questions and **Run Jev**, and answers come with confidence and probabilities.

#### OpenCode Console

OpenCode Console takes a named OpenCode API key in LLM Providers.

### Eclipse ADT

- **VERTEX Tools** — the same pages as in VS Code, opened from **Window → Show View → VERTEX** or
  the **VERTEX** submenu of an object's context menu (beside GitHub and Team), on that object's own ADT project.
  The editor's VERTEX commands, Path to This Line and Session Logs are in the same submenu.
- **VERTEX Assistant** — the chat over the ABAP project's system, and the Assistant panels in
  SelecTor and Versions, run by Codex or Claude Code.
- **VERTEX: Activate** — ADT's activation, optionally after the block review.

Setup of the assistant: [eclipse/README.md](eclipse/README.md).

### The chat's SAP tools from another MCP server

The **MCP** list in the VS Code VERTEX panel, beside the SAP system, picks where the VERTEX chat's
SAP tools come from: VERTEX itself (default), [ARC-1](https://github.com/arc-mcp/arc-1),
[mcp-abap-adt](https://github.com/fr0ster/mcp-abap-adt), [vibing-steampunk](https://github.com/oisee/vibing-steampunk)
or the ADT MCP Server of SAP's ABAP Development Tools for VS Code, which logs on with SAP's extension's own systems
(enable `adt.mcpServer.enabled` and allow the system in `adt.mcpServer.accessRestrictions`).
Toolsets (`vertex.chat.toolsets`) add a few tools of another server only when a task needs them: the
chat enables, for example, SAP's RAP generators and service-binding tools through `enable_toolset`
when asked for a RAP service, and other questions do not carry them. The last choice, **VERTEX Orchestrator**,
asks Jev once to select needed VERTEX/ARC-1 functions and choose direct or staged execution. Direct is the default, with no preliminary planning call or small-set cap. SQL SELECT and source reading stay available; only tasks that benefit from separate contexts use JSON stages and dependency summaries. Original inspection-only constraints still block execution and writes. The ⓘ button opens **VERTEX: MCP Servers**: each
server's description, version, toolsets and tools, kept from its last start; npm is asked after VS Code loads and each time the window opens, and **Update** appears when npm has a newer
ARC-1 or mcp-abap-adt, and nothing is installed until you press it.
The picked server is started with the active system's url, user, client and kept password; `npx`
downloads ARC-1 and mcp-abap-adt on first start (the start window shows an install scene then, and a take-off scene with the server's name for later starts), so Node.js must be installed, and vibing-steampunk's
`vsp` executable is downloaded by hand (`vertex.chat.vspPath`). Every server is read-only by default: the
window that opens on picking one asks for its write access, kept in `vertex.chat.arc1Access`,
`vertex.chat.abapAdtAccess` and `vertex.chat.vspAccess`; more servers are added in
`vertex.chat.mcpServers`. Details: [vscode/README.md](vscode/README.md#choose-the-chats-sap-tools).


Choose the shared Jev decision model with the gear beside the MCP list or **VERTEX: Configure Orchestrator Jev Model**. Session Logs shows a separate **Orchestrator tool selection** type with each stage, per-tool decisions, probabilities and the selected set. Missing configuration or failed selection stops execution.

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

**Fields** (a table's function beside Data) lists the fields of a table or structure as SE11 does - key, data element, type, length, decimals, short text - and an `.INCLUDE` or `.APPEND` row names the structure it brings in as a link that opens that structure's fields. A structure has no rows, so it opens on Fields; the chat opens a structure that way too.

| Word | Comes from | What it does | In VERTEX | Status |
|---|---|---|---|---|
| Data | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, joins, pivot | SelecTor | A table with filters, a join built from the dictionary's own foreign keys, and a pivot over either |
| Version | [AVE](https://github.com/ysichov/AVE) | History, diff, blame, code review of a whole transport | Versions | A transport — by its number, or picked from the open or released requests of a user, yours by default — a package or one object; its parts, their versions, the diff between two of them, and the review of a request — built, saved, approved, declined and commented on block by block. |
| Code | [ACE](https://github.com/ysichov/ACE) | Metrics, call maps, backward slicing, skeletons | Metrics | Three modes: the flow of a program, the branch scheme of one method, and McCabe, Halstead and the maintainability index per unit. A method opened from the Calls diagram draws its branch scheme in the same picture |

Status: **early**. All three answer, and each is a fraction of what it was cut from.

Building a review is here too, not only reading one. **Build review** reads every part a request changed from ADT,
leaves out code SAP generated, diffs each part by AVE's rule and cuts it into blocks; **Blame** names who wrote each
changed line. The review is saved at once, in `ZAVE_REVIEW` or in files (`vertex.review.storage`); approving, declining
and commenting work as in AVE, and **Rebuild from ADT** builds it again from the request as it is now.
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

Codex in the built-in VS Code chat can stage SAP source edits and new-object drafts through VERTEX tools. Save, apply and activation remain explicit VERTEX UI actions.

Automatic AI context from VERTEX Smart Debugger contains only a session reference. Recorded steps, source, values and analysis are not attached automatically; provide a relevant fragment explicitly when needed.

Screenshot bytes are sent only to independent recognition. The main request and later questions use file references and descriptions. With question logging enabled, Continue restores saved descriptions and references; older screenshots without descriptions remain marked as unavailable descriptions. Reattach an image only when a new visual inspection is needed.

Long chat histories keep earlier messages available while deferring offscreen layout. Session Logs defers offscreen session layout as well, reducing resize and scrolling work.

**Optimize context (VS Code Main chat).** Enable the checkbox above the message field, or `vertex.ai.context.optimize`, to run the configured TypeSafe Jev model before each ordinary AI chat request with older exchanges. Save a TypeSafe key and enable a Jev model in LLM Providers first. The first pass sends only the current question and older user requests to TypeSafe, never full assistant answers or screenshots. Short/unclear requests can receive a second pass with a bounded first/concluding prose extract from their answer (not a model-generated summary; code blocks are omitted). Normal Jev charges apply.

The current question, system instructions and at least the last three exchanges/six messages stay in context. Jev classifies older user questions for the current task, recent user requests, active requirements and dependencies; the associated answer follows the question. Payloads are packed into bounded portions, down to individual requests for long inputs. Each serialized request stays under 24,000 UTF-8 bytes as a conservative guard, not an exact token count. Requests that still do not fit are retained without assessment. A whole exchange may be omitted only when both Jev confidence and skip probability are at least 90%; uncertain decisions keep it. This is a model judgment and may miss a relevant older detail. Full history is retained in the chat and used if Jev is unavailable, errors, or its input limit is exceeded. Disable the checkbox to send full history again. Web mode, direct navigation and the independent AI Review chat retain their own context policies.

Session Logs shows **Context optimization (Jev)** under the main question: selected exchange index ranges, probabilities, latency, Jev usage, and before/after history characters. Jev calls are grouped in a separate related conversation per selection, so Continue does not restore it as a user question. The composer reports history text reduction or a full-history fallback. Character reduction is not a guaranteed token or money saving: Jev adds latency and usage, and changed context may affect the main provider's cache. Compare total provider usage and answer quality in separate baseline/optimized runs for a real A/B evaluation. Question/request logging controls whether full decision inputs and model prompts are saved.

After a topic is chosen, the line under the question box says which topic, how many earlier exchanges went with the question and how much shorter the history became - for example `Topic topic_0001 · Jev · 17 of 60 exchanges · history 65% shorter`. Nothing is deleted from the conversation; Session Logs shows each question's topic.

The progress line says **JEV is optimizing context…**, including the current pass and portion. Log details include pass/batch sizes and aggregated Jev usage. In the monitor, **Basis** distinguishes question-only decisions from brief-answer clarification; the expanded strip shows the actual brief extract used. Full context is retained on errors.


### Topic histories (VS Code, experimental)

While TypeSafe Jev is switched on and has a key in **VERTEX: LLM Providers**, the chat shows a history toggle. **Full history**, the default, sends every earlier exchange. **Auto (Jev)**, which you switch on yourself, has Jev give each question a stable topic ID and sends only that topic's history and its explicit dependencies. Topic labels are informational and do not change the history mode. Without Jev there is no toggle, and the whole history goes. Routing usage is logged separately; failures retain full history. This does not guarantee token-cost savings, answer correctness or provider cache hits. Current editor/review context and live tools still follow the current request; old tool outputs are not automatically replayed between turns.

New conversation clears the topic catalog; Continue restores saved topic IDs when question logging was enabled. Legacy untagged history remains available. The Optimize context checkbox and the Route topics checkbox are gone; routing does not delete stored messages. Colors follow the active VS Code theme.
