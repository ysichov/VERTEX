# SAP ABAP VERTEX Tools

**VERTEX** is the ABAP Version, Code and Data Explorer: one front end over three
SAP GUI tools, in VS Code and in Eclipse ADT, from the same pages. In VS Code it
also serves transport reviews to Copilot, Claude Code and Codex over MCP, and
puts an assistant into SelecTor and Versions.

| Window | What it shows |
|---|---|
| **SelecTor** | A table, its selection panel, the join builder and the pivot cross — set up by hand or from a sentence |
| **Metrics** | ACE's view of a program, class or function group: the flow of a program, the branch scheme of one method, and per-unit code metrics |
| **Versions** | The version history of an object, the diff between two versions, and the saved code review of a transport request — opened by hand or from a sentence |

## It needs an ABAP backend

This extension is one half of VERTEX. The other half is a set of ADT resources
that have to be installed on the SAP system, and the tools they read:

| Repository | What it is for |
|---|---|
| [Simple-Data-Explorer](https://github.com/ysichov/Simple-Data-Explorer) | The ADT resources every VERTEX window reads |
| [AVE](https://github.com/ysichov/AVE) | The version history, the diff and the review |
| [ACE](https://github.com/ysichov/ACE) | The flow, the branch schemes and the metrics |

Pull each with [abapGit](https://abapgit.org) and activate it, then register the
BAdI implementation `ZSDE_ADT_RES_APP` on `BADI_ADT_REST_RFC_APPLICATION` with
the filter `STATIC_URI_PATH` covering `/sap/bc/adt/zsde/*`.

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

- **VERTEX: Open SelecTor**
- **VERTEX: Open Metrics**
- **VERTEX: Open Versions**
- **VERTEX: Switch System**
- **VERTEX: Forget Password**
- **VERTEX: Copy the MCP address for Claude Code or Codex**

## Where MCP comes in

| Who | Uses MCP | Setup |
|---|---|---|
| The SelecTor, Versions and Metrics windows, used by hand | No: they read SAP directly over ADT | — |
| The **Assistant** panels in SelecTor and Versions | Yes, internally | None: for each request the extension hands Claude Code or Codex the window's own MCP address, `/selector` or `/versions` |
| External assistants: Copilot, the Claude Code and Codex chats, Claude Desktop | Yes | Copilot finds the server by itself; Claude Code and Codex are connected with **VERTEX: Copy the MCP address for Claude Code or Codex**, or through the [standalone `mcp/server.js`](https://github.com/ysichov/VERTEX/blob/main/mcp/README.md) |

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
| Claude Code or Codex with VS Code closed, the Claude Desktop chat, any stdio client | [`mcp/server.js`](https://github.com/ysichov/VERTEX/blob/main/mcp/README.md) | [its README](https://github.com/ysichov/VERTEX/blob/main/mcp/README.md) |

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
