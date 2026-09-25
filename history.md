# Release history

## 2026-09-25 — VERTEX 0.7.6 (VS Code): ABAP Unit, ATC, where-used, documentation

- **Run ABAP Unit Tests** (Ctrl+Shift+F10, or the beaker in the editor title) runs the test
  classes of the class or program in the tab, as Eclipse does. VS Code's Test Explorer shows the
  object, its test classes and their methods with pass or fail and the time; a failure carries
  SAP's alert text and opens the line where it was raised. Risk level harmless, every duration.
  A tab with unsaved changes is refused, because SAP runs the active source. Run again from the
  Test Explorer as well.
- **Run ATC Check** (Ctrl+Shift+F2, the checklist in the editor title, or the button in View
  source) checks the class, program, function module or interface with the system's default ATC
  variant, as Eclipse does without a variant of its own. The findings go to VS Code's Problems
  view and are underlined in the tab: priority 1 an error, 2 a warning, 3 information, the check's
  title beside the message. A new run of the object replaces the last one. A finding in a source
  VERTEX cannot open as a tab is named in a warning. A tab with unsaved changes is refused.
  A function module is checked through its function group, since ATC checks repository objects
  and a module is not one; the findings are the whole group's.
- **Where-used** in a SAP tab through VS Code's references: Shift+F12 peeks the places that use the
  name under the cursor, Shift+Alt+F12 lists them. SAP searches the saved source, so a tab with
  unsaved changes is refused; each object found opens as a VERTEX tab at its line, and a place in a
  source VERTEX cannot open as a tab (a program include, say) is named in a warning.
- **ABAP Documentation** (F1 in a SAP tab, or the context menu) shows SAP's keyword documentation
  for the statement under the cursor in a panel beside the source, in the theme's colours. F1
  there no longer opens the command palette; Ctrl+Shift+P still does. Links inside the page do not
  navigate.
- Hovering a keyword (`REPORT`, `TYPES`...) shows nothing: SAP answers there with HTTP 400, "no
  name at this position", which is no longer put in a hover. Other SAP errors still are.
- In View source, a click on the object's name above Parts shows the whole source again after a
  part was picked; Back returns to the part.
- The READMEs credit [abap-adt-api](https://github.com/marcellourbani/abap-adt-api) by Marcello
  Urbani (MIT), through which the VS Code extension talks to ADT.
- View source of a class or program has **Run Unit Tests** beside Open in the Editor, with the
  same result. The Eclipse sources carry the button hidden, since the plugin has no host call for
  it and was not built.

## 2026-09-25 — VERTEX 0.7.5 (VS Code): the flow chart and its player

- The flow chart runs top-down, the caller above its callees, and sits in the right column. The
  number on an arrow is how many times that call was made. In Methods each routine is its own
  block, class above and method below, coloured by its class, with no class frames, so the levels
  follow the stack depth. SAP standard is dashed blue, and a standard call stepped over is named
  down to its method (needs `src/` pulled).
- With Visual on, the chart follows the run: the block running now is filled green, dark green
  once called again. It moves without a redraw, and the chart is drawn again only when a block or
  an arrow appears. Every drawing fits the pane until the zoom is set by hand. In Flow the source
  line moves at every stop.
- A player for the recorded run: ⏮ ◀ ▶ ⏭, a slider, and ⏵ at 1-10 stops a second or max. The
  source line, the green block, the stack and the values move together, from the record alone,
  and ms per frame shows what the window takes.
- Rec, beside Visual, records every stop while it is on, from any source: manual steps, the
  assistant, breakpoints. Continue then steps as Visual does and draws nothing until
  the run ends, then the player replays it statement by statement. Flow and Rec read a routine's
  parameters and locals where it starts and ends.
- A click on a block moves the player to the next time the run entered that routine. A standard
  block shows its own source.
- Stack is a table as in SAP's debugger: depth number, event type, event, program, include, line.
  The caller's frames below the object (the SE37 or SE24 test frame, the screen) are hidden
  behind one line that shows them, and they stay off the flow chart. A function module is a
  block of its own name there, not its group's program.
- The Tools object field is narrower. A name with `*` or `+` lists the matching objects of the
  chosen type, through ADT's quick search; a plain name that is not found lists the names
  starting with it.
- A report written without any event, form or method (its code is the implicit
  START-OF-SELECTION) now has that one unit for Metrics and the Logic diagram, instead of "No code
  units" (needs `src/` pulled).
- A class's local includes that hold only SAP's generated comment are no longer listed in Parts
  or Diff (needs `src/` pulled).
- In a class, a section, a method or a local include picked in Parts is read from the include SAP
  keeps it in (CU/CO/CI, CMnnn, CCDEF...) and shown as it is, numbered from 1 (needs `src/`
  pulled).
- Diff's parts list, a package's drilled-in class included, looks like the Parts list of every
  other function: no Type / Name head row, methods in lower case.
- A package has View source: Parts lists its objects, and a program, class or function module
  picked there is shown with its source.
- Diff's parts column has the theme's editor background, not a panel shade of its own.
- View source drops the Parts column when the object has no parts, and folds it with a button when
  it has.
- A function module shows Parts only when it has local FORMs after its ENDFUNCTION; the list is
  that include's units, from ACE (needs `src/` pulled). The Eclipse sources carry the same change, but the
  plugin was not built.
- Terminate and Stop became Exit program and Detach. Detach lets the program go and stops
  listening but keeps the breakpoints for the next Run in SAP. Removing every breakpoint is Clear
  all, in the Breakpoints bar. A breakpoint can be deactivated and activated again without
  losing its condition and mode (Ctrl+click, its box, its checkbox, Deactivate all).
- Fitting the chart never enlarges it past its own size.
- In Stack, with the caller's frames hidden, depth counts from the object: its own frame is 1.
- Hovering a table or a structure in the source shows a small grid with column names, not lines of
  values joined by bars.
- The right column's sections (Stack, Breakpoints, Variables, Diagram, Log) are shown or hidden by
  switches at its top and resized by dragging the lines between them. Diagram and Log are separate
  sections, and the header's Diagram · Log button is gone.
- The chart takes its dark or light colours from the pane's real background, so dark themes work.

## 2026-09-24 — VERTEX 0.7.4 (VS Code): Visual Debug

- The VERTEX chat keeps its SAP tools whatever is on screen. A Tools window showing a diff, UML
  or metrics, or selected code, used to make it answer from the screen alone - without reading,
  changing or debugging, and with no sign of it; which window counted was the last one to report,
  not the one in view. What is on screen still comes with the question, and the model is told to
  answer from it when it is enough.
- Visual Debug (VS Code, pilot): a Tools function for programs, classes and function modules
  that shows the debugger on screen - the active source with breakpoints set or removed by a
  click, a condition and mode on right-click, the current line, the stack, every variable at once
  grouped as SAP groups them, with changed values marked and initial ones hidden on request, and
  tables in grids of their own. Steps with F5-F8, Run and Stop. It is the assistant's debugger,
  not a second one: breakpoints, stops and steps are shared both ways.
- In Visual Debug the mouse on a name in the source shows its value at a stop; `SY` shows only
  with SYST; parameters and locals are headed by their routine; an anonymous `\TYPE=%_...` type
  is shown as the source declares it.
- Visual Debug reads only what it needs: Globals, Locals and Params switch groups off, and a step over
  a plain statement reads again only the variables it names. Visual makes Continue (F8) a run of
  F5 steps that shows the current line as it goes, reads no variables, and measures the time per
  step; it ends when the program leaves the stack instead of stepping on into SAP's code.
  Terminate ends the stopped program and keeps the breakpoints.
- Visual run asks SAP for the stack only where it has to: from one plain statement to the next it
  takes the line from ACE's statement map - a new `statements` mode of the flow resource, which
  needs `src/` pulled. A misprediction is reported, not hidden.
- The Visual run also predicts a plain `PERFORM` and its `ENDFORM`, and asks SAP once where it stops.
- It predicts standalone calls of local methods too, and passes a loop in one F8 to the statement
  after it instead of stepping through it.
- Visual Debug keeps the last sources it drew instead of redrawing them at every change of
  include - a long run through large classes had slowed the whole machine. A global class's
  method include is predicted too. Run opens SE37 or SE24 for a function module or a class.
- Z only (on by default): a Visual run that steps from Z/Y code into SAP's own returns at once
  with F7, and goes on in the customer code.
- Flow: Continue from call to call, recording the program's real flow, and a diagram of it by class or
  by method. A call whose code the map places outside Z/Y is stepped over.
- A log of every step of a run, filtered and copied as text, and a line saying what each step
  decided. The run-to points of Flow and of a passed loop now reach the program being debugged -
  before, they went to the breakpoints of the next run and were never hit.
- Requests to SAP keep their connection open: before, each one opened a new connection and TLS
  handshake.

## 2026-09-24 — VERTEX 0.7.3: an assistant at the debugger

- An assistant debugs ABAP by itself: told the problem, it sets breakpoints, starts the program,
  reads what the program held where it stopped, decides where to look next, and ends with a
  verdict naming the line and the values that prove it.
- Breakpoints on a program, include or class line, with a condition SAP evaluates - written like
  an ABAP `IF`, with `LINES( )`, `STRLEN( )` and the rest - so the program stops only when it
  holds.
- Mode *log* makes a breakpoint a watchpoint: it records what changed and lets the program run
  on, without a turn of the assistant.
- A stop returns the stack, five source lines, the variables changed since the last stop and the
  first rows of a changed table; `debug_read` reads a field, a structure or a range of rows.
- Runs start in WebGUI (`debug_run`). SAP never applies ADT breakpoints to a session opened
  through SAP Logon, so a run from the standalone SAP GUI is not caught - by VERTEX or Eclipse.
- Another debugger listening for the same user (Eclipse, ABAP FS) is reported, not taken over
  unless the user agrees.
- Nothing is changed: no variable, no jump, no source. `debug_stop`, or closing the window,
  removes every breakpoint and the listener.
- The VERTEX chat has the debugger with no setup, and waits up to ten minutes for an answer that
  uses SAP tools. Claude Code and Codex connect to it as `vertex-debug`: **VERTEX: Copy the MCP
  address** has a debugger entry for each.
- The debugger works on the active system and follows a switch; a switch while breakpoints or a
  stopped program are still on the old system is refused until `debug_stop`. Before, it kept the
  system of its first call, and WebGUI opened on QAS after the user had switched to E19.
- A change the chat makes goes into the object's tab, unsaved, as if typed there; it is saved
  like any edit - Save & Activate or Review & Activate - or undone. No separate draft and review
  open any more, and no Tools window or old source beside it. Refused while the tab holds edits
  SAP does not have. A new object still opens as a draft.
- The assistant keeps waiting while the user logs on to WebGUI, asks whether the program ran
  instead of giving up, and gives no verdict without a stop - a guess from reading the code is not
  passed off as a debugging result.
- A system in `vertex.systems` can name a `webgui` address. The debugger opens WebGUI there when a
  system redirects its HTTP port to an HTTPS host name the computer cannot resolve.
- `Z_VX_DEBUGGER_TEST` in `src/`: a one-screen invoice that prints the wrong total, with a bug no
  single line shows - something to try the debugger on. Pull `src/` to get it.
- Eclipse 0.7.3, the first Eclipse build since 0.7.0: it brings the Tools window changes of 0.7.1
  to Eclipse - Diff with its own Parts and Versions column, a method opened by name, nothing picked
  without a named part, one-sentence answers to "open", the folded Parts strip - and the
  Assistant's rule that a fix changes no view. The debugger, the code editor and the Outline stay
  VS Code features.

## 2026-09-24 — VERTEX 0.7.2: names SAP knows, wherever they are declared

- Hover and Go to on a variable, parameter, attribute or type ask SAP through ADT's own
  element info and navigation - what F3 and the hover use in Eclipse - with the text of the tab,
  saved or not. The guessing from the text is gone, and with it the misses: `ix_error`,
  `result`. A name SAP cannot describe is said in the hover.
- Fixed: double-click on the method in `zcl_class=>method(` or `lo_ref->method(` did nothing -
  the `>` of the arrow was taken as part of the name. Angle brackets now count only around a
  field symbol, `<ls_row>`.
- A name declared in another object - `abap_bool` from the type pool, an interface constant, an
  attribute of another class - shows its declaration in the hover, and double-click or Go to
  opens it there: a class or a program as its VERTEX tab, any other kind read-only.
- The hover on a data element names its domain, type and length - `domain: VERSNO  NUMC 5`.
- Hover, double-click and Go to work inside a read-only view too, so navigation goes on from an
  interface or a type pool.
- Interfaces open as VERTEX tabs - read, edited, saved and activated like a program or a class,
  and found by the chat's SAP tools. Creating one is not offered.
- Fixed: the hover on a name at its own declaration - `BEGIN OF ty_diff_op` - said "SAP could
  not describe this name - Definition location found". It shows the declaration now.
- Double-click or Go to on the class in `NEW zcl_foo( ... )` opens its constructor, as Eclipse
  does; a class without its own constructor opens at its start.
- Outline for VERTEX tabs: a class as its sections and methods, each method leading to its
  implementation; a program as its events, forms, modules and local classes. The same list feeds
  Ctrl+Shift+O, the breadcrumbs and sticky scroll. It is read from the tab's text, saved or not.
- Double-click on `IF` or `CASE` goes straight to `ENDIF` / `ENDCASE`, and back. Ctrl+click or
  F12 still steps through `ELSEIF`, `ELSE` and `WHEN`.

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
