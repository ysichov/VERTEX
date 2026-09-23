# Release history

## 2026-09-23 — VERTEX 0.7.1: Diff keeps its own parts

- Diff keeps AVE's column - Parts with the versions of the chosen part under them - instead of the
  Tools window's shared Parts list, which it hides. It still opens on the part chosen in the other
  functions and hands its own choice back to them.
- The Tools window reads the parts of an object whatever function it is opened on, so a choice made
  in Diff is known when switching to View source, Logic or Metrics.
- The folded Parts list shrinks to its strip again; a width set with the splitter had kept it wide.
- A request naming a method - "the flowchart of ZCL_FOO->BAR" - opens on that method: navigation
  carries the part, and the Tools window selects it in Parts. Before, the first method opened.
- Nothing is picked for the reader: without a named part, View source shows the whole object,
  Logic diagram asks for a method and Diff waits for a part, instead of opening the first one.
- A request to open or show a function is answered in one sentence, without a summary of what
  opens.
- Fixed: hover and Go to skipped a parameter or variable without a conventional prefix -
  `ix_error`, `result`. Any name with a declaration is resolved now; keywords, structure
  components and calls are left out.

## 2026-09-23 — VERTEX 0.7.0: the builder apart from its rows, and View source to the editor

- Join and Pivot table in two panes: a short window of rows on top, and the settings below with
  most of the height, each scrolling on its own. Full view puts the settings away and gives the
  rows the whole window.
- View source has an Open in the Editor button: the object opens in the ADT editor in Eclipse and
  in the VERTEX source editor in VS Code, on the window's own system.
- LLM Providers (VS Code) shows every provider at once as a tree: a checkbox and an In use switch
  per provider, its models below. A provider switched off keeps its model ticks and is left out of
  every provider choice; the one in use cannot be switched off until another is chosen.

## 2026-09-23 — VERTEX 0.6.9: providers, models and a window with its own system

- Providers are named by what is paid for: "Claude subscription (Claude Code)", "ChatGPT
  subscription (Codex)", "Anthropic API (key)"; the panel shows the short Claude / ChatGPT /
  Anthropic API. The documentation says a subscription works only through the vendor's own
  extension, installed and signed in.
- LLM Providers: a table of models per provider with a checkbox each; at least one stays on.
  A Claude subscription lists versions by full id (`CLAUDE_VERSIONS`), the newest of each family
  on by default; another id is added after one test request. The Anthropic API lists
  `GET /v1/models`. With no model chosen, the weakest one switched on is used.
- The VERTEX panel: SAP system and LLM Providers links at the top; provider, model, New
  conversation, the question box and a VERTEX Tools button with the logo docked at the bottom.
  Review & save left the panel (it is in the editor's context menu).
- A VERTEX Tools window keeps the system it was opened on and is named after it ("VERTEX E19");
  its Ask AI chat has a splitter and a close button and shares the panel's provider and model.
- The panel's chat reaches any system in `vertex.systems` named in the question: copying code is
  a read in one system and a draft in the other, through the Code Change reviewer.
- Splitters and folding for Parts in Versions, Code Explorer and View source.
- The VERTEX Tools window keeps one Parts list for the object, beside every function: View
  source, Logic, Calls, Metrics, UML and Diff read the part chosen there, and switching the
  function neither redraws the list nor loses the choice. A class lists its sections and methods
  from its version history; a program lists its events, forms and methods from ACE's parse.
- Versions is laid out as AVE's was: Parts on the left with the versions of the chosen part under
  them (a splitter between), the diff on the right. Any version can be pinned as the base (◇);
  the Prev | Any switch compares with the previous version or with the base (the active version
  until one is pinned). The diff shows in one column (Inline) or two (2 pane); in 2 pane, Parts
  and Versions move to a band above the diff and the base stands on the right. The versions list
  folds on its own, apart from Parts.
- AVE's switches in Versions: TOCs (transport-of-copies versions, hidden by default), Dups (hide a
  version identical to the one before it, on by default) and Case/ind (compare without case and
  indentation, on by default). The ABAP side applies them — `ZCL_VX_ADT_RES_VERSIONS` takes
  `toc`, `dups` and `ic`, so `src/` has to be pulled. Without `toc`, TOC versions are no longer
  listed; that applies to the Eclipse plugin 0.6.3 as well.
- The panel's chat opens a VERTEX Tools window when a function is asked for ("open table
  SFLIGHT", "diff of ZCL_FOO"); before, it only said it was opening one.
- The panel's chat sees what a Tools window shows: Versions reports the part and the versions
  compared, and the changed lines of the diff are attached to the question, read from the
  window's system. Fixed: a Tools window's context was lost in VS Code because it arrived as JSON
  text. Code Explorer reports the method of the scheme on screen; the chat answers from the
  screen alone only when code or UML is on it, and otherwise reads the method through the SAP
  tools. Metrics sends its table - every unit and the totals - so the chat answers about the
  numbers on screen. Explaining never changes the view.
- Metrics totals are rounded to two places instead of showing float noise.
- A ? button in Code Explorer opens a help on every metric: what ACE counts, the formula, and
  how to read the value.
- Every choice between modes uses one switch template, the mode in force lit: Compact | Full,
  Inline | 2 pane, Prev | Any, Versions | Review, Join | Pivot table, Settings | Full view and
  Top-down | Left-right.
- Code Explorer's modes renamed for what they show: Flow is now Calls diagram (which unit calls
  which), Scheme is now Logic diagram (the flowchart of one method), UML class is UML diagram.
- Scheme and Flow in the theme's colours: blocks a step off the background, decision diamonds
  tinted with the accent, arrow labels on a backing, larger text; ACE's node colours kept.
- Thin scrollbars in the theme's colours on every VERTEX page.
- The UML magnifier works on Logic and Calls too, over the whole picture, and only where the
  text is too small to read at the current scale; Shift and two fingers on the
  touchpad (or the wheel) set its strength smoothly from 1.5x to 6x; Ctrl and a pinch zoom the
  whole picture. Calls diagram draws methods by default.
- Calls starts where you choose: picking an event or a form in Parts walks the calls from there,
  as a double-click in ACE's tree does; From: … ✕ goes back to the whole program. The flow
  resource takes `start` and `stype`. ACE's calculated path is carried over as well
  (`ZCL_VX_ACE_FLOW=>PATH_EVENTS`, `calc=X`) but not offered in the window: a start point says
  more plainly what the picture is about. Needs `src/` pulled.
- A Classes | Methods switch in the calls flow, as ACE's All Blocks: one block per program or
  class by default, or every event, form and method.
- Fixed: the "Opened … in system" answer printed the connection key instead of the system name.
- Fixed: Logic drew nothing after the last branch or loop of a method - a method without branches
  showed only its name. The statements after it and the unit's END line are drawn now
  (`ZCL_VX_ACE_CODE_HTML=>BUILD_SCHEME`; the same fix went into ACE's `ZCL_ACE_CODE_HTML`).

## 2026-09-21 — VERTEX 0.6.0: source as navigation

- View source now uses the Diff Parts table: `CPUB` / `CPRO` / `CPRI`, `METH`, and SE80-style
  visibility markers. A class method moves between its declaration and body; a section positions
  its declaration.
- Programs remain fully visible: the events, FORM, and local-class list only scrolls the complete
  source to the selected block.
- View source gained Back; a selected fragment and method signature are passed to VERTEX chat.
  A redefinition signature is resolved through its inheritance chain.
- In both VS Code chats, Enter sends a request and Ctrl+Enter adds a line; the separate Send button
  is gone.

## 2026-09-14 — VERTEX 0.5.4: chat and reading SAP code through ADT

- Searching and reading programs, global classes and function modules moved into the VS Code
  extension.
- The interface keeps a free-prompt chat; its orchestrator calls the SAP tools. SelecTor, Metrics
  and Versions stay as the earlier quick launches.
- Creating and changing objects prepares a draft and a diff. Nothing is written to SAP until the
  draft has been checked and explicitly applied.
- Keys and passwords are not written into the project: the system password is kept in VS Code
  SecretStorage, and the systems are configured in `vertex.systems`.
- The cause of `certificate has expired`: the `abap-adt-api` client used its own Axios transport,
  and VS Code's TLS settings did not match a direct request to SAP. A working ADT confirmed the
  system was reachable.
- An explicit `sap-http.js` was added: it sends requests straight to the configured SAP host and
  passes `rejectUnauthorized: false` when the system has `allowInsecureCertificate: true`.
- Checked against `https://sap.example.com:44300`: with the certificate allowed, TLS passes and the
  server answers HTTP 401 without a password; with strict checking, `CERT_HAS_EXPIRED` is
  reproduced.
- Built [vertex-abap-0.5.4.vsix](vscode/vertex-abap-0.5.4.vsix). The ADT and workspace tests pass.
