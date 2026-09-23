# SAP ABAP VERTEX Tools

[**VERTEX**](https://github.com/ysichov/VERTEX) is a set of ABAP tools that used to live in the SAP GUI, migrated to
VS Code and Eclipse ADT as one front end, plus AI integrations: an MCP chat and more.

| Window | Grew out of | What it shows |
|---|---|---|
| **SelecTor** | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | A table, its selection panel, the join builder and the pivot cross — set up by hand or from a sentence |
| **Metrics** | [ACE](https://github.com/ysichov/ACE) | The flow of a program, the branch scheme of one method, and per-unit code metrics |
| **Versions/Reviewer** | [AVE](https://github.com/ysichov/AVE), [ABAP-AI-Code](https://github.com/ysichov/ABAP-AI-Code) | Version history, diffs, block-by-block review with comments, and an AI assistant |

Those three programs are where the logic was written, and they are not developed
further. It has been carried across as `ZCL_VX_*`, with the SAP GUI stripped off,
and everything new happens on this side.

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
  enter its name, then choose the available function (for example Data, View,
  UML, Metrics, Flow, Scheme, Diff or Versions). The available functions depend
  on the selected object type; there are no separate SelecTor, Metrics or
  Versions commands any more.

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
- **VERTEX: Copy the MCP address for Claude Code or Codex**
- **VERTEX: Review & Activate** — editor title or context menu; opens the block-by-block
  Code Change panel described below.
- **VERTEX: Save & Activate** — editor title; saves the whole tab without the block review.
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
its Parts list only positions the complete source on an event, form or local-class implementation.

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

**LLM Providers** opens a table per provider with a checkbox for each model; only the ticked ones
appear in the model lists, and with no model chosen the weakest ticked one is used. Save refuses a
table with nothing ticked. Saving also makes that provider the active one, and resets a chosen
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
chosen in the panel. A copy is a read in one system and a draft in the other: the draft opens in
the **Code Change** reviewer with the target system in its title, and nothing is written until
it is approved there.

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
never writes to SAP on its own: a change it proposes arrives as a draft diff.

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

## Licence

MIT. See [the project](https://github.com/ysichov/VERTEX).
