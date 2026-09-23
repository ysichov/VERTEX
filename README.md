# ABAP VERTEX Tools

<img width="1656" height="950" alt="VERTEX" src="https://github.com/user-attachments/assets/e1494b01-b10f-44f3-992a-8692bf2ecb79" />



### Install

**[VS Code — the Marketplace](https://marketplace.visualstudio.com/items?itemName=YuriiSychov.vertex-abap)**
· **[Eclipse ADT — the update site](https://ysichov.github.io/VERTEX/)**

The Eclipse address is pasted into **Help → Install New Software → Add → Location**; the steps, and
getting back out when a p2 install goes wrong, are in [INSTALL.md](INSTALL.md). Building either half
from this repository instead: [BUILD.md](BUILD.md).


ABAP **Version**, **Code** and **Data** Explorer — three words, three SAP GUI tools, one front end
in ABAP Development Tools. Each view reads over the developer's existing ADT connection and
renders as HTML.

| Word | Comes from | What it does | In VERTEX | Status |
|---|---|---|---|---|
| Data | [Simple Data Explorer](https://github.com/ysichov/Simple-Data-Explorer) | Tables, views and CDS with select-options, joins, pivot | SelecTor | A table with filters, a join built from the dictionary's own foreign keys, and a pivot over either |
| Version | [AVE](https://github.com/ysichov/AVE) | History, diff, blame, code review of a whole transport | Versions | A transport — by its number, or picked from the open or released requests of a user, yours by default — a package or one object; its parts, their versions, the diff between two of them, and the review saved for a request — including approving, declining and commenting on a block. No blame |
| Code | [ACE](https://github.com/ysichov/ACE) | Metrics, call maps, backward slicing, skeletons | Metrics | Three modes: the flow of a program, the branch scheme of one method, and McCabe, Halstead and the maintainability index per unit |

Status: **early**. All three answer, and each is a fraction of what it was cut from.

Nothing but this repository's `src/` has to be installed. The table, the join and the pivot were
carried out of Simple Data Explorer, the flow and the metrics out of ACE, and the version history,
the diff, the transport lookup and the review out of [AVE](https://github.com/ysichov/AVE) — all
into `src/` as `ZCL_VX_*`, with the SAP GUI stripped off. None of the three is a prerequisite any
more: they are where the logic was written first, and they are not developed further — everything
new happens on this side. The `ZAVE_REVIEW` table the review is kept in ships in `src/` as well.

Building a review is here too, not only reading one. A Versions window opened on a request that
has none offers to build it, and walks the objects one at a time — reading the versions of each,
diffing them, cutting what changed into blocks — writing each object before it moves to the next.
One object per call, so nothing has to survive being slow and stopping costs the object in hand.
AVE's SAP GUI writes into the same `ZAVE_REVIEW`, so a review built either way is read by both.

The division of labour is the same for all three: ABAP computes and returns JSON, the page
renders it, and the view in between is transport. Nothing about a service lives in the host, so
every page runs under the VS Code extension in `vscode/` as well — the same files, from the same
folder. And since SAP GUI 8.0 draws on the same WebView2 engine as both editors, one day inside
SAP GUI too.


## How it fits together


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

### VERTEX chat and code reviewer (VS Code, 0.7.0)

The VERTEX panel in VS Code's Activity Bar has a chat over the SAP systems in `vertex.systems`,
run by a Claude or ChatGPT subscription — through the Claude Code or Codex extension, which has to
be installed and signed in — or by an Anthropic API key. **LLM Providers** shows every provider
with its models as one tree: a provider can be switched off whole, and each model on its own. Name a system in the question to reach it; a VERTEX Tools window keeps the
system it was opened on. Ask *show ZCL_TR_TEXT_DATA* or
*explain this method*: it searches and reads the source and opens it in an editable tab.
Edits go through the **Code Change** reviewer — approve or decline each block, ask AI about
one block, then **Save & Activate** writes only the approved blocks, with a syntax check and
a conflict check against the current SAP source. Details:
[vscode/README.md](vscode/README.md#vertex-chat).

### Transport reviews over MCP

Beyond its own chat, VERTEX hands SAP to the assistants already in use — Copilot,
Claude Code and Codex in VS Code — over MCP, with two tools that read the review saved
for a transport request: `sap_transport_changes` lists what the request changed, and
`sap_transport_diff` gives the diff cut into the blocks AVE's rule cuts, with the verdicts and notes
already given. Both only read: a review has to have been built first — the Versions window does
that — and a request without one is reported as such, never as a clean transport.

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
with SCARR*, or *the last change of COMPUTE_DIFF in ZCL_VX_DIFF*.
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

Open **VERTEX: Open Panel**, then choose **VERTEX Tools**. Select the object type, enter its name
and choose its function — for example Data, View, UML, Metrics, Calls diagram, Logic diagram, Diff or Versions.
The functions are filtered by object type, so VERTEX does not offer actions that cannot apply.

### Clickable ABAP source

The old SAP GUI made every meaningful name a place to go. VERTEX takes the same direction in
VS Code: source opened from VERTEX remains an editable `vertex-sap` document, while names in it
can be inspected and followed. Hovering a supported local variable shows its type; hovering a
method shows its parameters. **F12**, double-click, or **VERTEX: Go to (by context)** follows
local methods and declarations inside the current class, and can open a static class call or a
function module in its own source. **VERTEX: Back** (`Alt+Left`) returns along that navigation.

### Code editor improvements

- Hover now resolves a local declaration or method parameter first, then a class attribute declared
  in `PUBLIC`, `PROTECTED` or `PRIVATE SECTION`; it shows the compact `TYPE` / `LIKE` result.
- Method hover reads the complete definition statement, including multiline declarations and
  chained `METHODS:` entries, and shows the parameter sections.
- Navigation follows static calls, `CALL FUNCTION`, and instance calls such as
  `mo_splitter->set_row_sash( )` when the receiver has a visible `TYPE REF TO` declaration.
- A name declared in another object - `abap_bool` from the type pool, an interface constant -
  shows its declaration in the hover; double-click or Go to opens it there, a class or a program
  as its VERTEX tab and any other kind read-only.
- The hover on a data element names its domain, type and length.
- Hover and navigation work inside a read-only view as well.
- Interfaces open as editable VERTEX tabs, like programs and classes.
- `NEW zcl_foo( )` leads to the class's constructor.
  External classes and function modules open as source documents; **Back** returns through every
  VERTEX drill-down location.

This is intentionally separate from **View source** in the Tools window. That command is a
read-only, contextual overview inside VERTEX: class methods are grouped into the familiar
`CPUB` / `CPRO` / `CPRI` Parts table and carry the same SE80-style visibility markers as Diff.
One click opens a method body; double-clicking a method toggles its declaration and body;
double-clicking a section positions the declaration. A program always remains complete on screen:
its Parts list only positions to events, forms and local-class implementations. **Back** restores
the preceding source location. Chat context follows the active function: a source view sends a
selected fragment and method signature, while UML sends its diagram nodes and relationships. A
redefinition is resolved through its inheritance chain.

An explicit chat request such as *Open ZCL_FOO* opens the normal editable VS Code document. The
detailed, current navigation matrix is in
[vscode/README.md](vscode/README.md#clickable-abap-source).

### Object-specific tools

VERTEX no longer offers one generic action list for every SAP object. The selected object type
defines the functions in its toolbar: a transport exposes Versions and review, a class or program
can expose source, metrics, flow/scheme and diff, and a package exposes its package-level views.
The default action is the most useful available view rather than an extra Run button.

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
│   ├── metrics.html       Calls, Logic and Metrics: ACE's diagrams and numbers
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
- The join as a graph in SelecTor, drawn as the page's own svg. The candidates already carry their
  direction and their parent, and the joined tables their ON condition, so the nodes and the edges
  are in the join resource's answer already and only the drawing is missing. Not mermaid, which
  ships here for Flow and Metrics: a node has to be clickable to take its table into the join, and
  a rendered picture is not. The view stays egocentric, the join so far in the middle and one step
  of candidates around it, because `DD08L` offers dozens of them around a table like `BKPF`.
