# ABAP VERTEX Tools

**VERTEX** is the ABAP Version, Code and Data Explorer: one front end over three
SAP GUI tools, in VS Code and in Eclipse ADT, from the same pages.

| Window | What it shows |
|---|---|
| **SelecTor** | A table, its selection panel, the join builder and the pivot cross |
| **Metrics** | Per-unit code metrics of a class, program or function group |
| **Versions** | The version history of an object, the diff between two versions, and the saved code review of a transport request |

## It needs an ABAP backend

This extension is one half of VERTEX. The other half is a set of ADT resources
that have to be installed on the SAP system, and the tools they read:

| Repository | What it is for |
|---|---|
| [Simple-Data-Explorer](https://github.com/ysichov/Simple-Data-Explorer) | The ADT resources every VERTEX window reads |
| [AVE](https://github.com/ysichov/AVE) | The version history, the diff and the review |
| [ACE](https://github.com/ysichov/ACE) | The metrics |

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

## Review transports with Codex, Claude Code or Copilot

To work with VS Code closed, use the [standalone stdio server](../mcp/README.md).
The instructions below describe the alternative server hosted by this extension.

VERTEX exposes `sap_transport_changes` and `sap_transport_diff` through a local,
authenticated MCP server. These tools read the review already prepared in AVE.
They cannot prepare a review or approve blocks. An unprepared review is reported
explicitly, rather than treated as an unchanged transport.

The server starts when VS Code starts. `vertex.mcp.port` defaults to `37777` and
the token persists in VS Code SecretStorage. Keep the VERTEX window open and
select the intended SAP system with **VERTEX: Switch System**.

For the **Codex VS Code extension**, run **VERTEX: Copy the MCP address for
Claude Code or Codex**, choose **Codex**, and paste the copied TOML section into
your user `~/.codex/config.toml` (`%USERPROFILE%\.codex\config.toml` on Windows).
Replace the existing `[mcp_servers.vertex]` section if present; do not duplicate
it. The copied configuration includes the local server token, so keep it out of
version control. Restart the Codex extension and start a new conversation.
This uses Codex's supported [HTTP MCP configuration](https://developers.openai.com/codex/mcp/).

For **Claude Code**, choose **Claude Code** in the same command and run the
copied command in a terminal. If registered previously, first run
`claude mcp remove vertex --scope user`. Check `claude mcp list` and start a new
conversation. Copilot discovers the server through the VS Code MCP provider
(requires VS Code 1.101 or newer); Codex and Claude do not require that API.

Ask: **Review transport ALCK900593 using the VERTEX SAP tools.**

Normal window reloads require no registration changes. After changing
`vertex.mcp.port`, reload VS Code and copy the configuration again. Multiple
simultaneous VERTEX windows need different ports; a port conflict is reported
instead of silently connecting to another SAP system. Port `0` opts into a
temporary port and requires copying the address again after each reload.

## What it writes

Everything reads, with one exception: approving, declining and commenting in a
code review writes to `ZAVE_REVIEW` through AVE's own code. A review is prepared
in AVE; this reads it and adds verdicts to it.

## Licence

MIT. See [the project](https://github.com/ysichov/VERTEX).
