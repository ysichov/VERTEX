# SAP ABAP VERTEX Tools

**VERTEX** is the ABAP Version, Code and Data Explorer: one front end over three
SAP GUI tools, in VS Code and in Eclipse ADT, from the same pages. In VS Code it
also has an ABAP chat and a block-by-block code reviewer with Save & Activate,
serves transport reviews to Copilot, Claude Code and Codex over MCP, and puts an
assistant into SelecTor and Versions.

| Window | What it shows |
|---|---|
| **SelecTor** | A table, its selection panel, the join builder and the pivot cross — set up by hand or from a sentence |
| **Metrics** | ACE's view of a program, class or function group: the flow of a program, the branch scheme of one method, and per-unit code metrics |
| **Versions** | The version history of an object, the diff between two versions, and the saved code review of a transport request — opened by hand or from a sentence. A request is found by its number or among the requests of a user, yours by default |

## It needs an ABAP backend

## VS Code prerequisite

[SAP ABAP Development Tools](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode)
is recommended for the ABAP editor, navigation and standard ADT commands. It
is optional: VERTEX can connect to SAP through ADT HTTP by itself and opens
source in a normal VS Code text editor when SAP ADT is not installed.

This extension is one half of VERTEX. The other half is a set of ADT resources
that have to be installed on the SAP system, and the tools they read:

| Repository | What it is for |
|---|---|
| this repository, `src/` | The ADT resources every VERTEX window reads, and the flow, schemes and metrics |
| [Simple-Data-Explorer](https://github.com/ysichov/Simple-Data-Explorer) | The table reader, the join and the pivot |
| [AVE](https://github.com/ysichov/AVE) | The version history, the diff and the review |

Pull each with [abapGit](https://abapgit.org) and activate it, then register the
BAdI implementation `ZVX_ADT_RES_APP` on `BADI_ADT_REST_RFC_APPLICATION` with
the filter `STATIC_URI_PATH` covering `/sap/bc/adt/vertex/*`.

Until that is done, every window opens on a page saying so, with these links on
it. Nothing is broken; the backend has simply never been put there.

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

- **VERTEX: Search SAP Code** — manual fallback to find programs, global classes and function modules
  by exact name or wildcard; select a match to open active ABAP source.
- **VERTEX: Read SAP Code** — open one exact PROG, CLAS or FUNC object.
- **VERTEX: Read Class Include** — open local definitions, implementations, macros
  or test classes separately from the class's main source.
- **VERTEX: Edit SAP Code Draft** — turn the opened SAP source into an editable
  draft with a before/after diff. No SAP write happens yet.
- **VERTEX: Create SAP Object Draft** — prepare a program/class in an existing
  package or a function module in an existing function group.
- **VERTEX: Apply SAP Code Draft** — review the diff, supply a transport where
  needed and confirm the target system. SAP locks the object, checks syntax,
  saves, activates and verifies the active source. Changed active/inactive
  source is rejected before overwrite. Drafts stay bound to the system/user
  they were read from even when the active system changes.
- **VERTEX: Discard SAP Code Draft** — discard a pending change without writing SAP.

These source operations use standard SAP ADT directly through the pinned
`abap-adt-api` client. They require ADT access and SAP development/transport
authorizations; they do not require MCP or the ABAP-AI-Code/abapGit saver.
Function module source is supported; parameter interface/RFC metadata and
creation of function groups are not part of this release. Existing metadata
is preserved. New FMs begin with an empty parameter interface.

Drafts are held for the current extension session. They are not saved to SAP
by Ctrl+S. Use Apply SAP Code Draft. If a create/write request or activation
fails, inspect SAP: a newly created shell or inactive source may remain.
Such uncertain writes are not automatically retried or deleted.

The extension API exposes `sapCode.schemas`, `sapCode.instructions`, `sapCode.onEvent` and
`sapCode.execute(tool, arguments)`. Its JSON tools are `search_sap_objects`,
`read_sap_object`, `create_sap_object` and `modify_sap_object`; the chat adds
`open_sap_object` and `review_sap_changes`. Create/modify return a change ID and
open a draft; applying it is always a separate user action. Prompts live in
`prompts/tools/sap-code.md`, schemas in `schemas/sap-code-tools.json`.

- **VERTEX: Open Panel** — also available from the VERTEX icon in the Activity Bar.
  The panel holds the VERTEX chat, the active SAP system with system
  selection/settings, and quick-launch buttons for SelecTor, Metrics and Versions.

## VERTEX chat

The **VERTEX** panel in the Activity Bar has a free-prompt chat over the active
SAP system. Pick **Claude subscription** or **Codex subscription** and a model
above the conversation (`vertex.ai.provider`, `vertex.ai.model`); it runs the
Claude Code or Codex extension installed in this VS Code, with your login. Your
questions and VERTEX's answers are shown in different colours.

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

**Save & Activate** in the editor title saves the whole tab without the block
review. Ctrl+S saves the local copy only, never SAP.
- **VERTEX: Open SelecTor**
- **VERTEX: Open Metrics**
- **VERTEX: Open Versions**
- **VERTEX: Switch System**
- **VERTEX: Forget Password**
- **VERTEX: Copy the MCP address for Claude Code or Codex**

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
cut into the blocks of the review AVE saved, with the verdicts and comments
already given. They cannot prepare a review or approve a block, and a request
whose review has not been prepared in AVE is reported as such, not as a clean
transport.

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

**Assistant** in SelecTor's bar opens a chat. Choose Claude Code or Codex and one of the models
it offers, then write what to show, for example *SFLIGHT for carrier AA, joined with SCARR*.

The assistant reads only the table's layout — fields, keys, texts, the tables the dictionary
offers to join — and no row of any table. It answers with the state SelecTor is to be put in;
the extension checks it against the dictionary, and the window fills in the selection panel, the
join and the pivot and runs the query as if it had been clicked. A plan naming something the
table does not have is shown as an error and changes nothing.

Versions has the same **Assistant**: *the last change of BUILD_LAYOUT in ZCL_AVE_POPUP*, *the
review of DEVK900123, the BUILD_LAYOUT part*, *describe the method GET*. It reads what the window
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

- *the last change of BUILD_LAYOUT in ZCL_AVE_POPUP*
- *versions of program Z_AVE*
- *what does transport DEVK900123 change?*
- *the review of DEVK900123, the BUILD_LAYOUT part*
- *describe the method GET*, with its review open
- *review the change of ZCL_SDE_ADT_RES_VERSIONS=>GET: risks and open questions*

It needs the Claude Code or Codex extension installed in this VS Code: VERTEX starts the copy
that comes with it, with your login, in an empty folder, with no other MCP server and no shell.

## What it writes

Everything reads, with one exception: approving, declining and commenting in a
code review writes to `ZAVE_REVIEW` through AVE's own code. A review is prepared
in AVE; this reads it and adds verdicts to it.

## Licence

MIT. See [the project](https://github.com/ysichov/VERTEX).
