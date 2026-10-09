# Release history

## 2026-10-09 — Eclipse plugin source 0.8.8.qualifier: Versions and the review without the backend

Source only; the plugin has not been built at this number yet.

- **Versions and the review read ADT.** VERTEX Tools in Eclipse runs the same front-end modules as VS Code: the version history from ADT's revision feed, the review of a request built from it in the window, finding requests through the data preview. The status line says what a review being built is reading.
- **The diff is Eclipse's own Text Compare.** Two versions are compared by `RangeDifferencer` of `org.eclipse.compare.core`, the comparison ADT's Compare With shows; the plugin now requires that bundle.
- **Saving a review.** Save, Approve, Decline, comments and taking a verdict back are made in the window as AVE makes them and stored in `ZAVE_REVIEW` through `ZCL_VX_ADT_RES_STORE` or in files - **Window → Preferences → VERTEX Code Review**. A system without VERTEX's ABAP keeps reviews in files.

## 2026-10-09 — VS Code 0.8.8: SelecTor, Run Select and Versions without the backend

- SelecTor adds a remembered Technical names / Text toggle for Selection field labels and result headers.

- Forward Usage Analysis without a selected variable disables Formula, Expression and BSE, retaining FLOW and Full.

- **Native editor breakpoints.** Points set through Visual Debug or MCP become native VS Code breakpoints in matching VERTEX sources. Clicking a gutter point removes it from SAP and Visual Debug too. Conditions, disabled state and logpoint mode are synchronized without resending mirrored points to SAP.
  Restored editor tabs are included after an extension reload; their live documents are attached to the filesystem provider metadata before synchronization.

- **Run Select.** New command **VERTEX: Run Select** (editor context menu of a VERTEX ABAP tab): the SELECT at the cursor runs through ADT's data preview, read only, as Eclipse's SQL console runs a query, and the rows open beside the code. What only the running program would supply is left out: INTO and FOR ALL ENTRIES go, UP TO n ROWS is the row limit (otherwise 100; SELECT SINGLE reads one), and a WHERE condition that reads a program value - a variable, a parameter, a select-option - is dropped, an OR holding one dropped whole. What was dropped is listed above the rows. A program value under NOT or outside WHERE, or a dynamic table, list or condition, refuses the SELECT and says why. The statement is parsed with abaplint, saved or not. A SELECT on one table whose WHERE select-options can say opens in SelecTor instead, its conditions filled in as selection lines and each program value as an empty line to fill in; any other SELECT runs in the plain window, which says why it did not open in SelecTor. A SELECT with INNER or LEFT OUTER joins opens in SelecTor's Join, its tables in order, their ON conditions and the SELECT list carried over, when SelecTor's join takes them - it joins only the tables the dictionary offers; the selection starts folded. In a table the selection panel is a list of fields, as SAP GUI's selection screen is, each with a Shown checkbox. From Run Select only the SELECT's fields are read at first; Show hidden reads every field of the table and leaves the ones the SELECT did not ask for unticked, still there to select on.
- **SelecTor without the backend for a table.** SelecTor reads a table - its fields with their texts, and the rows under the select-options - through ADT's data preview, as Run Select does, instead of the VERTEX resource on SAP. The answer and the window are the same; a selection SAP refuses is now an error rather than an empty table. Joins and the pivot still need the ABAP backend.
- **SelecTor's join without the backend.** The join is built and read through ADT's data preview too: the tables the dictionary offers (foreign keys out and in, text tables, from DD08L and DD05S), the proposed ON, the SELECT list and the selection, with the same window. A table the dictionary does not offer can now be joined as well, on the key fields it shares with the base or on an ON of your own - a self-join included. The pivot still needs the ABAP backend.
- **SelecTor's pivot without the backend.** The pivot is read through ADT's data preview as well: one statement grouped by its rows and columns with the measures' aggregates, the column values spread into columns in the window. Run Select opens a SELECT with GROUP BY and aggregates in the pivot, its grouped fields as rows and COUNT, SUM, MIN, MAX and AVG as measures; HAVING, DISTINCT, UNION and expressions run in the plain window. Its columns are named by the fields and its values by their domains' texts, as the ABAP pivot named them; a smallest or largest date stays a date; its selection is the same field list.
- **Versions without the backend.** The version history of a program or an include is read from ADT's revision feed, as Eclipse's Revision History reads it - number, author, time, transport - and the diff of two versions is computed in the window - VERTEX's own line differ, Myers' shortest edit script over whole lines as Eclipse's Text Compare computes it, written from the published algorithm because Eclipse's comparer is under the EPL and VERTEX under MIT; nothing is done on top of it, so a commented-out line no longer pairs with its original as in AVE; the switches for transports of copies, duplicates and case/indentation work as before. The task under a request is not shown: the feed does not carry it. A class is its sections, its methods and its local includes, as before: ADT keeps the versions of the whole class, and a section's or a method's history is the versions of the class where its text changed, cut out with abaplint - the first look at a long-lived class reads every version of it once. An interface, a function module and a CDS view read their own feeds; a function group is its main program, its function modules and its other includes, from TFDIR and TRDIR. Tables, structures, domains and data elements read their own feeds; a package is what TADIR keeps under it and a transport request what E071 holds for it and its tasks, each part opened from the feed of the object it belongs to. Finding a user's requests reads E070 through the data preview. A saved review is read through the data preview as well - the summary, the reviewers, the history and a part's blocks with their verdicts and threads, out of the ZAVE_REVIEW table AVE and VERTEX share; with none saved - or on a system without the table - the review of a request is built from ADT on the spot: each part it changed, paired by AVE's own rule - the request's newest version, or the active one when ADT records it under the request and no other request's version sits above, against the first older version that is not the request's - diffed and cut into blocks, to look at and not saved. Building a review into the table and approving, declining or commenting still go through the ABAP backend. Includes also get their parts list in VERTEX Tools.
- **A review built from ADT can be saved.** The review of a request with none saved is built in the window, and the status line now says what it is reading (the request, then each part in turn). **Save** keeps it; a saved review takes Approve, Decline, comments and taking a verdict back, made the way AVE makes them (its ZCL_VX_REVIEW_STATE carried over), so AVE and VERTEX read the same review. Two saves of the same review at once do not overwrite each other: the second is refused.
- **Where reviews are kept: `vertex.review.storage`.** `table` (default) writes SAP's `ZAVE_REVIEW` through a new resource of VERTEX's ABAP, `ZCL_VX_ADT_RES_STORE` - the one thing it is needed for in VS Code; `file` writes one JSON file per request under `vertex.review.folder` (default `.vertex/reviews` in the workspace, `<system>/<request>.json`); `both` writes both. On a system without VERTEX's ABAP reviews go to files, and the page says so. Approving, declining and commenting no longer go through `ZCL_VX_ADT_RES_REVIEW` in VS Code.
- **The Marketplace page describes the extension only.** The per-release sections are gone from it; release notes are here.
- **The ABAP side is only the review store now.** `src/` holds `ZCL_VX_ADT_RES_STORE`, the `ZAVE_REVIEW` table, `ZCL_VX_ADT_RES_ABOUT` and the route registration; the version, diff, review and request classes and `Z_VX_DEBUGGER_TEST` are gone from it - pulling with abapGit does not delete them from a system, they are removed there by hand. Building a review on the ABAP side (Prepare) and the review against another system are no longer in VERTEX; AVE keeps both.
- **The standalone MCP server reads the review over ADT.** `mcp/server.js` reads a saved review through ADT's data preview, or builds it from ADT, with the extension's own code; it no longer asks VERTEX's ABAP. It needs the extension's packages in the checkout (`npm ci` in `vscode/`).

## 2026-10-08 — VS Code 0.8.7: function modules in Tools

- **Function modules in VERTEX Tools.** A function module offers Metrics, Logic diagram and Calls diagram, as a program does, and opens on Metrics; before, only Diff.
- **Calls diagram navigation.** A click on a method of a class local to a program (or an include or function module) opens that program at the method, instead of looking for a global class of that name and failing.
- **Value origin FLOW.** With a variable chosen, the flow goes into a call only where the value is computed; for a variable local to its method the flow is that method alone, without its callers or the rest of the class. The run no longer reads unrelated classes.
- **Forward Usage Analysis.** Analyze Variable Value Origin is now **VERTEX: Forward Usage Analysis** (same keys and menus). With no variable under the cursor it draws the flow forward from that line, without a slice of a value. Breakpoints no longer bound the flow as a pair: the flow stops at each breakpoint it reaches, and VERTEX asks whether to stop the analysis there, continue to the next breakpoint or ignore the breakpoints.
- **Backward Usage Analysis.** New command **VERTEX: Backward Usage Analysis** (editor context menu of a VERTEX ABAP tab): from the routine at the cursor up into its callers through SAP's where-used, following the value - a variable, else every parameter and used attribute, else the plain calls - on in each caller and up through the caller's own parameters. Standard SAP code is not followed. Breakpoints stop it a level of callers at a time, with the same three answers.
- **Expression with conditions, working clicks.** Alternatives in Expression say when each holds: `{(iv_base * mv_rate) otherwise | ((iv_base * mv_rate) - 50) when lv_gross > 1000}` (ELSE reads as `NOT (…)`, a WHEN as `x = value`). A click on a node or on `</>` in a Value origin window opens the source again - a shared script had broken the page's own script, and with it every click. A script that fails in the window is now reported, and a node with no source to open says so.
- **Interface methods.** A double-click on a call through an interface reference (`lo_strategy->calculate_base(`), or on a method name in an interface's METHODS, goes to its implementation as SAP's navigate-to-implementation names it, instead of stopping at the interface.

## 2026-10-07 — VS Code 0.8.6: Get started, a shorter Command Palette

- **Get started.** A first install opens a VERTEX page in VS Code's Get Started (later: Help > Get Started > VERTEX) with the four steps - import the SAP systems, test them, choose the assistant, and optionally add the VERTEX MCP server to Claude Code or Codex - each with its button, ticked off as it is done.
- **Command Palette.** VERTEX shows six commands everywhere (Open Panel, VERTEX Tools, Import / Test SAP Systems, Forget Password, Add the VERTEX MCP server to Claude Code or Codex); the editor commands - activation, tests, ATC, F1, Go to, value origin, Visual Debug, debugger steps - appear only in an ABAP editor, and the VERTEX Tools submenu functions, Back and Switch System (the panel's system list) only where they are used. Keys, menus and links work as before.

## 2026-10-07 — VS Code 0.8.5: SAP system setup, exits in Logic, long sources

- **SAP system setup.** **VERTEX: Import SAP Systems** fills `vertex.systems` from what the machine already has: each system's host and instance from SAP Logon (a logon group through its message server's host), the client and user from an Eclipse ADT workspace - the recent workspaces of the Eclipse installations found on the machine are offered - and the ADT address found by trying the usual ports (443NN and 80NN for the instance, then 44300, 8000, 50001, 50000, 443, 80, 8443, 8080). Only addresses that answer are offered, and nothing is written before the reader picks. **VERTEX: Test SAP Systems** logs on to each system and says what is wrong; the password goes to the OS credential store, never to settings. The import also checks where the debugger can open WebGUI (`/sap/bc/gui/sap/its/webgui`): on the system's `url` it needs nothing; served on another address that answered - say `url` on HTTP 8000, WebGUI on HTTPS 44300 - or behind a redirect to a host this computer resolves, it writes that as `webgui`; found nowhere, it says so, and `webgui` is set by hand. Both are links under `vertex.systems` in Settings, and a start with no system configured offers the import.
- **Logic diagram.** RETURN, LEAVE PROGRAM and an EXIT outside a loop end their branch and are drawn in the theme's error colour, instead of a line across the whole diagram to ENDMETHOD.
- **Long sources.** SAP's analysis of a source - hover, Go to Definition, F1 - is refused only above 50,000 lines (was 20,000). Above that F1 still works: SAP is sent only the statement at the cursor (a whole chain, across its lines), cut out with abaplint.
- **F1 and Go to Type Definition** wait for a hover's SAP analysis that is still running, as Go to Definition does, instead of failing with "SAP is still analysing the previous request".
- **Chat and reviews.** A question asked while a Tools window shows an object of a review carries that object's changes - the changed lines with three around them, each review block marked with its number, author and verdict - as it already did for a version diff.

## 2026-10-07 — VS Code 0.8.4: FLOW tree in BSE

- The FLOW tree in Value origin: switching between Full and BSE keeps the branches open as Expand all / Collapse all and Depth set them (BSE used to show everything collapsed). The tree's root keeps Expand all and Depth even when nothing is left under it, so the depth slider no longer disappears. Depth for calls starts at 1.
- Chat: when a bare object name finds several objects, each name in the list is a link that opens the object, as a single match is opened.
- Tools: the Logic only switch no longer shows in UML or Metrics while the window is still loading; it belongs to the Logic diagram only.
- Tools UML: while a diagram loads, the diagram area says what is happening - checking the system, reading the class or the package's classes, loading the diagram library, drawing.
- Chat: every answer has a Copy button under it; it copies the answer's Markdown through VS Code's clipboard and says Copied or why it failed.
- Chat: "VERTEX:" stands on its own line, so an answer that starts with a heading or a list shows it as one.
- ABAP: the ACE core (`ZCL_VX_ACE_*`, `ZIF_VX_ACE_*`, `Z_VX_ACE_SCHEME_TEST`) and the hub routes that served it - `metrics`, `class`, `package`, `flow` (`ZCL_VX_ADT_RES_METRICS`, `_CLASS`, `_PACKAGE`, `_FLOW`) - are removed from the repository. VS Code and Eclipse compute UML, metrics, Calls, Logic, FLOW and the statement map themselves from ADT source with abaplint. The other routes stay: table, join, versions, review, prepare, requests, about. Installs older than the move to client-side analysis still ask for the removed routes.
- Review: the Inline | 2 pane switch of the version diff is in a request's review too; in 2 pane each block's bar with Approve, Decline and Comment spans both columns above its change. The choice is shared with the version diff.
- Tools: while the window asks the SAP system what it offers, the page says so in its main area (it used to say it only in the small status line).
- 2 pane (version diff and review): the new version is always on the left and the old one on the right, and the heading names the new one first.
- Eclipse chat, as in VS Code: names in a list of found objects are links that open the object, and every answer has a Copy button that copies its Markdown through Eclipse's clipboard.
- Eclipse: opening a function module from VERTEX (Tools, the chat) failed with "Function module ... was not found" for every function module; it opens now, a standard one too: when the search by type leaves it out, the exact name is searched without the type, as in VS Code.
- Logic diagram: a TRY is drawn as a branch - the TRY body and each CATCH start from the TRY and meet at ENDTRY. A RETURN inside a CATCH no longer ends the whole diagram; the method goes on after ENDTRY.

## 2026-10-07 — VS Code 0.8.3: Predict past chains and loop tails, refused breakpoints

- A breakpoint SAP does not accept (a declaration line, for example) is taken off the editor's gutter again; SAP's refusal is still shown. Before, the red dot stayed though the run would never stop there.
- Predict with BSE passes a chained statement (`WRITE: / a, b, c.` over several lines) outside the slice in one F8 again. Every element of the chain was placed on the keyword's line, while SAP stops on each element's own line, so the page did not recognise the stop and stepped through the chain line by line, on every pass of a loop.
- Predict with BSE skips the rest of a loop pass once the slice has nothing more in it: from the last place of the slice in the pass, one F8 to temporary points on the first statement of the loop body (the next pass) and after the loop (the last pass), instead of stepping to ENDLOOP every time. Not over a breakpoint, and a call that is in the slice is still entered. The run's summary counts the passes skipped this way.

## 2026-10-07 — VS Code 0.8.3: flow readings, diagram controls and types

- Value origin draws again. The shared flow script used its identifier normaliser before defining it, and the page stopped after the heading.
- FLOW readings: one switch, **Classes / Methods / Logic / Statements**, in Value origin and in Visual Debug. All four are readings of one source, drawn by the one shared builder. Value origin opens at Methods. A reading is built the first time it is shown. BSE has no Logic reading: Logic is hidden there, and a Logic view turns to Statements.
- Toolbar: Tree / Diagram comes first. One Expand all / Collapse all button, whose SAP GUI chevrons show what a click does. Depth stands beside it at the root of a tree and beside Fit in the diagram. Every control explains itself on hover. The Analysis log is behind the bug control, with the other technical sections.
- Node menu (right click on a node or a routine frame): **Show from here** draws only that branch, and a path bar above the diagram (or Esc) goes back. The branch is kept across readings. **Expand this branch** and **Collapse this branch** open or close one branch only.
- Diagram direction **Auto** (default) draws the diagram both ways and shows the one that fits the window at the larger scale. Top-down and Left-right fix the direction by hand.
- Diagram reading: WHEN is the label on the line from its CASE, not a second box. Edge labels stand on the editor background, so no line runs through them. Labels show the code as written — `<>`, `<fs>`, `=>`, `&` — in FLOW and in the Tools Logic diagram (no more `NE` or dots). In BSE a kept block keeps its ENDIF / ENDCASE / ENDLOOP.
- Theme: diagram colours come from the editor theme only, and a missing theme colour is reported by name. Routine frames follow the theme in every layout: light blue on light themes. The magnifier keeps the diagram colours. Dragging the diagram no longer selects text.
- Navigation: a click on a FLOW diagram label opens the code again. A click in a Tools diagram scrolls the editor that already shows that source instead of opening a second copy. Back (Alt+Left) returns from code opened from a diagram.
- Types: the hover of a name declared inline (`DATA(x) = …`) shows the declaring statement and the type SAP gives it. **Go to Type Definition** opens the `TYPES` declaration of a variable's type in its class or interface.
- Visual Debug: the separate Logic button (the Tools logic diagram of one method) is gone; Logic is a reading of the flow.
- Tools Logic follows the editor while it scrolls: when the source scrolled to is another method, its logic diagram replaces the shown one (before, only a cursor move did that). The Eclipse plugin's Tools window does the same from the ADT editor's scrolling; it is in the Eclipse plugin build 0.8.1.20261008145448.

## 2026-10-06 — VS Code 0.8.1: release preparation

- Standard ADT + bundled abaplint analysis for Metrics, UML, Calls, Logic and Value Origin. Demand loading, cached source and signatures, and traversal limits reduce unnecessary reads.
- Visual Debug retains Classes / Methods and embeds the standard Tools Logic diagram through a separate Logic toggle. It follows the active source editor and selected routine across objects.
- Logic only keeps branches, loops, calls and exits; full operations remain available without folding. Nested conditions, ELSEIF joins, procedure endings and RETURN transitions are retained.
- Linked labels and breakpoints navigate to source. Conditions link external calls; source ranges highlight multiple nodes, and LOOP / ENDLOOP highlights the loop frame.
- Compact theme-aware controls, 10–100% zoom, a lens capped at effective 70%, focus-driven scrolling and theme changes without autofit. Detach follows debugger connection state.
- Analysis progress updates every three seconds. Diagnostic logs are available from the bug control. Built-in help and release documentation describe the final controls.
- Includes abaplint's MIT licence. The build stays at 0.8.1; the earlier 0.8.2 development label and separate experimental command are superseded.

## 2026-10-05 — VS Code 0.8.0: one flow, one formula, an Expression, the variables before the run, one magnifier

0.7.15 was never released; its changes are part of this release.

- **The assistant sees the open Value origin window as it is on screen.** The window reports its mode and depth, and the
  question carries what that mode lists: the flow (statements by call depth, marked where the value's slice reaches
  them) or the formula derivation - within the depth set, labelled as analysis, not a run.
  A Tools window that is closed no longer stays in the assistant's context.
- **Calls start over from the object.** The "From: ..." chip over the Calls diagram is gone; a click on the object's name at the top of the parts list draws the whole program again.
- **A breakpoint removed in Visual Debug stays removed.** The editor's own breakpoint is the one VERTEX restores on every reload, so removing the point only from the debugger's list brought it back; removing it there now removes it from the editor too.
- **No metrics help in the diagrams.** The `?` that explains the metrics shows in the Metrics table only, not over Classes, UML, Calls and Logic diagrams.
- **Expression: the derivation as one formula.** A third mode beside FLOW and Formula writes the derivation of the value
  out as one formula, by substitution: each definition stands where its value is read, and a step that adds or takes off
  a share of the value before it is written as that value times one plus (minus) the share, so the formula grows by a
  factor per step, not by a copy of everything before. What is read more than once stays a named step; under the formula
  is where each value comes from. Type conversions (`CONV decfloat34( ... )`) are left out of both Formula and Expression.
  The debugger's flow path has Formula and Expression too, drawn by the same code, and the assistant is given whichever
  is on screen. A value that comes from a table is written by its own name (`WEIGHT_KG`) as a link to the statement that
  reads it; the class shows on the pointer and one click opens it, and only two values of one name carry the class. Under the formula each value shows the SELECT that reads it, cut to the field that
  concerns it, the table and the conditions (`WHERE field_name = 'VOLUME' AND action = 'DISCOUNT'` - what tells two values of
  one name apart), not the other fields it fetched with it.
- **The formula follows the loaded pipeline.** When a scenario's pipeline is loaded in Value origin, the definitions a loop
  over it makes (every modifier's APPLY) stand in the order the pipeline runs them, each under the one after it, so a
  value such as the amount reads as the chain it is. A modifier the pipeline lacks is named above the tree as not run.
  Without a loaded pipeline the definitions stay side by side: their order is data, not code.
- **A formula is not repeated.** A definition that several inputs of a formula lead to - the same SELECT under each field
  that reads it - is derived once, where it first appears, and not drawn again; the diagram's graph still has every edge to it.
- **One Formula too.** The derivation of a value as formulas is built by one file, `value-origin-formula.js`: Value origin
  draws its Formula view from it and the debugger's flow path gets the same graph from the analysis, so Formula is no
  longer empty there.
- **One flow builder.** The FLOW of Value origin and the debugger's Analyze flow path were drawn by two different
  algorithms, and Value origin's read as a list of scopes rather than as code. The graph is now built by one file,
  `vertex-flow-graph.js`, from rows of statements and the calls made in them: classes, routines and statements nest
  as the calls do, in execution order. Only where the rows come from differs - the analysis of the chosen value in
  Value origin, the analysis from a breakpoint in the debugger.
- **One magnifier for every diagram.** The lens was written three times (Tools, the flow of Value origin, the
  debugger's diagram) and the debugger's copy went out while the pointer moved: it hid itself whenever the
  diagram was shown above about 80%, a rule the Tools copy had already dropped for flickering. It is now one
  file, `vertex-lens.js`, that all of them load - the best of the copies: over any point of a flowchart, over a
  node of a class diagram, no size rule, Shift and the wheel for its strength - and the switch is the same
  magnifier icon everywhere, in Tools too (it was the words *Lens off* / *Lens on*). (Tools in the Eclipse
  plugin takes it when that is next built.)
- **Collapse all / Expand all are one switch beside the depth, not its ends.** They were the two ends of the depth
  slider, so pressing one moved the depth and the switch could not stay where it was put. They are now one
  button after the slider that offers the other each time - *collapse* (while everything shown is open), then
  *expand* - and says whether the levels that are shown are open; the depth says how many levels there are. A
  depth of 3 with the levels open shows three levels open, collapsed the top only, and moving the slider keeps
  the switch. In every view that draws a flow (the debugger's diagram, Value origin). The Eclipse plugin takes
  it when it is next built.
- **The depth thumb stays where the limit is.** Changing the reading of a flow (classes, routines, statements) changes
  how deep it can be, and the slider kept the thumb where it had been while the label said *all*. The thumb is now
  put at the end for *all* and at the limit otherwise.
- **Opening or closing a node no longer refits the diagram.** Every drawing of a flow ended in a fit to the pane, so a
  click on a block that opened it threw the reader's zoom and place away. A drawing is fitted when it first
  comes, when the view or the direction changes, and when the pane changes size; one that only opened or
  closed a node keeps what the reader had.
- **The chat is given what Visual Debug shows, in two labelled parts.** A question put to the chat now comes with
  `recorded` - what the program actually did (the stops of the run in order, the depth of each below the first,
  the statements of the chosen value's slice marked), only as deep as the Depth control shows, consecutive
  repeats once - and `analysis` - what static analysis says the flow is between the two breakpoints (in
  execution order, the slice marked), said in its own text not to be what ran. Neither is added when the window
  has neither, and each is capped at 150 entries. The debugger's tools for the assistant (MCP) are not
  changed yet.
- **The depth counts classes by their calls too.** In the Classes reading of a flow every class stood at depth 1, so
  the depth control stopped at 1 or 2 while the calls were four deep. A class now stands at the depth of the call
  that first reached it, as a routine and a statement do.
- **Tree / Diagram are icons.** The switch between the tree and the diagram of a flow is a list icon and a
  diagram icon, each named by its tooltip, like the other controls of the flow view.
- **No value, no BSE, no Formula.** With no value chosen the diagram reads Full and FLOW, and the Full/BSE and
  FLOW/Formula toggles are not offered (Formula is how the value was computed); they appear with a value, and
  clearing the value puts the diagram back on Full and FLOW.
- **Variables before the run, for the place the reader is in.** They are read when the panel opens, and again as
  the reader moves: the place is the cursor's line in the VERTEX source in front (the host tells the panel), else
  a breakpoint's, else the program under debug. In a method or a FORM the Params and Locals are shown and the
  Globals are not - they are read when the Globals switch is turned on; outside every routine (a program's
  events, a class's own text) the globals are what there is. Names and types, no values: those come with the
  stop. A right-click follows a value, so the slice can be asked for before anything runs. A variable declared
  by a call has the type the method returns, and a variable of a structure type opens to its components (the
  TYPES BEGIN OF block that declares it, read from the tokens): `ls_result` opens to `shipment_id`, `amount` ...,
  and a component is followed by its path, so `LS_RESULT-AMOUNT` can be chosen before anything runs. A structure
  declared in an interface or class the analysis did not load is read from it; one that cannot be read is marked
  `?` on the variable and named in the notice. A type declared in the dictionary, not in the sources, has no
  components to show. An object above 20,000 lines is not read on its own: Analyze flow path does it.
  The analysis now finds a call inside the arguments of another (`io_log->add( iv_step = me->name( ) )` is two),
  a method named like a statement after an arrow (`lo_log->add( )` is no ADD), a receiver typed by the routine's
  own signature (`io_log TYPE REF TO zcl_calc_log`), and the parameters of a FORM.
- **SYST, Initials, Stack and Log only when there is a run.** They are about a stopped program's values and
  stack and about what a run did; before the run Variables shows names and types, and these switches are not
  there. Stack, SYST and Initials go while the program is not stopped; Log stays once a run has left rows in it.
- **A section the reader closed stays closed.** Following the cursor or a click on a method brought the Variables
  section back each time an answer came. A section is opened for the first answer of a state (the program
  stopped, or not) and left alone after the reader has closed it, until the state changes.
- **A click on a method no longer fails while a hover is being analysed.** Hover, Ctrl+Click and F1 post the whole
  source to SAP, and one such request runs at a time (a 147,000-line program hovered word by word froze the
  machine). A click made while the hover on the same word was still running was answered "SAP is still analysing
  the previous request". A click now waits for the one running and is then made; a second hover is still
  refused, it is the cheap repeated kind.
- **The analysis waits its turn.** The variables are read as the cursor moves, and the session of SAP takes one
  request at a time: a second was refused as busy ("SAP session is busy. Use separate sessions for parallel
  operations."), shown to the reader though nothing was wrong. The analysis's requests (the points, the variables,
  a link's source) now go one after another through a gate; of the variables only the newest request waits; a
  session busy with something else is waited for for a few seconds before it is reported.
- **The panes follow the program.** Before it stops there is no stack and there are no variables, so
  those sections stay closed and the breakpoints show as soon as there are any; when the program stops the
  stack and the variables open. A pane the reader closed stays closed until the next change.
- **Analyze flow path on a breakpoint.** The Breakpoints panel groups the points by object, and each one has
  *Analyze flow path*: the same analysis as Value origin, from that point to the next checked point the flow
  meets - in the same object or below it on the stack, in a routine the flow calls (a point at
  `ZCL_CALC_FACADE:34` ends a path that starts at the program's line 10). The start may be in a program, an
  include or a class: in a class the method is found from the analysis's declarations and ADT's start for it.
  The flow - ACE's statement stream in execution order - is drawn in the diagram the run's record is drawn in
  (Classes, Methods, Statements; Full or BSE): the program, its classes and routines, the statements under them
  with each IF, CASE and LOOP the parent of its body, a called routine's statements under the statement that
  calls it. The end statement is the last one drawn; what it calls is not. With a value chosen the statements
  its slice reaches are marked. A value is not needed: the slice only marks. The drawing keeps the order of
  execution and the stack. A call whose receiver the analysis cannot type is not nested (a call inside the
  arguments of another is), and a routine no call of the flow reaches is not drawn (the notice names it). A call
  to a routine the flow lists no statement of is still drawn, as a block with nothing under it, and the notice
  names it. A node opens as Value origin opens its own (the sources of the analysis, so a class's statement lands
  where Ctrl+Click would), not by the debugger's lines; a class or a routine opens its METHOD, not its first
  statement. A class that was only instantiated with `NEW` and has no constructor has no statement in the flow,
  so it has no node. A recorded run replaces the drawing.
- **Predict is on by default.** On the test program, following the value with Predict: 146 steps in 97.7 s
  before these changes, 111 steps in 67.4 s after (19 of them predicted, 18 stepped over).
- **Predict passes what the slice does not touch.** With a value followed and its analysis loaded, a
  straight-line run of statements outside the slice - a log call included - is passed in one go: a
  temporary point on the first statement that is in the slice (or branches, or ends the routine) and F8.
  A single call whose classes hold no place of the slice is stepped over with F6. A call that does hold
  one is always looked into, and a breakpoint on the way cancels the shortcut. The stats line counts the
  runs as "runs past statements outside the slice".
- **Predict passes an IF or CASE block with no place of the slice in it.** The block is run past with F8
  to what follows its end, as a loop is; a breakpoint inside it, or a place of the slice, keeps it stepped
  through. While a value is followed and its analysis is loaded, a call that is not itself a place of the slice
  is stepped over (F6) and the record keeps the line it stood on; a call that is a place of the slice is
  entered, so the calculations inside it stay in the record and in BSE. The stack is not read after an F6
  (the depth is the one it was); a breakpoint SAP reports on the way still makes it read.
## 2026-10-03 — VS Code 0.7.14: the source is the editor

- **View source is gone; the source is the editor.** Opening a 147,000-line program (zabapgit) in
  the Tools window's View source froze the machine for minutes: the page drew a DOM row for every
  line - roughly 670,000 nodes - and the browser's layout and paint took about five. The standard
  editor is fast because it draws only the lines on screen, and VERTEX is not in the business of
  competing with it. The function was removed from the model of both hosts rather than patched:
  an object opens in its VERTEX tab, and its structure is VS Code's Outline (Ctrl+Shift+O, the
  breadcrumbs). An object in Tools now starts on UML (class) or Metrics (program). The Parts
  list stays for the Logic and Calls diagrams, which follow one part; Metrics and UML draw the whole
  object and no longer show it. The Eclipse plugin was changed the same
  way (the page, its bundle entry and `sdeSource`) and was not built.
- **Visual Debug is no longer a Tools function.** The docked panel beside the editor replaced it
  and works; the copy in the Tools window had its own source pane and was already broken by the
  change above. The docked panel no longer builds its hidden source pane either.
- **SAP is asked about a name only for a source that fits.** Hover, Ctrl+Click and F1 post the
  whole source to ADT for every name, and SAP analyses all of it each time. Above 20,000 lines
  the request is refused with a message instead of sent, one such request runs at a time, and one
  that outlives 20 s is given up (SAP may still finish it; ADT cannot abort a request).
- **A value is followed from a menu, not by a click.** In Visual Debug's Variables a click on a
  variable's name used to switch the analysis to it, which happened by accident on every
  structure. It is now a right-click: **Follow … in the analysis** / **Stop following …**, with
  **Copy name** and **Copy value** beside it.
- **Predict no longer loses a loop it knows nothing about.** A loop was passed in one go (F8 to the statement after
  it) although its body held the calls that lead to the value - no modifier was recorded. A debugger does not skip a
  loop: it is stepped through, unless a value is followed, its analysis is there, and it has no place between the
  loop and its end - then what the run would record in the loop cannot lead to the value, and it is passed. The
  analysis starts when the value is followed, before Continue; a run that is faster than it simply steps through the
  loop, and the picture is whole once the analysis arrives - the run never waits for it.- **A chain is one step: the next statement is on another line.** `WRITE: / a, b, c.` is several statements of the
  statement map on one line, and the prediction took the second half of the line as the next statement - "expected
  line 42 after line 42; SAP says 43". F5 runs the whole line, so the next is the first statement of another line.
- **The `</>` of a node in Visual Debug's diagram opens its source.** The diagram's link calls `bseMermaidOpen`, which
  only the Value origin panel defined, so in the debugger a click did nothing. The window now defines it: the node's
  place is opened in the editor beside the panel, like the link in the tree.
- **The analysis of a chosen value runs beside the debugger.** It was asked through the queue every step and every
  variable read goes through, so a run waited seconds for it. It has a channel of its own, answered by the number of
  the request, and Run in SAP is light green.
- **BSE stays green.** The flow views took the green away in the BSE scope (everything left is in the slice, so
  nothing needed marking), which hid the one thing that tells a reader the scope has changed. Everything the BSE scope
  shows - the statements, the routines, the branches that lead to them - is green, and what it hides was the blue.
- **The path to a result is part of the slice.** A call into `modifier_for`, its `CASE` and the `WHEN` the run went
  through to a statement of the slice stayed blue, so in BSE they would have been drawn only as anything that leads
  somewhere, and the picture broke between the green call and the green statement. What leads to a statement of the
  slice - the call, the routine, the `CASE`, the `WHEN`, the `IF`, the `LOOP` - is now coloured as part of it, before
  anything the slice does not reach is hidden; logging, which leads nowhere, stays out.
- **The analysis starts from where the value is last used, not from where the run stands.** The slice asks what led
  to a value up to a statement; asked from line 10 or from the call on line 15 - where the run was - the value had no
  history yet, and the answer was two nodes ("read 96 sources, 2 nodes in the slice"). It only came out right when
  the run happened to stand on the last line. The host now starts from the last place of the source that names the
  value (a name in a literal or a comment is no use), as the cursor would stand on it in the editor; the run's own line
  is a fallback for a name the source does not contain.
- **A slice that agrees with nothing is no longer silent.** The chosen value's chip now says how many places the
  analysis found and how many stops of the record stood on them (`LS_RESULT-AMOUNT · 29 places · 14 of 175 stops on
  them`), and when the two never meet the red line names samples of both sides. A slice that came back empty was also
  kept for as long as the value was chosen - only a failed request was forgotten - so one bad answer outlived every
  later run. The analysis of a value is read once, as the value is chosen, and kept for the runs after it: a run asks
  again only when the answer it holds is empty (a first one may have come at a bad moment), never for one the user
  already waited for.
- **The analysis starts from the object's own frame.** Following a value while the run stood inside a called method
  passed that method's line to the analysis of the program ("read 96 sources, 2 nodes in the slice"). It now uses the
  program's own frame on the stack - the statement after the call it is on, when the run is inside one - and says
  so when the program is not on the stack at all.
- **A class pulled again no longer leaves the debugger on its old method lines.** The method starts of a class were
  read once and kept for as long as the extension ran, so after a class was changed in SAP (its methods moved) the
  slice's lines were converted with the old starts and matched nothing: no statement was green. A record and an
  analysis now read the class structure afresh.
- **The slice and the record now count a class's lines the same way.** ACE counts the lines of a method inside its
  own include (`METHOD` is line 1), the debugger in the class's main source. So the slice's `rs_result = ls_context.`
  (line 14 for ACE, 28 for the debugger) was marked on line 14 of the debugger - `ENDMETHOD` of `modifier_for` - while
  the statements that really change `cs_context-amount` were not marked at all. The points are moved to the debugger's
  lines from ADT's class structure (and the same lines place Points' breakpoints). Full marks the slice green and BSE
  shows only it; the statements are named as the analysis names them, which the statement map cannot do for two
  statements on one line.
- **The record's diagram draws the branch the run went through.** The debugger stops on statements, never on a
  `WHEN` or an `ELSE`, so the branch a statement ran in was missing and the statement hung straight under the `CASE`.
  The blocks a statement stands in are now made from the statement map - `CASE`, the `WHEN` it went through, the
  statement - and a branch no statement ran in is not drawn.
- **A line of several statements shows the one that does something.** Legacy code often writes `METHOD create.
  ro_strategy = NEW zcl_price_road( ). ENDMETHOD.` on one line, and the debugger names only the line. When the record
  cannot say which statement the run is on, the diagram showed the whole line as one node; it now shows the first
  statement that is not a `METHOD`/`FORM` header or an `END…` closing, and the statement the run did name is shown as before.
- **Following a value asks for its slice at once.** The slice was fetched only when BSE or Points was first pressed, so
  Full - which marks the slice - showed nothing green after Follow. It is fetched when the value is chosen.
- **A statement that only closes a block is not a step of Visual Debug's diagram.** `ENDMETHOD`, `ENDSELECT`, `ENDIF`
  and the like were drawn as steps - the debugger does stop on them - though no diagram of a value or of calls
  ever drew one. They are left out, by the keyword the statement map names for the line.
- **The source links of Visual Debug's diagram move the editor.** The `</>` button of a node showed the line in the
  panel's own source pane, which the docked panel does not have, so it did nothing. Docked, it now moves the editor to
  the statement, as a replayed stop does.
- **A literal or a comment has no history, and the analysis says so.** **Analyze Variable Value Origin** on a word
  inside `'Returned result:'` used to analyse `RETURNED` as if it were a variable and draw an empty "unresolved"
  result. With the cursor in a text literal or a comment it now refuses with that sentence.
- **Visual Debug's Points and BSE use the slice the Value origin view draws.** Following
  `LS_RESULT-AMOUNT` answered "no place that changes it" while the editor's analysis drew the whole chain through
  `RUN`, `calculate_base` and the modifiers: the debugger took its places from a separate list of ACE flow rows that
  the slice had to "reach", the editor from the slice's own statements. Both now read the statements of the slice.
  The analysis was also started one statement too early: Visual Debug passed column 0 of the stopped line, which
  for an indented `WRITE` lies before the statement and anchors on the one above it, so the slice had two nodes
  ("read 96 sources, 2 nodes in the slice"). It now starts at the variable's place in the line, as the cursor does.
  An empty answer still says what was read (sources, nodes, flow rows).
- **Visual Debug shows the average speed of a run:** `36 steps (0 predicted) · depth 4 · 25.6 s ·
  1.4 steps/s on average`.
- **Copy in the step log works in the docked panel.** The button had a handler only in the Tools window,
  which no longer has Visual Debug; the panel answered it with "no command copy".

## 2026-10-03 — VS Code 0.7.12: one flow view, one record, one place for each control

- **BSE in the record is the analysis’s slice, and each place watches its own names.** Marking
  only the stops where the chosen value changed found almost nothing, and for a good reason: a
  value crosses into a called routine under another name - `lv_scenario` becomes
  `IV_SCENARIO`, then a field of a structure - and no reading of recorded values can see that.
  The analysis can, and that is what it is for. The slice it returns now marks the flow, and at
  each of its places the run reads the names that place is about: what the statement changes
  and what it is made of.

- **Breakpoints from the analysis: stop where the value can change.** Choose a value in
  Variables and press **Points**: the analysis that answers *where did this come from* is asked
  once, before the run, and every place it names - across the called classes, not only the
  program - gets a breakpoint. The run then stops where something can happen to that value
  instead of stepping through everything, and each stop reads it. Nothing is asked of the
  system while the run goes. Places SAP will not take a point at are named rather than dropped
  quietly, and a stop where the value did not change is kept and marked - a slice that names
  many such places is a slice worth looking at.

- **A value is chosen in Variables, and BSE is the record narrowed to it.** Clicking a
  variable - a component of a structure as readily as a name, since the row already knows
  which - marks it as the value being followed. **BSE** then shows the routines the record
  says it changed in and the calls that led there; **Full** shows the whole record. It is
  rebuilt in the window from what the run already read: no new run, and nothing asked of the
  system. What the record cannot answer it says instead of drawing: values are kept where a
  routine starts and ends, so the answer is a routine rather than a statement, and a record
  made without values, or one that keeps a structure without its fields, has nothing to narrow
  by and says so.

- **The hidden frames are named, and only mentioned when there are any.** The stack left out
  what is under the object - whatever started it - and said so in a row of the table reading
  *caller frames hidden (test frame, screen)*, which was a guess and often simply untrue: a
  report started from SE38 has no test frame. It is a button in the Stack heading now, naming
  the frames it leaves out, and it appears only when something was left out.

- **A run is recorded unless you say otherwise.** The record control starts at **Rec steps**:
  Continue is a run of F5 steps and every stop is kept, which is what the window is for. **No
  record** hands Continue back to SAP, and **Steps & values** adds the values at each routine.

- **The player moves the editor.** Docked in VS Code the debug panel has no source pane of
  its own - the editor is the source, by design - so walking the record with the slider drew
  the stop into a pane nobody can see and the code on the left stood still. A replayed stop
  now opens where a live one does: the same tab, the same group, the line revealed.

- **One request at a time, and the player moves the source again.** The host answers every
  request with the same kind of message, so the only thing telling one reply from another is
  its turn in the queue - which holds while a single request is in the air and breaks the
  moment two are. A source read and a script asked for as an asset came back the wrong way
  round: the source read was handed a file of JavaScript to parse as JSON, said so, and the
  slider stopped moving the source while the diagram lost its view. Requests now go one at a
  time and the rest wait their turn.

- **A reopened SAP tab reads the system again.** The text of a source tab was remembered with
  the tab, and after a window reload that remembered copy was shown - which could be older than
  what is active in SAP, and whose line numbers are then not the ones breakpoints and the
  debugger use. A tab restored from a previous window now reads its object from SAP the first
  time it is opened. If the system cannot be read, the copy is kept and a message says so.

- **A breakpoint SAP refuses says what is on that line.** `Cannot create a breakpoint at this
  position` is SAP’s answer when the line carries no statement - usually because the editor
  shows something the system has not activated, so the lines no longer agree. The message now
  quotes line N of the active version, which makes the mismatch plain.

- **The Marketplace page opens with the picture again.** Every release had added a paragraph
  about its newest change to the top of it, and a *Testing Value Origin (0.7.x)* section with
  install steps for a test build - release notes, which is what this file is for. They are gone:
  the page opens with what VERTEX is, the architecture picture, and the table of tools under it.
  What was durable in them - what FLOW and Formula are, Depth, Tree and Diagram, and what the
  analysis does not claim - is now a **Value Origin** section among the other tools.
  The repository page had the same pile on it and is cleaned the same way: it opens with
  Install and the picture, and what Value Origin is has a section of its own.

- **The Marketplace line says what the extension is for.** It used to read as a list of
  internal names - *chat and code reviewer with Save & Activate, Versions/Reviewer, Data/Code
  Explorers + MCP server* - leading with a secondary feature and spending its space on what
  every ADT client already does. It now names what is here and nowhere else, in that order:
  value origin without running the program (BSE), debug recording with replay, code review,
  explorers, UML and metrics, and the object and function context it gives an AI client over
  MCP.

- **The window says where it is in the reader’s words.** A stop was named by the include SAP
  reports - `ZCL_MOD_CUSTOMS===============CM001:13` - and now by what a reader calls it,
  `ZCL_MOD_CUSTOMS=>APPLY:13`; a form or a program is named as itself. The run statistics lost
  the window’s own share of a step, which was the remainder of a subtraction and told nobody
  anything. A click on a source link in the flow opens that line in the window. The diagram
  pane fills the section, so **Fit** has a height to fit into, and full screen covers the
  window instead of being drawn under it.

- **Three things the flow tree was missing.** An inline declaration is written as the name it
  declares - `lo_log = NEW zcl_calc_log( )` rather than `DATA(lo_log) = …` - because what the
  statement does is the assignment and the source keeps the rest. A routine reached a second
  time is named where it was reached and marked, not opened again: its body stands once, where
  it first ran. And **Fit**, the zoom, the full screen and dragging the diagram work in the
  debug window as they do in the analysis - they were the analysis page’s own script, and are
  now part of the view, like everything else that draws a flow.

- **A line holding several statements is several nodes.** `METHOD create. ro_strategy = NEW
  zcl_price_road( ). ENDMETHOD.` was one node carrying the whole line, because the record kept
  only the line. SAP gives a debugger the line and nothing finer, but the window knows more
  while it steps - the statement map lists what is on the line and the run tracks which one it
  stands on - and the record now keeps that too. Each statement is its own node with its own
  text, cut on the periods that end a statement and not on those inside a literal. Where there
  is no map, or the stop was reached by a breakpoint rather than by stepping, the line is one
  node as before.

- **Every reading of a record is drawn by the one flow view.** Classes, Methods and
  Statements all hand their graph to the script Value Origin draws with, so each of them now
  has a tree beside its diagram, Top-down / Left-right, Collapse all / Expand all, Depth, the
  magnifier and the zoom. The window has no drawing of its own left: what it owns is the
  record and the three ways of folding it - by class, by routine, by statement. Where the
  program stands is marked by the view itself, in its tree and on its diagram, so the player
  keeps its place through all three.

- **The debug window draws its record with the analysis's own flow.** Choosing *Statements*
  in the player now hands the recorded graph to the same script Value Origin draws with, and
  what appears is that view: the tree beside the diagram, Tree / Diagram, Top-down /
  Left-right, Collapse all / Expand all, Depth, the magnifier and the zoom. The window shows
  none of its own controls there, because they would be a second control for the same state.
  The difference between the two pictures is now the data alone: one is what ACE derived, the
  other what the program did.

- **The recorded flow has one top, and nests by block and by call.** It had hung every class
  off the root and every routine off its class, so the picture fanned out of one point and every
  call crossed it. The top is now the routine the run started in - one node, not a program node
  repeating its name. Under it, a statement stands in the nearest block it ran inside - IF,
  CASE, LOOP, DO, WHILE, TRY and their branches - and statements of one block are siblings in
  the order they first ran. A call is the one other way down: the statement that called leads to
  the routine it entered, which carries the deeper stack. A routine is one node and keeps its
  class with it, because a class is not a level of the stack and a method without its class
  names nothing.

- **The record is one control with three positions, and Visual means drawing again.** Reading
  the values at a stop is its expensive half - the step itself is a line and a stack - and a run
  is often recorded for its shape alone. So the record is a single choice: **No record**, **Rec
  steps**, or **Steps & values**, where the third also reads the parameters and locals where
  each routine starts and ends. **Visual** is gone: a run always shows where the program is -
  there was never a reason to watch a window that stays still - and that toggle had been
  arguing with the record over one action. Recording is now the whole of the choice: with it
  off, Continue is SAP's own; with it on, Continue is a run of F5 steps, drawn as it goes, and
  the record keeps the steps alone or the steps with their values.

- **One control per section, and the diagram draws again.** A section was both shown or
  hidden by its button and folded by its heading - two controls for one state, which can only
  disagree; the heading no longer folds. And the Value Origin diagram had stopped drawing at
  all: moving the script out of the page left two strings escaped for a template that is no
  longer there, so Mermaid was handed `flowchart LR
bseroot[...]` on one line and a zoom
  pattern that matched nothing.

- **The flow is drawn by one script.** The tree, the diagram and the controls over both -
  Full / BSE, Collapse all / Expand all, Depth - were written into the Value Origin page as it
  was generated, so a second view that draws a flow would have been a second copy of them.
  They are one file now, served to the page like the diagram library, and what the page used to
  write into the script - the title, the BSE caption, the depth maxima - travels in the graph
  instead. A host with no address to serve files from carries the same file inline, so there is
  one source either way. The view itself comes with it: the Tree / Diagram toggle, the panes,
  the diagram toolbar with Top-down / Left-right, the magnifier, zoom and Fit are built by that
  script, so a window that draws a flow gives it a container and a graph and gets the same view.
  The analysis still owns what goes inside its panes and hands them over as templates. Nothing
  about the page changes for the reader; what changes is that the debug window can draw its
  recording with the same code.
  Its styling travels with it as well - the panes, the diagram, and the tree down to the
  indent of a branch and the look of a source link - so a window that draws a flow needs
  nothing of the analysis page but the data.

- **The recorded run draws as statements, the way Value Origin draws a flow.** Beside
  *Classes* and *Methods* the player has **Statements**: the program at the root, a class under
  it, a routine under the class, and the statements the run stood on nested in their own blocks
  - an edge is containment and carries the line, a call is an edge from the statement that
  called to the routine it entered. The two pictures are built the same way, so they read the
  same. A statement is one node however many times the run reached it: a loop is one branch
  with its count, a routine called twice is one node with two edges into it. The record itself
  is untouched - the player walks every stop and the mark follows it - and a click on a node
  opens that statement in the source.

- **Collapse all / Expand all and Depth in the player.** The Statements drawing is governed
  the way Value Origin governs its flow: one number decides how deep it is drawn - the program
  is 0, a class 1, a routine 2, and a statement one below whatever block holds it - and
  **Collapse all** / **Expand all** are its two ends, so the three controls cannot disagree.
  The maximum is the deepest statement the record actually holds. The toggle is the shared
  segment control, taken from the one stylesheet every VERTEX view uses rather than drawn
  again in this window.

- **The diagram zooms by a slider.** The player had a minus, a percentage and a plus; the
  diagram elsewhere in VERTEX has a slider, which says where you are and gets you anywhere in
  one move. The player has that now, and Fit and Ctrl+wheel move the slider with it.

- **The record is navigated above the whole window.** The player - first, back, the stop
  slider, forward, last, Play and its speed - sat inside the diagram bar, although it moves the
  stack, the variables and the source as much as the drawing. It is a bar of its own now, above
  the sections, shown as soon as there is a record and whether or not a diagram is open. The
  diagram bar keeps what belongs to the drawing: the reading, Collapse all / Expand all, Depth
  and the zoom.

- **The toolbar reads as three groups.** What to do with the program - Run in SAP, the name,
  Exit program, Detach - then how to step - Single Step, Execute, Return, Continue - then how a
  run behaves: Z only, Flow, Visual, Rec, Predict. A thin rule separates them. What the run is
  doing and what it just did moved out of the buttons into a line of its own under the toolbar,
  where it does not have to be read to use anything.

- **Predict is off by default.** A run that works the next line out from the statement map is
  faster and can be wrong; a run that asks SAP is neither. The fast reading is now the one that
  has to be switched on.

- **Predict, and a run that can be asked to stop guessing.** Continue made of F5 steps takes
  the next line from the statement map where the text alone decides it and passes a loop in one
  go, without asking SAP where the program is - that is what makes it fast, and what makes such
  a stop something the window worked out rather than read. The new **Predict** toggle, off by
  default, is that choice: switched off, SAP is asked after every step and loops are stepped
  through. It is the only control over how a run steps - **Rec** says Continue steps and the
  stops are kept, **Visual** says whether the run draws as it goes.

- **A prediction is only made where the line can prove it.** Two statements on one line - a
  chained `WRITE`, two statements side by side - gave the run nothing to check itself against,
  and it walked blind: five of the last six moves of a run that ended without stopping at a
  breakpoint were predictions within one line. The map is no longer used there. Nor is it used
  across the end of a method or form, where the frame changes and an invented frame is exactly
  what cannot be checked - that costs one stack read per call returned, not per statement. The
  statistics name both: lines with more than one statement, and unit ends.

- **The breakpoints reach the program that is stopped.** SAP keeps two sets: the "external"
  one that catches a run, and the one belonging to the program being debugged. Only the first
  was ever filled at the start, so until a breakpoint was changed or a loop passed, a Continue
  given to SAP ran past the points on screen. They are now sent to the stopped program the
  moment the debugger attaches, as ADT does. A point SAP refuses to place is named - in the
  header above the source and to the assistant - instead of leaving a breakpoint on screen that
  nothing stops at.

- **A Visual, Rec or Flow run stops at a breakpoint it steps onto.** Those runs are F8 made
  of F5 steps, and whether to stop was decided by what SAP said about the stop: SAP names a
  breakpoint when it stops the program at one, and says nothing when a step simply lands on
  that line. So a run stepping through a called class walked straight over a breakpoint waiting
  in the program that called it, and ended when the program did. The window has the list of
  breakpoints in front of it - it already refuses to predict a line that carries one - and now
  ends the run there as well. A deactivated point and a log point do not stop it, as they do
  not stop SAP.

- **A Visual, Rec or Flow run says when the program dumped.** Those runs step on their
  own and take no events from the debugger while they step, so a short dump ended them with
  nothing said - and with Rec on, the error that reached the header was the window's own, not
  SAP's. The answer to the step that killed the run already carries the dump the debugger read
  from ST22; the run now reports it there, and the Dump section opens as it does after F5.
  **Whole dump** opens the dump itself over the window from there, as it does for any other
  ending - the same section, the same overlay, nothing of its own.

- **A click on a dump opens that dump.** The Dump section lists every dump of the ending, but
  only **Whole dump** opened one, and always the first: with more than one, the rest could not
  be read at all. A row now opens its own dump in the same overlay, and the link to the source
  where the program died keeps its own click. **Check ST22** also says what it found: when the
  dump below is the one already reported, it says so instead of "no new short dump", which read
  as if there were none.

- **The stop is followed where the debugging was started.** Every stop opened the stopped
  source as a VS Code tab, whoever had stepped - so driving the debugger from a VERTEX window,
  which shows the source in its own pane, pulled an editor open over it at every step. The
  debugger now knows which surface is driving it: from a VERTEX window the stop is followed
  there and no editor is opened; from the editor - F5-F8, the docked Debug panel, the
  assistant - the editor follows a step into a method exactly as before.

- **A run leaves one tab behind, not one per class.** Following the stop opened every
  stopped source as a tab of its own, so an F8 run through a dozen classes left a dozen tabs
  to close. The stop is where the program is, not something the reader opened: it goes in the
  preview tab and the next stop takes its place. A source opened by hand keeps its own tab.

- **A name typed with nothing said about it opens an editor tab.** Asking the assistant for
  `ZVERTEX_DEBUG_LAB` inside a VERTEX window answered by turning that window into View source,
  although the rule the model is given says the opposite: source opens in an ordinary editor
  tab, and the reader opens it in VERTEX when that is what they want. The direct answer - the
  one given without a model, for a bare object name - now follows the same rule.

- **Value Origin folds as a whole.** A **Collapse all** / **Expand all** toggle sits beside the
  Type selector and covers every Type — FLOW, Code, Data and Formula — in both the tree and the
  diagram. Collapsed is the starting state, and switching Type applies the current choice to the
  Type switched to.

- **The source link is a link again.** In Value Origin the `</>` button was drawn as a
  full-width framed box under its statement instead of standing at the end of it: the page's
  general button rule outranked the one meant for it. It is inline again, in every Type.

- **FLOW nests WHEN, ELSE and ELSEIF.** A branch of an open `CASE` or `IF` stood beside the
  statements it guards rather than above them, so `WHEN 'ZCL_MOD_FUEL'.` and the assignment it
  selects were siblings under the `CASE`. A branch now closes the previous one and owns what
  follows it, as Logic already drew it, and `ENDCASE` / `ENDIF` close both levels. Tree and
  diagram share the edges, so both change together.

- **Selecting a variable with the mouse stays where it was put.** Dragging across a name in a
  SAP source tab jumped away the moment the last character was covered: VS Code reports no click
  count, so any mouse selection that exactly matched one identifier was taken for a double-click
  and opened its definition. A double-click is now recognised by what precedes it — an empty
  selection standing inside the word — so a drag, which grows through partial selections and
  begins outside the word, selects and nothing else. Double-click navigation is unchanged.

- **The Depth control opens the tree.** It used to be only an upper bound on top of whatever
  was expanded, so with **Collapse all** active every value from 1 to *all* looked the same.
  Depth is now the gate: it decides how far the tree is opened, and Collapse all and Expand all
  are its two ends — depth 1 and the maximum. One number governs what is shown, in the tree and
  in the diagram, so the three controls can no longer disagree.

- **The toolbar reads in the order the questions are asked.** Type, then *Tree* / *Diagram*,
  then what is shown: *Full* / *BSE*, Collapse all / Expand all and Depth. The view toggle stood
  at the far end, after every control it does not govern.

- **Two Types: FLOW and Formula.** Data drew the same tree as Code, from the same nodes,
  through the same function. Code drew what FLOW's BSE scope already draws — the findings and
  the path to them — only laid out along the call stack instead of along the code. Both are
  gone. What is left answers two different questions: FLOW, what the program does and where the
  value is touched; Formula, how the value was computed. The Type is a two-position toggle now,
  and it starts on FLOW.

- **FLOW shows what a call passes.** An edge between two procedures said when a call happened
  and not what crossed it, and the bindings lived only in Code. The bindings ACE resolved at a
  call site are now a node on that call's edge — `lv_scenario → IV_SCENARIO` — so the value stays
  visible where it changes its name. Nothing Code showed is lost with it.

- **BSE scope is what BSE found and the path that led to it.** That was always the rule, and
  it is the whole rule again. Two extra rules tried on the way — keeping the alternatives beside
  a kept control statement, and keeping a branch that holds a finding whole — kept statements
  that are neither a finding nor on the path to one, and are gone. A `WHEN` appears when a
  finding sits under it, and an alternative that leads nowhere does not appear.

- **FLOW names the event, not GLOBAL.** A program's statements outside any form or method sat
  under a level called `GLOBAL`, which is the analyser's word, not ABAP's. They belong to the
  event that opened them, and to `START-OF-SELECTION` when none did, because that is where ABAP
  runs them. The level now carries that name, and the event statement itself is no longer drawn
  as a step inside the level it names.

- **FLOW carries what runs.** Full FLOW was built from every local statement, so the program
  header, `TYPE-POOL`, the `TYPES` block, `PARAMETERS` and the other declarations stood in the
  flow as if they were steps. A declaration states what exists before anything runs and is now
  left out — with one deliberate exception: an inline `DATA(x) = …` declares, but it is an
  assignment and it runs, so it stays.

- **The Depth control means what the Type shows.** FLOW, Code and Data nest by calls, so there
  it bounds the call stack. Formula nests by data — `a = b + c`, then the definitions of `b` and
  `c` — and between two of its levels there may be no call at all or three, so there it bounds
  the derivation: the number of steps from the value that was asked about. The label says which
  one it is, **Depth: calls** or **Depth: derivation**, and the slider is reset to its maximum,
  which is no limit, whenever the Type changes.

- **A stack-depth control for every Type.** The breakpoint pair bounds the entry program's own
  lines, which reaches almost nothing in a slice that runs through called classes. What bounds
  those is the call stack, and the flow already knows it: the resolved calls say which procedure
  reaches which, so a procedure's depth is how many calls away from the entry program it stands.
  Every node of every Type now carries that number, and a **Depth** slider beside Collapse all
  bounds the tree and the diagram together. It starts at the deepest, which is no limit at all,
  so nothing disappears unless it is asked to.

- **Every Type is bounded by the breakpoint pair.** Code, Data and FLOW were limited by the two
  enabled breakpoints that bracket the cursor; Formula knew nothing about them and drew the whole
  backward slice. It now honours the same bound, and the same way: the pair limits the entry
  program alone, while a called method keeps its whole frame, because its lines are not in the
  editor's coordinate system.

- **Formula has one top.** The derivation started at every definition of the selected value at
  once, so ten overwrites of `cs_context-amount` read as ten unrelated formulas side by side.
  The selected value itself is now the single top node, open, and its definitions are its
  branches — in the tree and in the diagram alike.

- **Formula is the derivation again.** Three things pulled it away from `a = b + c` with `b`
  and `c` as its two branches. The diagram lifted every modifier implementation out of its
  parent into a *Runtime pipeline* cluster ordered by the configured step, which is a grouping
  by configuration and not by what feeds what — that cluster is gone, and with it the one box
  that ignored the VS Code theme. A node was labelled with its whole statement, so a `SELECT`
  with a long projection was a single leaf half a screen wide; a `SELECT` now reads as its
  target, at most three fields and its table, while an assignment keeps its own text. And a
  value already expanded anywhere in the tree was never expanded again, so the second branch
  reading the same variable ended without its inputs; the guard is now the path walked to that
  node, so each branch carries its own derivation and cycles are still cut.

## 2026-09-30 — VS Code 0.7.9: a run that dumps says so

- **A short dump is no longer silence.** A step that ends the run threw the same way
  whether the program finished or died of a runtime error, and nothing said which — F5
  into a class whose load fails ended the session with no explanation, and a program that
  died before it ever reached a breakpoint left the debugger listening for a stop that
  would never come. The debugger now reads SAP's dump feed. Every dump already in ST22
  when the run starts is remembered, so only what appears afterwards, and only under this
  user, is reported.
  - On a step that kills the run, the answer to that very step carries `dumped` with the
    runtime error and its text: the question is asked once, immediately, and a program
    that merely finished does not wait for an answer that is not coming.
  - While `debug_wait` waits, the feed is read every ten seconds — that is what catches a
    run that dumped before reaching any breakpoint.
  - A feed that cannot be read is reported as a problem of its own, never as "no dumps".
- **A program let go is asked after, not watched.** Detach continues the program and stops
  listening, so no stop and no step is ever coming and nothing could report how it ended - a
  run that dumped after Detach was invisible. Detach now takes one look at ST22 a moment
  after it lets go, without making the reader wait for it, and **Check ST22** in the Dump
  section asks at any time afterwards. The chat has the same question as `debug_dumps`. No
  timer runs in the background: after Detach the program is not ours to watch, and the
  question is the reader's to ask.
- **Visual Debug has a Dump section.** Beside Stack, Breakpoints and Variables, and shown by
  itself the moment a run dies of one: the runtime error, what SAP said about it, and
  **Open ST22**, where that dump is the first entry. A short dump is not a notice that
  scrolls away. The header line still says the run did not finish and points at the section.
- **The dump says where, and the place opens.** The Dump section names the include and the
  line the program died on, and clicking it opens that source there - the same click a stack
  frame takes. The dump feed does not carry a place, so it is read from ST22's own table
  `SNAP`, whose `FLIST` gives the runtime error, the program, the include and the line as
  tagged records rather than as markup to be scraped. This is the one part of the debugger
  that wants the ABAP backend: without it the dump is still reported, and says in the section
  why it has no line to open.
- **The standard editor follows a step into a method.** Stepping into a method whose source
  was not already open left the VS Code editor where it was, while VERTEX's own source pane
  moved. The standard editor is the one that survives a window reload, so that is where the
  debugger navigates now: the class is opened whole, as a click on a method already opens it,
  and the line is found inside it - the generated CM include a method frame names is not an
  object any editor tab can hold. Only the frame the program actually stands in is opened, so
  a stop deep in a callee still does not open every class below it; it stays in the editor
  group the ABAP sources already live in; and **Alt+Left** comes back from it, because being
  taken into a callee is a navigation like any other.
- **A section folds by its heading again.** Clicking *Stack*, *Breakpoints*, *Variables*,
  *Dump* or *Log* shuts it to its title bar and gives its height to the others; clicking
  again opens it. A click on a control in that heading - *Clear all*, the variable filter,
  *Open ST22* - still belongs to the control.

## 2026-09-29 — VS Code 0.7.9: the diagrams read as one

The same 0.7.9 build as below, carried further. Eclipse was not rebuilt; the shared
diagram pages change for both hosts once it is.

- **A method opens inside the Calls diagram.** Clicking a method block in the Calls
  diagram draws that method's Logic diagram in the same canvas, joined to the block it
  came from, so a call and what it does are read as one picture instead of two views.
  The open block is marked in the theme's focus colour, and the layout follows the
  *Top-down* / *Left-right* choice like the rest of the diagram.
- **The magnifier is a choice, not a guess.** The diagram toolbar has a *Lens off* /
  *Lens on* toggle, and it serves UML, Logic and every block opened inside Calls.
  Shift and the wheel set its strength. The old rule that turned the lens on by
  measuring the text on screen is gone: it flickered as the diagram was zoomed, and
  whether the text is too small to read is the reader's call.
- **A statement with nothing left to show is left out of the Logic diagram.** A
  comment, or a line that is only the characters a label cannot hold, used to be
  emitted as an empty box — and one empty box is a mermaid syntax error that fails the
  whole diagram, not just its own node. Affected the operations drawn after `METHOD`
  on the same row, the body of an opened loop, and the statements between two branches.
- **Operations that ACE found after `METHOD` on the same row get their own nodes**,
  rather than being swallowed by the grammar line they share.
- **Value Origin takes a type.** *FLOW*, *Code*, *Data* and *Formula*: Formula shows
  the derivation of a value as expanding input formulas, with the tree and the diagram
  showing the same expanded branches, and groups modifier implementations as the
  runtime pipeline choices they are. FLOW can be narrowed from *Full* to *BSE*.
- **One toggle style everywhere.** Independent on/off controls are `vertex-toggle`,
  mutually exclusive choices are `vertex-segment-toggle`; both live in
  `vertex-controls.css` and are copied into the extension at packaging.

## 2026-09-28 — VS Code 0.7.9

- Value Origin diagrams put a method's operations as siblings beneath its call node;
  stack depth is shown without enclosing frames.
- Value Origin execution flow retains resolved method identities and statement
  identities when entering callees. Mermaid source navigation handles execution-flow
  nodes. A regression checks nested RUN/base-price steps and parity between text and
  diagram.
- Fixed declaration-only ACE includes suppressing full class loading. The regression
  covers factory dispatch and five modifier implementations.

## 2026-09-27 — VS Code 0.7.9 test build (not published)

- Value Origin now consumes the ACE index (`flow?mode=origin`) and automatically
  loads referenced objects in the originating SAP system. The ABAP backend class
  `ZCL_VX_ADT_RES_FLOW` must be updated together with the VSIX.
- Backward dependencies follow component copies, NEW/factory returns and CHANGING;
  the view exposes a collapsible call stack, clickable calculation trees and a copyable log.
- ACE now returns class-to-interface relations and reference types, so an interface call in a
  generated CM include resolves to its concrete implementation instead of an unresolved declaration.
- F12/double-click no longer routes an interface invocation to its `METHODS` declaration.
- ACE include ownership now loads a complete foreign class pool when its CU was encountered in the caller snapshot.
- Ordinary context navigation keeps the active editor group even from a dirty source tab.
- Value Origin source links reuse the standard VS Code ABAP editor (Ctrl+Click opens beside).
  The test VSIX contributes ABAP breakpoint support, so a click in that editor's
  leftmost gutter adds or removes a native point, synchronized to the shared SAP
  debugger session.
- A VERTEX source tab now offers **Open Visual Debug**, which reveals the right-hand
  debugger panel for that object without duplicating its source and highlights the
  actual stopped line. F5/F6/F7/F8 in that tab step the same SAP session.
- Branch alternatives, unresolved calls and database-dependent loop order are
  explicit. This is static dependency analysis, not a solved execution trace.
- Package View source is the default; report parts (`REPS`) route to `PROG`.
- The backend activation/live SAP test remains pending; the available local SAP
  connection was unreachable during development. Eclipse was not rebuilt.

## 2026-09-26 — VERTEX 0.7.7 (VS Code): the chat runs the tests and ATC

- **The chat runs ABAP Unit**: *run the tests for ZCL_FOO*, *do the tests of this class pass*.
  The tool takes the object by name and type, so no tab has to be open, and answers with the
  test classes, how many methods passed, how many failed and each failure's message. The tree
  appears in the Test Explorer as it does for Ctrl+Shift+F10, and the run is refused while that
  object's tab holds unsaved edits, because SAP runs the active source.
- **The chat runs ATC**: *run ATC on ZCL_FOO*, *check the code quality*. The answer carries the
  system's check variant and the findings with their priority, check and message, the first 50 of
  them when there are more; all of them go to the Problems view as Ctrl+Shift+F2 puts them. A
  function module is checked through its function group, as in the editor.
- Where-used and the keyword documentation did **not** become tools. SAP answers both for a
  position in the source, not for a name, and finding a name's position would mean reading the
  ABAP as text. Asked for either, the chat says which key does it in the open tab: Shift+F12 and
  F1.
- **The ABAP backend is optional**, and every page that describes VERTEX now says so in its own
  feature table, which gained an **ABAP backend** column and lists what each tool does in full -
  ABAP Unit, ATC, where-used, the F1 documentation and the rest, with their keys. The
  documentation used to say the backend was needed, full stop. It is needed by the three
  explorers - Versions, Code Explorer, SelecTor - while the editor, the debugger and the
  assistant work over ADT alone. Visual Debug is in between: it runs without the backend, and
  ACE's statement map from it makes stepping cheaper and puts a stepped-over call's method on the
  chart. The second, duplicate table the repository's README had grown is gone.
- The list of what is not done yet moved out of the README into [Next.md](Next.md), which the
  README now links to. It had grown to a third of the page and is read by nobody installing the
  thing.
- The repository's README described the MCP side as the two transport tools alone. The debugger
  is served over MCP too - `/debug`, registered as `vertex-debug` for Claude Code and Codex, the
  nine `debug_*` tools, the same session Visual Debug draws - and was documented only on the
  Marketplace page. The README now names both servers.
- The Marketplace page never said **where** the systems are configured, only what to write. It now
  opens with a **First run**: install, pull `src/` with abapGit, add the systems through
  Ctrl+Shift+P → Preferences: Open User Settings (JSON), open the panel, open an object. The
  repository's README names that command too.
- The documentation caught up with 0.7.6, which shipped these four editor features while two
  pages that describe VERTEX did not say so: the Marketplace page listed the editor as "Hover,
  navigation, outline", and the update site's page still named 0.7.5 as the VS Code build.
- The Eclipse plugin is unchanged and stays at 0.7.3; it was not rebuilt, and its chat has
  neither tool.

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
- Fixed: hovering a keyword (`REPORT`, `TYPES`...) showed "SAP could not describe this name".
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


VS Code: Copy log now includes the complete FLOW hierarchy and points, Formula derivation tree and graph, and Expression text, substitution steps and source bindings as JSON for both ACE and ADT + abaplint. The export uses the current analysis and loaded configuration, independently of the visual depth slider.

VS Code 0.8.1 comparison build: the FLOW script is embedded in the page; the full JSON export remains in Copy log without duplicating the dump in the visible page. This change addresses the reported empty analysis pane; live VS Code rendering still needs confirmation.


## 2026-10-05 — VS Code 0.8.1: local analysis routes

VS Code routes Metrics, class/package UML, Scheme, Calls and the debugger statement map to standard ADT source reads and bundled abaplint. The existing Value Origin command and debugger dependency/variable analysis now use the client engine. Package enumeration uses ADT node contents. Tools obtains its analysis capability information locally. Versions, selector, tables, transport review/prepare and dumps retain their VERTEX backend routes.

This is an experimental migration: local Halstead token classification may differ from ACE; Scheme shows structured syntax rather than the ACE execution diagram; Calls marks unresolved receivers and bounds source expansion to eight levels/100 objects. Unknown dynamic targets, macros and unsupported statements are not claimed resolved. Source-coordinate handling uses assembled class rows. Live SAP operation with the backend physically removed remains to be confirmed.

Debugger migration follow-up (0.8.1): generated class-pool statement requests resolve to the class's standard ADT main source. Statement maps mark ADT source coordinates so the debugger does not apply ACE method-include offsets. Class BSE ranges use the requested assembled-source rows and respect the upper breakpoint. Unknown statements, macros, SQL and control transfers require a SAP stack read instead of a predicted plain step. Explicit CALL/PERFORM/SUBMIT statements are treated as calls.

VS Code 0.8.1 debugger path fix: analysis between breakpoints without a selected variable now discovers source dependencies through calls in the entry range and reached routine bodies. The previous value-demand loader stopped at the entry program because the backward slice had no variable. The call traversal is conservative for unresolved receivers and retains the source limit; live SAP results remain to be confirmed.

VS Code 0.8.1 debugger path closure now follows all resolved call sites in a statement, including NEW class( )->run( ) chains and nested calls. Previously its singular call field could stop source discovery at the constructor and leave deeper routine bodies unloaded.

VS Code 0.8.1 variable declarations now load referenced receiver sources and resolved method parameter types without requiring a selected value. This restores inference of inline result structures from RETURNING signatures, such as LS_RESULT from RUN, and their component expansion before execution.

VS Code 0.8.1: declared-variable reading before execution uses editor source and preserves a local declaration fallback if type loading fails. Dependency warnings are propagated to the pane; a failed read displays its error instead of leaving an empty variable area. Execution-path analysis still requires active source. The local demo returns seven declarations and infers LS_RESULT's RETURNING type; the reported live failure has not yet been reproduced.

VS Code 0.8.1: choosing a variable after drawing a breakpoint path now refreshes its FLOW rows, call sites, Formula and Expression from the resulting slice while retaining path bounds. The old path had no included rows and could therefore display an empty BSE despite reported slice points.

Visual Debug 0.8.1 now exposes Analysis log / Copy analysis log above Variables. It copies the latest breakpoint path and value slice separately, with request and UI bounds, source closure, timings/warnings, dependency nodes/edges, FLOW, Formula tree and Expression. This provides evidence for incomplete BSE after reload; the cause is not yet established.

Metrics presentation: fractional numbers are displayed to two decimal places in unit rows, totals and the summary bar; integer counts remain integers. Raw analysis values and numeric sorting retain full precision.

VS Code 0.8.1: local diagram Parts use ADT + abaplint; Diff checks actual backend availability. Visual Debug exposes a Log button and retains the complete analysis response for copying.


VS Code 0.8.1: Logic diagram now ports ACE analyze/build_scheme, operation folding, branch joins, loop/TRY frames and source links. Local Parts restore short method names, section groups and visibility icons. Nine diagram cases and seven Tools/theme checks pass; the full suite reports 328/346 passing, with 18 failures requiring separate investigation. Live ACE equivalence is not yet verified.


Verification follow-up: 52 focused diagram, Tools and Visual Debug checks pass. One test fixture lacked the DOM helper required by the new Log button and was corrected. The remaining 17 full-suite failures concern contracts already present in HEAD (Formula codeFlow and Versions casing/DOM mocks); they remain unresolved.


VS Code 0.8.1: fixed Program Parts routine kinds. FORM, FUNCTION and MODULE retain their types; report events retain their names, with implicit START-OF-SELECTION instead of synthetic GLOBAL. Class methods remain METHOD. GET PARAMETER is not classified as an event.


VS Code 0.8.1: local Tools analysis updates progress every two seconds during ADT reads and worker parsing, with the current object/stage, source count and elapsed time. Parser warnings are collapsed into a bounded details panel instead of filling the diagram area. Progress messages follow the active request and do not consume its final answer. Fourteen focused checks passed.


VS Code 0.8.1: Calls analysis defaults to depth 3, matching the UI and ACE. Explicit depths follow the UI range 1–99 instead of silently capping at 8. An orientation regression check confirms setDirection redraws existing Mermaid without requesting analysis. Depth edits still apply on change (including field blur); clicking orientation after editing Depth can therefore coincide with the depth request.


VS Code 0.8.1: frontend Tools reuse parsed ADT sources across analysis requests and depth changes. Only newly reached objects are read/parsed; all-cache-hit requests start no parser worker. Concurrent requests share the same in-flight read. Cache isolation follows repository URL/client/user/system; limits are 100 objects, 32 MiB source text and five minutes since loading. Save/activate attempts through VERTEX invalidate the repository cache, including partial failures. External SAP changes can remain cached until expiry or extension reload. Request indexes receive cloned data, preserving cache immutability. Seventeen focused checks passed, including depth 1→2, repeated depth, invalidation and repository isolation.


VS Code 0.8.1: default Calls depth is now 2 at the user's request. Depth input applies after a 250 ms debounce; newer Calls requests cancel the active traversal and replace queued older Calls requests. Cancellation interrupts parser work, stops waiting for the current ADT read and discards late results (the already sent HTTP read may still finish). Successfully loaded cache entries remain reusable. Displayed calls are limited by call-edge depth rather than source-loading depth. Classes/Methods honor aggregate/per-routine labels, structural root-to-entry links restore program connectivity, and unreachable foreign routines are omitted. Responses carry their depth so stale deeper diagrams cannot replace a shallower view.


VS Code 0.8.1 depth correction: Calls now walks reached routines breadth-first instead of recursively loading every declared source dependency. The boundary callee is a leaf (depth limit); its source is not loaded and its body is not walked. Program roots are actual report events, or the explicitly selected unit, rather than all FORMs as independent starts. Tests confirm Depth 1 reads only the report, Depth 2 adds only its first called class, a deeper class remains unread, and unused FORMs cannot pull in foreign objects. This avoids deeper work rather than merely filtering its diagram afterward.


VS Code 0.8.1 depth semantics correction: program root is 0; entry into an event or selected routine is 1; every subsequent call adds one. The traversal now starts at level 1 and stops before inspecting calls of a terminal block. Displayed entry edges have the same cost; Classes view accounts for the entry hidden by aggregation. Added explicit PERFORM, CALL FUNCTION and classic CALL METHOD handling in Calls. A static external function is read through standard ADT FUNC only when its body falls within the traversal depth. Tests cover event→FORM→FORM, FORM→function, and methods across objects; terminal targets are not read or walked.


### 2026-10-06 — 0.8.1 ACE parity audit
Corrected frontend metric keyword classification and routine boundaries; added regression coverage and docs/ace-port-audit.md. Full ACE parity remains under audit.

### 2026-10-06 — Calls labels and colours (0.8.1)
Restored ACE naming, shapes and colour classes. Removed synthetic program root and graph-level depth recalculation.

### 2026-10-06 — 0.8.1 full local verification
365 tests passed; separate light/dark palette check passed. Restored FLOW parameter transfers, retained empty routines and corrected UML dependency scope and method ordering.

### 2026-10-06 — 0.8.1 Class Calls entry
Default class entry is CONSTRUCTOR; Parts selection replaces it. No all-method fallback when constructor is absent.

### 2026-10-06 — 0.8.1 context tools
Added VERTEX Tools submenu with five object-specific functions in ABAP editor, Explorer and Tools webview context menus.

### 2026-10-06 — 0.8.1 Calls context fix
Corrected calls-to-flow navigation mapping; validate context actions before webview creation.

### 2026-10-06 — 0.8.1 Calls expressions
Restored functional calls in assignment expressions and NEW receivers; reuse Value Origin call enumeration.

### 2026-10-06 — 0.8.1 unified calls
Shared call enumeration/resolution/walk for Calls, Value Origin and Visual Debug. Full suite 374/374.

### 2026-10-06 — 0.8.1 expression classification
Fixed false CHAR12/type method calls and class-name methods after NEW; preserve real constructor and argument calls.


VS Code 0.8.1: Calls omits depth-limit labels and implicit constructor stubs. Calls and Visual Debug FLOW use the same routine palette; BSE green takes precedence over routine colours. Depth still limits source loading and traversal.


VS Code 0.8.1: Run in SAP uses a theme-aware pale blue fill, with a stronger fill and the shared focus-colour glow on hover.


VS Code 0.8.1: VERTEX Tools opened from an object context hides the object type and name fields, keeps the function picker, and names the tab after the object.


VS Code 0.8.1: Object-bound VERTEX Tools opens beside the source editor, keeping code and tools visible together.


VS Code 0.8.1: Clicking a Calls routine in object-bound Tools opens its source in the left editor instead of expanding embedded method logic.


VS Code 0.8.1: Progress and internal style changes no longer trigger diagram theme redraws; stale Mermaid renders cannot replace the newest diagram.


VS Code 0.8.1: Context Logic/Calls selects the method under the source cursor; object-bound Tools starts with Parts collapsed.


VS Code 0.8.1: Metrics method names open source on the left; headers sort locally in both directions. Numeric routine metrics use green/yellow/red thresholds shown in cell tooltips (MI is graded in reverse). Totals remain ungraded.


ACE metrics parity correction: colour grades use the original zcl_ace_metrics_window scales only: CC ≤10 LOW, ≤20 MEDIUM, ≤50 HIGH, >50 CRITICAL; MI ≥85 HIGH, ≥65 MEDIUM, below65 LOW, zero ungraded. Other numeric metrics have no original ACE thresholds and remain ungraded.


VS Code 0.8.1: Logic nodes open their source line in the left editor; scrolling Logic follows the visible statement without taking keyboard focus from the diagram.


VS Code 0.8.1: Logic draws the false path around IF without ELSE, and ELSEIF conditions as separate decisions connected by the false path.


VS Code 0.8.1: Selecting code in the bound source highlights and reveals matching Logic nodes without moving editor focus; reverse-follow scrolling is suppressed to prevent navigation loops.


VS Code 0.8.1: Logic only is enabled by default and keeps control structure and external calls. Turning it off restores ordinary operations without another SAP read.


VS Code 0.8.1: Tools diagrams replace zoom minus/plus with a continuous 1–400% slider; code-selected nodes use a contrasting theme-aware fill as well as an outline.


VS Code 0.8.1: Tools zoom is 10–100% with a compact theme-styled track and thumb. Object/line status appears above diagram controls.


VS Code 0.8.1: Scrolling the bound source editor scrolls Logic to the corresponding visible code area without changing selection highlighting or focus. Programmatic source navigation is suppressed to prevent scroll feedback.


VS Code 0.8.1: Embedded Tools pages load the canonical vertex-controls.css so Logic only uses the same toggle appearance as Visual Debug.


VS Code 0.8.1: Value Origin has one visible command, Analyze Variable Value Origin, using ADT + abaplint. Tools omits the permanent engine label and shows only actual warnings.


VS Code 0.8.1: The shared diagram lens compensates for displayed SVG scale, reaching natural text size at small zoom (10% gives about 10× by default); Shift-wheel remains adjustable.


VS Code 0.8.1: Lens stays hidden at diagram scales of 70% and above; below 70% it magnifies up to an effective 70% scale (10% → 7× maximum).


VS Code 0.8.1: Logic switches automatically when the source cursor enters another method; movements within the method only update highlighting and position.


VS Code 0.8.1: Fixed repeated Logic method recalculation caused by comparing the wrong current-method field; source navigation from diagrams no longer echoes cursor events back into analysis.


VS Code 0.8.1: Editor navigation commands (including Alt+Left/Right) update Logic even during the diagram-navigation guard; only unclassified programmatic cursor echoes are suppressed.


VS Code 0.8.1: Logic draws a procedure end node; RETURN points directly to it and does not continue to the next operation. RETURN remains visible in Logic only.


VS Code 0.8.1: RETURN terminates branch reachability before subsequent structural nodes are emitted. A join is omitted when all incoming branches have returned, preventing detached continuation nodes.


VS Code 0.8.1: Follow code is enabled by default and synchronizes only code → Logic. Turning it off synchronizes only Logic → code; opposing scroll directions are never active together. Explicit node clicks still navigate to source.


Synchronization uses the focused view as its driver automatically; the Follow code toggle was removed. Programmatic navigation never changes the driver.


VS Code 0.8.1: Selected diagram labels carry the theme selection text colour inline, retaining contrast when cloned into the lens.


VS Code 0.8.1: Logic only retains internal method calls too, including unqualified show_versions_diff(...); procedure calls are control transfers regardless of receiver syntax.


VS Code 0.8.1: Folded operation groups retain expansion on click; an explicit expand/collapse marker restores folding without conflicting with source navigation.


Logic diagrams show every operation individually without folding. Logic only remains the filter for control flow and procedure calls.


Logic diagrams retain inline declarations containing constructor or procedure calls, including DATA(result) = NEW class( )->method( ).


Selecting a loop header or its source range highlights the entire loop frame with a theme-aware pale blue tint.


Logic conditions remain a single diamond with all AND/OR terms and parentheses. External calls, including nested argument calls, are marked with ↗; arguments are abbreviated, and the diamond tooltip lists external targets.


External method names inside condition diamonds are links opening their class method in the source editor. Unresolved receiver calls navigate to the call site. Empty branches retained by Logic only still join ENDIF.


Removed the permanent Experimental ADT + abaplint banner from analysis and Visual Debug.


Flow diagrams and flow trees open source through linked node labels instead of separate </> icons; diagram frames retain expansion actions.


Visual Debug Classes, Methods and Statements retain shared call depth and expansion state. Statements at the selected call-depth boundary remain visible when their routine is expanded.


Full FLOW retains ENDMETHOD, ENDFORM and ENDFUNCTION as routine exits, with their original routine scope, so closing-line breakpoints can end an analysed path.


Logic diagrams and FLOW share the procedure-ending classification in abap-control.js instead of separate ENDMETHOD lists.


Logic and Full FLOW use the same statement classification for declarations, calls, procedure boundaries, branches, loops and control transfers in abap-control.js.


Visual Debug adds Logic before Statements. Logic filters routine bodies using shared ABAP rules; Logic and Statements group operators inside routine frames without adding call-depth levels.


Routine frames follow the global diagram direction: Left-right or Top-down, including their contained operators.


Fixed grouped Logic/Statements Mermaid direction syntax (TB inside subgraphs). Long flow analysis reports current stage, object, parsed statement/source counts and elapsed seconds.


Analysis progress is displayed every three seconds, coalescing intermediate updates to avoid flicker.


Routine/event names such as START-OF-SELECTION are clickable frame headings in grouped Logic and Statements. Frames have a theme-aware pale blue fill, with green BSE emphasis.


Breakpoint object:line labels are links that navigate to their source line in the left editor; row clicks use the same navigation.


Grouped routine diagrams draw visible arrows between successive body statements instead of invisible layout-only links.


Grouped FLOW diagrams use execution edges for sequential operators, IF/CASE branches and joins, loop back edges, and routine exits. Statement containment is retained for tree/depth controls. Frame backgrounds are lighter.


Routine frames and entry nodes use distinct Mermaid identifiers. Execution edges connect to entry nodes rather than clusters, avoiding compound-layout failures on cyclic flows.


Visual Debug status messages use the theme green colour, matching the VERTEX assistant appearance.

Visual Debug and Value Origin keep the analysis log control at the top right, without a separate toolbar row. Source links use VS Code navigation so Back can return to the previous location. Grouped Logic and Statements diagrams use the bundled ELK layout for cross-method edges.

Grouped Mermaid diagrams attach source navigation, frame toggles and tooltips after rendering, without click directives unsupported by the bundled ELK database.

Grouped Logic and Statements diagrams apply the selected direction inside each method frame as well as to the overall graph. The bundled Mermaid ELK adapter explicitly passes group direction to ELK; independent branches may still sit beside one another.

Changing diagram depth keeps the toolbar in place. Mermaid renders in an offscreen container, and the bundled ELK measurement container no longer participates in the page flex layout.

Detach is enabled only while the debugger is stopped or listening for a run. Its tooltip distinguishes continuing a stopped program from cancelling the wait; otherwise the button is disabled.

Changing the colour theme preserves diagram zoom and scroll position. Shared FLOW diagrams update SVG colours without rebuilding the layout; Logic and Calls redraw with the existing viewport.

Visual Debug keeps Classes/Methods and embeds the standard Tools Logic diagram when its separate Logic toggle is on. Turning Logic off restores the existing Calls view; source navigation and code following use the same Tools handlers.

Embedded Logic starts from the active source editor rather than the analysed path root. It selects the routine containing the cursor and follows selection changes across ABAP objects using the standard Tools component.

### Eclipse 0.8.1 export preparation

Prepared 0.8.1.qualifier bundle/feature metadata, the shared FLOW dependencies and an Eclipse Visual Flow Analysis command with Calls / Logic and ADT editor selection/source navigation. Eclipse retains its existing ACE backend contract; the VS Code frontend-analysis adapter and runtime Debug are not claimed ported. See [Eclipse export guide](eclipse/README.md).

Eclipse 0.8.1 test archive built (qualifier 20261006202315): Visual Flow Analysis, Tools editor bridge and shared FLOW dependencies. Compilation and archive checks passed; installation and live SAP behavior remain to be checked before publication.

### Eclipse Debug Monitor prototype

**VERTEX: Debug Monitor** observes an existing SAP ADT debug session using exported SAP `IAbapThread` / `IAbapStackFrame` and Eclipse debug events. It does not establish a second connection or change breakpoints. Open it from an ABAP editor context menu after starting the normal ADT debugger. It reads stopped frames and up to 100 top-frame variables in background jobs; Refresh retries the read. If multiple threads are present, choose one explicitly. Large displayed values are truncated at 2,000 characters, and variable children are not fetched recursively.

When an ABAP class frame supplies its class URI and absolute source line, the monitor passes that coordinate to the Tools Logic view. Include-local coordinates are not guessed. Editor selection remains available for source following. Step, Continue, terminate, recording, table expansion and frame-selection control remain in the normal ADT debugger for this prototype.

The installed SAP ADT 3.60 interfaces were inspected locally, and Java 21 compilation and archive packaging passed. No live debug session or light/dark runtime check has been performed. Install the test archive before using this as a release feature.


### Eclipse Tools: standard ADT analysis

Tools UML, metrics, Calls, Logic and Parts now use the shared VS Code frontend-analysis and abaplint parser in a browser worker. Source and package reads use the selected Eclipse project’s standard ADT session. These analysis views no longer require `/sap/bc/adt/vertex/class`, `/metrics`, `/flow` or `/versions` handlers. Versions/Diff, Review and other backend services retain their existing routes. The separate Value Origin view is not migrated by this change. Eclipse/SAP runtime and light/dark rendering remain unverified.


Eclipse follow-up: corrected Debug Monitor / Visual Flow Analysis registration under `org.eclipse.ui.views`. Value Origin now reads standard ADT source and uses the shared abaplint worker; it no longer requests the custom origin endpoint or requires ZCL_VX_ADT_RES_FLOW. Java compilation and archive creation passed; live Eclipse/SAP behavior is pending.

Eclipse Origin fix: ADT metadata reads now send `Accept: */*`; source reads send `Accept: text/plain`, including class includes. This fixes the server’s “Accept header missing” rejection. Live SAP verification is pending.

Eclipse Tools fix: standard ADT object metadata uses `Accept: */*`, matching the VS Code ADT client; `application/xml` was rejected by servers requiring ADT vendor media types. Source reads remain `text/plain`. This Java transport change does not affect VS Code.

Eclipse ADT bridge: added String content handlers for standard SAP vendor XML metadata, including programs v3, classes and interfaces. Shared by Tools, Visual Flow Analysis, Debug Monitor and Origin; negotiated vendor XML versions are registered on response. This change is confined to Java transport. Live SAP verification is pending.

Eclipse browser bundle fix: UMD dependencies now receive the local module loader as `require`, fixing “require is not defined” during abaplint initialization. The VS Code runtime is unchanged.

Eclipse module loader: failed initialization no longer leaves partial exports in the cache. This prevents a failed abaplint load from turning subsequent requests into misleading “MemoryFile is not a constructor” errors. Restart the PDE runtime or installed Eclipse after updating generated resources.

Eclipse browser runtime: added the Buffer.from hex/UTF-8 operations used by abaplint built-in constants, allowing dependent class parsing to continue. Origin reports its ADT + abaplint engine correctly. VS Code runtime unchanged; live SAP verification pending.

Eclipse browser bundler: generated module imports now use a distinct loader name, avoiding collision with frontend-analysis’s SAP source load function. This fixes Calls palette and Logic module loading; shared VS Code analysis sources are unchanged.

Visual Debug Copy log now includes DEBUG HISTORY SLICE (recorded stops, selected-variable snapshots, watch reads, changes since prior reads, missing/error states) and DEBUG CONTEXT (the current assistant context). Export does not infer or carry forward values; a changed value does not identify an intervening culprit statement by itself.

Visual Debug assistant context now includes actual recorded value history (up to the context limit), with missing/error states. Watch reads always include the chosen variable alongside relevant operands; previously only the route reached chat despite recorded values being available.

Visual Debug replay slider now displays watch values read at the selected recorded stop, including missing/read-error states, rather than ignoring watch history and searching only routine scope snapshots.

## VS Code 0.8.3 — recorded values and AI debug context

Visual Debug brings the ABAP source, execution diagram and recorded variable values into one workspace.

1. Choose **Steps & values** and select a variable for BSE analysis. Relevant stop reads include the selected variable and related operands; routine snapshots provide additional scope values.
2. Use the history slider or replay buttons to revisit recorded stops. **Stack** shows the recorded location; **Variables** shows watch values read at that stop, or the available routine snapshot when there is no watch read.
3. Ask the assistant to analyse the run. Its context includes the execution route and actual variable history, with missing reads and errors identified. The value history is limited to 150 stops in assistant context.
4. Use **Copy log** to export the analysis, **DEBUG HISTORY SLICE** and **DEBUG CONTEXT** for a reproducible discussion.

BSE identifies code relevant to the selected value. Predict can skip irrelevant statements and loop tails. A recording contains values at captured stops, not every intermediate execution state; inferred steps are not measured variable values. Differences between two reads alone do not prove which intervening statement caused an error.

**Initials** is off by default. Enable it to display variables with initial values.
### Value Origin: selected assignment and Copy log

Selecting a variable on the left side of an assignment includes that assignment in its backward slice. Selecting an operand keeps the incoming-value analysis. This retains the selected calculation and its condition and dependencies in BSE. Copy log uses the VS Code host clipboard and displays success or failure instead of relying on webview clipboard permissions.

