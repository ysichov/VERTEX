# SAP ABAP VERTEX Tools

[**VERTEX**](https://github.com/ysichov/VERTEX) is a new set of plugins for VS Code and Eclipse ADT:
AI assistant and MCP, an enhanced ABAP editor, an AI-driven debugger and explorers for code,
versions and data. Several of them grew out of earlier SAP GUI tools.

| Tool | Grew out of | What it does |
|---|---|---|
| **AI Assistant** | — | Chat, code, any SAP system |
| **Enhanced Code Editor** | — | Hover, navigation, outline |
| **AI-driven ADT debugger** | [Smart Debugger](https://github.com/ysichov/Smart-Debugger) | Conditional breakpoints, verdict, Visual Debug |
| **Versions Reviewer** | [AVE](https://github.com/ysichov/AVE), [ABAP-AI-Code](https://github.com/ysichov/ABAP-AI-Code) | History, diff, block-by-block review with comments |
| **Code Explorer** | [ACE](https://github.com/ysichov/ACE) | Metrics, UML, logic, calls |
| **Data Explorer (SelecTor)** | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, joins, pivots |

The projects named above are where the ideas were worked out first, and they are not developed
further. Their principles and functions were carried over, and the ABAP logic of the SAP GUI
explorers now lives in `src/` as `ZCL_VX_*`, with the SAP GUI stripped off. Everything new
happens on this side.

![VERTEX architecture: VS Code and Eclipse ADT, the VERTEX MCP server between them and the AI assistants (Claude Code, Codex, GitHub Copilot), the six VERTEX Web UI tools, and the ADT hub on SAP at /sap/bc/adt/vertex/*](https://raw.githubusercontent.com/ysichov/VERTEX/main/docs/architecture.jpg)

## It needs an ABAP backend

## VS Code prerequisite

This extension is one half of VERTEX. The other half is the ADT resources in this
repository's `src/`. Pull it with [abapGit](https://abapgit.org) and activate it.

Until then, every window just shows a page explaining that the backend isn't installed yet.


[SAP ABAP Development Tools](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode)
is recommended for the ABAP editor, navigation and standard ADT commands. It
is optional: VERTEX can connect to SAP through ADT HTTP by itself and opens
source in a normal VS Code text editor when SAP ADT is not installed.


## Settings

The Eclipse plugin inherits its connection from the ABAP project. There is no
project to inherit from here, so the systems are a list and one of them is
active.

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

The `url` is the ICM port, not the one SAP GUI connects to. The password is
asked once per system and kept in the operating system's credential store.
`allowInsecureCertificate` accepts a certificate that cannot be verified, which
development systems often have; it is off by default on purpose.

## Commands

- **VERTEX: Open Panel** — also available from the VERTEX icon in the Activity Bar.
  The panel holds the VERTEX chat, the active SAP-system selector, provider and
  model controls, and the **VERTEX Tools** button.
- **VERTEX Tools** — opens the unified tools window. Choose an object type,
  enter its name (a package opens in View source with its objects in Parts; a name with `*` or `+`, such as `Z_VX*`, lists the objects of that type that
  match; pick one with the mouse or the arrow keys and Enter; a plain name that is not found
  lists the names starting with it), then choose the available function (for example Data, View,
  UML diagram, Metrics, Calls diagram, Logic diagram, Diff or Versions). **Calls diagram** shows which program, class or
  method calls which in the whole object (ACE's Calls Flow): **Classes | Methods** draws a block
  per class or per method, and picking an event or a form in Parts starts the calls there, as a
  double-click in ACE's tree does (**From: … ✕** goes back to the whole program). **Logic diagram** is the flowchart of one method (ACE's Flow Scheme). A magnifier follows the
  pointer over every diagram; Shift and two fingers on the touchpad (or the wheel) change its strength; Ctrl and a pinch zoom
  the whole picture. The available functions depend
  on the selected object type; there are no separate SelecTor, Metrics or
  Versions commands any more. For a class or a program the window keeps one **Parts** list at
  the left: pick a method, a section, a form or an event there, and every function shows that
  part; switching the function keeps the list and the choice. Diff keeps its own Parts and
  Versions column, AVE's layout, and opens on the same part.

  In Code Explorer, **?** explains every metric: what ACE counts, the formula, and which values
  are good.

  **Versions** is laid out as AVE's was: the parts of the object on the left, the
  versions of the chosen part under them — the line between the two is dragged to
  share the height — and the diff on the right. Picking a version shows the change
  it made. Pin a version with ◇ and every version picked afterwards is compared with
  that base instead. **Prev | Any** chooses what a picked version is compared with: the
  one before it, or any version pinned as the base with ◇ — the active version until one
  is pinned. **Inline | 2 pane**
  in the diff's bar shows the change in one column or the two versions side by side; in
  2 pane the parts and versions move to a band above the diff so the code gets the full
  width. The versions list folds on its own with the arrow at the right of its bar. The parts column can be folded away and resized.

  AVE's three switches sit beside it: **TOCs** shows the versions written by
  transports of copies (off by default), **Dups** hides a version whose source is the
  same as the one before it (on), **Case/ind** compares without case and indentation
  (on). The ABAP side applies them, so they need this release's `src/` pulled.
- **VERTEX: Switch System**
- **VERTEX: Forget Password**
- **VERTEX: Copy the MCP address for Claude Code or Codex** — the review server, or with a
  **- debugger** entry the debugger server ([Debug with an assistant](#debug-with-an-assistant))
- **VERTEX: Review & Activate** — editor title or context menu; opens the block-by-block
  Code Change panel described below.
- **VERTEX: Save & Activate** — editor title; saves the whole tab without the block review.
- **VERTEX: Run ABAP Unit Tests** — Ctrl+Shift+F10 or the beaker in the editor title of a class
  or program tab, as in Eclipse. SAP runs the object's test classes (risk level harmless, every
  duration) and VS Code's Test Explorer shows object, test class and test method with pass or
  fail, the time, the alert text, and a link to the line where the failure was raised. A tab with
  unsaved changes is refused: the tests run the active source. The same run is the **Run Unit
  Tests** button beside Open in the Editor in a VERTEX Tools View source.
- **Where-used** — Shift+F12 (peek) or Shift+Alt+F12 (list) in a SAP tab: the places that use
  the name under the cursor, from SAP's where-used over the saved source. A place in a source
  VERTEX cannot open as a tab is named in a warning.
- **VERTEX: ABAP Documentation** — F1 or the context menu in a SAP tab: SAP's keyword
  documentation for the statement under the cursor, beside the source. In these tabs F1 replaces
  the command palette key; Ctrl+Shift+P still opens it.
- **VERTEX: Run ATC Check** — Ctrl+Shift+F2, the checklist in the editor title, or **Run ATC
  Check** in View source. Checks the object with the system's default ATC variant; the findings
  appear in the Problems view and underlined in the tab, priority 1 as errors, 2 as warnings,
  3 as information. A new run replaces the last one's findings for that object.
- **VERTEX: Go to (by context)** — F12 or double-click in a VERTEX SAP source tab; follows a
  supported name according to its ABAP context.
- **VERTEX: Back** — Alt+Left; returns to the preceding location followed by VERTEX navigation.

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

Navigation is provided only for source read through VERTEX and therefore does not depend on an
ADT project being open. If SAP ABAP Development Tools is available, its own editor navigation and
context-menu commands remain available too.

### Source view versus editable source

Every object does not have the same action set. The object type determines the available VERTEX
functions: transports focus on Versions and review; classes and programs can offer source,
metrics, flow/scheme and diff; packages offer their package-level views. This keeps unavailable
or meaningless actions out of the toolbar.

**View source** is the default VERTEX view where source is available. It is a read-only,
contextual page inside the Tools window, useful for inspection and for sending selected fragments
to the internal chat. For a class, its Parts list reuses the Diff table: `CPUB`, `CPRO`, `CPRI`
and `METH` rows have the same SE80-style visibility markers. One click shows a method body;
double-click on the method switches declaration and body; double-click on a section positions its
declaration. **← Back** restores the prior location. A program is never cut down to one part:
its Parts list only positions the complete source on an event, form or local-class implementation. **Open in the Editor** opens the object in the editable VERTEX source editor.

The chat context follows the active function. A source view sends a selected fragment, or the
currently open method when nothing is selected, together with the method's signature. For a redefinition VERTEX follows `INHERITING FROM`
before asking the assistant, so the context uses the original declaration and identifies its
owning class. UML sends the diagram's object, nodes, method names and relationships instead — not
a method signature — so it can be analysed directly. Ask the chat explicitly to *open* or *edit*
an object — for example, *Open ZCL_FOO please* — to open a normal, editable VS Code tab instead.
Changes made there are still sent to SAP only through **Review & Activate** or **Save & Activate**.

## VERTEX chat

The **VERTEX** panel in the Activity Bar has a free-prompt chat. The top line holds the
**SAP system** list — the link opens the system settings — and **LLM Providers**. The question
box, the provider and model lists and **New conversation** stay at the bottom of the panel; the
answers scroll above them, questions and answers in different colours. Asking for a VERTEX
function — *open table SFLIGHT*, *show the diff of ZCL_FOO* — opens a **VERTEX Tools** window on
it.

### Providers

| Provider | What is paid for | What has to be installed |
|---|---|---|
| **Claude subscription (Claude Code)** | Your Claude subscription | The Claude Code extension, signed in |
| **ChatGPT subscription (Codex)** | Your ChatGPT subscription | The Codex (OpenAI) extension, signed in |
| **Anthropic API (key)** | Tokens, billed to the API key | Nothing — only the key |

A subscription has no public API: it is used only through the vendor's own client, with the
login made there. VERTEX runs the copy of the CLI that ships inside that VS Code extension, so
without the extension a subscription provider does not work — VERTEX says which extension is
missing. It never reads or reuses the client's login token. The Anthropic API calls
`api.anthropic.com` directly; the key is asked for when that provider is first chosen and is
kept only in VS Code SecretStorage.

The panel shows the short name — Claude, ChatGPT, Anthropic API. Changing the provider there
switches at once and clears the chosen model (`vertex.ai.provider`, `vertex.ai.model`).

### Which models are offered

**LLM Providers** shows every provider at once as a tree: the provider with its own checkbox and
an **In use** switch, its models underneath with a checkbox each. Only the ticked models appear in
the model lists, and with no model chosen the weakest ticked one is used. A provider switched off
keeps its model ticks but is left out of every provider choice; the one in use cannot be switched
off - choose another first. Save refuses a provider with no model ticked, and resets a chosen
model that is no longer offered. The choice is kept in `vertex.ai.modelConfig`.

- **Claude subscription** lists Claude versions by full id (`claude-opus-5`, `claude-sonnet-4-6`,
  ...). Claude Code reports no list of its own, so this list is VERTEX's, in `assistant.js`
  (`CLAUDE_VERSIONS`), and is updated when a new model comes out. The newest of each family is
  ticked by default. **Check and add** takes any other id and keeps it only after Claude Code has
  answered one short request with it.
- **ChatGPT subscription** lists the catalog Codex reports. A model named in
  `~/.codex/config.toml` is offered too, because VERTEX runs Codex without that file.
- **Anthropic API** lists what `GET /v1/models` returns for the key.

### Several systems

The panel's chat can reach every system in `vertex.systems`. Name one in the question — *copy
ZCL_FOO from E19 to QAS* — and the SAP tools run against it; without a name they use the system
chosen in the panel. A copy is a read in one system and a change in the other: it goes into the
target system's tab, unsaved, and nothing is written until you save it there. A new object has
no tab yet: it opens as a draft in the **Code Change** reviewer, with the target system in its
title.

A **VERTEX Tools** window keeps the system that was active when it opened, and its tab is named
after it — *VERTEX E19*. Everything started from the window, its **Ask AI** chat included, works
against that system; choosing another system in the panel affects only windows opened later. The
window's chat uses the panel's provider and model.

In both the Activity Bar panel and the Tools chat, **Enter** sends a question and
**Ctrl+Enter** inserts a new line.

Ask in any language, for example *show ZCL_TR_TEXT_DATA*, *explain this method*
or *add a check for an empty table here*. The chat searches and reads SAP
source itself and opens the object in an editable tab on the right. Follow-up
requests about "this code" use the active SAP editor tab as context. The chat
never writes to SAP on its own: a change it makes goes into the object's tab, unsaved, and you
save it with **Save & Activate** or **Review & Activate** - or undo it with Ctrl+Z. If the tab
already holds edits that SAP does not have, the chat's change is refused rather than written over
them: save or undo yours first.

## Code reviewer

Edit SAP source in a VERTEX editor tab, then choose **Review & Activate** in the
editor title or context menu (or ask the chat to save your edits). The
**Code Change** panel shows the edits against the current SAP source, cut into
blocks with context lines:

- **Approve** / **Decline** each block, or approve all;
- **ASK AI** sends one block to the chat with its method, line number and
  surrounding lines, and asks for a short explanation and real problems only;
- **Save & Activate** writes only the approved blocks. SAP locks the object,
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

## Review transports with Copilot, Claude Code or Codex

VERTEX serves two read-only MCP tools. `sap_transport_changes` lists what a
transport request changed; `sap_transport_diff` gives the changes of one object,
cut into the blocks of the saved review, with the verdicts and comments
already given. They cannot build a review or approve a block, and a request
that has none built yet is reported as such, not as a clean transport.

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
- **Claude Code**: run **VERTEX: Copy the MCP address for Claude Code or Codex**,
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

An assistant can run the ABAP debugger by itself: set breakpoints, start the program,
look at what the program held where it stopped, decide where to look next, and end with a
verdict that names the line and the values that prove it. You describe the problem; you do
not step through the code.

> *Z_CALC computes the wrong discount. Find out why with the debugger.*

The debugger sets breakpoints and holds a listener. It never changes a variable, never jumps
over code and never writes source or data.

### Before you start

- **VERTEX for VS Code 0.7.3 or newer**, with the SAP system in `vertex.systems`.
- **Nothing on the ABAP side.** The debugger uses only SAP's standard ADT services; the VERTEX
  classes (`src/`, pulled with abapGit) are not needed for it. They are needed only for the
  example program `Z_VX_DEBUGGER_TEST` and for the other VERTEX windows.
- **In SAP**, for your user: the authorisation to debug (the standard object `S_DEVELOP` with
  object type `DEBUG`), and the WebGUI service active in SICF
  (`/sap/bc/gui/sap/its/webgui`) - the debugger starts reports there.
- **For the VERTEX chat**: a provider set up in **LLM Providers**. For Claude Code or Codex:
  the client installed and signed in.
- **A strong model.** Debugging is a loop of many steps - set, run, wait, read, decide - and a
  small model gives up early or "fixes" the wrong line. In the pilot Claude Haiku once answered
  from reading the code instead of debugging, and once proposed a fix that did not fix anything;
  Claude Opus found the cause with the values that prove it, and the right fix.

### Quick start

1. Install VERTEX 0.7.3 or newer and reload the window.
2. Choose the system in the panel's **SAP system** list (or **VERTEX: Switch System**) and
   enter the password once.
3. Close any other debugger for your SAP user - an Eclipse debug session, ABAP FS - or tell the
   assistant it may take over.
4. For Claude Code or Codex only: register `vertex-debug` once, as described below, and start a
   new conversation.
5. Ask: *Z_VX_DEBUGGER_TEST prints the wrong invoice total. Find out why with the debugger.*
6. When the browser opens WebGUI, log on if asked. The assistant waits for the program.
7. Read the verdict. Ask it to fix the code if you agree: the change lands in the program's
   tab, unsaved; save it with **Save & Activate** or **Review & Activate**.

### Where it runs

| Assistant | How it gets the debugger | Setup |
|---|---|---|
| The **VERTEX chat** in the panel | on its own `/chat` address, beside the source tools | none |
| **Claude Code** or **Codex** | a second MCP server of the extension, `/debug`, registered as `vertex-debug` | once, below |

The debugger runs on the **active** system - the one chosen with **VERTEX: Switch System** or in
the panel's system list - with the password VS Code keeps. Naming another system in a chat
question does not move the debugger there; switch first. Switching while breakpoints or a
stopped program are still on the old system is refused until `debug_stop` has removed them.
A VS Code window with VERTEX has to stay open while it works.
The standalone MCP server in `mcp/server.js` does not have it.

**Claude Code or Codex**: run **VERTEX: Copy the MCP address for Claude Code or Codex** and
choose **Claude Code - debugger** or **Codex - debugger**.

- Claude Code: paste the copied command into a terminal and run it. `claude mcp list` then
  shows `vertex-debug: http://127.0.0.1:37777/debug (HTTP) - Connected`. Start a **new**
  conversation - one already open does not see a server added after it began.
- Codex: paste the copied `[mcp_servers.vertex-debug]` section into `~/.codex/config.toml`,
  restart the Codex extension and start a new conversation.

`vertex-debug` sits beside the review's `vertex`; neither changes the other.

### How a run is caught

1. The assistant sets breakpoints. Setting the first one starts a **listener** for your SAP
   user - without a listener, SAP lets every breakpoint pass.
2. It starts the program with `debug_run`: WebGUI opens in your browser on
   `…/sap/bc/gui/sap/its/webgui` and runs the report at once. Log on there if the browser
   asks.
3. The program reaches a breakpoint, the listener catches it, and the assistant reads the stop.

**Runs from the standalone SAP GUI are never caught.** SAP does not apply ADT breakpoints to a
session opened through SAP Logon - not for VERTEX, not for Eclipse, not for any ADT client
([SAP's documentation](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/breakpoints-characteristics)).
They do apply to WebGUI, to the SAP GUI embedded in Eclipse, and to any HTTP or RFC request
made under your user. A class or a function module is started by you, through whatever calls
it over HTTP or RFC; the assistant asks.

WebGUI opens at the system's `url`. Two things can get in the way:

- **A certificate that names a host.** Use the host name the server's certificate names (for
  example `https://s4.example.com:44300` rather than an IP address), or the browser warns.
- **A redirect to a host this computer does not know.** Many systems send WebGUI from their HTTP
  port to HTTPS on their own full host name - `https://sap-host.corp.example:44300/...` - and the
  browser answers "cannot find the server". Two ways round it:
  - Give the system a **`webgui`** address that works from here, and the debugger opens WebGUI
    there directly:
    ```json
    { "name": "DEV", "url": "http://10.0.0.5:8000", "webgui": "https://10.0.0.5:44300",
      "client": "100", "user": "DEVELOPER" }
    ```
  - Or teach this computer the name: one line in `C:\Windows\System32\drivers\etc\hosts`
    (administrator rights needed), with the address and the name from the failed redirect:
    `10.0.0.5  sap-host.corp.example`. Then the redirect works as it is.

**One debugger per user.** SAP gives each stop to one listener. If Eclipse or ABAP FS is
already debugging for your user, the assistant is told so and does not take over unless you
agree - otherwise the other debugger would silently lose its stops. Close the other debug
session, or tell the assistant it may take over.

### If it does not work

| What you see | Why | What to do |
|---|---|---|
| The browser says it cannot find the server | SAP redirected WebGUI to a host name this computer does not resolve | Give the system a `webgui` address, or add the name to `hosts` - see above |
| The browser warns about the certificate | WebGUI opened at an IP address or another name than the certificate's | Use the certificate's host name in `url` or `webgui` |
| The program ran and nothing stopped | It was started from SAP Logon; or another debugger took the stop; or it started after the assistant gave up waiting | Start it through `debug_run` (WebGUI); close the other debugger; ask the assistant to wait again |
| *SAP did not accept the breakpoint* | The line holds no executable statement, or the object is not active | Pick an executable line; activate the object |
| *Another debugger already listens for …* | Eclipse or ABAP FS debugs for the same user | Close it, or let the assistant take over |
| *Debugging is still going on …* | The system was switched while breakpoints were set on the old one | Ask for `debug_stop`, then start again |
| A verdict that does not match what the program does | A small model guessed | Ask again with a stronger model, and ask what the debugger showed |

### Breakpoints: conditions and modes

A breakpoint goes on a line of a program (`PROG`), an include (`INCL`) or a class (`CLAS`,
counted in its main source, as the VERTEX class tab shows it). The assistant cannot yet set one
in a function module; [Visual Debug](#visual-debug-the-debugger-on-screen-pilot) can. The line
has to hold an executable statement; SAP refuses anything else, and the refusal is reported.

A **condition** is checked by SAP each time the line is reached; the program stops only when
it is true, so a thousand passes cost nothing. It is written like the condition of an ABAP `IF`
([syntax](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/syntax-for-breakpoint-conditions)):

| Condition | Stops |
|---|---|
| `lv_total > 1000` | once the total passes 1000 |
| `ls_order-customer = 'CUST_B'` | on that customer's rows |
| `sy-tabix = 3` | on the third pass of a loop |
| `LINES( lt_items ) > 0` | once the table has rows |
| `sy-subrc <> 0` | after a failed call |
| `oref IS BOUND AND oref->attr = 'X'` | the second part is checked only if the first holds |

The built-in functions are `LINES( )`, `STRLEN( )`, `XSTRLEN( )` and `INEXACT_DF( )`, with a
blank inside each bracket. At most 255 characters. A name that does not exist is found only
when the line runs: the program then stops there with SAP's message, rather than passing.

Each breakpoint has a **mode**:

- **stop** (default) hands the stop to the assistant, which reads, steps and continues.
- **log** records the variables that changed and lets the program run on at once - a
  watchpoint. A loop of a hundred passes costs the assistant no turn; it reads the record
  afterwards.

Setting the same line again replaces its condition and mode.

### What a stop shows

- where the program stands and the top of the stack;
- five source lines around the statement;
- the variables that changed since the previous stop - all of them at the first stop;
- for a table that changed, its row count and first five rows.

That is deliberately little. Everything else is read on purpose with `debug_read`: a field, a
structure's fields, or rows *from*..*to* of a table (up to 200 at once), by name as ABAP writes
it - `LS_ORDER`, `GS_INVOICE-ITEMS`, `ME->MV_RATE`.

### Visual Debug: the debugger on screen (pilot)

**Visual Debug** in the Tools window (programs, classes and function modules) shows the same
debugger the assistant drives - one session, not a second one:

- **The source with its breakpoints.** A click beside a line number sets or removes a
  breakpoint; a right-click sets a condition and the mode (*stop* or *log*). The lines are those
  of the active version, which is what the program runs. Breakpoints the assistant set appear
  here, and those set here are the assistant's too.
- **Where the program stands.** At a stop the current line is marked and the source follows it,
  also into another include; **Object source** goes back. **Single Step** (F5), **Execute** (F6),
  **Return** (F7) and **Continue** (F8) step, named and drawn as in the classic debugger; a click on a stack level shows that level and its
  variables.
- **Every variable at once**, grouped as SAP groups them; parameters and locals are headed by
  the form, method or event they belong to. Structures and objects unfold in place (object
  attributes marked public, protected or private); **Initials** shows the variables with an
  initial value and **SYST** the system fields `SY`, both hidden by default; **Filter** narrows
  by name. A value that changed since the previous stop is marked. A type SAP names only
  `\TYPE=%_T...` is shown as the source declares it - `p LENGTH 8 DECIMALS 2` - or, with no
  declaration, as SAP's technical type.
- **What is read, and when.** **Globals**, **Locals** and **Params** switch a group's reading
  on or off: a group switched off is not asked of SAP at all. ADT does not say what a step
  changed, so after a step over a plain statement only the variables it names are read again
  (the header says which); after a call, a step out of the routine or a Continue, every group
  switched on is read.
- **Visual.** With **Visual** on, Continue (F8) runs as a string of F5 steps: the current line
  moves through the source as the program goes, no variable is read on the way, and it stops at a
  stop breakpoint, on **Pause**, or when the programs it began in are no longer on the stack -
  the program is over and F5 would go on into SAP's own code. SAP's answer to a step does not
  say where the program now is, so each step asks for the stack - except from one plain statement
  to the next plain one in a program or include, where the next line is known from ACE's
  statement map (`/vertex/flow/<program>?mode=statements`, read once per program). A plain
  `PERFORM` is predicted too - into its FORM's first statement, with a frame added to the stack,
  and from `ENDFORM` back to the statement after the call. Such a stack is marked predicted: its
  levels can be chosen once SAP is asked, which happens when the run stops. A standalone call of
  a local method - `lcl=>m( )`, `me->m( )`, `m( )`, `CALL METHOD m` - is predicted the same way,
  unless a local class inherits from that class (the method may be redefined) or it has a class
  constructor. A loop is not stepped through: at `LOOP`, `DO` or `WHILE` the run sets a point on
  the statement after the loop's end and runs to it with F8, then goes on step by step; a
  breakpoint of yours inside the loop stops it there, as F8 would. With **Z only** on (the
  default), a step that goes from Z/Y code into SAP's own is followed by F7 at once: the call runs
  to its end and the run goes on in your code - as F6 on that call, Z code called from inside it
  (a BAdI, an exit) passed with it. Where the map can tell beforehand that every call of a
  statement goes outside Z/Y code - `CALL FUNCTION 'BAPI_...'`, `cl_gui_x=>m( )`, `NEW cl_x( )`, a
  builtin - the run steps over it with F6 and takes the next statement without asking SAP. The map is used on a source
  only where it lines up with it - each statement starting on its line with its keyword - so a
  global class's method include is predicted too; a call into a global class, a branch or a call
  through another reference still asks SAP. When the stack is asked after a
  plain statement and the program is not where the map said - an exception raised inside `TRY` -
  the window says so and counts it as *mispredicted*. The statistics show the steps, how many
  were predicted, the time per step, and SAP's step and stack requests apart. Beside it: the steps, the time, and the time per
  step - of the whole step and of SAP's step request alone. The variables are read once, when it
  stops. A log breakpoint met on the way is still recorded.
- **Flow.** With **Flow** on, Continue (F8) runs from call to call and records which routine
  calls which - the program's real flow. In a routine it sets points on every call that may
  enter Z/Y code and on the routine's end and runs to the first reached, whatever branch the
  program takes; at a call it goes in (F5), a call outside Z/Y is stepped over (F6) and a step
  that lands outside Z/Y goes back out (F7); a routine with nothing to call is left at once. With
  **Visual** on as well, the window draws where the program is at each change of the stack only.
  When the run stops, **Diagram** shows the flow as a Mermaid chart: **Classes** (classes and
  programs, with the number of calls between them) or **Methods** (every routine, grouped by
  its class) - kept across Continue until the program ends or Detach or Exit program is pressed -
  zoomed with −, +, Fit or Ctrl + wheel, and shown on the whole window with ⤢ (Esc
  goes back). SAP's own code appears as one node for what was called. The chart runs top-down,
  the caller above its callees; SAP standard is dashed grey, and the number on an arrow is how
  many times that call was made. The chart sits in the right column under Variables; with Visual
  on it is redrawn during the run, each time the stack changes. The block running now is filled
  green, dark green once it has been called more than once; the mark moves on the drawn chart,
  which is drawn again only when a new block or arrow appears. SAP standard is dashed blue.
  In **Methods** each routine is one block, class above and method below, coloured by its class
  with no frame around a class, so the levels follow the stack depth.
  ⏮ ◀ ▶ ⏭ and a slider move through the recorded stops and ⏵ replays them: the source line and the green block
  move together with the Stack as it was at that stop (marked recorded), from the record alone,
  at 1, 2, 3, 5 or 10 stops a second or as fast as the window draws (max), with the
  milliseconds each stop took on screen (kept after the replay). Flow and Rec read a routine's
  Parameters and Locals where it starts and where it ends; the player shows them in Variables,
  and at the stops between, the values last read in that routine.
  A click on a block moves the player to the next time the run entered that routine, its source
  shown here; a SAP standard block the run stepped over shows its source (class, function module
  or program). **Stack** is a table as in SAP's debugger: depth number, event type, event,
  program, include and line, the deepest level on top. The frames below the object - SE37's or
  SE24's test frame, the screen - are folded into one line, and are not on the chart; a function
  module's block carries its name.
- **Rec.** Beside Visual. While it is on, every stop goes into the record, whoever made it:
  F5-F8 in this window, the assistant's steps, a breakpoint - and into the step log, with the key
  and the time of a step made here. Continue (F8) then takes the same F5
  steps as Visual but draws nothing until the run ends. The player replays the record statement by
  statement. Each drawing fits the pane, never above 100 %, until the zoom is set
  by hand with −, + or Ctrl + wheel; Fit returns to fitting.
- **Sections.** The right column holds Stack, Breakpoints, Variables, Diagram and Log. Each is
  shown or hidden by its switch at the top of the column, and the line between two visible
  sections drags to resize them. Diagram opens by itself when a run has recorded something.
- **Log.** A section of its own; it lists every step of the Visual and Flow runs:
  what was done (F5, F6, F7, F8 and to which points, predicted or not), from where, to where, and
  how long it took, SAP's share apart. A filter narrows it, **Copy** takes it as text. It is kept
  like the flow, the last 5000 steps. A line under the buttons says, at each step, what the run
  knew and decided - the map, the statement, the step.
- **Values in the source.** At a stop, the mouse on a name in the source shows its value - a
  field, a component such as `ls_new-price`, a structure's fields, or a table's row count and
  first rows.
- **Tables in grids.** A click on a table opens its rows below the source, a hundred at a time,
  in a tab of its own - as many tables as you like, read again at every stop.
- **Run in SAP** (first in the header, with the SAP execute clock) starts the program in WebGUI, as `debug_run` does. A program runs itself. For a class
  or a function module, name the program that calls it in the field - or leave it empty for the
  object's test screen, SE24 or SE37 with the name filled in, and start the test there with F8.
- **Detach** lets the program go and stops listening, but keeps the breakpoints in the list:
  **Run in SAP** sets them in SAP again and listens before it starts the next run.
- **Exit program** ends the stopped program where it stands, as the debugger's Exit does; the
  breakpoints stay and the next run is caught again.
- A breakpoint can be switched off without losing it: Ctrl+click on its dot, **Deactivate** in its
  right-click box, its checkbox in Breakpoints, or **Deactivate all**. It keeps its line,
  condition and mode, shows as a grey ring, and is not in SAP until it is activated again.
- **Clear all**, in the Breakpoints bar, removes every breakpoint - the assistant's as well, since
  they are the same. The assistant's `debug_stop` still lets go and removes them all at once.

Because the session is shared, a step or `debug_stop` by the assistant moves this window too, and the
other way round. The assistant still finds each stop through `debug_wait`, whoever stepped. Like
the assistant, the window never changes a variable or the code.

This is a pilot: Smart Debugger's history (stepping back), coverage and diagrams are not part of
it. Visual Debug exists in VS Code only; Eclipse has its own debugger.

### The tools

| Tool | Does |
|---|---|
| `debug_set_breakpoint` | object type, name, line, optional condition, mode `stop` or `log`; starts the listener |
| `debug_clear_breakpoints` | removes one breakpoint by id, or all |
| `debug_run` | opens a report in WebGUI in your browser |
| `debug_wait` | waits up to 280 s (60 by default) for a stop or the end of the run; returns the stop, what log breakpoints recorded, and runs that ended |
| `debug_read` | reads one variable at the current stop |
| `debug_step` | `over`, `into`, `out`, or `continue` to the next stop breakpoint |
| `debug_status` | system, listener, current stop, breakpoints with ids, and what the answers have cost |
| `debug_log` | everything log breakpoints recorded in this session |
| `debug_stop` | lets a stopped program run on, stops listening, removes every breakpoint |

Closing the VS Code window does what `debug_stop` does, so no breakpoint and no listener is
left behind on SAP.

### What it costs

Every tool answer stays in the assistant's context for the rest of the conversation, so the
answers are kept short: changes rather than the whole state, tables as a count and a few rows,
one answer cut at 60,000 characters with a note saying so. A condition instead of stepping is
the largest saving: on Z_CALC, two conditional stops took a dozen SAP requests and under a
second, where stepping through every line took 451 requests and 26 seconds. `debug_status`
reports how many characters the debugger has returned so far, and about how many tokens that
is; the assistant's own total is shown by the assistant (in the VERTEX chat, under each
answer).

A chat request that may use SAP tools waits up to ten minutes for its answer, so that a
debugging run has time for a WebGUI logon and the program's way to its breakpoints.

### A program to try it on

The ABAP side ships `Z_VX_DEBUGGER_TEST`: an invoice of four order lines that should total
940.00 and prints less. It is one screen long, raises no error, and no single line of it looks
wrong - the cause shows at runtime, in what a statement did not do. Pull `src/` with abapGit, then
ask: *Z_VX_DEBUGGER_TEST prints the wrong invoice total. Find out why with the debugger.*

### A session, as it goes

1. You: *Z_CALC computes the wrong discount. Find out why with the debugger.*
2. The assistant reads Z_CALC, sets a log breakpoint in the loop and a stop breakpoint with a
   condition where the discount is computed, and calls `debug_run`.
3. You log on in the browser if asked; the report runs.
4. `debug_wait` brings back the logged passes and the stop: the running total goes 600, 900,
   1600 while the customer changes from CUST_A to CUST_B.
5. The assistant reads what it needs, calls `debug_stop`, and answers: the total is never reset
   when the customer changes (the line), so CUST_B's discount is computed from 1600 instead
   of 700 (the values).

## Set up SelecTor or Versions with a sentence

**Assistant** in SelecTor's bar opens a chat. It uses the provider and model chosen in the VERTEX
panel; write what to show, for example *SFLIGHT for carrier AA, joined with SCARR*.

The assistant reads only the table's layout — fields, keys, texts, the tables the dictionary
offers to join — and no row of any table. It answers with the state SelecTor is to be put in;
the extension checks it against the dictionary, and the window fills in the selection panel, the
join and the pivot and runs the query as if it had been clicked. A plan naming something the
table does not have is shown as an error and changes nothing.

Versions has the same **Assistant**: *the last change of COMPUTE_DIFF in ZCL_VX_DIFF*, *the
review of DEVK900123, the COMPUTE_DIFF part*, *describe the method GET*. It reads what the window
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

- *the last change of COMPUTE_DIFF in ZCL_VX_DIFF*
- *versions of program Z_ANY_PROG*
- *what does transport DEVK900123 change?*
- *the review of DEVK900123, the COMPUTE_DIFF part*
- *describe the method GET*, with its review open
- *review the change of ZCL_VX_ADT_RES_VERSIONS=>GET: risks and open questions*

A subscription provider needs the Claude Code or Codex extension installed in this VS Code:
VERTEX starts the copy that comes with it, with your login, in an empty folder, with no other MCP
server and no shell. See [Providers](#providers).

## What it writes

Everything reads, with one exception: approving, declining and commenting in a
code review writes to `ZAVE_REVIEW`, through this repository's own `ZCL_VX_REVIEW_*`.
A review is built by the Versions window; this reads it and adds verdicts to it.

## Acknowledgements

The VS Code extension talks to SAP ADT through
[abap-adt-api](https://github.com/marcellourbani/abap-adt-api) by Marcello Urbani (MIT): reading
and writing source, activation, the debugger, ABAP Unit, ATC, where-used, keyword documentation. It travels inside the VSIX with its
licence, as do the other npm packages it depends on (MIT, Apache-2.0, BSD-3-Clause), each in its
own folder. The Eclipse plugin does not use it: it works through the platform and ADT only.

## Licence

MIT. See [the project](https://github.com/ysichov/VERTEX).
