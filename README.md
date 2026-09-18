# ABAP VERTEX Tools

<img width="256" height="256" alt="icon" src="https://github.com/user-attachments/assets/077f3c2e-7c3e-4078-a007-d45660adee59" />



[**Install from the VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=YuriiSychov.vertex-abap) · Eclipse ADT: install from `https://ysichov.github.io/VERTEX/` or build it from this repository (see below).


ABAP **Version**, **Code** and **Data** Explorer — three words, three SAP GUI tools, one front end
in ABAP Development Tools. Each view reads over the developer's existing ADT connection and
renders as HTML.

| Word | Comes from | What it does | In VERTEX | Status |
|---|---|---|---|---|
| Data | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, joins, pivot | SelecTor | A table with filters, a join built from the dictionary's own foreign keys, and a pivot over either |
| Version | [AVE](https://github.com/ysichov/AVE) | History, diff, blame, code review of a whole transport | Versions | A transport — by its number, or picked from the open or released requests of a user, yours by default — a package or one object; its parts, their versions, the diff between two of them, and the review AVE saved for a request — including approving, declining and commenting on a block. No blame |
| Code | [ACE](https://github.com/ysichov/ACE) | Metrics, call maps, backward slicing, skeletons | Metrics | Three modes: the flow of a program, the branch scheme of one method, and McCabe, Halstead and the maintainability index per unit |

Status: **early**. All three answer, and each is a fraction of what it was cut from.

Only [AVE](https://github.com/ysichov/AVE) still has to be installed, for Versions and the review.
The table, the join, the pivot, the metrics and the flow were carried out of Simple Data Explorer
and ACE into this repository's `src/` as `ZCL_VX_*`, with the SAP GUI stripped off, so neither of
those two is a prerequisite any more — they are where the logic was written first, not something
to install.

The division of labour is the same for all three: ABAP computes and returns JSON, the page
renders it, and the view in between is transport. Nothing about a service lives in the host, so
every page runs under the VS Code extension in `vscode/` as well — the same files, from the same
folder. And since SAP GUI 8.0 draws on the same WebView2 engine as both editors, one day inside
SAP GUI too.


## How it fits together

<img width="1373" height="913" alt="image" src="https://github.com/user-attachments/assets/b657ec1c-49e3-4efc-9d31-6d011cd0c9b0" />


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

## AI assistants

### VERTEX chat and code reviewer (VS Code, 0.5.5)

The VERTEX panel in VS Code's Activity Bar has a chat over the active SAP system, run by
the Claude Code or Codex subscription already installed. Ask *show ZCL_TR_TEXT_DATA* or
*explain this method*: it searches and reads the source and opens it in an editable tab.
Edits go through the **Code Change** reviewer — approve or decline each block, ask AI about
one block, then **Save & Activate** writes only the approved blocks, with a syntax check and
a conflict check against the current SAP source. Details:
[vscode/README.md](vscode/README.md#vertex-chat).

### Transport reviews over MCP

Beyond its own chat, VERTEX hands SAP to the assistants already in use — Copilot,
Claude Code and Codex in VS Code — over MCP, with two tools that read the review AVE
saved for a transport request: `sap_transport_changes` lists what the request changed, and
`sap_transport_diff` gives the diff cut into AVE's own blocks, with the verdicts and notes
already given. Both only read. The review has to be prepared in AVE first, and a request without
one is reported as such, never as a clean transport.

The tools are served two ways, from the same code:

| Server | How it runs | Its SAP connection | Clients |
|---|---|---|---|
| Inside the VS Code extension | HTTP on `127.0.0.1:37777` with a bearer token; VS Code must be open | The extension's active system | Copilot finds it by itself; Codex and Claude Code are given its address |
| [`mcp/server.js`](mcp/README.md) | A child process over stdio; no editor | `VERTEX_SAP_*` environment variables | Development/standalone mode; not part of the tested VS Code workflow |

Every client keeps its own registration: a server added to Claude Code is not visible in the
other clients. Setting up the tested VS Code workflow:
[vscode/README.md](vscode/README.md#review-transports-with-copilot-claude-code-or-codex) and
[mcp/README.md](mcp/README.md). For GitHub Copilot in Eclipse, use the
[Eclipse MCP setup guide](eclipse/MCP.md). The Eclipse plugin's built-in Assistant
uses a separate private MCP runtime; it is not an external Copilot endpoint.

SelecTor and Versions also take a sentence. **Assistant** in their bar opens a chat: pick Claude
Code or Codex and the model it offers, and write what to show — *SFLIGHT for carrier AA, joined
with SCARR*, or *the last change of BUILD_LAYOUT in ZCL_AVE_POPUP*.
In Versions the assistant also reads what the window shows — the change a version made, whole
sources, a saved review with its blocks and verdicts — so it describes and reviews code as well as
moving the window there, the way the clicks would. SelecTor's assistant never sees a table row.
Examples of requests for both windows are in [vscode/README.md](vscode/README.md#examples).

### Development status

The tested integrations are GitHub Copilot in VS Code, Claude Code, and Codex in VS Code.
Claude web, ChatGPT web, Claude Desktop, and other MCP clients are not supported or tested yet.
The remote HTTP host is experimental and documented for future development only.

### Where MCP comes in

| Who | Uses MCP | Setup |
|---|---|---|
| The SelecTor, Versions and Metrics windows, used by hand | No: they read SAP directly over ADT | — |
| The **Assistant** panels in SelecTor and Versions | Yes, internally | None: for each request the extension hands Claude Code or Codex the window's own MCP address, `/selector` or `/versions` |
| Supported assistants | Yes | GitHub Copilot in VS Code, Claude Code, and Codex in VS Code |
| Other chats and MCP clients | Not supported/tested yet | Claude web, ChatGPT web, Claude Desktop, and other clients are development work |

MCP is how Claude Code and Codex are given tools in both cases. The difference is
who connects them: the extension, for one request, or you, once.
The assistant reads the table's layout (fields, keys, the tables the dictionary offers, never a
row) and answers with the state SelecTor is to be put in; the page checks it against the
dictionary, fills in the panel, the join and the pivot as the clicks would, and runs the query
itself. It starts the copy of Claude Code or Codex that comes with its VS Code extension, with
no other MCP server and no shell. In Eclipse, the same runtime runs through
Node.js and uses the window's ADT session. Configure executable paths in
**Window > Preferences > VERTEX Assistant**; see [Eclipse Assistant setup](eclipse/README.md).

## Installing it in Eclipse

Installing, and getting back out when a p2 install goes wrong: **[INSTALL.md](INSTALL.md)**.
Read it before the first install into an Eclipse you care about.

**Help → Install New Software → Add → Location**, and this address:

```
https://ysichov.github.io/VERTEX/
```

The category **ABAP VERTEX Tools** appears, with the feature under it and its sources beside
it. ADT has to be installed first: the feature declares the SAP bundles as prerequisites
rather than shipping them, so p2 refuses the install on an Eclipse without ADT instead of
leaving a plugin that cannot resolve.

Then **Window → Show View → Other… → VERTEX**, or right-click an object in the Project
Explorer → **VERTEX**.


Building the update site and the VS Code package: **[BUILD.md](BUILD.md)**.

## In VS Code

Published as
[**YuriiSychov.vertex-abap**](https://marketplace.visualstudio.com/items?itemName=YuriiSychov.vertex-abap):
install it from the Extensions view and there is nothing to build.

To run the copy in `vscode/` instead, open that folder in VS Code and press F5. It has no
dependencies and no build step; `vscode:prepublish` copies the pages in from the Eclipse plugin
when the package is made, and a checkout reads them across the repository. **Do not** install it
by making a junction into `%USERPROFILE%\.vscode\extensions` — a folder not named
`publisher.name-version` is loaded on every scan and cannot be uninstalled, which is a trap worth
naming because this project fell into it.

It needs the connection Eclipse inherits from the ABAP project. There is no project here, so the
systems are a list and one of them is active:

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

Then the command palette: **VERTEX: Open SelecTor**, **Open Metrics**, **Open Versions**. There is
no object tree here to right-click, so each page opens empty and its own name field is the way in.

## Talking to ADT

Reading and writing an ADT resource from Java, the WebView2 callback deadlock, and how to read
signatures off the bundles when web search has nothing: [ADT_TECH.md](ADT_TECH.md).

## Layout

```
org.vertex.abap.ui/
├── META-INF/MANIFEST.MF   bundle dependencies
├── plugin.xml             registers the view at org.eclipse.ui.views
├── build.properties       resources/ must be listed, or the page is missing at runtime
├── resources/
│   ├── table.html         the grid, the join builder and the pivot cross
│   ├── metrics.html       Flow, Scheme and Metrics: ACE's diagrams and numbers
│   ├── mermaid.min.js     draws the diagrams; shipped, never fetched
│   └── versions.html      parts, their versions, the diff, and the saved review
└── src/org/vertex/abap/ui/
    ├── PageView.java           browser, page, ADT read, answer bridge - the shared half
    ├── SelectorView.java       table data: what to request, and opening a second window
    ├── MetricsView.java        code metrics: what to request
    ├── VersionsView.java       version history: parts, then the versions of one
    ├── ServiceHandler.java     context menu -> a view, on the object's own system
    ├── DataHandler.java        which view, and what to carry in its secondary id
    ├── MetricsHandler.java     the same, for metrics
    ├── VersionsHandler.java    the same, for versions
    ├── SelectionContext.java   the ADT object and project behind a workbench selection
    └── JsonContentHandler.java reads a JSON response body as a String
vscode/
├── extension.js           the second host: webviews, the SAP connection, the MCP provider
├── mcp.js                 the review tools and the local HTTP MCP server
├── selector.js            SelecTor's assistant: its tool, its plan and the check
├── versions.js            Versions' assistant: its tools, its plan and the check
├── assistant.js           starts Claude Code or Codex for one request, shut in
└── test/                  node --test; no SAP, no editor
mcp/
├── server.js              the same tools over stdio, for clients without VS Code
├── sap.js                 its own SAP reader: the review resource only, no redirects
├── configure-local.py     writes Codex and Claude Code configuration, password left empty
└── test/                  the real process against a fake SAP endpoint
```

A view is transport and nothing else: it names a path and hands the answer to its page. What the
user operates lives in the page, which is what lets the same page run under the VS Code host in
`vscode/`.

## Next

- Authorization on the ABAP side. The table resource lets any authenticated user read any
  transparent table; `S_TABU_DIS` / `S_TABU_NAM` are not checked anywhere yet. `SE16N` resolves
  both through `VIEW_AUTHORITY_CHECK`, and a refusal has to be a real 403 rather than an empty
  result.
- Paging and a refresh button for the grid. Sorting a column sorts the rows that were read, which
  is what the SAP GUI grid does too; the row limit is still a constant in the page and the
  resource has no offset, so a large table stops at the first hundred rows.
- Conversion exits and F4. Values arrive as stored, so an `ALPHA`-padded key reads as padded.
- Filters on a joined table. The selection panel knows the base table's columns; the join's own
  are filterable by the resource already, and wait for the panel to learn their names.
- `ORDER BY` for the join, and editing an ON condition rather than taking what the dictionary
  proposes.
- The character-level highlight inside a changed line, and the pass that pairs a deletion with the
  insertion it belongs to. Both exist in AVE already, in the ABAP and in its browser port; see
  stage 12 of `dev_history.md` for why neither was copied wholesale.
- Blame.
- `C_ALLOW_SELF_REVIEW` in the review resource is on for testing and has to come out: AVE refuses
  to let a developer approve their own block, and so should this.
- Optimistic locking is one-sided. A write is refused when the review moved under the page, which
  is right, but AVE's own save still overwrites without looking.
- The metrics of a whole package, which needs the same treatment the transport just got.
- The DDIC side of a review. `TABD`, `DOMD` and `DTED` have no line diff, and their page in AVE is
  a field table kept as ready-made html; VERTEX says so rather than rendering it.
