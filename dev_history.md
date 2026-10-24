# Development history

## 2026-10-24 — Visual Debug becomes VERTEX Smart Debugger

At the user's word "Visual Debug" is "VERTEX Smart Debugger" everywhere a reader meets it: the VS Code command (was "VERTEX: Visual Analysis / Debug") and the Eclipse command, view and VERTEX-submenu item, the window's title ("· VERTEX Smart Debugger", "(transpiler)" for a transpiler run), its messages and the errors of both hosts, the notes the assistant is given about the window, and the user documentation - README, the Marketplace page, eclipse/README, docs/index.html, AGENTS.md and BUILD.md. Comments in the code that name the window follow. File names, element ids and command ids stay (visual-debug.html, vertex.openVisualDebug, org.vertex.abap.ui.command.debugMonitor), and the histories keep the name things had when they were written. A blind replace turned "visual debugger" in two README feature lists into "smart debuggerger"; corrected. Tests: VS Code 965 pass, Eclipse the three old failures.

With Eclipse's Debug view closed for good, a real stop no longer showed in the code: Eclipse moves the editor to a stop from that view's selection, and visual-debug-host had left editor navigation to ADT so as not to open a tab per step. The Eclipse host now opens each stop's line itself - a stop outside a run, and where a run ends (the page calls the host's sdeRevealStop then) - once per stop and never per step, through sdeOpenToolSource, so the editor of another object replaces the one opened before. VS Code marks the stopped line on its own and has no sdeRevealStop.

The user then found tabs piling up during debugging and while browsing the history: ADT's debugger opens its own editor of the program (the tab with the debug icon), and ADT's navigation, asked by VERTEX, opened the ordinary editor beside it. ToolsView.navigate now uses an editor of the object that is already open - a visible one first - and only opens one when none is; ADT's debugger editor, which ADT's model does not describe, is known by its title, "[SID] NAME". Compiled; not run in Eclipse.

The user closed the window during a session and the session seemed to hang; reopened, the window showed the stop but not where it was in the code, and F8 ended nothing. Three causes. A window closed in the middle of a run with Visual off never brought back the Eclipse windows it had hidden - the Debug view stayed away, and with it the editor's current line and Eclipse's Resume (F8), which needs a session selected there; closing now brings them back. A reopened window read the stop (picture) but only a stop event revealed it; the picture does too now. And the page had no keys of its own: F5 to F8 were bound by VS Code's editor only; the page now takes F5 Single Step, F6 Execute, F7 Return and F8 Continue while it has the focus, not in a field or with a dialog open (the selection screen keeps its F8). At the user's suggestion closing the window while the program stands stopped asks first - Exit program, leave it stopped, or cancel; Eclipse lets a view ask only through the save protocol (ISaveablePart2), so a stopped program is the window's dirty state and its tab shows a * meanwhile. Compiled; VS Code tests pass; not run in Eclipse.

Asked whether the documentation says the standard debugger must be switched off, it did not - and its VERTEX Smart Debugger section in eclipse/README still described the window as it was before this session (no keys, ADT doing the editor's navigation, every value read at every stop). It is rewritten for what the window does now, and names the one Eclipse setting that matters: the user's runs were slower until they turned off Run/Debug > Activate the debug view when a breakpoint is hit, which brings the Debug view back at every stop - every step of a run - undoing what VERTEX hides.

## 2026-10-24 — The record keeps what an operation wrote

At 19 steps a second the user asked that recording keep only changes, so that each operation says what it wrote, and that a statement writing nothing - WRITE, SKIP, ULINE - not be read at all. A local run already kept only changes (snapshot compared with the stop before and kept deltas, the player rebuilding a stop's values from them); a run in SAP stored every variable at every stop. Both now keep deltas, compared with the last stop of the same routine (owner, name, stack depth) - compared globally, entering a method would have shown the caller's variables gone and back. The player rebuilds any record kept as deltas and marks the values the shown stop wrote. frontend-analysis marks a statement quiet in the statement map when it writes no variable - WRITE without TO, SKIP, ULINE, NEW-LINE, NEW-PAGE, FORMAT - and a recorded run skips the scopes read with the step after a quiet statement and the snapshot after it. Tests: the SAP delta per routine; a playback test given the replay's new first line; the quiet flag checked through frontend-analysis on WRITE /, WRITE ... TO, SKIP, ULINE and an assignment.

## 2026-10-24 — Declared structures open to their fields; a recorded Continue that kept stopping

Without a debug session Visual Analysis in Eclipse still showed LS_RESULT without fields. Run through the Eclipse analysis bundle with a ZVERTEX_DEBUG_LAB-shaped program, the declarations had LS_RESULT typed zif_calc_types=>ty_context and no components - and value-origin-model's typeComponents gave none for that interface in VS Code's own modules too. The type is declared as a chain, TYPES: BEGIN OF ty_context, ..., END OF ty_context.; abaplint's statements (aceStatements) split a chain into one TYPES statement per part, and typeComponents kept its BEGIN OF ... END OF bookkeeping per statement, so a chained structure never closed. The bookkeeping now spans the statements of a source; a nested structure and an alias come out too, and the model's own tokens give the same. vscode/test/type-components.test.js holds the three cases; the Eclipse request now answers amount and currency.

The user also could not judge the speed of a recorded run: Continue (F8) under Rec steps, a series of F5s in both editors, kept stopping. The page ends the series when a stop names a breakpoint; VisualDebugSession named the first of thread.getBreakpoints(), which ADT's thread can go on returning after later steps. A line breakpoint now counts only when the top frame stands on its source and line. Compiled; not run in Eclipse.

In Eclipse the run then went at about five steps a second - and passed the last breakpoint, out of the program: the check compared the breakpoint's line with the frame's absolute line only, and the addresses in exact case. It now takes either line ADT gives a frame (absolute, or within its include) and compares the addresses ignoring case. The user, suspecting the drawing costs time, asked for a Visual switch in both editors, off by default, to measure again; the page had one once, until runs were made to draw always (s.draw=true). Visual is back in visual-debug.html beside Z only: on, a run draws the window at every step; off, when the run stops. Both hosts already styled a #visual button as a toggle.

With 0.9.30.20261024133002 the run stopped at its last breakpoint. The user then saw the declared view open LS_RESULT to its fields where a debug stop did not: the live list hides a field whose value is initial unless Initials is on, and a structure not yet filled is nothing but initial fields. Initials now thins only the top level of the list; a structure opened by hand shows all its fields, as the declared view does. With Visual off the user still saw the run being drawn; the page does not draw during a run (sdeDebugEvent is ignored while a series runs, and seen() draws only with Visual), so what moves is most likely Eclipse's own debugger - its Debug and Variables views and the editor's instruction pointer answer every ADT suspend.

Steps & values then recorded nothing: "Unknown ADT debug command: snapshot". The page reads a recorded stop's values with snapshot, which VS Code's host answers from debugger.js stopValues - the scopes of the kinds asked for with their variables, a structure's fields one level down as an object. VisualDebugSession had no such case. It has now, on the same scopes its Variables view reads, an event's variables on the frame collected as Globals as that view collects them. Comparing every debug(...) command of the page with what Eclipse answers found more with no answer: saveRecord, watchpointAdd, watchpointRemove, allBreakpoints, opendump, restore, toProgram, selection and openRuns; sapTranspile, sapRecompile and localSnapshot belong to the transpiler and local files, which Eclipse does without. Compiled; not run in Eclipse. (opendump turned out answered after all, by DebugMonitorView's runInSap.)

Asked whether Visual should also quiet Eclipse's own debugger windows, the user agreed, noting their Debug perspective had no Variables view open. The page now calls the host's sdeQuietDebugViews, when the host has one, at the start of a run with Visual off and again when it stops; DebugMonitorView hides whichever of Debug, Variables and Expressions are open and shows those again afterwards. VS Code defines no such function and is unchanged. Compiled; not run in Eclipse.

The next stop showed "listening for a run" and the thread list with the buttons dead, the program stopped on line 11: Eclipse reported more than one ADT thread - an earlier session still alive beside the new one - and VisualDebugSession chose a thread by itself only when there was exactly one. When there are several and exactly one is suspended, it is that one now.

With that build installed Steps & values recorded at 14.7 steps a second, structures' fields at every stop. Two more came up. A recorded run stopped on line 16 where the reader had no breakpoint: the thread also names ADT's own breakpoints - with Z only on, a step out of SAP's code is such a stop - and the hit check took them as the reader's; only breakpoints of Eclipse's list count now. And a second run showed no buttons until an F5 in ADT: once a thread was selected, VisualDebugSession dropped every event of another thread, so a new session stopping beside a still living first one went unseen. A stop of another thread of the project now takes over when the selected thread is not stopped itself, and with several stopped the one reported last is chosen. Compiled; not run in Eclipse.

The user then ran two programs, each stopped, each in a window of its own - and F5 in one went nowhere and emptied it. Each window chose its thread by itself (the only stopped one, or the one stopped last), knowing nothing of the other window, so both could take the same thread and one window stepped the other's program. Windows now hold their threads in a shared map: a window takes only a thread no other window holds, by itself or when a new stop takes over, and picking a held thread in the list says another window shows it. A window lets its thread go when it closes or the thread ends. Compiled; not run in Eclipse.

The user asked where the LLM log is, and for an icon for it in the assistant that says where to set it up when it is not. The Eclipse chat (resources/chat.html, Eclipse only) has a log icon beside the model list; ChatView's sdeOpenLogs opens Session Logs, or, with no log folder in the VERTEX Assistant preferences, answers where to set one, shown in the chat as an error line. Asked whether debug sessions are logged: in Eclipse not - the page's saveRecord has no Eclipse answer, and Session Logs opens recorded runs in VS Code only. Compiled; not run in Eclipse.

The user found the separate VERTEX windows always covering part of the screen and asked for a two-pane layout by default, editor left, VERTEX right. DetachedView no longer detaches: a view opened for the first time goes into one VERTEX stack (org.vertex.abap.ui.stack.beside), created right of the perspective's editor area at half its width when missing; what is moved is the view's placeholder in the perspective, the view itself living once in the window. A view already open keeps its place, wherever the reader put it. Compiled; not run in Eclipse.

The user asked Run in SAP in Eclipse to start the program as Run As > ABAP Application does, and Run with ABAP Transpiler to be hidden there until Eclipse has it. DebugMonitorView.runInSap now, for a program, takes ADT's launch shortcut com.sap.adt.sapgui.ui.runApplication from the launchShortcuts extension point and launches it in run mode on the program's editor (ToolsView.navigate, made protected, reusing an open one); a class or function module test with the field empty still opens SE24/SE37. The bundle requires org.eclipse.debug.ui for ILaunchShortcut. visual-debug.html shows Run with ABAP Transpiler only without window.vertexDebugHost, the Eclipse host's mark. eclipse/visual-debug.test.js: 5 pass, 1 fails - 'a native stop reaches shared recording without reopening the ADT editor', which expects no editor navigation at a stop, contrary to sdeRevealStop added earlier today. Compiled; not run in Eclipse.

At the user's word that test now checks what sdeRevealStop does: a stop opens its line once (ZCL_CALC, CLAS, 27), the same stop again opens nothing more, nor does a stop inside a run of steps. eclipse/visual-debug.test.js: 6 pass.

The user asked for the section switches at the very top of VERTEX Smart Debugger, a switch for the Run controls, and Variables full-screen like the diagram, in both hosts. In visual-debug.html #panes moved out of #right to the first line of the body, with a Run switch first; the three header groups (run, steps, Visual/Z only/record) are wrapped in #runsec (display:contents, so the header's layout is unchanged), a pane setPane hides like any other but layoutPanes leaves out. Out of #right the switches lost '#right [hidden]', which had kept Output's switch hidden; #panes [hidden] says it again. Variables got a ⤢ button (#varfull) toggling a fixed full-window class, Esc leaving it. Tests: 971 pass (eclipse/visual-debug and vscode). Built the vsix and Eclipse; the layout not looked at in either.

In a narrow VS Code panel the Variables toolbar ran past the edge and took the new ⤢ with it: #varsec h3 now wraps. The user also judged VERTEX: Run with ABAP Transpiler in the editor's context menu needless beside VERTEX Smart Debugger, whose panel has the same button; the editor/context entry is gone, the palette one for local files stays. README and the Marketplace page say so. At the user's word the menu's VERTEX items are ordered Tools, Smart Debugger, Run Select, Path to This Line (navigation@7-10), Unit Tests and ATC after them.

Asked why Eclipse has Visual Flow Analysis and what it is in VS Code: a remnant of 0.8.1, before Eclipse had Tools - a ToolsView opened straight on Calls, with a Logic toggle of its own; VS Code has no such item, Calls and Logic live in Tools. At the user's word it is gone: the view, command, handler and menu item in plugin.xml, VisualFlowAnalysisView and its handler, the visualFlow branch of tools.html in both copies, and its section in eclipse/README and its mention in docs/index.html.

The same for Forward and Backward Usage Analysis: VS Code hides both commands (commandPalette false, no menu) and reaches them from the debugger - Analyze flow path, and Where used on a breakpoint. The Eclipse submenu items are gone; their commands, handlers and the Value origin view stay, the debugger page's analysis (sdeOrigin) being independent of them. In Eclipse that leaves Backward with no way in: the page offers Where used only when the host defines sdeBackward, which Eclipse does not. The value-origin test that wanted the old menu label now checks the items are absent. eclipse/README's section says where both are now.

At the user's word Where used came to Eclipse as VS Code has it (extension.js, call backward): the point's line in its editor, then Backward Usage Analysis from there with the variable chosen in Variables. visual-debug-host.js defines sdeBackward, which the page waits for before it offers Where used, handing the point as text to DebugMonitorView's sdeNativeBackward; that opens the editor through ToolsView.navigate, puts the cursor at the line's start and calls ValueOriginHandler.open - execute's body, now static, taking the direction and the variable. The Target carries the variable to the page, and value-origin.html's runBackward follows it instead of the one under the cursor when given, as vertex.backwardUsage does with options.variable.

Asked whether such gaps come from duplicated code: partly - the page is one, but each host's bridge is its own (tools-window.js and extension.js; visual-debug-host.js and the Java views), and a function added to one host was never looked for in the other. eclipse/host-coverage.test.js now compares the sde* functions the page uses and the debug commands it sends with what each host defines and answers; the known gaps are listed with their reason (VS Code: sdeQuietDebugViews, sdeRevealStop, Eclipse-only by design; Eclipse: sdeClear, and the commands of Save session, watchpoints, All BP, restore, openRuns, selection, toProgram and the transpiler), and closing one fails the test too. BUILD.md names it in the validation command. 3 pass.

The test's first Eclipse gap, Clear, closed at once: asked whether it is for the transpiler, it is not - it drops a recorded run, the analysed path, the values followed and the output, an SAP run's as much. DebugMonitorView defines sdeClear, which reloads the page through PageView.loadPage (createPartControl's setText, split out); the browser functions and the view's VisualDebugSession stay, so the breakpoints and the ADT session do. host-coverage now wants no Eclipse function gap.

Asked why Eclipse's VERTEX submenu has Activate: ADT's activation with a block review first, by a preference (ask, always, never). VS Code has Save & Activate (no review) and Review & Activate. The user wanted only Review & Activate in Eclipse, where activation without a review is ADT's own Ctrl+F3: the item and command are named Review & Activate and always review; the preference, its combo in VERTEX Assistant's preferences and the Review/Activate/Cancel question are gone.

The user asked every VS Code command to start with VERTEX, to tell it from VS Code's and other extensions'. Seventeen titles had no prefix and showed bare in the menus (Save & Activate, Review & Activate, Run ABAP Unit Tests, Run ATC Check, ABAP Documentation, Get Started, Choose Log Folder, the VERTEX Tools functions ...), the palette adding their category. All titles now begin with "VERTEX: ", and the categories went: the palette writes a category before the title, which made Go to (by context) and Back read "VERTEX: VERTEX: ..." there already. The Marketplace page names them so. VS Code tests 965 pass.

The update site in docs/ now carries build 0.9.30.20261024162505: its p2 repository (content.jar, artifacts.jar, features/, plugins/) replaced by the package.ps1 site of that build, index.html and .nojekyll kept; README, docs/index.html and eclipse/README name the build. Not committed or pushed, so not yet on GitHub Pages.

The user found ASK AI of a review half-done: it put the whole prompt, the review's JSON context included, into the chat's input, leaving no place for a question and no way to ask about several blocks. code-review.js now gives the blocks as data (askContext: the block, or every block with all) and the rules the chats follow - mergeAsk (a block of the same review adds to the chip, another review or all replaces it), askLabel ("Review · ZT · blocks 1, 2") and askRequest (the question, or the default when empty, then the blocks as untrusted data). The review page has an ASK AI beside Approve All. VS Code's panel (sidebar.js) keeps the chip's blocks in the host and attaches them when the next question is sent, showing only the question and the chip's label; its old pendingPrompt path went with the JSON. chat.html, the Tools chat of VS Code and Eclipse, has the same chip; it cannot load code-review.js, so it repeats the three small rules, with a comment naming where they come from. Eclipse's review hands its blocks through sdeAskBlock to ChatView.reviewAsk, which calls the page's sdeReviewAsk; tools.html forwards it into the chat frame. Found on the way: the log icon added to chat.html this morning stood in VS Code's Tools chat too, where nothing answers it, and in Eclipse's Tools frame, where a host function called from the frame fails - it now shows only when sdeOpenLogs exists, and tools.html forwards sdeOpenLogs into the frame. Tests: VS Code and Eclipse 983 pass, the two old Value origin failures; the chip checked in a browser on chat.html. The user also reported that a Tools transport review gave the model only fragments.

Looked at: the review page tells the chat only names (pageState, "never a line of source"), the model reads the review with its diff tool - blocks and a few lines around them - and chat.js's rule for a focused view, "answer from what is on screen and do not read the object again", kept it there even with the reader in Full. For a view naming a review_object chat.js now says the diff is blocks with a few lines, and to read the whole source with read_sap_object when the answer needs more, rather than ask or guess. Eclipse takes chat.js through prepare.js. Asked why the blocks had no Approve: the review was built live from ADT, not saved, and a live review shows no verdict buttons - not authorship, which nothing checks. Its buttons did not light on hover (list-hoverBackground, near the dark theme's background); versions.html's buttons take the theme's secondary button and its hover colour as VERTEX Smart Debugger's do, Approve and Decline the review's green and red (code-review.js). ASK AI came to the transport review as well: on each block and beside the object's title for all of them, shown also on a live review since it writes nothing; askReview builds the same blocks code-review.js gives (lines, five around), and tools.html hands a result frame's sdeReviewAsk to the chat frame's chip - not to the chat frame itself, which keeps its own. Tests 983 pass, the two old failures; the transport review's look not checked in an editor.

The user found AVE's report in SAP GUI handsomer and asked to take it further from AVE's git, and reminded of AVE's AI prompt diff and AI prompt full, which put a prompt on the clipboard where no AI is set up, and of its link to the code. From AVE (zcl_ave_acr_report: coloured column heads, a developers table, a group per kind with caret and total, rows +/~/- green, orange and red, Expand all / Collapse all) versions.html's review summary is redrawn in the theme's colours - the button background for the heads, the charts' green, orange and red for the counts - as developerTable and objectGroups; objectTable went. The developers table is gathered from the objects' authors, the only per-author data the review has. A block has Open: tools.html hands a result frame sdeOpenReviewSource, onto the host's sdeOpenToolSource in any window - a program at the block's line, a method in its class. Copy prompt: diff (the blocks, five lines around each) and Copy prompt: full (the whole source, + and - marked) stand beside the object's name; the clipboard is the host's sdeCopyText - Eclipse's, and VS Code's tools-window now defines one too (copyText, vscode.env.clipboard), which also mends the Tools chat's Copy under an answer: it called sdeCopyText, which VS Code never defined. AVE says a block is never approved by its own author; VERTEX checks nothing of the kind - not changed. Checked in a browser on the page with sample data: the summary's totals and shares, the block's buttons and both prompts. Tests 983 pass, the two old failures.

In Full the model still saw no more than blocks: it was told names only and read the review with its diff tool, and since the last change re-read the source itself on every question. versions.html now offers sdeReviewSource - the object as shown, Full the whole source with + and - marked, Compact the blocks with five lines around each (the Copy prompt texts without their instruction) - tools.html puts it in the request state as review_source, and chat.js gives it to the model as untrusted source data (capped at 200000 characters), counts it as what is on screen, and keeps the "read with read_sap_object" rule for Compact only. Checked sdeReviewSource in a browser with sample data; tests 983 pass, the two old failures. On the way the reason for the occasional "Assistant preparation failed" turned up: prepare.js's copyFileSync of code-review.js into org.vertex.abap.ui/assistant failed with UNKNOWN (-4094), a locked file - a second run went through.

## 2026-10-23 — Eclipse: Run Select, the VERTEX menu as VS Code's

Comparing the two context menus side by side the user asked for as few differences as possible, and noted that earlier questions about differences had not found these. Run Select was missing in Eclipse. Its decision - SelecTor when SelecTor can say the SELECT, the data preview otherwise - moved from the VS Code command into select-query.js (run, page), which the VS Code command now calls; frontend-analysis answers it as /sap/bc/adt/vertex/runselect for Eclipse's worker. Eclipse got RunSelectHandler, RunSelectView and eclipse/run-select.html: a SelecTor answer opens VERTEX Tools on the table with its plan (ToolsView.OPENS hands it to the new window) and the Run Select window closes; rows are drawn in it otherwise. Checked through the Eclipse bundle that a SELECT on a table with a WHERE answers the SelecTor plan. "Open Visual Debug" is named "Visual Analysis / Debug" as in VS Code. Visual Debug opened from an editor did not get the editor's line - ToolsView passed cursorLine, the page reads line - so its Variables said "line ? ... is in no method"; DebugMonitorView now passes it as line. What still differs: Go to / Go to Definition / Back are ADT's own (F3, Alt+Left); Run with ABAP Transpiler stays out by the user's word; Forward and Backward stay in Eclipse's menu because its Visual Analysis does not yet work without an ADT session; Visual Flow Analysis is VS Code's Calls/Logic in Tools. A temporary trace in VisualDebugSession logged what Eclipse reports as debug targets and threads. In the next try Visual Debug found the session, and the trace showed it as expected - AbapDebuggerLaunch, AbapDebugTarget, an AbapDebugThread suspended in the project - so the earlier "Start an ADT debug session first" was most likely taken while nothing was stopped. The user then found LS_RESULT without fields while stopped on line 16: the debugger opens a structure once the statement has filled it (it did after a step), and VS Code's live view is the same; what VS Code does more is read the declared variables, structures opened to their type's fields, with no session at all - in Eclipse that had failed on the missing cursor line, fixed above. Both traces are removed. A VS Code test expecting the exact UML call was given its newTab field.

## 2026-10-23 — Eclipse: Forward and abaplint

Forward Usage Analysis in Eclipse failed with "Value origin in Eclipse has no module @abaplint/core". Since VS Code 0.9.23 call-graph.js asks abaplint whether a call is a built-in function (lines( ), xsdbool( )); Value origin in Eclipse runs in the page itself from value-origin-bundle's fixed list of modules, which has no abaplint, so any flow that met a call failed. A browser test with a call-free program had passed. frontend-bundle.js now builds any entry as a window global (build), and abaplint(root) bundles @abaplint/core alone; prepare.js writes it as assistant/abaplint.js, ValueOriginView puts it into the page before the analysis, and value-origin-bundle hands it out for require('@abaplint/core'). Checked: Forward on a program with x = lines( t ) draws its slice in the page built as ValueOriginView builds it, ADT stubbed.

The user's first real run then showed two more things. The window docked into the perspective (ValueOriginHandler used page.showView); it opens detached now, as Tools and Path to This Line do, and Backward with it. And interfaces met by the flow were reported as "Resource CLASS ZIF_... does not exist": the flow asks for a name as a class, and VS Code's loader reads it again as an interface when SAP finds no class (code-workbench load); the Eclipse page's loader did not. It does now, on ADT's "does not exist" or "was not found". Compiled; not run in Eclipse.

## 2026-10-23 — Eclipse: one editor for UML clicks, Ctrl for a new tab

With the links working, the user found every click left a new editor tab behind and asked for either-or; of the two ways offered they took plain click reusing the one editor, Ctrl+click a tab of its own. metrics.html adds newTab (Ctrl or Cmd) to what a UML click sends - VS Code ignores the field. ToolsView remembers the editor it opened last for a plain click and, when the next plain click opens a new one, closes the previous - only an editor this window opened itself (the set of open editors is taken before navigating), never one with unsaved changes, never one opened with Ctrl. Checked in the stubbed Tools page that a plain and a Ctrl click send newTab false and true; the closing is compiled, not run in Eclipse.

## 2026-10-23 — Eclipse: the chat in its own window

Asked where the chat is: in Eclipse only as Ask AI inside VERTEX Tools. ChatView, the chat window, has been in the code all along with its id, but plugin.xml never declared it, so nothing opened it. The user wanted it "as an option": the view is declared, ChatHandler opens it detached on the project of the selected object or the active editor (none: the view asks, as every VERTEX window opened without an object does), and the VERTEX submenu has VERTEX Assistant. Asked about chat logs: the Eclipse settings store on this machine held no log folder, so nothing was logged; the defaults are VS Code's (no folder, every flag off). Eclipse had no counterpart of vertex.ai.log.request; at the user's word it has one now: the logRequest flag in AssistantPreferences, passed by AssistantBridge as logInclude.request, and eclipse/bridge.js computes the prompt before asking and hands instructions, prompt, tools and schema to session-log's request(), as vscode/chat.js does. Run through the prepared bridge with a stub model: the log holds user, vertex_request, assistant. Compiled; not run in Eclipse.

## 2026-10-23 — Eclipse: UML method links from a free Tools window

From an editor a UML method opened its source; from a Tools window opened in Project Explorer nothing happened. Driven in the stubbed Tools page, the click reached sdeOpenToolSource with the class and method, so the page was right. ToolsView asked ADT to open the object and then went on with the page's active editor - from an editor-bound window that is the object's own; from a detached window opened in Project Explorer the focus stays in that window and the active editor is another object's, so the line was looked for there. The handler now goes on with the editor ADT's navigation returns (navigate), activates it, and finds the method in it; an object that is not open is opened. (In the stubbed page the UML first stayed on "Drawing": the browser pane was hidden, which pauses requestAnimationFrame; drawing by hand showed the links.)

Installed - its bundles.info named 0.9.30.20261023220500 - the click still seemed to do nothing. Eclipse's log had no VERTEX error but did show the clicked classes' editors becoming active: the source opened in the workbench window, behind the large detached Tools window. After opening, the workbench window is now brought to the front (un-minimised, forceActive). Built as 0.9.30.20261023221521 - and wrong: the user's screenshot showed the workbench in plain view and nothing opened. (Earlier target/eclipse-* folders had been deleted before each build; the user had installed one of them and Eclipse could no longer find it. Builds now stay in their folders until the user removes them.)

A temporary trace into Eclipse's log - from the page on each click, and from ToolsView on each open - settled it in two rounds. The click found the link and an opener, and ToolsView's sdeOpenToolSource was never called; the opener the diagram used was the frame's own sdeOpenToolSource, which threw "Element not found" (0x80070490). SWT's Edge browser puts every BrowserFunction into every frame, where it only fails. A window bound to an editor never met it, because tools.html replaces the frame's copy with a call to its own; in a free window nothing replaced it, and metrics.html's umlSourceOpener prefers sdeOpenToolSource. The user's remark that the trouble began with the detached window pointed the same way but was not the cause: sdeTrace from the same window reached Eclipse. tools.html now clears the frame's sdeOpenToolSource in a free window (the frame keeps only what the page hands it, as in VS Code) and forwards sdeCopyText and sdeOpenObject to its own, since the chat in Tools calls those two directly and met the same failure. The traces are removed; the editor-to-front step stays, as an editor opened from a detached window would otherwise stay behind it.


## 2026-10-23 — Eclipse: a package's UML and metrics

With the Accept header in place the user saw package Z_RIG's metrics empty (Objects (0)), its UML still spinning, and the Tools fields black. The package's objects were read from elements named `item`; ADT's node structure names them TREE_CONTENT/SEU_ADT_REPOSITORY_OBJ_NODE, as abap-adt-api reads them, so every package was empty in Eclipse. The fields: tools.html fell back to #1e1e1e/#d4d4d4 where VS Code supplies --vscode-input-*; Eclipse supplies none, so they were dark on a light window. They fall back to Field/FieldText, which follow the page's color-scheme.

To see the UML for once instead of guessing, the Tools page was built as ToolsView builds it (tools.html with the service pages, object model, routes and the Eclipse front end) and driven in a browser with Eclipse and ADT stubbed: package Z_RIG with two classes now draws both in UML and lists both in Metrics. A first run said "mermaid.min.js was read but defined no mermaid object" - an artefact of the harness, which had put a 3 MB script before the page's meta charset, so the file was decoded in the wrong encoding; Eclipse hands the page over as a string. What kept the user's window on "Loading the diagram library" is not reproduced; it was gone with this build when the user tried it. Published as 0.9.30.20261023215155 into docs/, "Latest build" in docs/index.html, README and eclipse/README following. The "1 analysis warnings" is the shared note that local metrics may differ from ACE, shown in VS Code too.

## 2026-10-23 — Eclipse: Forward and Backward against VS Code

Compared with VS Code by the code, the analysis of both directions is the same shared code; the differences were in what the Eclipse page does with the messages of the page it draws. Copy log and a page's own failure went nowhere (Backward even answered Copy log with "This node names no source to open"); a running analysis could not be stopped, where VS Code's progress has Cancel; a scenario click said "is in VS Code only". The last turned out wrong on VS Code's side too: its handler calls loaded.loadPipeline, which no analysis sets, so a scenario there loads nothing - Eclipse now ignores it the same way instead of claiming VS Code does it, and the loader is left as it is.

Copy log goes through a new sdeOriginCopy onto SWT's clipboard and the page hears copyLogResult; a page failure is said in the status line. Cancel: a button beside the status while the analysis runs; it marks the page stopped, stops it waiting at once (each worker request races a promise the button rejects - one ADT read that never answers would otherwise hold it), and tells the worker through window.vertexEclipseCancel, now the general form of sdeCancelWorkspace. frontend-analysis's backward walk takes the cancelled check the forward request already had, at each source read and where-used. Checked in a browser with an ADT that never answers: Forward and Backward both end with "Analysis cancelled." right after Cancel; Copy log reaches the clipboard stub and the page gets ok; a page error shows in the status line.

Published as 0.9.30.20261023203747 into docs/ with the colour, cancellation, Project Explorer and help-block changes before it; "Latest build" in docs/index.html, README and eclipse/README follow.

## 2026-10-23 — Eclipse against VS Code, by the code

The user asked that the "ADT analysis help" block go - an Eclipse-only note in eclipse-frontend.js, two of whose claims were stale (no scroll synchronisation; saving a review needing VERTEX's ABAP) - and then for every such difference, found by comparing the code. The comparison: the sde* functions the shared pages call against what each host defines (VS Code's tools-window and extension, Eclipse's BrowserFunctions, tools.html's child wiring and the route-built service calls), the VS Code theme variables the pages use with no value for Eclipse, and the pages' host-specific messages. Real differences: Logic's Code view and Reachability had no colours in Eclipse; a superseded Calls analysis was not cancelled there (no sdeCancelWorkspace); a Value Origin scenario's pipeline opens in VS Code only; Session Logs opens no recordings; Local Folder is VS Code's. The user chose the first two.

Colours: metrics.html's :root and dark palettes now give the --vscode-* names the Code view and Reachability use (editor background and foreground, line numbers, links, the cursor line, hover, focus border, panel border, widget background). In VS Code tools.html copies the theme's values onto the child page as inline styles, which win over these. Cancelling: eclipse-frontend's worker keeps a set of cancelled request ids and hands frontend-analysis.request the check it already takes; window.sdeCancelWorkspace marks every Calls request still running. Checked in a browser: a Calls request whose ADT read never answers rejects with "Analysis cancelled" right after the cancel; the Code view's link, cursor line, fold text and background in light and dark, and a VS Code theme value still winning.

## 2026-10-23 — Eclipse: Tools from Project Explorer is a free window

Logic view on a class opened from Project Explorer said "Pick a method on the left." with Parts folded away. ToolsView marked every window it opened on an object as boundObject, the state VS Code gives only to Tools opened from an editor: the object fields hidden, Parts folded, the routine chosen by the editor's cursor - and it sent the line of whatever editor was active, another object's or none. Now the window is bound only when the active editor shows the object it opens on; from Project Explorer it opens as VS Code's sidebar Tools does: object type and name fields shown (a mask such as ZV*LAB lists matches), Parts open. This also answers the user's earlier ask for the object fields in Eclipse. Compiled; not run in Eclipse.

## 2026-10-23 — Path to This Line in colour

The user saw Path to line in Eclipse uncoloured and took it for an Eclipse gap; asked, they said it should look like the Logic view's Code. Neither host coloured it: the page marked only Value sources' variables. The parse it builds from already carries the parser's token colouring (value-origin-linter lexColors) that ace-scheme's codeView uses, so build passes it to page, which wraps each token in the same tk-* classes; a Value sources mark at the same column goes first and wins. The colours are VS Code's theme variables, and eclipse/reach-path.html gives them Light+/Dark+ values. Checked: the markup for keywords, numbers, strings, a class and a method; the Eclipse page in light and dark in a browser. Eclipse rebuilt as an install archive, 0.8.29 by the user's word.

The user then set the number: VS Code 0.9.30, and Eclipse the same - the plugin follows the extension's number from here (MANIFEST.MF, feature.xml, package.json). Built vertex-abap-0.9.30.vsix and the Eclipse archive 0.9.30.20261023195758; put into docs/ the same way, with "Latest build" in docs/index.html, README and eclipse/README following.

## 2026-10-23 — Eclipse: UML of a package

UML on a package in Eclipse answered "Request could not be understood by the server due to malformed syntax: Accept header missing". The package's objects come from ADT's repository/nodestructure, a POST that PageView.assistantPost sent with no headers; abap-adt-api in VS Code always sends an Accept. assistantPost now asks for the type ADT's Project Explorer asks for, application/vnd.sap.as+xml with dataname com.sap.adt.RepositoryObjectTreeContent; the answer's vnd.sap +xml type is taken by the response filter addAdtTextHandlers already registers. Compiled; not run against SAP.

## 2026-10-23 — Eclipse: Logic Code view in colour

The user saw Logic's Code view in Eclipse without token colours. metrics.html coloured abaplint's tokens with VS Code theme variables alone (--vscode-debugTokenExpression-*, --vscode-symbolIcon-*), and Eclipse's browser defines none, so every token fell back to plain text - the page's own palette, which gives Eclipse light and dark values from :root and prefers-color-scheme, had been passed over. The token colours now live in that palette as --tk-*: VS Code's Light+/Dark+ editor colours in Eclipse, the theme's variables (with those as fallbacks) under body.vscode-*; comments take --muted. Checked in a browser in light and dark, and that a VS Code theme variable still wins under body.vscode-dark. Line-number links in the Code view still use --vscode-textLink-foreground with no Eclipse value; not changed.

## 2026-10-23 — Eclipse: Path to This Line and Session Logs

The user asked for every VS Code function in Eclipse one to one, the SAP debugger aside, and named three gaps: Path to This Line (required), the transpiler (if possible), the logs (required). The audit found the rest either shared code that a rebuild carries (review, Versions, Logic, Calls, Metrics, SelecTor, Value Origin) or VS Code's own host (editor folding and jumps, local files, SAP Systems and RFC, Save & Activate, unit tests, ATC, documentation, which ADT has).

Path to This Line: reach-path.js's register built the path and the page inside VS Code's command. The build moved into `build(text, offset, line, options)`, which VS Code's panel calls and which frontend-analysis answers as `/sap/bc/adt/vertex/reach` - a write carrying the editor's text, since Eclipse's analysis worker takes every request through that door. Eclipse got ReachPathHandler, ReachPathView and eclipse/reach-path.html, which writes VS Code's page into a frame with acquireVsCodeApi answered by the window, and PathPreferences for methodRelativeLines. The view follows the editor by a MouseUp listener on its StyledText, as VS Code follows Mouse selections. In a stubbed browser run the second path's script was blocked: a document written into the same frame keeps the first document's Content-Security-Policy, whose nonce no longer matches; each page now gets a fresh frame. Checked there: the path, Value sources kept across rebuilds, a line link revealing, and a line outside a routine leaving the last path with the reason.

Session Logs: log-report.js parsed with Node's path.basename; it now cuts the name as text, so eclipse/logs-bundle.js can carry log-report, log-snapshot and session-log into the browser (fs and path throw if used; crypto gets its bytes from the browser). LogsView reads, lists and deletes the JSONL files, opens logged objects in ADT on the project the log names or a chosen one (the project is resolved per object, not cached), opens a local file in Eclipse's editor (org.eclipse.ui.ide and org.eclipse.core.filesystem added to the manifest), and opens the assistant preferences and a folder chooser; eclipse/session-logs.html speaks to VS Code's log-report.html as the panel does. Snapshots open in the same window with a way back. Checked in a stubbed browser run with one log. The report still names `vertex.ai.log.request`, which Eclipse has no setting for.

Built with eclipse/package.ps1 as 0.8.25.20261023182803 in target/ (82 classes), then again below; not put into docs/ and not installed in Eclipse. Eclipse tests: the same 3 failures as before the change. The transpiler is not ported: the user decided Eclipse does without it.

The user found the VERTEX items so low in ADT's editor menu that they fell off the screen: each was contributed on its own after `additions`. They are now one `VERTEX` submenu contributed `before=group.undo`, the first group AbstractTextEditor gives a text editor's context menu; a menu without that group - a tree's - gets it at its end. The submenu shows where VERTEX Tools does, each item keeps its own test, and Session Logs stands below a separator. Rebuilt as 0.8.25.20261023183624 in target/; whether ADT's editor menu has group.undo is to be seen in Eclipse.

It has none: the user's screenshot showed no VERTEX at all - a contribution whose anchor a menu lacks is dropped, not appended at the end as the comment had assumed. ADT's own plugin.xml anchors its editor items at `#EditorContext?after=group.open` and its Project Explorer items at `group.open` too, so the submenu went `before=group.open`, above ABAP Type Hierarchy. That vanished too. Flat items in `additions` were put back for a moment, until the user pointed at GitHub, Team and Run As: submenus in that same group, which every popup has. The VERTEX submenu now stands there, `after=additions`, beside them - not at the top, but one entry instead of seven. Rebuilt as 0.8.25.20261023185106 in target/.

The user found the menu right and named the version: 0.8.29, in MANIFEST.MF and feature.xml. Built as 0.8.29.20261023191934 and put into docs/: content.jar, artifacts.jar, features/ and plugins/ replaced, the rest kept; the site's metadata names only 0.8.29.20261023191934. "Latest build" in docs/index.html, README and eclipse/README follow, and docs/index.html now lists Path to This Line, Session Logs and the VERTEX submenu. Not installed in Eclipse from this site; publishing is a push of main.

## 2026-10-23 — VS Code 0.9.29: SAP Systems buttons

The user found the table's buttons off-style - square, no hover - and Change password closer to saving a new one. system-table.js's buttons take VERTEX's 6px rounding (as vertex-toggle) with the theme focus colour glowing under the hovered one, disabled ones dimmed; the label reads Save new password. No shared action-button class exists in vertex-controls.css, so the style stays in the table's page.

The user asked how to recompute a live review after the request's content changed - the only way had been to open the window again. review-front builds a review with nothing saved from ADT on every read and keeps nothing, so versions.html's live view got a **Rebuild from ADT** button that simply calls loadReview() again. Eclipse shares the page but was not rebuilt, so its README is unchanged.

That first button did not rebuild anything: review-live keeps a build for five minutes, and reading again inside that time returned the kept one. The page now asks with a fifth argument, which tool-routes turns into `fresh=1`, and build skips what it kept.

The user then asked whether the request's change time could tell when a saved review needs building again. E070's date moves with the header, not with a source edited in the request, so the check goes by versions instead. review-live's staleness chooses each part's pair as a build would and compares it with OBJ_STATS's VERSNO_NEW/OLD; sources are read only where numbers cannot settle it - a new side that is the active state (99998), compared with the new side of the stored diff, and a part the request names that the review does not hold, which counts only when its diff is not empty. A part that cannot be read is listed as not checked, not taken for unchanged. Carrying verdicts over was set aside: a block's key is its position (type~part~number), so a block added above moves every key below it. The new write action R replaces the saved review with a fresh build, keeps HISTORY and refuses a stamp that moved since the page read it.

A wrong turn on the way: moving the request reading into requestParts dropped `numbers` from buildNow, and every part failed into MISSING - the existing review-state test caught it.

Checking the Eclipse side turned up a second hole: versions-front reads a revision's text once a session by its address, and the active state (00000) keeps one address while its text changes. A check or a rebuild after an edit would have compared and built from the text read first. review-live now reads the active state anew each time and keeps only numbered versions.

## 2026-10-23 — VS Code 0.9.28: the Path panel follows the cursor

The user, working through a long method with the panel beside it, asked for the path on the right to be rebuilt for each click on the left. register's parse-path-sources work moved into `build`; the panel listens to onDidChangeTextEditorSelection for its own document and rebuilds on kind Mouse only - a line opened from the panel (a selection set by code) or a keyboard move does not rebuild, so following a link does not replace the path being read. A turn counter drops a result overtaken by a later click. A refusal (a line outside any METHOD/FORM) is posted to the page and shown above the old path instead of an error popup per click. The toggle keeps its state through webview getState/setState, since each rebuild replaces the html.

The user's look at the toggle showed a misunderstanding: the list under the path was not it - they wanted the place where a variable is computed (a CALL FUNCTION ... IMPORTING ev_valid = lv_valid) shown in the path itself, the colour tying it to the condition. valueSources now also returns `before`, the sources per condition line, and the page puts each as a `feed` row right above its condition, hidden while the toggle is off; the list stays below. Constants were coloured too (lc_ins, abap_true): abaplint's meta marks them `read_only`, which IMPORTING parameters also carry, so a read is skipped when read_only without `importing`. Probed first that a CALL FUNCTION of an unknown FM still gives `Write To` for its IMPORTING actuals.

Also at the user's request: a gear (`vertex.openSettings`, view/title of vertex.launcher, hidden from the palette) opening the Settings editor on `@ext:YuriiSychov.vertex-abap`. Then, asked to refactor: the SAP system and LLM Providers links moved beside it as view/title icons (`vertex.openSystemSettings`, `vertex.openModelSettings`, ordered navigation@1..3, hidden from the palette); the links, their handlers, the sidebar's `settings` action and its `configModels` message are removed, and the 📜 buttons take the `margin-left: auto` the LLM link used to carry.

Next the user asked for a table of systems - SNC on/off, delete, test, deactivate - then refined it while it was being written: a hybrid screen like LLM Providers, tests per row rather than all at once, a Log in for the password, and Import offering only new systems; moving the SNC checkbox out of the panel saves its room. Decisions taken by default while the questions went unanswered: the server icon opens the table (the gear already opens raw settings); `disabled: true` is filtered in extension.js `systems()` and auth `currentSystems()`, so it is gone from the list, Switch System, Test SAP Systems and connections, and a tab bound to it names the switch; Delete confirms modally and, like Remove configured systems, does not forget the kept password. system-table.js changes an entry by index and checks its name, so an edit made meanwhile is refused instead of overwritten. testSystems' loop body became `testSystem(entry)`, used by both. `auth.login` always asks and keeps what is entered (password() returns the kept one). Import now skips candidates whose SID is already a configured name before probing them - a second system with the same SID on another host is no longer offered either.

Asked whether a "logged in" mark makes sense: ADT requests carry the kept password each time, so there is no session to show; what is real is whether a password is kept, and the last test. `auth.hasPassword` reads the credential store (never SAP, never the value); the row's button reads Change password when one is kept, Log in otherwise, and is redrawn after every test, since a 401 drops the kept password. Test results are kept host-side by system name in a module Map until reload, and in the page across redraws, which used to wipe the result cell.

## 2026-10-23 — VS Code 0.9.27: RFC dump on large sources, method-relative Path numbering

The user double-clicked a static method call in a large class on an SNC system and got `RFC_ABAP_RUNTIME_FAILURE` / `XML_FORMAT_ERROR` from `SADT_REST_RFC_ENDPOINT`. Without a wire log the failing request could not be named, so the dump was read from screenshots of ST22: `CX_XSLT_FORMAT_ERROR` in SAPLSADT_REST, raised in `REMOTE_FUNCTION_CALL`, kernel `Xml2AbapRun`, `NODE_TYPE illegal` - the RFC parameters themselves were not accepted, before any ADT handler ran. The body travels as the XSTRING `MESSAGE_BODY` and the URI and headers of `navigation/target` are plain ASCII, so a stray character was unlikely; hover in the same class failed the same way, hover in a small object worked. It is the size of the source sent (hover and navigation send the whole editor text, as Eclipse does), with the threshold unknown. Where in sap-rfc-lite, the SDK or the kernel the large XSTRING breaks was not found.

The user chose: a configurable line limit (`vertex.rfc.maxAnalysedLines`, 0 = none), RFC systems only; after the first dump, no more source-sending calls for that object until reload; navigation in a refused source by abaplint. sap-code.js gates elementInfo, elementDetails, definition and implementation behind `sent()`, keyed by the source URL without fragment, refusing with code `VERTEX_SOURCE_NOT_SENT`; the dump itself is still shown once. goToClassMethod's SAP part moved into `sapNavigation`; on that code it calls local-navigation's new `resolveSource`, abaplint over the one source in a registry of its own (the local-file cache is not touched), declaration leading on to implementation. Names in other objects are left to the existing static/instance call resolution, which reads sources by GET.

In the same landing, at the user's request: Path to This Line can number lines from the routine's opening statement (`vertex.pathToLine.methodRelativeLines`), because the absolute class line is hard to find in SAP GUI's method editor. Only the displayed numbers change; links keep source lines.

Then, at the user's request with a debugger screenshot beside the panel: a toggle to show where the conditions' variables come from, a colour per variable. The user chose the last write before each condition on the path. The ACE statements carry tokens only, and regex over ABAP is ruled out, so `valueSources` runs abaplint's SyntaxLogic and walks the spaghetti scopes' references: `Read From` on a condition's lines, the last `Write To` of the same resolved declaration between METHOD and the condition. Probed first: CALL METHOD ... IMPORTING, SELECT INTO @DATA( ), DATA( ) and component writes (`ls-a = ...` writes `ls`) all come as `Write To`. abaplint's errorNamespace is set to match nothing, so a Z type it cannot see is void and does not stop the method's analysis. Colour by declaration, so one variable keeps its colour where two conditions find different writes. Rendered as spans by column in the rows and in a list under the path, coloured from the theme's chart colours, all under the shared `vertex-toggle`. "Last before" is by line order: a write inside a branch the path avoids still counts.

## 2026-10-23 — Eclipse rebuilt: 0.8.25.20261023012033

The user asked how far Eclipse had fallen behind: plugin 0.8.15 and its analysis bundle (vertex-frontend.js) last built on 2026-10-14, 98 commits and VS Code 0.8.16-0.9.26 since. Rebuilt with eclipse/package.ps1 (JustJ javac 26 at --release 21, against ~/.p2/pool/plugins). The first run failed in prepare.js: the browser bundle follows every require() it finds, and value-origin-model has required sap-fugr.js since 0.9.5 for a module's signature - a token reader - while sap-fugr's local-file functions require fs and path inside them. frontend-bundle now gives a browser fs and path the same stand-in it gave crypto: a proxy that throws when used, so the local-file paths say so instead of being dropped. The bundle then carries codeView, reachLines and programInclude, and parses. Built: target/eclipse-0.8.15.20261023010021 (update site and install archive), the plugin jar with its 67 classes and the new metrics.html, versions.html, object-tools.js and bundle. The version stays the manifest's 0.8.15; no number was chosen for Eclipse. Eclipse tests: 6 of 16 failed on the last commit's stale bundles, 3 after the rebuild - the Value origin page's bridge order, its script count, and the plugin.xml label of the Value origin command, all from 2026-10-10 and older than later renames; left as they are. Then, at the user's word, version 0.8.25 (MANIFEST.MF and feature.xml), rebuilt as 0.8.25.20261023012033 while docs/ still held the template, and put into docs/: content.jar, artifacts.jar, features/ and plugins/ replaced, index.html, .nojekyll and the rest kept. The site's metadata names only 0.8.25.20261023012033 and keeps its category; the plugin jar has its 67 classes. "Latest build" in docs/index.html, README and eclipse/README follow. No PDE export: package.ps1's site is the p2 repository, made from the last export as its template. Not installed in Eclipse from this site; publishing is a push of main.

First look in Eclipse: the Code/Diagram toggle showed in UML. It carries the hidden attribute outside Logic, but the shared vertex-segment-toggle style sets display: inline-flex, which outweighs [hidden]; `#logic-view[hidden] { display: none; }` puts it back. Rebuilt VS Code 0.9.26 and Eclipse as 0.8.25.20261023012033, which replaced the site in docs/ (metadata names only the new build). Also from that look, explained rather than changed: the Tools view stood in a minimized view stack, which Eclipse shows as an overlay and hides on the next click in the editor; double-click navigation never existed in the Eclipse plugin (ADT's F3 and Ctrl+click navigate there) - both offered as Java work, not done.

The user chose a window of its own for Tools over restoring the minimized stack. DetachedView.show opens the view as before and, while it stands in the workbench window (EModelService.getTopLevelWindowFor), detaches its MPart into a window beside it - two thirds of the workbench's width, its height -; a view already in its own window is only activated. ToolsHandler and ServiceHandler use it. Require-Bundle gained org.eclipse.e4.ui.model.workbench and org.eclipse.e4.ui.workbench; package.ps1 carried both into the site's content.xml as osgi.bundle requirements. Compiled; rebuilt as 0.8.25.20261023012033 and put into docs/. Not run in Eclipse: the window's placement and whether detaching behaves in the user's ADT are unseen.

## 2026-10-23 — VS Code 0.9.26: review blocks out of the session log

The user found code in a session log: a review block sent as context (`review_object`, `review_type`, `compared_with`, `text`) was logged with its whole diff, against the 0.9.22 rule that logs carry references, not code. session-log's sanitize omitted a `text` only under a fragment or selected_code parent; now also under a review parent or beside `review_object`. As the user added, a review block is a part: objectReference turns review_object and review_type into a reference - REPS as PROG, FUNC as FUNC, class parts (METH, CPUB, CPRO, CPRI, CINC) as their class - carrying the part, so the log links to it. Test with the user's case (Z_TR_TEXT_TRANSFER, REPS); 947 pass. Version 0.9.26 at the user's word.

## 2026-10-22 — VS Code 0.9.25: Code view opens a step at a time

The user opened "(129 operations hidden)" and got far too much: ON_TOOLBAR_CLICK's `CASE fcode`, opened, showed every WHEN with all its statements - Depth already kept the blocks nested in them folded, but the WHENs counted as no step. As the user put it, opening should act like Depth + 1 for that range. codeView now treats an opened block's branches as a step: when a block Depth folds has been opened and has branches (B rows of its own depth), each stretch - before the first branch, and after each branch up to the next or to the closing statement - is a fold of its own unless opened, keyed by the branch's row (the stretch before the first branch by the opening's row negated, so keys never meet a block's). A block without branches opens to its inside at once, as before. The diagram is unchanged: there an opened block shows its branches' insides, nested blocks folded. Test for CASE opened step by step; 942 pass. Version 0.9.25 at the user's word.

Folding back on a double-click, at the user's question. codeView marks the line that opened a block (its keys: the block's row and the negated one of its first stretch) or a branch (its row) with `closes`; the page's dblclick on that line's text drops those keys from `expanded` and asks for the routine again. A single click on the number still opens the line in the editor. Seen on the way: a CATCH holding only a comment showed "(0 operations hidden)"; a fold of no operations is no longer made, the comment shows. Checked with a real double-click in the browser on BUILD_PARTS_LIST's opened TRY (expanded emptied, the routine asked again at depth 1); test; 943 pass.

Renamed at the user's word: "Logic diagram" is "Logic view", now that it opens on the code. Changed in the shared action labels (object-tools, also its tracked assistant copy), the page's option, hint and help, Tools' Logic toggle title, Visual Debug's embedded frame title (both copies), the context-menu command, tools-context's action list, code comments and a test name, and in README, vscode/README, docs/index.html and eclipse/README; the option's hint and the README sentence now say it is the method's code or its flowchart. Release notes, development history, the presentation plan and the ACE port audit keep the old name: they tell what was. 943 pass.

The page's **?** help (diagramhelpdialog) still described the diagram alone and said "the focused view drives scrolling", untrue since the code alone moves the view. Rewritten: Code and Diagram, Depth with step-by-step opening and folding back on a double-click, line numbers and node clicks (Alt+Left kept), Logic only, the code leading the view and a fold marked for a cursor inside it, Reachability; the Calls and zoom paragraphs as they were. The user's screenshot still showed "Logic diagram" in the picker: the 21:32 build with the rename was not installed then.

"Find transport requests" showed nothing after Find - the Versions page stayed on "Type an object name and press Load." The host answered, but tools-window's bridge passed the answer on to `document.getElementById("result").contentWindow`: the result frames have long been kept by tools.html in its variable `result`, with no element of that id, so the handler threw and the list was dropped. It takes the visible frame from `result` now. On the way the first fix's comment used backticks inside the bridge, which is a template literal - tools-window.js did not load; caught by loading the module, rewritten. Checked in the real Tools window with a stand-in host: Find posts requestSearch, and a list in the host's shape (versions-front requestsOf) renders as "1 request of DEV". Left as it is: the page takes the first answer after loading as its "what does this system have" answer; should the host ever answer the search first, the list would be taken for that. Not seen live.

The review of ALCK900593 stopped at "reading what ALCK900593 holds ..." and then showed "Class/Interface ZCL_CODE_AI_RUNNER does not exist" - the class is in the request's E071 but gone from the system (no TADIR entry on A4H). review-live's partsOfRequest read every object's parts before the first progress step, and one missing object ended the whole review; that is also why no "n of m" progress ever showed. Now a part read that fails is checked against TADIR (a function module against TFDIR), not against SAP's message: an object that exists still stops the review, one that does not is listed and the review goes on. The list rides beside the payload as a non-enumerable MISSING, so a saved review keeps AVE's format; review-front answers it as `missing`, and the Versions page shows it under "Not in the system". Two tests (gone object listed, existing object failing still stops); 945 pass. Not seen against A4H in VS Code.

Next, ALCK900744: "Request version for DTEL is not supported" - SAP's answer to the revision feed of a data element on that release, not a VERTEX message. The user: a review must not fail. So no one part ends it any more: in the loop, reading a part's place, its feed, its versions and the diff is one step whose failure lists the part with SAP's own words and goes on; in partsOfRequest, an object whose parts cannot be read is listed too - "deleted since" when TADIR/TFDIR has no entry, else the error - where before an existing one stopped the review. The page's section is now "Not reviewed", with Type, Object and Why. Tests: a gone class, an unreadable existing one, a DTEL whose feed SAP refuses; 946 pass. Not seen against A4H in VS Code.

## 2026-10-22 — VS Code 0.9.24: Logic depth

The user asked for a nesting level in Logic, 3 by default as in Calls, so a complex method is not drawn in full depth at once; the version is 0.9.24 at their word. ace-scheme's `scheme` takes `maxDepth`: a block whose level (its row depth, counted from 1 inside the routine) exceeds it is turned, before drawing, into its opening statement, one node for its inside and its closing statement - all three plain operations marked as logic so *Logic only* keeps them -, the inner rows marked hidden (`X`) so every row index the drawing uses stays where it was. First the block was one node "IF d = 1 … ENDIF."; the user wanted the closing statement always shown and the inside hidden ("like 50 operations hidden"), so the inside node reads "(N operations hidden)", is a `foldnode` and opens through the existing `aceexp_` mechanism keyed by the opening's row. frontend-analysis passes the request's `depth` (3 when none) to both drawings. metrics.html shows the Calls Depth field in Logic (`body.logic #depthbox`, without Calls' Classes/Methods), keeps a separate `logicDepth`, and sends it with the scheme request. Checked: test in ace-scheme.test.js (folded, opened, depth 0 draws all), 937 pass; in the browser on AVE's ON_TOOLBAR_CLICK the field shows 3, three blocks fold (313 instead of 381 nodes), and a click on a fold node asks for its expansion at the same depth. Not seen in VS Code itself.

The user then set what Depth counts: first "1 is METHOD...ENDMETHOD, 2 an IF without its body, 3 its body", then, while that was being written, "or let 1 be the first level inside" - taken, as a method with its whole body folded says nothing. Depth is now the number of levels inside the routine that are shown: a block folds when its own level (1 = a statement right in the routine) is at least Depth, so 1 shows the routine's statements with every block's inside folded. The fold choice moved into one function, `folds`, used by both the diagram and the Code view; the earlier tests keep their cases at Depth 4 (the old 3) and a test pins 1 and 2. Default stays 3.

Then a Code | Diagram toggle for Logic, Code by default, folded to Depth automatically. ace-scheme `codeView` lists the routine's source lines verbatim (comments included) and, for each block deeper than Depth (not inside another folded one), one fold item for the lines between its opening statement's last line and its closing statement, keyed by the opening's row - the same key the diagram's fold uses, so `expanded` is shared by both views. frontend-analysis returns it as `code`. metrics.html: a `vertex-segment-toggle` (Code/Diagram, AGENTS' shared style) beside Logic only; `draw()` hands over to `drawCode()` in Code view, which renders rows with theme variables (editor font, line-number and link colours, line highlight), opens a line on its number and a fold on its text; sdeCodeCursor marks and scrolls to the cursor's line there; the drawing-only controls (direction, Logic only, Reachability, zoom, Fit, lens) are hidden in Code view. The first wiring used document.querySelectorAll at load and sat above the page's wiring section, so the tests that load only the functions failed; it moved to the wiring section as one delegated listener. Also from the user's screenshot: the path panel listed `IF sy-subrc <> 0. RETURN. ENDIF.` twice - a closing statement on a line already shown is now left out. Checked: tests for codeView and the panel; 938 pass; in the browser on ZCL_AVE_POPUP=>HANDLE_PARTS_DBLCLICK (248 rows, 4 folds) in a dark and a light variable set, the cursor line marked, a fold click asking for its expansion at depth 3, a number click opening its line, and Code -> Diagram -> Code. Not seen in VS Code itself.

Syntax colours in the Code view, at the user's word after the choice was laid out: the editor's colours come from another extension's TextMate grammar, which a webview cannot use, and VS Code gives a webview no token colours. So the colouring is abaplint's reading, in theme colours that exist as variables: value-origin-linter's parse adds `lexColors` - a grammar token (TokenNode that is no TokenNodeRegex) is a keyword, a matched token a literal (string, number) or a name (a method when its parenthesis follows at once, a class before =>), a Comment statement a comment. TokenNodeRegex being a subclass of TokenNode first made every name a keyword; the test caught it. codeView splits each line into pieces that join back to the line exactly. Colours: keywords debugTokenExpression-boolean (symbolIcon-keywordForeground is the plain text colour in the default themes), strings/numbers debugTokenExpression-string/-number, comments descriptionForeground in italics, methods and classes their symbolIcon colours. Checked in the browser with Dark+ and Light+ values on HANDLE_PARTS_DBLCLICK; test added, 939 pass. Eclipse's bundle was not rebuilt, so there the Code view stays plain.

The user: line numbers in the Code view did not open anything, and do comments keep to the depth? A real mouse click in the browser did call the opener, so the page was not at fault: tools.html gives a frame `sdeOpenToolSource` only in a Tools window bound to an editor, and the number's handler did nothing without it - while showing a pointer. A line number has nothing to unfold in place, as a UML method has not, so it now uses the page's `umlSourceOpener` (sdeOpenToolSource, else sdeOpenUmlSource, which every window has); with neither, the number is no link and shows none. The class was first called `link`, which the page already styles as an underlined link; it is `opens`. Comments did not keep to the depth: a fold ran to the last statement inside the block, so a comment before ENDTRY stayed in sight; it now runs to the line before the closing statement (test). Checked in the browser with a real click and only sdeOpenUmlSource present; 940 pass. The diagram's nodes still open the source only in a bound window, as before.

Next look: the Code view did not follow the editor as the diagram does, and its numbers still did not open lines. The editor's cursor was at 1227, inside the TRY folded at Depth 1, a line the Code view does not show, so nothing was marked; the diagram marks the nearest node. A fold row now carries its hidden range (codeView's `to`) and is marked and scrolled to when the cursor is inside it. The numbers: a real click after a Diagram -> Code round trip still called the opener in the browser, the lens only listens on the SVG it is installed on, and the installed extension is the 19:30 build - most likely the Tools window was opened before that build, and a page is read when its window opens. Not established; the user is asked to reopen the Tools window.

Found by the user's own observation that the path panel opens lines where the Code view does not: the editor holds a source of SAP's ADT extension (`abap:/repotree-v1/...`, breadcrumb "2100d1052d94124d > CLAS"), which the user always works with. tools-context, finding no VERTEX object for such a document, takes the object from its text and opens a bound Tools window; but tools-window maps an editor to an object only through VERTEX's tabs (documentObject) - so no cursor of that editor ever reached the page - and openToolSource looks for VERTEX's tab of the object, finds none and opens VERTEX's own copy elsewhere. The path panel works because it keeps the very document it came from. Now tools-context passes the editor's `sourceUri`; tools-window counts that editor as the window's object for the cursor and scroll events (`objectOf`), and a line of the window's object asked without a method opens in that editor when it is no VERTEX tab. The earlier guesses on the way - the window opened before the new build, the console checks - were not the cause. Test for the passed URI; 941 pass. Not seen in VS Code itself.

"Still not working - but the links appeared." A run of tools-window's message handler on a stubbed VS Code, opened as from an `abap:` editor with its `sourceUri`, opened that document in column 1 and put the cursor on the asked line - the host code is right. The links come from the page, read anew whenever a window opens; the extension host keeps running the code it started with until the VS Code window is reloaded after a vsix is installed, which is the likely reason; the user is asked to reload. Also at the user's word: Logic's Depth defaults to 1 (page and host).

The VERTEX log stayed empty on a click: nothing reached the host. Logging was added for that and taken out again. Reproduced at last by loading the real Tools window - tools-window's HTML with the bridge, a stand-in acquireVsCodeApi recording what is posted - drawing the Code view in its frame and clicking with the mouse: nothing was posted, while a scripted click() and a direct call were. A record of the frame showed the diagram pane rebuilt over twenty times in two seconds; a mouse press and its release met different elements, so no click was dispatched. drawCode ends in endAnalysis, which removes a body class that is not there - classList.remove still rewrites the attribute -, the page's own theme MutationObserver took that for a theme change and redrew, and so on without end. themeChanged now redraws only when the theme's colours really changed (`themeSeen`, recorded at every draw). Checked in the same real-window setup: one draw in two seconds, and a mouse click on 1414 posts openToolSource with line 1414. The earlier steps - the `abap:` editor binding, the window opened before the build - were real gaps or guesses but not this cause; the binding stays, as an ADT-extension editor does need it for the cursor and for where a line opens. The diagram does not loop (old page, 8 s, one draw), so this is not why a large diagram was slow.

## 2026-10-22 — VS Code 0.9.23: path to a line

New `vscode/reach-path.js`, command `vertex.reachPath` (editor context menu for ABAP, hidden from the palette). Scope chosen by the user: only inside the line's METHOD or FORM; conditions shown as written, no negation rewriting; a separate panel rather than a CodeLens. (An earlier proposal called the CodeLens option "Lens", which in VERTEX means the diagram magnifier - corrected in the discussion.)

Structure comes from abaplint statement kinds (`parserKind` from value-origin-linter's parse of the editor text, unsaved edits included), not from text patterns. One pass from the routine's start to the cursor's statement keeps a stack of open blocks; each branch records its CHECKs, the inner branches that leave, and an unconditional exit. On close, a branch that leaves becomes "must not be taken" in its parent, a branch with conditional exits becomes "if taken:" with them nested; when every branch of a covering IF/CASE leaves, the parent branch itself leaves. CHECK/CONTINUE/EXIT inside a loop are scoped to that loop and dropped when it closes. The open stack then gives the path: earlier branches false, the taken branch true (ELSE/WHEN OTHERS unlabelled), loops entered, CATCH as raised and caught.

First test run missed the innermost IF: the cursor was in the indentation of a line, and the statement chosen by offset was the previous multi-line IF. The statement starting on the cursor's line now wins. FUNCTION and MODULE are not handled (not asked); a line outside METHOD/FORM fails with a message. Not followed: callers, dynamic calls, values changed between a check and the line. Parser warnings (macros, unknown statements) are shown as a warning that the path may miss conditions.

The user's first look (a METHOD with IF/ELSEIF/ELSE and two nested LOOPs) asked for the hierarchy as indentation and for the closing statements. Rows now carry a depth as in the code - WHEN one level inside its CASE - the line itself is shown in place, and the ENDIF/ENDLOOP/ENDCASE of the blocks still open are found after it. A closed block that conditions the line comes as one group: its opening line when a later branch is the one shown, the branches, and its closing statement. Grouping exposed a duplicate: a closed LOOP with inner gates was pushed twice (through the branch loop and through the LOOP rule); branches are now walked only for IF, CASE and TRY. A group whose only remaining rows are structural (after a loop's pass-scoped gates are dropped) is dropped too.

Reachability in Logic (the user's option A of two: highlight in Logic, not a separate path-only diagram). frontend-analysis.js returns `reach` with the Logic data for a METHOD or FORM: `reachLines` runs the path for every drawn line and gives the source lines it touches. metrics.html has a `Reachability` vertex-toggle beside Logic only, shown only when `reach` came; with it on, a node click (it still opens the source) sets the line, and `showReach` marks nodes and loop clusters by `data-source-line` - path nodes get the theme focus border, the rest and all edges opacity .25 - and is reapplied after each redraw. ENDIF join nodes and the start/end nodes carry no source line in nodeLines, so they stay quiet even on a path. Eclipse's vertex-frontend.js bundle was not rebuilt, so there the toggle stays hidden. Checked in the built-in browser on a real ace-scheme diagram of the test FORM: path nodes lit, others .25, focus colour taken in both a light and a dark variable set; not checked in VS Code itself.

In VS Code the panel still showed no indentation: the webview's CSP allows styles by nonce only, so the inline `style="margin-left"` on each row was dropped silently. Depth is now a class (`d0`..`d40`) defined in the nonce'd stylesheet. The same look showed an ENDTRY with no TRY above it: a line in a TRY body had its TRY frame closed but never opened in the list; the TRY line is now shown.

The user declined a virtual ABAP document for the path (it would lose the source line numbers) and found the panel's colours poor. Code is now shown without the webview's chip background, as in the editor; the verdict is a small outlined tag in the theme's test pass/fail colours (`testing.iconPassed` / `testing.iconFailed`); the line itself has the editor's line-highlight background.

Next look: the panel's indentation did not match the editor's, and a long COND statement became one flattened line (abaplint's concatTokens) both in the list and in the header, which repeated the whole statement. Rows now show the statement's source lines verbatim (`line`..`endLine` from the document text, in a `<pre>` in the editor font), so indentation and line breaks are the source's own and the computed depth is no longer used for layout; the header says only "Path to line N in METHOD ...". A Python heredoc turned `'
'` and the split regex into real line breaks on the first try; caught by the test run.

Block folding (`vscode/abap-folding.js`): a FoldingRangeProvider for `abap` built from abaplint statement kinds. A block folds from its opening statement's last line to the line before its closer; a branch (ELSEIF, ELSE, WHEN, CATCH, CLEANUP) to the line before the next branch or the closer; the first segment of an IF is not a separate range, as VS Code keeps one range per start line. Blocks left open by a statement abaplint did not understand are dropped, not folded to a guessed end. Ranges are cached per document version. Wrong turn: after it was written the user found that the editor already folds, and it was removed; the user then explained that the existing folding goes by indentation and fails on unformatted code, and it was restored. extension.test.js's vscode stub gained `registerFoldingRangeProvider`. Checked by two tests (ranges of a sample; the same ranges with all indentation stripped); not checked in VS Code itself, including how it merges with folding another ABAP extension may provide.

Block jumps (double-click, F12, Ctrl+click from LOOP to ENDLOOP and back) failed on the outer LOOP of a method in AVE's ZCL_AVE_POPUP while folding there was right. code-workbench.js's structuralTarget matched keywords at line starts with a regex; line 3702, `class = ls_meta_hunk-class_name )`, a call parameter, opened a CLASS frame, and every closer after it found the wrong frame on top. structuralTarget is now async and reads abap-folding's `blockJumps` over abaplint statements; the parse is shared with folding through `abap-statements.js` (per document version and text), so a jump after folding waits for nothing. structuralAnchor still gates which word under the cursor is a keyword, on that one line only. The double-click test waited a fixed 20 ms and now waits for the jump. Checked on the AVE source: ENDLOOP 3775 -> LOOP 3658, ENDLOOP 3774 -> LOOP 3765; a regression test with a CLASS parameter line; 928 tests pass. Slip on the way: Python's text mode on Windows and heredoc escapes wrote CRLF and literal line breaks into code-workbench.js; the file was restored from HEAD and the change redone with exact edits.

Logic diagram navigation and lead, from the user's look at a method: CONTINUE and ENDIF nodes did not open the source. Navigation goes through Mermaid `click` directives, and ace-scheme gave them only to conditions, blocks, exits and folds; now every `p` and `j` node gets an `acego_` click at the end, unless it already has one (an exit, an opened operation's `aceexp_`). A fold of one operation became the operation itself ("1 operation" took a box anyway). Scrolling "stuck": a click in the diagram opened the line, the editor scrolled, and its visible-range event carried userFocus (the editor was active) and handed the lead back to the code, which scrolled the diagram; the diagram's own scroll in turn moved the editor. As the user set it: a mouse click decides the lead (diagram pointerdown; editor selection of kind Mouse), scroll events never take it, scrolling the diagram no longer moves the source (that listener removed with its timer state), and the source scrolling into another method still opens that method's diagram even while the diagram leads. The wheel no longer takes the lead. 928 tests pass; not checked in VS Code itself; Eclipse's host sends its own cursor events and was not changed.

The user, on the installed build: operations still not clickable, and after working in the code then turning to the diagram, scrolling pulled it back. The real metrics.html, loaded in the browser with a stub host on the user's method (ZCL_AVE_POPUP=>BELONGS_TO_CLASS), opened the line for every node but the ENDIFs - in VS Code, navigation goes by `data-source-line` from nodeLines, not by the Mermaid clicks, and `j` nodes were missing from nodeLines; they are in it now. The pull-back: opening a line from the diagram changes the active editor, and tools-window posted `codeFocus`, whose handler (`sdeCodeFocus`) handed the lead back to the code - the 700 ms guard after a diagram click is shorter than opening a SAP source can take. By the user's rule only a mouse click changes the lead, so the `codeFocus` chain (tools-window listener and relay, tools.html relay, metrics.html handler) is removed. Why operations seemed unclickable in VS Code itself is not established: in the page they open; the pull-back may have hidden it. 928 tests pass.

Still wrong for the user: "if I scroll, I have grabbed the window". The lead rule is now the window the reader works in: a click or wheel in the diagram takes it for the diagram (diagram scrolling stays there); a click, a key or a scroll in the editor gives it to the code - editor scroll events count as the reader's even when the webview has focus (VS Code then reports no active text editor). The editor's own moves after a line is opened from the diagram are kept out by the host's quiet time, which now also starts again when the open has finished, as a SAP source can take longer than its 700 ms. Earlier in this landing a click-only rule and the removal of the wheel were tried at the user's word and turned out not to be what was meant. 928 tests pass; not checked in VS Code itself.

Still pulling back after the first click in the diagram. Two more causes were found and the lead model was given up at the user's word ("clicked - positioned"; then "code scrolling may move the diagram, not the other way - only a click"): VS Code repeats selection and visible-range events with nothing moved (on focus changes among others), and every redraw replayed the stored code cursor through sdeCodeCursor with its old userFocus, scrolling the diagram back. Now there is no lead state (`followCode`, its pointerdown/wheel listeners and `userFocus` removed): the editor's real moves - tools-window passes on a selection or visible range only when it differs from the last one, also remembering it during the quiet time after a diagram click - position the diagram; a redraw marks the cursor's node again without scrolling (`replay`), except right after a method opened for the code (`positionAfterDraw`); scrolling the diagram touches nothing. 928 tests pass; not checked in VS Code itself.

A program's Calls diagram (START-OF-SELECTION) showed ?[]->FIELD-SYMBOL, ?[]->S370, ?[]->I025, ?[]->GT_NAME, ?[]->GT_NSL_TVARVC1 as unresolved calls. The program sits on a system the MCP servers here cannot reach, so the shared scanner (value-origin-model `callsIn`) was tried on the suspected forms: `x(4)`, `x-f(1)`, `t[ 1 ]-f(2)` (offset/length) and `FIELD-SYMBOL(<fs>)` (inline declaration) were all read as calls - a word followed by `(`. ABAP's functional call has a blank after the parenthesis; `callOpen` now requires one, for plain, static, instance and NEW calls. FORM F_GET_HOUSING_WTS: the user says it is an external form, and asked whether it can be read. call-graph.js already took the owner from `PERFORM f IN PROGRAM prog` and the walk loads that program; the short form `PERFORM f(prog)` gave no owner, so the form was looked for in the program itself. The short form - the parenthesis right at the name - now names the program too (test added). Which form the user's program uses is not known here; if it is IN PROGRAM, the unresolved arrow has another cause still to find. As the user's program is on another system, the case went to the debugger_tests repository as `Z_CALLS_TEST` and the subroutine pool `Z_CALLS_TEST_FORMS` (abapGit XML written with a BOM), checked clean by abaplint's check_syntax (a planted error proved the check runs), and walked with call-graph.js: it also showed `lines( )` as an unresolved method call LINES - drawn as ?[]->LINES. call-graph now drops an unqualified call with no target whose name abaplint's BuiltIn knows; a routine's own method of that name still resolves (test). The walk of Z_CALLS_TEST then gives exactly LOCAL_FORM, SHORT_FORM and LONG_FORM in Z_CALLS_TEST_FORMS (both resolved), CONVERT_DATE_TO_INTERNAL and LCL_HELPER->RUN. Checked by regression tests and the full suite (931); the fix also changes Logic's call marking and Forward/Backward usage, which share callsIn. Eclipse's bundle (vertex-frontend.js) was not rebuilt.

Two include bugs from the user's program. (1) Object Navigator: "No CLASS LCL_RESI_DEDUC IMPLEMENTATION in ZHRR_EMP_RESIDENCY_PROOF." object-navigator's `position` took a component's line only from a link to the main source; a local class implemented in an include had none, and openToolSource then searched the program's own text. `position` now also returns the include a link points to (`.../includes/<name>/source/main`), opened as INCL at that line; and openToolSource, when the IMPLEMENTATION is not in the program, walks its INCLUDE statements (abaplint's `Include` kind), nested ones too, and opens the method in the include that has it. The shape of ADT's link for such a component was not seen live, hence both. (2) A breakpoint in an include's editor never reached SAP: breakpointTarget accepted PROG, CLAS and FUNC only and dropped INCL silently, though debugger.js already maps program include URLs; INCL is accepted now (test, with the code-workbench mock taught INCL URLs). For checking both on a reachable system, Z_INCL_TEST was created on A4H in Z_RIG through MCP (Z_INCL_TEST_TOP with LCL_APP's DEFINITION, Z_INCL_TEST_C01 with its IMPLEMENTATION, Z_INCL_TEST_F01 with a form), batch-activated, SAP syntax check clean, no inactive objects left (PROG/PX included), and committed to debugger_tests with BOM'd XML. 932 tests pass; neither fix was seen in VS Code against a live system.

On Z_INCL_TEST the Calls diagram showed LCL_APP->MAIN unresolved and stopped there, and VERTEX Tools in the context menu had no Object Navigator. frontend-analysis read a program's main source only - a class's parts were read, a program's INCLUDEs never; they are now read after it (abaplint's `Include` statements, nested ones too, each once; ADT include URL, or the local file in a folder), parsed as parts of the program, and an include that cannot be read is a warning. The user confirmed: includes are part of the program in SAP's own tokenizing. The walk then missed `add( sy-index )`: callOf rejects an unqualified name that is an ABAP keyword; a parenthesis right at the name with a blank inside is a call, keyword or not (`CHECK ( x )` has the blank before). Checked by running the Calls request over the local copy of Z_INCL_TEST: START-OF-SELECTION -> LCL_APP->MAIN -> IS_EVEN, ADD, FORM SHOW_TOTAL. `vertex.tools.navigator` added to the VERTEX Tools submenu (SAP sources only, as Diff; hidden from the palette); object-tools gets the action from tools-window, first for SAP sources only. The packaged build then failed to load tools-context.js: a shell-escaped `'` in its local-file message became a bare quote (SyntaxError), which also hung extension.test.js - the vsix of 17:37 was broken and was rebuilt after the fix. The user then asked for local files too ("we have Parts"): object-navigator `localTree` builds the tree from abaplint's parse of the program and its includes (each a file of its own, found by local-analysis `find`) - Includes, Events, Local Classes (DEFINITION line; methods from the IMPLEMENTATION, wherever it is) and Subroutines, each opening in its own file at its line; local-analysis gives its single-object api an `objectNavigator` for PROG, and the Parts request (`parts=X`) keeps its old answer there. The menu entry shows for `file` sources too. Test added; 933 pass. Not opened in VS Code.

With includes read, the user found their routines did not open from Calls ("the blocks used to be clickable") and asked about Metrics. A part read from an include kept the program as its objectName, so every place said "program, line N" with N counted in the include. The parse result now carries `programInclude`; Calls' places, Logic's answer (`writtenIn`, used for node clicks and to follow that include's editor) and each Metrics row (`writtenIn`, used by the unit link, which had also opened a local class's method as an object named after the class) name the include - INCL from SAP, PROG for a local file - and its line. The page's method switch by cursor line now matches the unit's file too (`fileOf`), as an include's lines meet the program's. Metrics also showed START-OF-SELECTION for Z_INCL_TEST_TOP: a source with no events or routines got an implicit event for its top-level statements even when all were declarations (a class DEFINITION, DATA); now only when one of them runs. test/program-includes.test.js covers Calls, places and Metrics; 935 pass.

Double-click on `lcl_app=>main( )` in Z_INCL_TEST: "CLAS LCL_APP was not found". ownDeclaration finds a local class's METHOD, a class or a form only in the source in front, and a program keeps them in includes, so the call went on to SAP as a global class. `includedDeclaration` runs ownDeclaration over the program's INCLUDEs (abaplint's parse via abap-statements, nested, each once), with the word and call taken from the editor in front (ownDeclaration got a third argument, FROM). Test with an include in the code-workbench mock; 936 pass.

Object Navigator on an include: "unavailable for Include" - the action list left INCL out, as ADT's node structure answers nothing for an include. sap-code's objectNavigator now looks up the including program in D010INC (MASTER by INCLUDE) and shows that program's tree; more than one program is an error naming them, none picked. Checked on A4H: D010INC gives Z_INCL_TEST for Z_INCL_TEST_C01. Not opened in VS Code. Enabling the action for INCL with the navigator's `first` flag would also have made it an include's default instead of Diff, which nobody asked for: object-tools' `enable` now takes the list of types the action leads, and INCL keeps Diff. The test that pinned "an include does not have it" now pins the new rule.

Checked: 6 new tests in `test/reach-path.test.js`; the full suite passes 924 tests; the page HTML was generated in Node. Built `vscode/vertex-abap-0.9.23.vsix` (contains reach-path.js). Not checked: the panel inside VS Code, light and dark themes by eye (the page uses only VS Code theme variables), Eclipse (not built).

## 2026-10-22 — individual tool calls collapsed in AI logs

Retain each call ID in the parsed report and pair results by that ID. The Tools section lists independent native disclosures headed by tool name, initially closed; arguments, results and links are inside the corresponding call. Calls retain invocation order, and orphan results remain visible separately. Keep the package version at 0.9.22 as requested.

## 2026-10-22 — VS Code 0.9.22 package

Built the universal `vscode/vertex-abap-0.9.22.vsix`. The archive verifier checks all entries and both Windows x64/macOS Apple silicon bindings. Packaged logger, replay handlers, snapshot viewer, AI/SAP sidebar actions and execution-manager page match the current sources; the source-logging setting is absent.

The focused suite passed 122 tests. The final storage changes passed 77 related tests, and snapshot-script and packaged Scheme checks passed. Headless-browser checks covered recorded UML, metrics, log disclosure sections, AI/SAP buttons, filtering, selection and deletion messages in light and dark themes. SAP recording lifecycle was tested with a fake SAP connection; no live SAP session or Eclipse package was checked. The user accepted 0.9.22 and instructed that future version changes wait for their publication notice.

## 2026-10-22 — assistant evidence links and context snapshots

Preserve run/session IDs in source-free tool summaries and associate tool results with their original calls. Report links dispatch only the existing offline replay commands. SAP assistant runs use a separate stop recorder, enabled with assistant tool logging, so no Visual Debug webview is needed to save observed frames, values and available source snapshots. Manual run controls do not start assistant recordings.

Source-free logging removes the legacy code flag, sanitizes nested request JSON and tool arguments, and retains current-object references. The Eclipse logger copy and preference fields follow the same source omission policy. Request-context logging retains UML and metrics snapshots; the report renders those saved structures separately from current-source links.

Conversation selection uses native checkboxes; clearing resolves IDs against the configured log folder and confirms deletion. Shared logger instances are discarded for cleared files so pending responses cannot recreate deleted logs. Execution recording files are untouched by conversation clearing. The matching AI and SAP sidebar log buttons open distinct managers. The execution manager combines SAP recordings and memory/persisted transpiler runs, uses kind-and-ID keys for opening and selected deletion, and rejects unknown selections. Transpiler deletion is scoped to validated recording folders and preserves original ABAP documents. Deleting a live assistant SAP recording discards its recorder so later stops cannot recreate it. The extension defaults assistant transpiler storage to its own recording folder, preserving log links across restarts without an extra setting.

## 2026-10-22 — VS Code 0.9.21 package

Built the universal `vscode/vertex-abap-0.9.21.vsix` with the standard packaging wrapper and dependencies from the lock file. npm and vsce were installed in a temporary tools directory because they were absent from PATH. Archive policy, entry integrity, version and packaged Scheme checks pass. The report HTML, settings handler and SAP-system prompts match the current sources inside the archive; Windows x64 and macOS Apple silicon RFC bindings are present. All 11 focused log-report and system-setup tests pass. The log UI has not been checked visually in a live VS Code window. No Eclipse package was built.

## 2026-10-22 — collapsed assistant log sections

Replace the prompt-row expansion with native, keyboard-accessible disclosure sections for User, Model answer, Tools, instructions and request context. Each starts collapsed. User and model content use normal text typography; technical payloads retain monospace formatting. Three accents use VS Code theme colours for user, model and technical content. The shared HTML source and its generated VS Code copy stay aligned. The two log-report tests pass. This report is a VS Code feature; no Eclipse host is built.

## 2026-10-22 — VS Code 0.9.21: assistant log report placement

The installed 0.9.18 report opened in the active editor column and could be hard to locate from the sidebar. Keep the session-log report in the column beside the active editor, including when reopening it. Its settings action used a search filter for only `vertex.ai.log.request`, which hid the question, answer and tool logging options. Open the full `vertex.ai.log` setting group instead. When SAP Logon or an ADT workspace has no client or user, label both import prompts with explicit “Enter the SAP …” instructions; the empty client remains valid for the system default. Package as VS Code 0.9.21; the existing VS Code guide already describes the report placement and logging controls. No Eclipse build is part of this change.
## 2026-10-21 — Logic: an opened operations block stays open

Checked whether folding in Tools Logic had regressed. A block such as `5 operations` still opens on click. Since the 0.9.19 source-line handler, a click on one of the opened operations goes to its source, where the comments in `metrics.html` and `ace-scheme.js` still promised that it folds the block again. The owner chose the current behaviour, open and then go to the code, so only the two comments changed. The three failing `ace-scheme` tests are unrelated: they draw the full scheme, which never folds, and have failed since they were added in 0.8.1.

## 2026-10-21 — tests follow recorded design decisions

Four failing tests still expected what earlier landings had deliberately changed, each change recorded in this history: Run in SAP's pale blue fill (0.8.1, the test still asked for green), the depth slider running from 1 to the maximum (the test asked for `min="0"`), and the builder's node keys `m|routine` and step keys `OWNER=>ROUTINE|include:line`. The expectations now name the current form. Two of them pass; the record-diagram test and the formula depth test then fail further on, on what is drawn rather than how it is named. Those, the three `ace-scheme` tests (a loop and plain operations are no longer folded by default; an empty method draws its ENDMETHOD and an edge), the FLOW demo and the two Visual Debug block tests are behaviour differences without a recorded decision and are left for the owner. Product code is not touched; the suite stands at 897 of 908.

## 2026-10-21 — page test harnesses catch up with their pages

Twenty-two tests cut functions out of `table.html` and `visual-debug.html` and ran them against a stub page, and the pages had outgrown the stubs. SelecTor's script now wires its field-label toggle with `document.querySelectorAll` at load, so the stub document gets one returning nothing (15 tests). The local-history tests looked for a section by an LF boundary in a CRLF file, and `replay` now publishes `window.sdeReplayStep` (2). In Visual Debug the step and slice graphs call `poolName`, `recordedUnitKey` and `callerFrames`, and two functions read `INITIAL` and `focusedRoutine`; the tests now load the page's real helpers instead of stubbing them, so the code under test is unchanged. Product code is not touched. Two of these Visual Debug tests then failed on their assertions instead of a missing name — node keys now carry an `m|` prefix — and join the group of outdated expectations. The suite stands at 895 of 908.

## 2026-10-21 — VS Code 0.9.21: lens tests follow the scale rule

Three `vertex-lens` tests had failed since the 0.8.1 refactor added a scale check to `vertex-lens.js`: the lens is hidden on a diagram already drawn at 70% of its natural size or more, and its magnification never goes past that point. The check is intended; the tests still assumed a lens over any diagram with a fixed 1.5×–6× range. A first attempt removed the check from the code and was reverted. The tests now draw their SVG with a viewBox at a known scale, and a new test covers the hidden lens at 70%. All seven lens tests pass. The remaining failing tests (stale page harnesses, outdated markup expectations, `auth-manifest`, `code-workbench`, `value-origin`) are not touched in this landing.

## 2026-10-21 — merging work from two machines

Work done on another machine (0.9.20: SNC/password switch, chat-led analysis docs, session log placement) and local 0.9.18–0.9.19 work diverged from the same base. Rebased the local work onto 0.9.20; code merged without conflicts, only versions and docs collided. Kept 0.9.20, kept both sides of both histories, and merged the Visual Debug save paragraph: the local rename to **Save session** with first-step IDs, plus the remote rename/delete description. The empty-state hint in SAP Debug Session Logs still said "Save log" and now matches the button.

## 2026-10-21 — sidebar SNC/password switch

Add an inline SNC checkbox beside the VS Code sidebar's SAP-system selector. It updates only the selected entry's `authType`, preserves SNC/RFC settings when switched to password, and validates required SNC data before switching back. SAP Logon import retains SNC details for password-mode direct entries when available. Add focused tests for toggle behavior and validation. VS Code only; no host version or package is claimed.

## 2026-10-21 — assistant log report opens beside the editor

The VERTEX sidebar's assistant session-log action opened its report in the active editor column, which made the new panel easy to miss in the Mac presentation workflow. Open and reveal the report in a dedicated adjacent column instead. Add a regression assertion for the initial placement and repeat-open behavior; the log parser and command registration tests pass. VS Code only; no Eclipse package is affected.

## 2026-10-21 — documentation for chat-led runs and saved debug sessions

The VS Code and repository guides now show how to begin with a package or program name, compare multiple transpiler selections in a single assistant request, inspect declared class variables for a reference parameter, and open, rename or delete saved SAP debug recordings. They also explain that an open saved recording supplies cited history to the assistant. The Eclipse guide is unchanged because these details concern VS Code.
## 2026-10-20 — transpiler citations from Visual Debug

Visual Debug runs now save their recorded trace in transpiler history, publish the run ID in the debug context and refresh context after a local run completes. The assistant instructions identify the correct run citation format, and the existing known-run list resolves its links.

## 2026-10-20 — remove ordinary node backgrounds

Mermaid uses editor widgets for ordinary node fills, which can create high-contrast label rectangles in some themes. Ordinary node fills are now transparent, and navigable labels use the editor foreground without browser link underlines; group and special-node colors remain themed.

Tools Logic diagram click handling now lets `foldnode` events reach the `aceexp` toggle rather than opening the folded block's first source line.

VS Code command contributions now set low-level debugger steps, local package analysis and Go to Method to `commandPalette: false`, leaving their keybindings or contextual entry points intact.

The chat assigns repeated matching labels to the next unused target choice, so an object and its package both remain clickable when their displayed names match.

## 2026-10-20 — stop creating empty editor splits

`open_sap_object` used `ViewColumn.Beside` unconditionally, creating a new editor group even when the source could open in the current one. It now targets the active editor's group, or the first group when no editor is active.

## 2026-10-20 — live SAP recording IDs

The Visual Debug page creates a session ID when its first SAP stop is recorded, publishes it with the chat context and writes it unchanged to a saved file. Live sessions join the known evidence list, and clicking a citation replays the step in the current Visual Debug panel. Opening a new panel clears stale debug context. The replay bar button is now **Save session**.

## 2026-10-20 — direct-search links

Single-result direct search now returns opening choices for the object and its package, and the sidebar links matching names in the whole answer instead of only list items. The package name is bold in the Markdown answer so it can become a link. Focused chat and sidebar tests pass (23 tests).

## 2026-10-20 — WebGUI run without a breakpoint

The SAP editor context menu now exposes **Run SAP in web GUI** for programs, classes and function modules. It reuses the debugger's WebGUI transaction URL construction but opens the URL directly, so a breakpoint and listener are unnecessary. The debugger's existing Run in SAP behavior remains tied to a breakpoint.

## 2026-10-20 — sidebar model diagnostics

Model-loading failures now populate an accessible status message below the sidebar selector; a successful response clears it. The focused sidebar, assistant and chat tests pass (37 tests). The universal 0.9.18 VSIX is repackaged with the updated sidebar and README, retaining the previously packaged dependencies.

## 2026-10-20 — explicit empty state for provider models

When a provider returned an empty model array, **Config models** rendered the header and an empty table with no explanation. The panel now shows an explicit retry message; for Claude it also explains that the catalog is bundled in VERTEX and does not test subscription sign-in. Added a focused UI-source regression assertion. VS Code only; no host package was built.

## 2026-10-20 — Debug Session Logs row actions

The Visual Debug header now names the saved-recording list **Debug Session Logs**, distinct from the on-screen **Log** pane. In the list, clicking a session row opens it; icon buttons invoke rename and delete, with accessible labels and keyboard row activation. The rename prompt and delete confirmation remain host-side. The extension panel title and VS Code-facing feature descriptions use the same name. The Eclipse update site was not rebuilt.

The first step a SAP recording creates at Continue used to lack its Variables snapshot: the page added the stop to the timeline, then stepped before asking for values. It now reads the scopes at that initial stop and stores the Globals on the step, regardless of the full Steps & values mode. Selection parameters are available under Globals when the user replays the first step. The transpiler run path is unchanged.

The first step a SAP recording creates at Continue used to lack its Variables snapshot: the page added the stop to the timeline, then stepped before asking for values. It now reads the scopes at that initial stop and stores the Globals on the step, regardless of the full Steps & values mode. Selection parameters are available under Globals when the user replays the first step. The transpiler run path is unchanged.

## 2026-10-20 — stable IDs and citations for SAP debug sessions

Saved SAP debugger files now carry GUID `session_id`s; legacy recordings acquire one on first read. VS Code chat recognises `[session <id> step <n>]` citations and opens the saved offline replay at that step. Transpiler runs expose the same ID as `session_id` while retaining `run_id` for existing tool schemas and citations. The saved-session list supplies IDs for citation resolution. Focused history, renderer and transpiler tests pass. This change is VS Code-only; no Eclipse host build is claimed.

## Unreleased — Logic position and ALC function module

The shared Logic diagram reset its viewport on each graph redraw, including Visual Debug record updates. It now fits once and preserves scroll and zoom on later redraws. The function module selection screen puts simple input labels beside the fields. In the ALC snapshot of `FIMA_DAYS_BETWEEN_TWO_DATES_2`, an unrelated SLO2 FORM called missing `FILL_AN_ENTRY`; unreachable function-group FORMs are omitted while keeping source line numbers. The saved snapshot transpiled after this change. Further offline execution encountered dictionary objects absent from that old snapshot, so full execution still requires a fresh SAP read. Dictionary closure now collects bare LIKE and chained TABLES dependencies, and format 6 refreshes old snapshots when used. Generated default binding is applied to the defining group, duplicate importing/exporting names are bound once, and legacy `><` is normalized for the transpiler. Focused local tests cover these cases and the Logic viewport behavior.

The SAP run command now opens its program window without starting a dictionary read. Its first Execute starts the normal cached-build path; Recompile starts the fresh-read path. Previously compiled parameters are shown when the open Visual Debug source has them. After an Execute that needs to prepare a build, the new run window executes the already entered selection; without a prior selection it displays the newly compiled parameters for entry. The agent run path retains its direct behavior.

The saved ALC `ZCL_MOD_FUEL` class has a required `IO_LOG TYPE REF TO ZCL_CALC_LOG`, whose `MT_LOG` is an instance attribute. The selection screen now opens a read-only dialog of declared class variables from an icon in place of the reference text field. Its required reference is constructed by default. On generated SAP run copies, abstract and private/protected creation restrictions are relaxed before transpilation; mandatory constructor parameters receive `VALUE #( )` initial values. The original SAP source is untouched. An offline run of the ALC snapshot transpiled, reached the entry and proceeded to its SELECT; without a configured SAP system, the SELECT then stopped. A changed copy with abstract/private creation and a mandatory constructor argument likewise transpiled and reached the entry. Local tests cover reference shapes, generated calls and copy-only relaxation.

## 2026-10-19 — 0.9.18: direct search finds packages

`search_sap_objects` now queries ADT's `DEVC/K` type and maps it to `DEVC`. The direct chat route retries a bare name as prefix and contains patterns only after an empty exact search. Package choices use `open_sap_object` to open the package's Object Navigator in the correct system. Focused tests cover package metadata, ordered fallback and package opening.

## 2026-10-19 — 0.9.17: empty recording after a successful function call

The saved ALC `FIMA_END_OF_MONTH_DETERMINE` snapshot returned output in the non-live runner but no trace. `mappedPlaces` and `mappedLines` decoded only the first source-map segment on each generated line, leaving subsequent source and line deltas unapplied; later source positions became negative. Both decoders now consume every segment and retain the first mapped position for each line. A regression test uses two segments on one line, and the live offline run records ten steps and returns `E_DAYS_OF_MONTH=29` for `I_DATE=20160210`.

## 2026-10-19 — 0.9.16: FIMA_DAYS_BETWEEN_TWO_DATES

The saved ALC snapshot reproduced `Variable name "DEFAULT" already defined`: `moduleSignature` stopped at the hyphen in `LIKE VTBBEWE-JINTRADAY`, then treated the following DEFAULT as another parameter. It now consumes qualified type names and ADT pragmas. The old snapshot carried the incorrect parsed signature, so format 5 rereads that object on next use. The standalone call declares this module's generic `E_TAGE` as integer. The next local failures revealed unsupported `STATICS`, a standard module in FF05 omitted from FF04's call closure, and upper-case call binding keys that the generated callee read only in lower case. Statics now move to private, persistent group globals; reached standard modules in another group are included; generated callees accept either parameter spelling.

With ALC's `FIMA_INTEREST_METHOD_CONVERT` source supplied temporarily for the offline check, the saved snapshot transpiled and executed with `I_DATUM_VON=20260115`, `I_DATUM_BIS=20271002`: `E_TAGE=617`, `E_SEKUNDEN=0`. The temporary SAP source was removed from the repository after verification. Focused regression tests cover signatures, cross-group calls, statics and parameter binding case. No direct SAP execution comparison was available.

## 2026-10-19 — 0.9.15: ENDIF layout after an early return

The Logic only diagram placed the next IF under the surviving branch when the other branch returned. The scheme now keeps the exit node as a structural tail to the visible `ENDIF` and draws continuation from that join only when a live path remains. No invisible layout edges are used. Focused tests cover the early RETURN, nested IF and TRY/CATCH cases. The universal VSIX was packaged, verified and installed locally.

## 2026-10-19 — 0.9.15: FIMA function module snapshot and offline run

The ALC snapshot for `FIMA_DAYS_AND_MONTHS_AND_YEARS` exposed duplicate `GPDAYS`/`IDENT` fields because DD03L include/append markers were emitted beside flattened fields. `normalizeTableFields` now compares nesting depth (`ADMINFIELD`) and removes those markers. The collector saves `TYPE-POOLS` sources such as `TRFF`; the dictionary reader follows `LIKE TCURR-GDATU`, keeps `TYPES: BEGIN OF` scope across statements, and reads explicit table keys from DD42S. In `FIMA_END_OF_MONTH_DETERMINE`, the two `STATICS` fields are assigned before each read; its transpiler copy uses local `DATA` because the bundled transpiler throws at runtime for `STATICS`. The SAP source is unchanged.

Snapshot format 4 invalidates older saved dictionaries only when their object is used again. Failed builds require a fresh read, and Recompile forces one. The saved ALC snapshot passed offline transpilation and local execution with `I_DATE_FROM=20260115`, `I_DATE_TO=20271002`, returning `E_DAYS=625`, `E_MONTHS=21`, `E_YEARS=2`. Fixture additions for `TCURR`, `SKONDGRP` and `LVC_T_STYL` were checked against ALC; the new reader gets them on a fresh build. Focused tests passed (49/49). Direct SAP RFC comparison was blocked by the unavailable `ZADT_VSP` WebSocket endpoint. The universal VSIX was packaged, verified and installed locally.

## 2026-10-18 — ADT watchpoints and local variable interventions

The SAP debugger now calls ADT's watchpoint create/list/delete endpoints and reads reached watchpoint IDs from step responses. The local transpiler instruments requested executable source lines, applies a scalar replacement on the requested occurrence and records its observed before/after values in the trace. The run tool passes interventions through both launch paths and the history tool exposes them. Local integration and fake ADT protocol tests cover the behavior; live SAP watchpoints have not yet been exercised.
Visual Debug's Variables pane can add and remove watchpoints through the same commands in both modes. Local live Continue stops on matching changes; recorded Continue finds the next matching trace event. Component comparison checks that field's previous and current values. Watch Follow reuses the value origin points' `names` list to cover aliases across calculations and calls. Focused adapter, trace matching and fake ADT tests pass.
The 0.9.15 panel also accepts a When comparator. It sends a full ABAP condition to SAP's ADT watchpoint endpoint and evaluates the same numeric or quoted-text comparison on the new value in the transpiler trace. Focused tests cover a threshold and the condition across renamed Follow variables.

## 2026-10-18 — 0.9.15: selection texts for SAP transpiler runs

The SAP run path previously fetched text elements with `getObjectSource`, which requests ABAP source and cannot read the text elements media type. `sap-code` now exposes the ADT client's `getTextElements`; `code-workbench` converts its selection and symbol entries into the screen's text map. A focused repository test verifies the endpoint and category. The universal `vertex-abap-0.9.15.vsix` passed the packaging wrapper's archive and page checks. The SAP endpoint itself has not been exercised against a live system.

## 2026-10-18 — ADT workspace import on macOS

The 0.9.14 importer stopped before workspace selection when SAP Logon was absent. It now reads each ABAP project's `.destination.properties` from the Eclipse workspace and uses its system ID, server, instance, client and user. It scans macOS Eclipse app bundles for recent workspaces and offers common workspace folders. SAP Logon entries continue to work. The focused system setup tests pass (7/7). Built and verified the universal `vertex-abap-0.9.14.vsix`; its archive contains the new importer. macOS discovery has not been run on a Mac.

## 2026-10-18 — 0.9.14: missing scenarios are run

With a kept CLEAN run open in Visual Debug (opened from a chat link), the request "check all scenarios, describe the difference in logic" got no run at all: the agent took the Visual Debug context for the current debug session, said only CLEAN was recorded, and asked whether to run the rest. The chat context now adds `kept_run` (run_id, conversation number, a note that it covers only its selection) when Visual Debug shows a kept run, and the transpiler instructions tell the agent to run any scenario no run of the request covers, without asking.

## 2026-10-18 — 0.9.13: transpiler selection and evidence

A chat log showed the agent running five scenarios twice to no effect: lowercase keys (`{"sc":"p_prec"}`) and radio buttons set as `{"P_PREC":"X"}` were silently dropped, so every run executed the default CLEAN scenario. Added `normalizeSelection` in `transpiler-tool.js`, applied before the missing-input check: keys and radio choices are upper-cased; unknown keys, unknown choices and unknown `$parameters`/`$ranges` names throw with the screen's accepted shape. Setting a radio button by its own name was not made to work; it is refused with the group form, so there is a single way to choose.

The same log showed a conclusion ("the caller never checks SUBRC") that the agent had read in no history step: it stopped reading after the SELECT that returned no rows. The transpiler agent instructions now require a run_id, step, line and value for each claim, and label the rest as not verified. Unit test added; the 36 failing tests in the full suite are in diagram, SelecTor and lens files that these changes do not touch.

First trial of that instruction in the chat failed: the agent ran all five scenarios correctly, read no history, and answered with one status line ("scenario check completed") after 9.2k output tokens that the log does not record. Forbidding unproven claims without requiring the history call left it nothing it was allowed to say. The instruction now requires find_abap_transpiler_stops or read_abap_transpiler_history before answering a comparison or cause question, a fallback of reported outputs marked not verified when history is unreadable, and forbids a status-line-only answer. Logging the model's thinking was considered and set aside.

After the instruction change a trial answer cited every claim by run and step. Run citations became links: the agent writes `[run <8 hex> step <n>]` in a fixed English form; the chat webview tokenizes it in its inline renderer and, on the finished answer, links it only if the prefix matches exactly one run that the host reports as known (`vertex.knownTranspilerRuns`). Matching free prose such as "step 13" was rejected: one sentence often covers two runs.

Runs are kept on disk when `vertex.transpiler.runPath` is set: `transpiler-history.js` writes `<stamp>_<object>_<run_id>/vertex-run.json` with relative paths and copies each source the record steps through into `sources/<n>/<original name>`. The original name is kept because the adapter derives the program name from it; a first version prefixed the file name and the stopped frame read `0_ZLAB`. `read`/`find` fall back to disk, so the agent can also query runs from earlier sessions. `vertex.openTranspilerRun` opens a run by id and step or from a picked folder; Visual Debug gets the record through a new `trace` option of the local adapter, whose `restore` now returns the output and the start step, and refuses Run for a kept run. Unset path keeps the earlier in-memory behaviour, and a citation of an unknown run reports it rather than rerunning. Tests cover the store round trip, a moved folder, the adapter's start step and the chat link.

A trial with Claude Code streamed a complete comparison with citations, then submitted the structured `answer` as "the summary was given in the previous answer"; the sidebar replaces the stream with `answer`, so the text and its links vanished. Combining stream and answer was rejected: the stream is usually a preamble and would duplicate or mislead. The schema's `answer` property now carries a description saying it is the complete reply and that text outside it is lost, and the base instructions say the user sees only that field.

With the whole reply now in `answer`, Claude Code wrote nothing as plain text and the chat showed only "Using StructuredOutput..." until the end: the stream handler treated Claude Code's StructuredOutput tool call like an SAP tool. Its input now streams as the answer through the existing partial-answer parser.

The user found GUID prefixes meaningless in the chat. Of the options (label by scenario, number per conversation, readable folder names) the user chose the conversation number. `transpiler-history.js` numbers saved runs and resets on New conversation (`vertex.resetTranspilerRunNumbers`); the tool result carries `run_number`; the agent still writes the id in citations, which stay unambiguous, and the chat draws them as "run N, step S" with the full id in the tooltip. Runs from earlier conversations or from disk have no number and keep the cited id.

## 2026-10-17 — VS Code 0.9.11: direct SNC only

Removed the separate bridge through the SAP ADT VS Code extension and its full-object index. The direct fr0ster RFC/SNC transport, SAP Logon import, native RFC library discovery and standard direct ADT operations remain. Historical entries below describe the bridge while it existed.

## 2026-10-17 — SNC attribution

Added explicit acknowledgements for fr0ster's `@mcp-abap-adt/connection`/auth-broker libraries and PR #1, and Enrico Andreoli's independent `adt-rfc-bridge`. The latter's README informed VERTEX's search for a compatible installed `sapnwrfc.dll`; no Python bridge code was incorporated. There is no verified evidence of copying between the two external implementations, so the documentation does not claim it. Updated the third-party notice's packaging sentence to match the current universal VSIX.

## 2026-10-17 — Direct SNC lineage clarified

The successful ER6 access uses the direct auth-broker/RFC path from fr0ster-forks PR #1, augmented in 0.9.10 by one universal VSIX with both supported native bindings, Windows `sapnwrfc.dll` discovery, and direct SAP Logon SNC import. The prebuilt `sap-rfc-lite` binding is packaged; SAP's RFC library is not. The observed success proves a compatible library was found at runtime, not that a separate full SDK install occurred or that SAP GUI necessarily supplied the DLL. The independent SAP ADT extension bridge does not participate in that request path.

## 2026-10-17 — 0.9.10: unified SNC packaging trial

The universal VSIX now includes the prebuilt `sap-rfc-lite` bindings for Windows x64 and macOS Apple silicon, omitting Linux and SAP's own libraries. `rfc-wire` finds `sapnwrfc.dll` in SAPNWRFC_HOME, System32, SAP GUI or PATH before loading the binding. On this Windows host the RFC binding loads with the installed System32 DLL. Archive-policy and discovery tests pass. Built and verified `vertex-abap-0.9.10.vsix`; the package check also excludes generated RFC diagnostic logs. A live SNC logon has not been verified.

## 2026-10-17 — 0.9.9: interface method reachability fix

The SNC work reduced what the transpiler reads by omitting bodies of class methods the run cannot reach. Its reachability parser split `METHOD zif~method` at `~` and stored only the interface name. Calls recorded the method name, so a reachable interface implementation was replaced with the unreached-method assertion. `partsOf` now retains the qualified name and `collect` matches its method suffix. A saved run still failed after the code fix because its cached sources already contained the assertion; the user confirmed Recompile corrected the run. Regression tests cover a called and an uncalled interface method and the debug lab's facade-to-factory-to-road path. The focused tests pass. Built and verified the universal VSIX for 0.9.9. A Windows x64 VSIX was also built and verified, then removed at the user's request to defer SNC packaging. No Eclipse or macOS package was built.

## 2026-10-17 — 0.9.8: SAP ADT extension visibility

The SAP ADT extension can be available through its `abap:` file system even when it is absent from the current extension host's `extensions` list. `state` now probes the repository instead of refusing early; the `onFileSystem:abap` event activates SAP ADT when needed. Import reads known destinations without the extension-list gate, and the setup link remains visible when a destinations file exists. A missing provider now reports the failed read rather than incorrectly claiming the extension is not installed. Built the universal VSIX for the SAP ADT extension route; the RFC package was not rebuilt.

## 2026-10-17 — 0.9.7: SNC auth broker release

Reviewed the merged fr0ster auth-broker PR against the Basic and SNC transport boundaries, SecretStorage migration, host refusals and package checks. Released the existing integration as VS Code 0.9.7; Eclipse was not rebuilt.

## 2026-10-17 — The auth broker next to SNC through SAP's ADT extension

While this landing was under way, 0.9.3–0.9.5 reached SNC systems through SAP's ADT extension (`"connection": "sap-adt-extension"`). The owner decided both routes stay: the extension route needs no SAP NW RFC SDK but offers no Run in SAP or SAP debugger; `authType: "snc"` talks RFC directly, needs the SDK, and offers everything, the debugger included. The branch was merged with 0.9.5: extension destinations are validated apart from the broker systems and never reach the broker, its wires or a password prompt; connection keys are read through `auth/systems.keyInfo` instead of by array position, so breakpoints and variable reads of an extension tab stay on its destination; `package.js` carries the vendor-source check 0.9.5 added to `package.ps1`.

## 2026-10-16 — Auth broker integration, path a

The user asked for auth broker integration, path a: keep abap-adt-api and replace its transport with provider-driven HTTP for basic and RFC for SNC, using VS Code SecretStorage for credentials. Gate 1 passed (SNC discovery, read and lock/unlock). Gate 2 passed (the stack loads in the local extension host); its addendum found that Electron refuses external buffers, hanging RFC ADT responses, so SNC needs sap-rfc-lite ≥ 0.2.4 with NewOrCopy (now in the lock). Gate 3 chose option B: no CSRF token over RFC, with a local response token stripped outbound. Gate 4 passed twice: deleting the listener ended its poll after 0.828 s and 0.814 s; LISTENER_STOP_MS is 6000.

Owner decisions: engines.vscode stays ^1.85.0, with basic verified on Node 18/20/24. SNC supports Windows x64 and macOS on Apple silicon only, in local VS Code. Packaging is per target with its own prebuilt binding (win32-x64 or darwin-arm64); universal has no SNC. The SDK is installed by the user at runtime. The version is left to the plugin's author when merging; no version is changed here.

Tasks 3–10 built settings validation and login/connection identities, the SecretStorage stores and one-time password migration, the auth broker and HTTP wire, host refusals and the RFC wire, and a shared client factory for commands, repositories and the debugger. Debugger listener work uses a separate probe client with bounded shutdown and disposal on failure; repository restore selects by connection key, then unique name, re-reads after a changed definition and reports failure instead of showing old source, and reports a lost lock without retrying a write.

Preliminary integration on the owner's Windows machine over SNC passed browse/search/read, lock/unlock, logout and read again on one client, ABAP Unit, ATC, and data preview through VERTEX's own client factory under VS Code's Electron; Test SAP Systems passed too. The debugger in VERTEX passed attach, step, stack, variables, detach and attach again, and recognised listener conflict 409. Still open for Task 13: save and activate twice in VERTEX, listener shutdown time, confirming no RFC conversation remains after a failed attach, restore after a system change, the whole basic column, two windows, and migration in a fresh profile. SNC on macOS (Apple silicon) remains unverified; the packages are built in Task 12.

Task 11 documents basic and SNC settings, target packages and runtime prerequisites, host refusals, credential storage and reset, and the separate WebGUI logon in the READMEs and connection walkthrough.

Merged upstream/main 0.9.5 while retaining the auth broker structure: extension destinations validate separately and use destination connection keys for restore; HTTP and RFC clients still come only from auth/clients.js. The debugger keeps lifecycle serialization, probe routing, generation guards and bounded stop alongside local-only breakpoints. package.ps1 remains a package.js wrapper; the upstream zero-divide vendor-source archive check is included in package.js alongside its existing full-entry, packaged Scheme, UML and version checks. The lock root matches the manifest; no dependency installation or host build was run.
## 2026-10-17 — 0.9.6: Object Navigator in VERTEX Tools

The user asked for SE80's Object Navigator as the first function of a class and a package, the tree working as links into the code; after the first build, a transport request too - what they had meant from the start, with the class kept. A request's tree was first read in three data-preview queries with a level per task; on a large request it hung at Reading, and the user asked for a list first and the rest on unfolding: one query now, E071 joined to E070 on the request or its tasks, the objects by type with no task level; a LIMU METH opens its class at its METHOD statement, a REPS gets no link because it may be an include. On the first look at a class two branches had ADT's raw codes: CLAS/OF, the friends, is now Friends of; CLAS/OCX named the class itself and is dropped, the root stands for it. Then, at the user's word, Object Navigator became the default of these types in VS Code: object-tools' `enable` with `first` also sets the default, so Eclipse, which does not enable it, keeps UML and Review. A click opens the source beside the tree and keeps the focus on it (`beside`, `preserveFocus` of openToolSource), as the user asked - before, each click took them away from the window. A function group in a request was a dead leaf; it now unfolds to its function modules and includes through `nodeContents("FUGR/F")`, which answers in the package's shape, so packageTree builds it. On a live package ADT left the object types' labels empty, so the tree showed CLAS/OC and the like, and its nodes carried folder entries typed DEVC/OC, DEVC/DT and so on, each an empty branch; the types now go by SE80's names (Classes, Programs, Function Groups, Function Modules, Includes, the dictionary types) and the DEVC/ folder entries are left out. A function group's includes did not open: ADT indexes them as FUGR/I under the group's address (checked on the system: LZVX_CALCTOP at /functions/groups/zvx_calc/includes/lzvx_calctop, no PROG/I), and `resolve` looked for INCL as PROG/I only. It now also takes the one exact FUGR/I under /includes/ - a module's own include (LZFGU01) is listed under the module's address and is not taken. FUGR/PX, the group's generated main program (SAPL...), stays as ADT names it for now, at the user's word, until the includes are tried. Programs got Object Navigator too, as their default, at the user's word: `nodeContents("PROG/P")`, built by packageTree; a part without a source of its own (a form, an event, a local class) opens the program at its statement through openToolSource's method lookup. Seen live on ZABAPGIT: the program's types came without labels and are named now - Fields, Events, Subroutines, Screens, GUI Statuses, GUI Titles; PROG/PX was the program itself and is left out; PROG/T, PROG/PLM and PROG/PLA keep ADT's codes, their meaning not yet seen. Only a subroutine links (to its FORM): an event, a field or a screen has no statement openToolSource finds by name. Its includes did nothing on a click: a failure of openToolSource was posted to the page as a result no one waited for and dropped. It is now shown as an error message, so the cause can be seen; the message then named it: ZABAPGIT_AUTHORIZATIONS_EXIT is named by `INCLUDE ... IF FOUND` and does not exist, yet ADT's node structure lists it. At the user's word an include of a program that is not found opens the program at its INCLUDE statement, with a warning saying so (`declaredIn`; openToolSource finds an `include` by its INCLUDE line). Ctrl+Shift+P did nothing in the Tools window: VS Code reads the keys of the webview's top document only, and the pages are frames inside it; tools.html now passes a key with Ctrl, Alt or Meta, or an F-key, up as a keydown of its own document - shared with Eclipse, where it should be harmless. Neither was tried in VS Code. The whole ZABAPGIT tree then showed what the remaining codes are: PROG/PL local classes, PROG/PLM and PROG/PLA the methods and attributes of all of them in one flat list, and PROG/PT the TABLES of the program (SSCRFIELDS) - not GUI titles, as first guessed. PT is Tables now; PLM and PLA leave the program's level, and a local class unfolds on demand to Methods and Attributes, asked from the node structure below its node (`parentnodes`, the way Eclipse unfolds it); a method opens the program at its METHOD. Whether SAP answers that with the class's own parts or with all of the program's is not yet seen. A type with no named entries is not shown. Then Object Navigator on the standalone abapGit program hung at Reading and slowed the whole laptop: the Tools window reads an object's Parts for every function, and for a program that is the metrics analysis, the whole source through abaplint, queued before the tree. Object Navigator, being a parts list itself, now reads no Parts; they are read when another function is chosen. Asked whether Parts duplicated the navigator: it did, at a far higher price - one ADT request against reading every include and parsing it all here. The pages match a chosen part by its name and kind alone (metrics.html's sdeSelectPart), never by the include the list carries, so at the user's word a program's Parts on a SAP system now come from the node structure (`programUnits`: PROG/PE events, PROG/PU forms, PROG/PLM local methods; route navigator with parts=X). The diagrams and metrics still parse the source when they draw. Local files, Eclipse (no navigator route there), includes and function modules keep the old reading. Not tried in VS Code: whether ACE's event names match the node structure's exactly, which the choice of a part depends on. Going through the rest: classes, interfaces, groups, packages and requests already list their parts by a few SELECTs; the include and the function module still parse their whole source for their Parts. Whether the node structure answers for them could not be probed from here - no tool of this session reaches it, and computer use was off - so, at the user's choice, Object Navigator was added for both as the probe: an include asked as PROG/I (Eclipse's way of unfolding one), a function module as its group's tree (FUGR/F of the group TFDIR names; a group's forms are the whole group's). Both get it first in the list without it becoming their default. Their Parts are not moved yet: that waits for what SAP answers. ZABAPGIT_FORMS as PROG/I: an empty tree, shown as a bare root; an empty answer now says so. The probe moved to PROG/PI, the only include parent abap-adt-api's NodeParents names. At the user's word Object Navigator is the default wherever it is offered, the include and the function module included. PROG/PI answered nothing either: SAP's node structure has no tree for an include, so the include lost Object Navigator again - a default that opens empty is worse than none - and its Parts stay on parsing. In the editor, a double-click on ENDCLASS failed with "Unexpected query in ADT object URI": CLASS ... ENDCLASS was no block for the structural jump, so the click went on to SAP's definition, whose address carried a query sourceAt refused. CLASS/INTERFACE ... ENDCLASS/ENDINTERFACE are blocks now (not DEFERRED, LOAD, LOCAL FRIENDS), and sourceAt drops the query. A double-click on a local method's name in a program, include or module went nowhere: the METHODS/METHOD counterpart was for global classes only; it now goes within the local class it stands in, so a name two local classes share goes to its own. Then the Parts list's own parse went, at the user's word ("Parts are handy - lint is just not needed everywhere"): where no cheap list exists - an include, a function module, a class in VS Code (whose list came from the metrics route too), a local file - the window no longer asks for the metrics analysis ahead of the page; metrics.html, which loads that analysis first in every mode anyway, hands its units to the window (`sdePartsFound`), and the list is built from them. One parse instead of two per opening; a program's, a class's Diff and a package's lists keep their cheap sources. A part named on opening is applied when the list arrives. Logic only dropped ordinary operations without a trace; at the user's word the ones left out between two shown steps now stand as one dashed block, "N operations", which a click opens in place (its first line goes into the scheme's expand list, the aceexp_ action the page now handles) and a click on any opened one folds again. The three ace-scheme tests about ACE's older folding fail as before; a test of this folding is added. Asked whether Diff's Parts also parse: a class's did - versions-front's classLayout parsed the main source with abaplint for its sections and methods. At the user's word ("only the method kinds are the nuance") the list now comes from ADT's object structure where the host reads it (`componentLayout`): a section is listed when a component has its visibility, a CLAS/OM goes into its section, and a method of an implemented interface - a CLAS/OM or INTF/IO under the interface's component - as ZIF~M in none. That interface methods sit under their interface's component is assumed from ADT's outline, not seen live; the cut of a chosen part's versions still parses, as it needs the lines. Hosts without the object structure (SAP's ADT extension) keep the parse. Unfolding a local class of the standalone abapGit program showed (empty) for every class: the node structure below a class's node answered nothing. A class now unfolds from the program's object structure, the one Eclipse's Outline is drawn from, found by its name; its components group as a global class's do and open at their lines. Not yet seen live, nor the type codes a program's outline uses for its local classes' parts. Seen: the outline unfolds them, its methods typed PROG/PLM (now Methods; PLA Attributes, and PLT/PLE guessed as Types/Events), but with no line to open at. Such a method now opens at its METHOD inside its own CLASS ... IMPLEMENTATION - a name many local classes share is never taken from another - and says so when it is not there. Next look: PROG/PLY holds the local types (now Types); a local class's name opened nothing, nor did its attributes and types. The class now opens at its CLASS ... DEFINITION, an attribute or a type at the first line of that DEFINITION naming it. And a double-click on lcl_page in the 147,072-line abapGit program was refused - Definition is not sent to SAP over 50,000 lines. A class, an interface or a form the source declares itself is now found in the source before SAP is asked (`ownDeclaration`), so such names navigate in a source of any size; what only SAP can resolve - a variable's type, a global object - stays refused over the limit, which protects SAP from analysing the whole file at every click. Then the hover in that program was refused the same way, and the user asked whether size matters at all. It does not to SAP: Eclipse sends the whole source with every hover and navigation, whatever its size, and abapGit is worked on there. The 50,000-line limit was VERTEX's own caution (20,000 first, raised once), while what actually protects SAP and the machine was already in `analyse`: one request at a time, a hover never queued behind another, each given up after 20 s. The limit is gone from `analyse`; F1 still sends only the statement at the cursor for a source over 50,000 lines. A double-click on create in zcl_abapgit_html_toolbar=>create( ) went to SAP for a global class that is local to the program. A call of a method of a class the source declares - a static lcl=>m( ), or lo->m( ) with lo's class found by instanceClass - now goes to its METHOD in that class's IMPLEMENTATION in the source. The user then noticed the Parts read again on every switch of function. The window keyed its list by object and by where it came from (ADT's versions or the parse), and a class's Diff and its diagrams differ in that; since every page finds a chosen part by its key - Diff falls back to the key too - the list is now one per object, whatever function read it first. A click on GET_PARTS in the Calls diagram of ZCL_AVE_POPUP failed with "Logic unit GET_PARTS was not found in ZCL_AVE_OBJECT_FACTORY". The call is lo_obj->get_parts( ) after DATA(lo_obj) = NEW zcl_ave_object_factory( )->get_instance( ... ), and value-origin-model's `types` took any expression starting with NEW x for an x - so the receiver was the factory, and with the implementing class not loaded the call stayed unresolved under the factory's name. `newOnly` now takes NEW x( ... ) for an x only when nothing follows it; a chain gives what its last method returns (also for the variables view's inline types). Reproduced in a test with an interface and no implementation loaded: the owner was ZCL_FACTORY, it is now the class the factory's method returns. The value-origin test that failed before fails the same. Briefly a local class opened from the navigator at its IMPLEMENTATION; the user then settled it back - the class at its DEFINITION, its methods at their METHOD in the IMPLEMENTATION. In the editor its name on the DEFINITION line leads to the IMPLEMENTATION and back. Inherited from was added at the user's word, from SEOMETAREL's inheritance row (RELTYPE 2) - ADT's object structure does not carry the superclass. The tree comes from ADT's own answers: a package from the node structure (`nodeContents("DEVC/K")`, the same call packageObjects makes) grouped by its categories and object types, a class or interface from its object structure (`classComponents`), each component's line from its implementationIdentifier link, else its definitionIdentifier, and only when the link points into source/main - a local class's part in another include is shown without a link rather than opened at a guessed place. vscode/object-navigator.js builds the tree, sap-code.js's `objectNavigator` reads it, frontend-analysis.js answers `/vertex/navigator/`, and the shared page org.vertex.abap.ui/resources/navigator.html draws it and loads subpackages, classes and interfaces when unfolded; a click goes through the Tools window's existing sdeOpenUmlSource. The function is VS Code's, added through object-tools' `enable`, which gained a `first` place; Eclipse does not bundle the page and was not built. Checked: test/object-navigator.test.js, the page against a stand-in host in the browser (unfold, lazy load, a click opening RUN at line 20). Not run against SAP - the node structure's categories and the component links are taken from abap-adt-api's types, not from a live answer. The suite's other failures (lens, SelecTor table, Visual Debug pages) are as before this change.

## 2026-10-16 — 0.9.5: the transpiler reads what the run reaches

On a large system the transpiler read dozens of classes for one method: collect took every customer object any source of the run names, and the transpiler (unknownTypes compileError, its default) refused a project with one missing. The user asked to read only the run's flow, and better still per method. Checked first with a real run: a class whose unused method names a class that does not exist fails to transpile in compileError and runs (output 42) in runtimeError. sap-transpile.js now splits each source into its routines by its tokens (`partsOf`) and reaches them from the entry - the method at the cursor for a class, the program and the module whole - through the calls of the routines reached (`callsOf`: meth( ), ->/=>meth, CALL METHOD, PERFORM, by name, so an instance call reaches every method of that name); a class's attributes are taken when a reached routine uses them, INHERITING FROM and INTERFACES always; a module called (CALL FUNCTION) is reached, its group's others are not. abap_transpile.json sets unknownTypes runtimeError. After collecting, `stubUnreached` leaves out the bodies of the methods not reached: the first line between METHOD and ENDMETHOD becomes a failing ASSERT naming it as not transpiled, the others blank, so line numbers stay. The kept build carries its entry line and is read again for another. A first version made every module of a function group reached; found by reading it back and fixed. Through SAP's ADT extension `/IWNGW/IF_NOTIF_PROVIDER` stopped a run: every /namespace/ was taken for customer code; now only namespaces with a root package in the tree are (kept with the index, derived from a kept index's objects), the rest left to the transpiler as void (its errorNamespace is ^(Z|Y|LCL_|TY_|LIF_)). Loading a class or method only when the run enters it - waiting on its transpiling, recursively - was discussed as the next step, not built. Then over HTTP the user's run stopped on the parameter screen: the type of IV_REQUEST_ID, data element ZREQUEST_ID, had no domain (abaplint's lookupDomain). sap-ddic.js's `known` mixed open-abap-core's tables, data elements and domains, so a domain named as one of its 114 data elements with no domain of that name was taken for known and not read; `coreNames` now keeps the domains apart (`known.domains`), and only a domain counts for a domain. Metrics of a program on one system failed with "System ... is not part of Central User Administration" while classes worked and another system opened programs; Eclipse's search on that system found no such program - it was not there. frontend-analysis.js reads a program not found as an include, and that system answers a missing include with the CUA error, which was shown alone; the not-found is now said, the include's answer added. test/sap-transpile-reach.test.js and a sap-ddic test; the suite fails the same 37 tests as main. Raised to 0.9.5 at the user's word. Not run against SAP. Eclipse not built.

## 2026-10-16 — 0.9.3, 0.9.4: SNC systems through SAP's ADT extension

The user asked for SNC. Over HTTP there is no SNC: it secures DIAG and RFC only. Weighed: SPNEGO or X.509 on the ICM (the user's browser got the Basic dialog - neither is set up there), a password reset, and RFC with SNC. ABAP FS (its PowerShell Kerberos/certificate probe), SAP's ADT for VS Code (headless Eclipse ADT with JCo, `sncType`/`partnerName` taken from SAP Logon) and mcp-abap-adt (SNC over RFC through `SADT_REST_RFC_ENDPOINT`, needing the NW RFC SDK the user does not have) all answer it over RFC. The user's idea settled it: SAP's extension registers a FileSystemProvider for `abap:`, and `vscode.workspace.fs` reaches any provider. Probed on the trial system with a throwaway extension in the scratchpad (a trigger file, a task.js read afresh): readFile works by full path; deep stat/readDirectory answer from a tree cache, so a write walks the path first, else VS Code tries createDirectory, which the extension lacks; writeFile is dropped without a word when the document is open and unchanged (an open file is written through its document and saved); readFile gives the inactive version; activate and checkObject act on the active editor and report through diagnostics, and activate on code with errors opens a modal "activate anyway?" the command never reports - so VERTEX activates only after a clean check. The extension's MCP server (20 tools) has no object search; nothing outside the extension finds a name.

Stage 1 (vscode/sap-adt-extension.js): the extension found by its case-sensitive id, `~/.adtls/destinations.json`, the state (not installed, no such destination, not logged on, logged on), **Get Connections from SAP ADT for VS Code** (palette while installed), the refusal of every HTTP path (`password`, `fetch`), the system list's mark; SAP Logon entries with `sncname` and no `sncnosso="1"` leave the HTTP import. Stage 2 (vscode/sap-adt-extension-repository.js): createRepository's operations over `abap:`, objects kept at their ADT addresses so the rest of VERTEX is unchanged; the class parts, function group files and texts follow abapGit's names as the extension shows them. The Tools window's name search goes through ADT's quick search, so on such a system extension.js answers it from the index in ADT's XML. Breakpoints of such a system stay VERTEX's (the debugger's `localOnly`/`local`), so Visual Debug lists them and Analyze flow path works; a first version kept them only in the editor and the panel showed none. abap: documents are taken in as VERTEX tabs of their system (`adopt`), with the commands and the tree's context menu on them. Stage 2b (vscode/sap-adt-ddic.js): the transpiler's dictionary reads answered from the extension's `.tabl.ddic` sources, read by their tokens, in DD02L/DD03L rows; data elements, domains and table types of customer packages are refused by name, their files not seen yet. Function groups and their modules come from the tree, not TFDIR.

The index went wrong three times. Walking every customer root on any miss took seconds on the trial system and swept thousands of objects on a large one; then a name was looked for nearest first, from the package of the object worked on outward, standard names never; at the user's word a full index is built once on request, four requests at a time, with progress and Cancel, and kept. Checked against TADIR on the trial system: classes, interfaces, tables, data elements and table types matched; five objects were missing, all in a package with a hyphen in its name, which the folder test refused - fixed. Types a source declares with TYPES had sent the transpiler's dictionary reads walking every package; they are known now (`declaredTypes`, components excluded).

Found on the way, for every system: `FROM b` in `SUBTRACT 1 FROM b` taken for a table (sap-ddic.js); a routine's end taken as its last statement's first line plus one; class method starts taken from ADT's components (now from the analysed source); a FUNCTION statement's interface never read, and a type `zif_x=>ty_y` split by moduleSignature; parameters written with `!` lost; the empty variables panel saying its toggles were off when they were not. A page change of this session broke the whole Visual Debug panel with one unmatched quote; test/page-syntax.test.js now parses every inline script of the pages. Also at the user's word: metrics tables without their own background, UML method links in every Tools window and in the group the source stands in, the variables asked at the panel's opening line, a function module's parameters from its group's XML for a local copy, the parameter screen's folded structures and table rows edited as structures with Duplicate, the panel's breakpoints of its object with All BP, a transpiler failure kept in the panel, no Run in SAP for such a system. Tests: sap-adt-extension, sap-adt-extension-repository, fugr-module-parameters, value-origin-declarations, page-syntax and additions to sap-ddic; the suite fails the same 37 tests as main. Built as 0.9.3 through the day and raised to 0.9.4 at the user's word. Eclipse not built.

## 2026-10-15 — 0.9.1: an SAP program run with the transpiler

The user asked for the transpiler run for SAP code too, and for a button beside Run in SAP. Discussed first: where an SAP program's dependencies come from. The analysis (Analyse) already loads sources on demand through ADT (value-origin-demand.js), but only along its slice, without function modules or DDIC, and a failed load is a warning there; a run needs the whole program and must stop on any gap. Settled in stages: (1) the button and a strict whole-program collection of classes and interfaces, (2) a cache of the map and the files, checked for freshness with one SELECT over REPOSRC and DD02L/DD04L/DD01L dates, rebuilt only after changes, (3) function groups, (4) DDIC as abapGit XML. This landing is stage 1.

vscode/sap-transpile.js: `namedObjects` takes the customer objects a source names from its tokens (NEW, =>, INTERFACES, REF TO, INHERITING FROM, CAST, RAISING/CATCH lists, INCLUDE) and its customer CALL FUNCTIONs; `collect` reads them with the analysis reader (active version), a class with its definitions, implementations and macros includes and without testclasses, a name not found as a class as an interface; any read that fails, a customer function module, and a name that is neither class nor interface (a DDIC type after REF TO) throw with the name. `writeProject` writes an abapGit folder with its own abap_transpile.json under %TEMP%/vertex-sap-abap. code-workbench's `transpileSources` refuses a program whose open tab is dirty or differs from the active version. extension.js handles `sapTranspile` from the docked panel: reads with a progress notification, writes the folder and reopens the panel as the transpiler's on the program file, running at once (`autoRun` now also comes from the source handed in; Clear passes it off). visual-debug.html shows the button only for a PROG in the docked panel.

Two transpiler findings on the way. Local classes of a global class were transpiled into `.clas.locals.mjs` but never imported: the import is only written with `options.addCommonJS`; the SAP run's config sets it. The local-file run has no addCommonJS and likely the same gap - not changed, told to the user. And the transpiler writes a program's INCLUDE as `// transpiler TODO: INCLUDE` and runs on without it (only function group includes are expanded). A first version refused such programs; the user pointed out that an include is just code the run steps into. Now each program goes to the transpiler with its includes written in (`expandIncludes`, an INCLUDE must stand on lines of its own, a self-include is refused), and after transpiling `remapIncludes` (called from local-run's launch when vertex-includes.json is present) rewrites the program's source map so each line points at the program or the include in the folder's sap/ copy, as SAP holds them; the panel opens that copy.

test/sap-transpile.test.js (5 pass): the names, the closure, every refusal, the expansion's places, and a real transpiler run that prints 101 and records steps in the include, the program after it, the class and its local include at their own lines. The whole suite fails the same 37 tests as main before this change. Not run against SAP: whether the analysis reader reads a PROG/I include through ADT is unverified. Raised to 0.9.1 and built with package.ps1. Eclipse not built.

The user asked why the editor's context menu of an SAP program has no run. `vertex.runTranspiler` was shown for file tabs only; it is now shown for a vertex-sap tab whose path names PROG too, and its handler runs the SAP flow (`runSapTranspiler`, shared with the panel's button) when the tab is not a local file. The user's first live run on A4H (ZVERTEX_DEBUG_LAB) read the program and its classes and failed in the transpiler: CHAR12 not found - the SAP run's project lacked the CHAR/XFELD/... data elements a local run makes with `localDdicAliases`; writeProject now makes them the same way (exported from local-run.js; the test program declares a CHAR12). And ZLOG_SHIPMENT not found, a customer structure: DDIC is stage 4, and the collector cannot see a `TYPE zstructure` today - the transpiler names it. Rebuilt 0.9.1.

At the user's word stage 4, DDIC, came before the cache. vscode/sap-ddic.js: `dictionaryNames` takes from a source's tokens what may be the dictionary's - after TYPE (through TABLE OF, LINE OF, RANGE OF, REF TO), INCLUDE TYPE/STRUCTURE, TABLES, and a SELECT's FROM and JOIN. `readDictionary` asks DD02L/DD03L, DD04L, DD40L and DD01L (`as4local = 'A'`, 40 names per IN) over the same data preview SelecTor uses (`repo.api.query`), and follows .INCLUDE/.APPEND PRECFIELDs, field data elements, structures and table types, data element domains and table type row types until nothing new is named. open-abap-core's data elements and domains and the classes read are not asked for. A name a source used that the dictionary lacks is left to the transpiler (local TYPES, built-ins); a name a definition uses that it lacks throws. `objectXml` writes abapGit TABL/DTEL/DOMA/TTYP XML (.APPEND as abaplint's .INCLU--AP), checked against abaplint core's parsers. code-workbench's transpileSources reads the dictionary after the sources, writeProject writes it into src. A name after REF TO that is no class or interface no longer stops the collection: it is `REF`, tried as a class and an interface and else left to the dictionary.

Checked on A4H first by hand: SAPQuery over DD03L answers ZLOG_SHIPMENT's fields as expected. Then a replay: the sources of the user's ZVERTEX_DEBUG_LAB run (the folder in %TEMP%) with the DD rows of A4H fed through a stand-in query. The first replay failed with CHAR12 and WERTV8 unknown in lookupDomain: a data element and its domain share a name, and the domain was never asked for, since the name counted as asked. Types and domains are now asked for apart; the replay transpiles. Not run in VS Code: its SELECTs need SelecTor. test/sap-ddic.test.js (5 pass): the names, the closure with an include, a table type and same-named domains, a definition's missing dependency, the XML, and a program typed by a table type over a table with an include that runs - its CHAR 7 field cut as SAP cuts it. The whole suite fails the same 37 tests as main. Rebuilt 0.9.1.

The user's live run on A4H opened every step in a copy under %TEMP% beside the SAP tab, and closing the panel left F5-F8 stepping a run nobody showed, while opening it again started the run over. Asked first: the SAP tabs would carry the run, and a breakpoint set in a tab is VERTEX's SAP breakpoint too - (a) one breakpoint for both runs, or (b) none sent to SAP while the transpiler panel is open; the user chose (a), and for the panel restoring the live run, since Clear starts a new one. sap-transpile's `copyPath` names where each source stands; runSapTranspiler keeps each copy with the address of its tab (code-workbench `sourceUri`, the same formula as sourceDocument) on the panel's source as `sapCopies`. extension.js turns one into the other (`runPathOf`, `runUriOf`, `runDocument` through code-workbench `sourceOf`): the history mark, reveal and Where used open the SAP tab, and F5-F8 from a tab of a copied source step the run. local-debug-adapter takes `pathOf`/`uriOf`: a breakpoint in a SAP tab counts as one in its copy, and one set from the panel goes to the tab. Closing the panel no longer loses the run: the adapter keeps whether it ended and its time, answers `restore`, and the page, opened with `restore` instead of `autoRun` while the adapter has a trace, shows that record (`localResult`, shared with Run; the SAP run's part of Run is `sapRun`). local-debug-adapter.test.js: two new tests, 8 pass. The whole suite fails the same 37 tests as main. Not run against SAP. Rebuilt 0.9.1.

The user asked about methods and function modules. Methods first, function modules with stage 3 (function groups). runSapTranspiler takes a CLAS too: the cursor must stand in the tab of the class's main source (its address from sourceUri), its line goes to the panel as entryLine, and a line in no method is refused before the panel opens. The collection starts from the class. projectFor refused a driver for any project with its own abap_transpile.json; the folder VERTEX writes for an SAP run (marked by vertex-includes.json) now takes the driver's folder and file into its inputs. The panel's button and the context menu show for a CLAS tab too. sap-transpile.test.js: a method of ZCL_PRICE run with N = 4 prints 41 and records its local class's line (6 pass). The whole suite fails the same 37 tests as main. Not run against SAP. Rebuilt 0.9.1.

At the user's word, from C:\soft\GitHub\open-steamgate (OSD, MIT) what serves the transpiler and its debugging. Reviewed there: its transpiler pin (upstream 2.14.3 with fork fixes - nothing we lack), docs/debugging-abap.md, tools/osd-where.mjs (stacks to ABAP lines by source maps), osd-sql-trace.mjs (the one database seam), osd-fm-registry.mjs (function group signatures from fugr.xml; the transpiler has no PARAMETER-TABLE, so calls are generated), and its use of `abap.builtin.sy`. Not taken: the js-debug descriptions, the hit list, the inspector door, gogen, OData and the ADT facade.

open-abap-core: the user allowed a download; upstream open-abap/open-abap-core at the commit already vendored (5af9e694) was cloned into the scratchpad and its src copied into vendor/open-abap-core without *.testclasses.abap (the ddic part identical to what was there; 698 files, 2.7 MB; REVISION says so; package.ps1 now requires a library class in the vsix). Whole library in a run measured first: the A4H sources plus all of it transpile in 4.3 s, so an SAP run takes the whole src (filter on the open-abap-core path) rather than a chosen closure, and no class the runtime raises by itself is missed. sap-ddic's coreNames now covers its tables and table types too. The first run failed in the library: local-trace instrumented cl_abap_exceptional_values, whose variable `in` is a JavaScript keyword. Library sources are now never instrumented: run, not recorded, never stepped into - which also keeps the record to the user's code. Local-file runs still take only the ddic part: many library classes have local classes, which need addCommonJS, still undecided for local runs. A test runs CX_SY_ZERODIVIDE raised by the runtime and CL_ABAP_CHAR_UTILITIES (a program's inline DATA(lx) after CATCH ... INTO is still lost by the transpiler, the known gap repairInlineProgramDeclarations covers in part).

Failure at the ABAP line: the trace's capture now stands on the statement's own line instead of a line before it, so generated line numbers match the maps; local-entry.test.js pinned the old layout and follows. local-trace `abapFailure` reads every .mjs:line of a failed run's stderr through its map and says the error, then "at OBJECT line N (file)" and "called from ..." for each ABAP place; launch throws that and writes Node's text to the output channel. Tested with a method calling itself through an initial reference: at ZCL_BOOM line 8, called from ZFAIL line 4.

SY and SQL per step: capture records the SY fields SUBRC, TABIX, INDEX, DBCNT, FDPOS when they change (from abap.builtin.sy), and the SELECTs since the last capture - the DEFAULT connection VERTEX installs for SelecTor now notes each SELECT with its row count or error. The adapter shows SY and SQL groups beside Locals and answers SY for the SY toggle (its notice no longer says SY is unavailable); the page's record carries both, SQL for one step only. Tested: a SELECT shows at the next step with its rows, and READ TABLE without a hit records SY-SUBRC 4.

Not done from the list: function groups (stage 3), only proposed. The whole suite fails the same 37 tests as main. Not run against SAP. Rebuilt 0.9.1.

Stage 3, function groups, at the user's word. A4H first: TFDIR lists the customer modules and their main programs (Z_VX_FM_CALC in SAPLZ_VX_TEST); ADT shows a module with its signature in its FUNCTION statement (IMPORTING VALUE(iv_amount) TYPE decfloat34 DEFAULT 10000 ...), not abapGit's *" comment, and the group's main program names LZ_VX_TESTTOP and the generated LZ_VX_TESTUXX. abaplint takes the signatures from <group>.fugr.xml (RSIMP/RSEXP/RSCHA/RSTBL with PARAMETER, TYP/DBFIELD/DBSTRUCT, DEFAULT, OPTIONAL, REFERENCE), as OSD's osd-fm-registry reads them.

vscode/sap-fugr.js: `groupOf` (TFDIR), `readFunctionGroup` - the main program, every include it names recursively but UXX and the U includes, and every module of the group, through ADT addresses with code-workbench's sourceAt - `moduleSignature` (the FUNCTION statement's sections read from its tokens), `moduleBody` (the statement made FUNCTION <name>. and its other lines left empty, so a module's lines are its tab's), `groupXml`. sap-transpile's collect takes a `groups` option: a customer CALL FUNCTION, or a FUNC root, brings the whole group, and a group's own INCLUDEs are not queued as programs; fileName and writeProject lay groups out as abapGit does. runSapTranspiler, the panel's button and the context menu take a FUNC; the module's copy opens, from the cursor's line in its tab or its first, and maps to its FUNC tab; the group's main program and includes have no VERTEX tab and stay copies.

Found on the way. The first group XML named the group for each include (the run's sources keep the part in include): abaplint found no include, so no FORM in it. A parameter with a DEFAULT was not optional; SAP and abapGit make it so. The transpiler leaves a module's DEFAULT unset (its own "todo, set DEFAULT value"): a caller that omits the parameter got it initial, silently - 40 instead of 42 in the test. writeProject keeps the DEFAULTs in vertex-defaults.json, and after transpiling `applyModuleDefaults` sets each where the generated module creates the parameter, on the same line; a DEFAULT that is no literal stops the run. A replay of A4H's Z_VX_FM_CALC from its ADT texts then failed in the trace: its DATA lv_atc_unused, declared near the end, was read by every capture before - a JavaScript let in its temporal dead zone, which typeof cannot touch either. Each value is now read in its own try, and JavaScript keywords are left out (the `in` of open-abap-core). The replay then ran the whole calculation (EV_PAYMENT 867,57 for 10000 at 7.5% over 12 months, 5 primes) and stopped at FORMAT COLOR, which the transpiler does not run, named as Z_VX_FM_CALC line 91 - abapFailure now names a group file's part, not the group. The SELECT of a routine's last statement had no next step to show on; the trace's end gives it to the last record (and a live run gets it as VERTEX_TRACE_TAIL).

test/sap-fugr.test.js (4 pass): the signature and the body's lines, the group read whole with its XML, a program calling Z_ADD without IV_B getting its DEFAULT and stepping into the module and the group's FORM include, and Z_TWICE run by itself with a variable declared after its use. The whole suite fails the same 37 tests as main. Not run in VS Code against SAP. Rebuilt 0.9.1.

At the user's word the real SAP system is no longer named in the repository: every mention of it - histories, a comment in debugger.js, test fixtures, a transport number - now says A4H, and the SAP user in tests is DEVELOPER. The Marketplace publisher id, LICENSE and copyright keep the author's name.

The selection screen, at the user's word, after a look at C:\soft\GitHub\open-abap-gui (MIT): an SAP GUI in ABAP over HTML - ALV grid, containers, trees, an HTML viewer - and a converter that turns a classic report into a class on its framework, whose host draws dynpros and selection screens. Proposed and chosen: its model of a selection screen (open-abap-gui converter/src/passes/collect-selection-screens.mjs: blocks, lines, comments, SKIP, ULINE, pushbuttons, tabbed blocks, PARAMETERS, SELECT-OPTIONS), drawn in our own dialog with VS Code's theme. Its parser reads ABAP text with regular expressions, which this repository does not do, so the model is built again here from tokens; running the program through its framework was ruled out - the converter rewrites the code, so lines no longer meet the SAP tab, and its HTML has its own look.

vscode/selection-screen.js: the program's statements from the tokenizer, hyphenated words joined (SELECTION-SCREEN, NO-DISPLAY, TEXT-001, SY-DATUM) and chains taken apart into the statements they stand for; `selectionScreen` gives screen 1000's elements in order - blocks (frame, title), lines, comments, SKIP, ULINE, PARAMETERS (type, LENGTH, DECIMALS, DEFAULT, CHECKBOX, RADIOBUTTON GROUP, OBLIGATORY, LOWER CASE, NO-DISPLAY), SELECT-OPTIONS (FOR field, its type from the program's DATA, DEFAULT low TO high, OPTION, SIGN, NO INTERVALS, NO-EXTENSION) - leaves BEGIN OF SCREEN n out and keeps what it cannot draw as a note. `textPoolOf` reads abapGit's TPOOL, `adtTexts` ADT's NAME =text lines (?... is no text; @DDICReference skipped), as seen on A4H through ARC's TEXT_ELEMENTS. local-run's scenariosFor and parametersFor now come from this model (chains were missed before), and `screenFor` gives the page the model and its texts: the .prog.xml beside a local file, or vertex-texts.json, which runSapTranspiler writes from code-workbench reading /sap/bc/adt/textelements/programs/<name>/source/selections and /symbols - that address is ADT's as Eclipse uses it, not seen working here; a failure is stored and the window says it.

The transpiler, tried on a sample, leaves two throws in a program with a selection screen: every SELECTION-SCREEN statement ("SelectionScreen, transpiler todo") and any PARAMETERS with LENGTH or DECIMALS ("not supported", as a value would be cut). `repairSelectionScreen` empties the first (layout only, which the dialog draws) and declares the second with its length and decimals and its literal DEFAULT (C, N, P, X; another type, or a DEFAULT that is a name, stays a throw saying so), on the same line; the pieces of a chain all map to the chain's line, so the n-th throw there is the n-th sized piece. `setRanges` writes the screen's SELECT-OPTIONS rows after the program's own DEFAULT rows, clearing them first. The page draws the screen (`drawScreen`), keeps what was typed between openings, sends $ranges beside $parameters and refuses Execute while an OBLIGATORY field is empty. Checked in the browser pane on a preview page with a stubbed host: blocks, lines, radio groups, the two kinds of SELECT-OPTIONS, the note, the OBLIGATORY refusal and the values sent.

test/selection-screen.test.js (3 pass): the elements of a chained screen with another screen and a pushbutton, both text sources, and a run with a framed block, a LENGTH 10 OBLIGATORY parameter and SELECT-OPTIONS - DEFAULTs upper-cased, then the screen's values with two range rows. The whole suite fails the same 37 tests as main. Not run against SAP. Rebuilt 0.9.1.

The user, running ZVERTEX_DEBUG_LAB again and again: every run read everything from SAP and transpiled it anew. Stage 2, the cache, was built first as planned: vscode/sap-cache.js kept what a run read per system and object, and a fingerprint - every include's last change from REPOSRC (a class's pool includes down to CM001, a group's L includes) and every dictionary object's from DD02L/DD04L/DD01L/DD40L, one query each, checked on A4H - decided whether the kept reading was SAP's as it stands. local-run took the transpiled code again under the same fingerprint, from an untouched copy, since the record's instrumentation and the screen's values change it in place. The first copy held the whole output - 1391 files with the runtime - and a repeated run took 17 s against 11 s for a new one; copying only the modules whose maps name the user's ABAP, with _init.mjs, made it 1.3 s.

The user then asked for another approach: a Recompile button, as ABAP's code can change while the compiled load runs. The fingerprint query is gone; sap-cache keeps the build (named by when it was read) and a run takes it as it is, without asking SAP. transpileSources reads only on recompile or when no build is kept; runSapTranspiler writes the project only for another build, and keeps the SAP object and the method's line on the panel's source; the page's Recompile (`sapRecompile`) reads and transpiles the object again and opens the panel on the new build, and Run's tooltip and the state line say when the build was read. A method or function module run still transpiles at each run - its call program carries the values - but reads nothing. The selection texts are read at each run (two small requests).

At the user's word too, a run with no breakpoint is one program: the selection screen stands in the panel (#runscreen) instead of a window, Execute (F8) runs and shows the list, Back (F3) returns to the screen with the values given; with a breakpoint the window and the debugger stay as they were. Checked in the browser pane on a preview page: the screen in the panel, the list, Back, the values kept.

test/sap-cache.test.js (2 pass): the kept build per system and object, and a run of the same build taking its transpiled code again ("taken again", no Transpiler CLI, the same steps recorded) until the build changes. The whole suite fails the same 37 tests as main. Not run against SAP. Raised to 0.9.2 at the user's word - everything of 2026-10-16 goes with it, history.md's 0.9.1 entry keeping what was built on 2026-10-15 - and built with package.ps1.

The user tried 0.9.2: it works, but they expected a window of its own for the run, as open-abap-gui shows one, the output in it too, and a "See flow history" button to open the debugger. Asked first: SAP GUI's layout in the VS Code theme's colours (chosen), or open-abap-gui's own CSS with fixed colours, which AGENTS.md rules out. The selection screen's drawing moved out of visual-debug.html into pages/selection-screen-ui.js, which tools-window.js and the new program-window.js put in at a SELECTION-SCREEN-UI mark, so both draw it alike. program-window.js opens pages/program-window.html in an editor tab: a title bar (the program and Selection screen / List), a toolbar (Execute F8, Back F3, See flow history, Recompile for an SAP object), the screen or the list, a status bar. It runs through the same local-debug-adapter as Visual Debug, so each run is recorded there; See flow history (`showFlow`) shows the panel whole - not the plain run - restoring that record, and a run that stops at a breakpoint opens it at once. openVisualDebug opens the window for a run of a program (no method or module screen) and leaves the panel behind it without its own automatic run; methods and function modules still run in the panel. Recompile is one function for the window and the panel. Range inputs got a width, as they ran past the edge. Checked in the browser pane with a stubbed host: the screen, an OBLIGATORY field refused, the values sent, the list, Back with the values kept, See flow history asked. test/program-window.test.js: the shared screen code put in, the toolbar, no fixed colour. The whole suite fails the same 37 tests as main. Not run in VS Code. Rebuilt 0.9.2.

The user's try in VS Code: everything works, but from Visual Debug there was no way back to the program window. Back to program, beside Run in the transpiler's panel while the window is open (program-window.js isOpen/reveal), brings it to the front; closed, it says so. Rebuilt 0.9.2.

More from the user's try. The header's buttons had three looks - Run's fill, Exit program and Detach in red text underlined on hover, Recompile and Clear as boxes: Exit program, Detach, Recompile, Back to program, the SAP program's transpiler button and Clear are now VS Code's secondary button, and Run keeps its fill as the panel's first action (the red of the two that end something is gone with it). The long title ran under Clear, the bug and ? in the top right corner: the first row leaves them room and the title is cut with an ellipsis; checked in the browser pane at 700 px. Back to program was not seen: the user's VS Code still ran an earlier 0.9.2 - a vsix of the same number is taken only after the window reloads. The help under ? spoke of Classes / Methods and Logic only; it now says what the panel does: the two runs, the program window, Recompile, stepping and the record, Output and results, Detach / Exit / Clear (the zoom paragraph kept, not checked).

Methods' and function modules' screens moved into the program window too, at the user's word: the parameter screen with its variants went to pages/selection-screen-ui.js beside the selection screen; the window gives it debug() for the variants (passed to the adapter: variants, saveVariant, deleteVariant only) and failed(). The results: local-entry.js wrote them as WRITE lines (RS_RESULT-FIELD =value), unreadable for a structure. They are now written in VERTEX's own form - VERTEX:S (a value by its path), VERTEX:T (a table's name, rows and columns) and VERTEX:R (a row), parted by tabs, through string templates, so a value is not formatted by WRITE - and `splitResults` takes them out of the list: the window draws a value as a line, a structure as a tree and a table as a grid, both foldable (`drawResults`); Visual Debug's Output shows them as indented text (`resultsText`). widthOf, which only served the old table lines, is gone. local-entry.test.js and sap-fugr.test.js pinned the old form and follow. The whole suite fails the same 37 tests as main. Not run in VS Code. Rebuilt 0.9.2.

The user asked whether Exit program and Back to program were related. They are not: Exit program ends a stopped run, Detach lets an SAP one go and stops listening, Back to program only brought the window forward. At the user's word Detach is hidden in the transpiler's panel - a transpiler run has no session to leave. Renaming Back to program was proposed; the user then saw that it doubled Run, and asked for it to go: while the program window is open, Run in the transpiler's panel brings that window back (toProgram), as a run there that reaches a breakpoint opens the panel by itself, and the separate button is gone. The help says so. Rebuilt 0.9.2.

See flow history did not close the program window, as the user found, but Visual Debug, restoring the record, showed the run's source in the active editor column - the window's - and the window went behind it. The source now opens in a column where it is already in sight, else beside the program window when that window is in sight in the active column (program-window.js column, extension.js runColumn), for reveal and for Where used. Rebuilt 0.9.2.

The user then saw two lists - the window's and Visual Debug's Output, in different forms - and that they did not agree: Visual Debug was refreshed only by See flow history, so after another Execute it still showed an earlier run (a run whose amounts were all 0 beside one of 12213 and one of 11302). Each run of the window now refreshes Visual Debug (`refreshFlow`), whether or not it is in front, and See flow history only brings it forward; Visual Debug's Output is hidden for a run of the program window, whose list is the window's. Rebuilt 0.9.2.

From a local file the same program window had no Recompile - right, a local file has no build of SAP's to keep - and Visual Debug said "recorded 0 ABAP steps" and "Cannot read properties of undefined (reading 'forEach')". The host's run of that file, replayed outside VS Code (C:\soft\GitHub\debugger_tests, the debug adapter with a live launch and an empty SelecTor), recorded 33 steps, so the fault was between the panel and the window: the panel's page was written before the window opened, so it did not know the window held the run, and kept its own run screen; a run of the panel and one of the window share the debug adapter, and a second run ends the first. The panel's page is now written after the window opens and is never a run of its own (no autoRun, no runOnly); the adapter refuses a second run while one goes on, and lets the next one go when a run fails. The forEach message itself was not reproduced here.

At the user's word, a local file is not transpiled at every run either: projectFor stamps the folder's ABAP and XML files - path, size, last change - with the configuration, and launch takes the last build again under the same stamp, as for an SAP object (7.7 s, then 1.0 s, on ZVERTEX_DEBUG_LAB). sap-cache.test.js: an edit transpiles again. The whole suite fails the same 37 tests as main. Rebuilt 0.9.2.

The user's second run from the window again left Visual Debug at "recorded 0 ABAP steps" with "Cannot read properties of undefined (reading 'forEach')". The adapter, replayed twice outside VS Code, answered restore with all 33 steps both times, so the answers went astray: the page asks one thing at a time and takes the answers in order (sdeNext/sdeReady), and when the window's run writes the page again, an answer to a request of the page before - still running then - reached the new page, took the place of its first answer, and put every answer after it one off: restore read a picture (no trace: 0 steps), the picture read restore's record (no breakpoints: the forEach). Each load of the panel's page now has its number (setDockedHtml, dockedGeneration) and the panel's handler answers only the page that asked (replyTo). Rebuilt 0.9.2.

The user: no change. The page, loaded in the browser pane as refreshFlow writes it, with its host answering from the debug adapter's real record after two runs, came up right - 33 steps, no error - so an answer still went astray in VS Code. The handler's catch answered every failed call with "ERROR:", also the calls the page does not wait on - reveal (the page's first replay of the record opens its source), backward, clear, the local run and steps - and such an answer was taken for the next request's. Only debug, source and asset are answered now; an error of another call is shown as a VS Code notification. Rebuilt 0.9.2.

## 2026-10-14 — 0.9.0: Formula, Expression values, an endless re-annotation

At the user's word the notice "The flow from line ... in the diagram" after Analyze flow path is gone from visual-debug.html. The user found Formula and Expression the same: commit 0d9b49c put Expression's line at the head of Formula, and a long formula filled the pane; Formula is the tree alone again. The record's Expression wrote its result without a value; it is now named with it like the other names (record-formula.js; four assertions of record-formula.test.js follow, 12 pass). The user's machine hung twice on moving the slider: annotateValues inserted its value spans, the MutationObserver saw them after `annotating` was false again, and annotated again 50 ms later, endlessly; it now drops its own records (takeRecords), and replay goes through the same 50 ms debounce instead of a call per slider move. Still open: with an analysed path, the total's value is looked for back through the record and can be an early 0 when the late steps keep LS_RESULT without fields - proposed to the user, not changed. docs/architecture.jpg was replaced by architecture2.png; vscode/README.md, eclipse/README.md and docs/index.html still pointed at the old file and now point at the new. Raised to 0.9.0 and built with package.ps1. Not run live; Eclipse not built.

## 2026-10-14 — Debugger: source read once per run

Prompted by the user's report that the SAP (WebGUI-started) debugger is slow, and a look at abapsmith (C:\soft\GitHub\debug) for what could be taken over. `lines()` in vscode/debugger.js fetched the whole include with `getObjectSource` at every stop to show five lines around it. It now keeps the text in a map per attached run (`sources`, emptied in `attach`), so a step after the first one in the same include costs one request less. A program cannot change while it stands in the debugger; a new run reads it again, so a reactivation is seen. Considered from abapsmith and not done yet: starting a class through `/sap/bc/adt/oo/classrun` and a report through a generated classrun wrapper instead of WebGUI, and `/sap/bc/adt/debugger/batch` (step, stack and root variables in one POST - unverified live in abapsmith itself). `test/debugger.test.js` passes (30). Not run against SAP; the user is measuring where a run's time goes; before this change a Visual run of 173 steps at depth 2 took 113.0 s (1.5 steps/s). Raised the VS Code extension to 0.8.17 and built it with vscode/package.ps1 (vertex-abap-0.8.17.vsix, verified). Eclipse was not rebuilt.

Then `/sap/bc/adt/debugger/batch` was probed on A4H with a throwaway script (not in the repository; run by the user, since the session could not connect with the certificate check off), on ZVERTEX_DEBUG_LAB from line 15, alternating the two ways each step-over. Step-over plus getStack as two requests: 96-133 ms, about 115 ms. The same two in one batch: 57-66 ms, about 62 ms; the stack lines followed on correctly (16, 19, 31, 36, 50, 54). Each sub-request must carry `Accept: application/xml` - without it the batch answers 202 and each part 400 "Accept header missing" (abapsmith's builder sets none; its batch is unverified live there). The finding that matters more: SAP's share of a step is about 0.1 s, while the Visual run measured above spent about 0.65 s per step, so most of a step's time is spent in VERTEX itself. Batch is not wired into debugger.js.

At the user's word, to find where the other half second goes: Visual run and Flow run in visual-debug.html time each stage of a step and the stats line ends with "ms per step": SAP (the step itself, from the host's `sap`), stack/host (the rest of the host's `total`: the stack and what arrive does), page-host (the step's round trip beyond `total`), picture (the `picture` request), draw (apply / markSource), values (readChosenValue, snapshot), map/plan (mapFor, methodsFor and the plan of the move), rest (the run's time not in a stage). `spent`, `timed`, `stepShare` and `stageText` sit beside drawStats; the existing `sap`/`total`/`stackMs` sums are unchanged. The stats test now also loads the helpers and pins the breakdown. visual-debug-ui.test.js fails the same 9 tests with and without this change. The 0.8.17 vsix was rebuilt with it, the number not raised.

The stats line is cut at the window's width, so the breakdown could not be read: the line now carries its full text as its tooltip too. Rebuilt 0.8.17 again.

The user could not capture a tooltip, so a click on the stats line copies it. Their run (19 steps, 22.6 s): SAP 188 and stack/host 191 ms per step, map/plan 807. map/plan is now two stages: map (mapFor and methodsFor - the statement map of the program and a class's method starts, cached per program but emptied by fresh() at the start of every run) and plan (the move worked out from it). Rebuilt 0.8.17.

The user pointed out that they had asked before for no map with Predict off. runVisual still called mapFor and methodsFor on every step, though with Predict off it uses nothing of the map (expect, exit and the mismatch check are all under `guessing`); it now builds none, and the explain line says "Predict off: no statement map". Flow run still uses the map to decide its moves and is unchanged.

At the user's word, too: the maps are no longer emptied by fresh() at every run. The host's analysis cache is already dropped by `invalidate` when VERTEX writes a source (code-workbench's apply); frontend-analysis now counts those (`generation`), the page asks for the count (`mapsVersion`) at the start of a run and drops maps, lists and method starts only when it changed. A source activated outside VERTEX (Eclipse, SAP GUI) is not seen; a map that no longer fits shows as a statement map mismatch, as before. Eclipse's host has no `mapsVersion`, so there the page drops the maps at every run as it did. And at the user's suggestion the map is built in the background: when a stop is shown outside a run and Predict is on, `prefetchMaps` asks for the map and method starts of every Z program on the stack; a map asked for while one is on its way waits for it (`mapAsks`). The fresh() test pinned the old rule ("the maps belong to the run") and now pins the new one; a new test covers dropping on a changed count. visual-debug-ui.test.js: 36 pass, the same 9 fail; the whole suite fails the same tests as before this change. Not run against SAP. Rebuilt 0.8.17.

With both: 19 steps in 9.3 s instead of 22.6 (2.0 steps/s): SAP 182, stack/host 181, page-host 88, picture 38 ms per step, no map. A Predict run measured before these changes: 155 steps (47 predicted) in 76.4 s, SAP 181, stack/host 126, page-host 17, picture 19, map 149 ms per step, 11 statement map mismatches.

At the user's word, the step and the stack after it now go to SAP in one request, through ADT's debugger batch as probed on A4H. `stepWithStack` in debugger.js builds the multipart body (each part with `Accept: application/xml`), splits the answer and reads the parts with the same parsing abap-adt-api uses for the separate requests (its `fullParse`/`xmlNodeAttr`/`xmlArray`/`parseUri`, required from its build). `advance` uses it for every step except one whose line the window predicted - that one reads no stack, as before - and hands the stack to `arrive`, which reads it itself only when none was given. A failed step part is the program ending, as a failed separate step was; a batch that answers with the wrong number of parts, or a stack part that failed after the step ran, is thrown as an error saying the step may have run - never retried, never read again in two requests. Log breakpoints met on the way (arrive's continue loop) and runTo keep separate requests. The fake SAP of debugger.test.js answers the batch; a test checks a quick step makes one batch request and no separate stack request.

page-host was 88 ms in one run and 17 in the other. To see what it holds: `advance` returns `queued` (the wait for `exclusive`, where the step stands behind any other request of the session), the extension adds `handler` (its whole hold of a step command, pinTo included), and the window splits page-host into queue, handler (the host's own beyond queue, step and stack) and page-host (the round trip that is left). debugger.test.js: 31 pass. visual-debug-ui.test.js: 36 pass, the same 9 fail. Not run against SAP. Rebuilt 0.8.17.

The user's runs after batch: without Predict, 173 steps in 37.8 s (4.6 steps/s; SAP 177, stack/host 1, queue 0, handler 0, page-host 24, picture 15 ms per step) against 113 s at the start. With Predict, no value: 173 steps (54 predicted) in 68.5 s, map 185 ms per step, 11 mismatches. With a value: 128 steps (45 predicted) in 78.4 s, values 187, map 229; the same run again 52.1 s with map 18 - the cache across runs works, and the first run waits for the map to be built. A predicted step cost the same as any other (about 175 ms): the stack it saved now comes with the step for nothing.

So, at the user's word, three changes. (1) No line prediction: runVisual sends no `expect`; every step goes through the batch. The map still gives `expect.over` (F6 over a call outside Z/Y) and the skips (loops, blocks, rest of a pass, statements outside the slice). The mismatch check now runs after every plain statement, not only after unpredicted ones. debugger.js keeps the predicted path of `advance` and `settle`; the window no longer uses them. (2) The map is not waited for: with Predict on, a step whose program's map (and a class's method starts) is not ready - or before the check against VERTEX's writes is done (`mapsReady`) - goes without it while the build goes on; the explain line says "statement map being built". (3) values: readChosenValue asked `vars` at every stop, about as dear as the step. The step's batch now takes a third part, getVariables for the followed value (`read` on the step command, `names` in `advance`), parsed as abap-adt-api parses it; a failed part comes back as an error with the answer, the step and stack stand. readChosenValue uses it when it holds every name wanted at that stop, and asks as before otherwise (a place of the slice wants its operands too). The getVariables part is not yet run against SAP. debugger.test.js 32 pass (its fake SAP answers the third part); visual-debug-ui.test.js 37 pass, the same 9 fail; the whole suite fails the same tests as before. Rebuilt 0.8.17.

Run with the three changes and a value followed: 123 steps in 63.6 s, SAP 176, stack/host 4, page-host 35, picture 236, values 64 ms per step, 13 mismatches. picture had been 13-21: the page sends its requests to the host one at a time, and the map being built for the steps after (`statements`, seconds of analysis) stood in that queue before `picture`; not waiting for the map in the step had only moved the wait. A separate channel for background requests was considered and not built: the user then decided to remove Predict entirely.

Predict removed. The page loses the button, `prefetchMaps`, the loop/block/slice skips (`loopExit`, `BLOCKS`, `loopUnlessSliced`, `straight`, `skipAhead`, `loopRest`, `stopAfter`, `overCall`) and the line prediction (`urlOf`, `unitIn`, `predicted`); runVisual steps F5 every time, with `read` for the followed value, and no longer checks the map after a step or settles a predicted stop at the end; the stats line loses "(N predicted)". The host loses `advance`'s `expect`, the predicted stop, `settle` (and its command) and the predicted flag of the picture and of frame(). Flow run keeps its own use of the map (mapFor, methodsFor, placeOf, listFor, callable, stepOver), and the maps are still kept across runs for it. Tests removed with the code: six of visual-debug-ui.test.js (the Predict skips, stopAfter, the next line) and two of debugger.test.js (a predicted step, a predicted PERFORM and settle); the stats test and the map-drop test follow the code. debugger.test.js 30 pass; visual-debug-ui.test.js 31 pass, the same 9 fail as before. Eclipse's host never sent `settle` or a prediction. Rebuilt 0.8.17.

A Flow run, measured after that: 59 steps in 58.6 s, SAP 175, stack/host 81 (runTo: points, F8, points back, stack - not batched), page-host 74, picture 39, map 621 ms per step. Against a Visual run of the same program (173 steps, 37.8 s) it lost cold and would win perhaps 15 s warm; the record of a Visual run already holds the call structure the diagram is drawn from. At the user's word Flow went too, with what was left of the map in the debugger. The page loses the Flow button and `runFlow`, `mapFor`/`methodsFor`/`checkMaps` and the maps' version check, `stepOver`, `callable`, `outside`/`ownersOutside` and the map/plan stages of the stats; `backToOurs` (Z only) set points over its routine from the map and ran F8 to leave deep standard code in one move, and now steps out with F7 a level at a time, the run asking again after each. The host loses the `statements`, `methods`, `mapsVersion` and `runTo` commands, `runTo` itself, frontend-analysis' write count, and the local adapter's `settle` and `methods`. The record's diagram code still reads `maps` where a map exists (unitOf, statement text, loop shapes, closesBlock, snapDue); nothing fills them now, so those take their no-map branches - as every Predict-off run already did. Eclipse's VisualDebugSession still answers `settle` and `runTo`, which the page no longer sends; not changed, since Eclipse is not built here. Tests: runTo's test of debugger.test.js and the map-drop test of visual-debug-ui.test.js went with the code; debugger.test.js 29 pass; visual-debug-ui.test.js 30 pass, the same 9 fail; the whole suite fails the same tests as before. Not run against SAP. Rebuilt 0.8.17.

The user found the Marketplace description (vscode/package.json `description`) weak: nothing about serverless work, the transpiler, analysis and debugging without SAP. It now begins "Serverless ABAP: run, debug and analyse ABAP on your machine with the ABAP transpiler, no SAP system needed" before the SAP debugger, BSE, review, explorers and MCP. Also from the user: Run with ABAP Transpiler on C:TMP	est.abap said "Expected one generated program for test.abap; found 0." Checked with the bundled CLI in a scratch folder: a file named `test.abap` gives only init.mjs/_top.mjs - abaplint takes the object type from the abapGit name - while `test.prog.abap` gives project/test.prog.mjs; no .prog.xml is needed. The message was not changed.

Then, from the user: in the transpiler panel for C:\TMP\test.prog.abap a breakpoint of ZVERTEX_DEBUG_LAB (another file) was listed, and it kept the panel out of a plain run - `syncRunOnly` turns the run into the debugger when any active point is listed, and the local adapter listed every ABAP breakpoint in VS Code. The user asked for the points to be checked when the object is opened. local-run.js now has `runScope`: under an abap_transpile.json project, everything below its root; otherwise the file and the sources `automaticInputFilter` takes with it (the same set a run transpiles; `automaticRoot` is factored out of projectFor for it). The adapter takes it as `scope`, reads it on opening and again at each run, and lists only the points in those files; Clear all without an id removes only those (it used to remove every VS Code breakpoint, of any language). Checked on scratch files: a program, the class it calls and a class it does not - the first two are in scope. At the user's word, since points elsewhere may matter once the run gets there, **All BP** (a `vertex-toggle` in the Breakpoints header, transpiler panel only) switches the adapter to every ABAP breakpoint (`allBreakpoints`); a new panel starts with it off. The user also found the record switch pointless in the transpiler: the page already hid `#recmode` there, but `.vertex-segment-toggle`'s display overrode the hidden attribute; `#recmode[hidden]` (and `#bpscope[hidden]`) now say display:none, as the page does for other hidden parts. local-debug-adapter.test.js covers the scope, Clear all and All BP (6 pass); the whole suite fails the same tests as before. The toggle was not looked at in a browser. Rebuilt 0.8.17.

Steps & values in the SAP debugger (values 818 ms per step on a 27-step run). Why it was so: `snapshot()` was built from the Variables pane's commands - `scopes`, then `children` per group - which open one node per click; at first it ran only at routine boundaries (`snapDue`), so a few requests a stop were bearable; 0.8.16 made Steps & values read at every stop, so Formula can tell which statement changed a value; and reading each structure's components for Formula's LS_X-FIELD names added one request per structure. All of them went one after another through the page's request queue. Now one host command, `snapshot` -> debugger.js `stopValues(kinds)`: @ROOT, then every scope asked for in one getChildVariables, then every structure of them in one more, each variable placed by HIERARCHIES (PARENT_ID -> CHILD_ID; SAP's answer for a scope carries them, as abapsmith's live capture 034-vars-locals-scope.xml shows, and rows() already relied on it for structures). The page asks it with the kinds it keeps (parameters and locals; globals in an event); the transpiler path is unchanged. A first name, `snapshot`, collided with debugger.js's own snapshot(stack) of the assistant's stops and deadlocked inside exclusive - found by its test hanging. debugger.test.js's fake SAP now gives a scope's HIERARCHIES; a test counts three requests and checks a structure's fields. Not run against SAP.

At the user's word, too: vscode/README.md's first paragraph now says VERTEX works serverless in VS Code - the transpiler runs, debugs and analyses local ABAP with no SAP system - before what it does against SAP. And a local file whose name has no .prog (test.abap) now gets "The transpiler made no program of test.abap: it takes the object type from the file name. Name it test.prog.abap." instead of "found 0". Rebuilt 0.8.17.

From the user: PARAMETERS p_clean(10) TYPE c was never asked - the transpiler's selection screen knew radio groups only (`radioGroups`), so the program ran with the parameter's DEFAULT or initial value. value-origin-model.js has `selectionParameters`: every PARAMETERS that is not a radio button, as a value or AS CHECKBOX, its DEFAULT unquoted, whether it is numeric, and whether SAP would upper-case it (a character type without LOWER CASE). The panel puts them on the same selection dialog as the radio groups (a text field, a checkbox) and sends them as `selection.$parameters`; the command without the panel asks them with an input box or a pick. `entryFor` sets each after the generated program's own lines for it - after the DEFAULT and the transpiler's to_upper - as `name.set(value)`, upper-cased where SAP would, a number as a number (a non-number for a numeric parameter fails loudly). Checked end to end on a scratch program with a CHAR, an I and a checkbox: the transpiled program printed `SDSD      7X`. SELECT-OPTIONS are not asked. test/selection-parameters.test.js covers the reading. Rebuilt 0.8.17.

The user changed the program and saved it, and the selection dialog still showed the old parameter: the page built the screen once, from INITIAL (read when the panel opened). Now `fillSelection` builds it, and before each run the page asks the local adapter for `selection` - radioGroups and selectionParameters of the document as it stands now, saved or not - and fills the dialog again; a value the reader typed is kept while a parameter (or a radio group) of that name is still there, a new one starts at its DEFAULT. With nothing on the screen the run starts without the dialog. Not looked at in a browser. Rebuilt 0.8.17.

Steps & values after `stopValues`: 173 steps in 131.9 s, values 529 ms per step - three requests one after another. The user asked who decides the scope ids (SAP's ADT debugger: VERTEX reads them from @ROOT; seen in abapsmith's captures of one system only, so not taken as fixed) and whether everything could be read in one request and laid out after. A probe on A4H (ZVERTEX_DEBUG_LAB from line 15, F5 through the facade and the data provider) read @ROOT, @GLOBALS, @PARAMETERS and @LOCALS in one getChildVariables at every stop: never refused, 55-80 ms; @ROOT named @GLOBALS in the report event and ME, @PARAMETERS, @LOCALS in a method; a scope the stop does not have answered nothing. So the step's batch now takes that request as one more part (`SCOPES`, `scopes` on the step command, `kinds` in `advance`), `scopeGroups` keeps the scopes @ROOT named of the kinds asked for, and `structureFields` reads all their structures' components in one request, only when there are structures. The page asks it in Steps & values for params, locals and globals and keeps what it wants by inEvent, as before; `stopValues` (a stop made by hand) uses the same single read, two requests at most. A failed part comes back as an error the record keeps for that stop. debugger.test.js's fake SAP answers several parents at once and the batch's getChildVariables part; 31 pass. Not run against SAP. Rebuilt 0.8.17.

Measured: 173 steps in 66.4 s (from 131.9), SAP 207, handler 150, page-host 19, picture 6, values 0 ms per step. The 150 under handler is the structures' request: `advance` read it after `total` was taken, so the window counted it as the host's own work. `advance` now returns its time as `structures`, and the window counts it under values. Rebuilt 0.8.17.

The user wants the analyses on a recorded history - transpiler or SAP - without running the program again: pick the step to start from, and choose any variable again and again; "the same as we already compute". What was there: following a value (Variables' menu) rebuilds Formula from the record at the player's stop (`at=replayAt`) and asks the slice; Analyze flow path and Where used start from a breakpoint. What was missing: the recorded values (`drawRecordedTree`, shown while the player stands at a stop) had no menu - a right-click gave the browser's Cut/Copy/Paste - and nothing started the analyses from a stop. Now a recorded row opens the same menu, with its path (name-component, rows of a table have none); at a recorded stop the menu adds "Flow of X from stop N" (`analyzePath` from the stop's point) and "Backward of X from stop N" (`sdeBackward`), both following X first. `stopPoint(i)` makes the point from the stop: a SAP class or program address, or a local .clas/.prog.abap file, gives the object, its type and the line. `#vmenu button[hidden]` is display:none, or the menu's block display would show the hidden items. Tests: stopPoint for the four kinds of address, and the menu test given `replayAt`. visual-debug-ui.test.js 31 pass, the same 9 fail. Not run in VS Code or against SAP. Rebuilt 0.8.17.

The user: Follow at a recorded stop "does not work", and asked how it differs from Flow of. Follow only registers the value the analyses are about (the chip, the marks, BSE, Formula from the record); Flow of also runs the analysis from the stop. What looked broken: choosing redraws Variables, and `drawVars` did not know the player - with the program no longer stopped it drew the declared variables, and the recorded values the reader had just right-clicked were gone. It now draws the recorded stop while the player stands at one. And `originLine` - the line the slice is asked from - takes the recorded stop's line when that stop stands in the window's object, not the live frame's. The originLine test gets `replayAt`. The whole suite fails the same tests as before. Rebuilt 0.8.17.

The user asked for the transpiler to run any method or function module, with a screen of its importing and changing parameters and tables beforehand, and variants of the values kept. Decided with the user: variants in VS Code (workspaceState), methods and function modules together. Found first: the bundled transpiler handles function groups (it registers `abap.FunctionModules[...]`), but the panel only ran a program or the unit tests.

New `local-entry.js`. `targetAt` finds the method or function module whose implementation holds the cursor line from abaplint's statements (MethodImplementation/EndMethod, FunctionModule/EndFunction), not from the text. `parametersOf` reads the signature: for a class, abaplint's SyntaxLogic and the class definition from the spaghetti scope (visibility, static, OPTIONAL, DEFAULT, each parameter's type; a method that is not public, a non-public constructor, a type with no name and a reference are refused with the reason); for a function module, the group's XML through abaplint's FunctionGroup (direction, type name, OPTIONAL, DEFAULT). `screenOf` builds the call program with DATA only, checks it with abaplint and reads each variable's type back - one way for both kinds - as the screen's shape: simple, a structure's fields, a table's row. `driverSource` writes the program: a variable per parameter (a constructor's prefixed c_), the values as assignments (a table's rows by APPEND INITIAL LINE ... ASSIGNING), DEFAULT where nothing was given, an optional parameter passed only when given, the call (`NEW ...( )->m( )`, `=>m( )`, `CALL FUNCTION`), and a WRITE of each simple result. Two transpiler limits shaped it: an inline FIELD-SYMBOL(...) or DATA(...) at the program's top is left undeclared (the trap repairInlineProgramDeclarations works round for programs), so everything is declared at the top; and CX_ROOT is no class in the run (only open-abap-core's DDIC goes in), so the call is not wrapped in TRY - an exception ends the run with it. Two of my slips on the way: abaplint's getAll() is a generator, and a first .find used it up, so the constructor was never found; and the signature's field was called `constructor`, which every JS object has - a function module got Object as its constructor list; it is `creation` now.

local-run.js: `entryScreen(document, line)`; `launch` with `selection.$entry` writes the call program to a temp folder, `projectFor` takes it as one more input (and refuses a project with its own abap_transpile.json), and `entryFor` runs it; `automaticInputFilter` takes a function module's whole group (XML and includes). The extension keeps the cursor line of the opening (`entryLine`) and puts the screen into INITIAL (`entry`, or its error); the local adapter answers it again with `selection` and keeps `variants`/`saveVariant`/`deleteVariant` in workspaceState under `vertex.variants.<CLASS=>METHOD or FM>`. The page: `fillEntry` and `entryEditor` (a field, a structure's field table, a table grid with + row and ×), the variant bar, and `readEntry` into the run; a target that cannot be called shows its reason and Execute runs nothing (`entryBlocked`). Colours are VS Code's variables only.

Checked: end to end through local-run (projectFor with the program, the bundled transpiler, the runtime, entryFor, node) on a scratch class - ZCL_CALC=>TOTAL with two rows and rate 10 wrote CV_NOTE =note: HEAD, EV_COUNT =2, RV_SUM =70 - and on a scratch group - Z_ADD with IV_A 40 and the DEFAULT 2 wrote EV_SUM =42. The screen was looked at in the browser pane on a page built by debugHtml with a stub host: the editors, a variant loaded into the grid and fields, and Execute sending exactly those values; the dark theme can only be seen in VS Code, the stub page has no --vscode-* variables. test/local-entry.test.js (5) covers the target, the shapes, the refusal of a private method, the call program of a method and of a function module. Not run inside VS Code. Rebuilt 0.8.17.

The user wants any method. Tried in a scratch project: a program calling a PRIVATE method of a class, transpiled with the bundled CLI (syntax check on), ran and returned its value - neither the transpiler nor its check enforces visibility. The refusals of a non-public method and of a non-public constructor are gone; the README says SAP itself would refuse such a call. The test that expected the refusal now checks a private method's call program. Rebuilt 0.8.17.

The user ran ZCL_PRICE_ROAD with the cursor in METHOD zif_pricing_strategy~calculate_base: "Method ZIF_PRICING_STRATEGY~CALCULATE_BASE is not in ZCL_PRICE_ROAD's definition". An interface's method is defined in the interface, and a global interface is an object of its own, out of the class's syntax run. `parametersOf` now reads the signature from the interface - found in the class's scope or by the interface's own syntax run - and the call goes through it on the object (`zvx_object->zif_x~m( ... )`, as the name already said). End to end on a scratch interface and class: WEIGHT 1200, RATE 3 wrote RV_AMOUNT =3600. A test covers it (local-entry.test.js 6 pass). Rebuilt 0.8.17.

Then ZCL_CALC_FACADE=>MODIFIER_FOR (private, IMPORTING iv_name TYPE char30, RETURNING REF TO zif_calc_modifier) said "unknown, generic: ZIF_CALC_MODIFIER not found, lookup". abaplint gives an object reference the qualified name of its class or interface, so the call program declared `TYPE zif_calc_modifier` without REF TO, and that variable's type was unknown. `declaration` now declares a reference as REF TO (an object reference by its class or interface, a data reference by its type), and a reference is a shape of its own: not entered (a value for it fails), not written - WRITE of a reference was the next error, "Source not character like" - and seen in Variables after the call. An unknown type now says it must be among the local sources. Run end to end on the user's debugger_tests (read only; everything generated went to temp folders): MODIFIER_FOR with ZCL_MOD_FUEL ran to Done. RUN of the same class stopped at Open SQL in that script, which starts no SelecTor bridge; the extension's launch does. A test covers the reference (local-entry.test.js 7 pass). Rebuilt 0.8.17.

The user saw the call program open in the editor (it lives in %TEMP%/vertex-local-entry/<pid>/zvertex_run.prog.abap, written again at every run) and asked for it not to be shown. `instrumentProject` takes a list of sources it leaves alone, and the launch of a method or function module passes the call program: it is not recorded, so the run starts in the code it calls and the editor never follows a stop into it. What goes with that: there is no stop after the call any more, so the results are what the method shows at its own last stop and the simple ones written to Output. A test checks the call program is left uninstrumented. Rebuilt 0.8.17.

At the user's word a test function module in debugger_tests: function group ZVX_CALC with Z_VX_CALC_FREIGHT (abapGit layout - the group's XML with the parameters, the TOP and SAPL includes with their XML; .abap with LF and no BOM, .xml UTF-8 with BOM and CRLF, as the repository's own files are). It takes every kind of parameter the screen offers: a simple value, a structure (ZIF_CALC_TYPES=>TY_CONTEXT), a table (TT_STEPS), an optional value with DEFAULT 2, CHANGING, and a table as a result (TT_LOG); debugger_tests' README says so. Running it end to end found a slip of the call program: at the type check, before the shapes are known, it wrote a WRITE of every non-reference result, the table ET_LOG among them ("Source not character like"); only a result known to be simple is written now. Then: weight 1200, distance 500, AIR, two steps gave EV_AMOUNT =3602 and CV_NOTE =note: AIR: 3602. Not pulled into SAP. Rebuilt 0.8.17.

Three reports from the user on the same day.

Double-click did not follow lo_data_provider->get_shipment( ): local-navigation.js found a method's class only in `NEW zcl_x( )->m` and `zcl_x=>m`, by regular expressions over the line, and for a variable looked in the current class. It now asks abaplint's LanguageServer.gotoDefinition, which knows the variable's type (an inline DATA(...) = NEW, a parameter, an attribute); a method found at its declaration leads on to its implementation (abaplint's MethodImplementation statements), and a global class or interface named at the cursor leads to its definition. The sources are the workspace's ABAP and XML files (findFiles) and, for a file outside the workspace, its own folder's; each as the editor has it where open, else as saved; the registry is kept and a file parsed again only when its text changed. On debugger_tests: get_shipment, zcl_pricing_factory=>create, lo_strategy->calculate_base (to the interface), NEW zcl_calc_log, NEW zcl_mod_fuel all land; the first lookup takes about 1.9 s, the next about 20 ms. One test's code was not valid ABAP (run called with a parameter it does not have, lv_scenario undeclared); abaplint types nothing past such an error, so the test now uses valid code. That is a real limit: in a source with a syntax error, navigation after it finds nothing - the old regular expressions are not kept as a fallback.

The function module did not start: "open a local or SAP ABAP source tab first". `sourceObject` knew .clas/.intf/.prog/.incl names only, so zvx_calc.fugr.z_vx_calc_freight.abap kept its dots and was no object. A function group's file is now the module or include it holds, type FUNC, with its group. The panel's calling-program field is hidden for a method or module run as for a program.

A structure result was not seen after RUN of a method: with the call program unrecorded, the last stop is in the method before its last statement ran. The call program now writes every result to Output - a simple value, a structure field by field, a table row by row (a field symbol declared at the top, a row number before each). Z_VX_CALC_FREIGHT wrote EV_AMOUNT, CV_NOTE and both rows of ET_LOG. local-entry.test.js 8 and local-analysis.test.js 13 pass. Rebuilt 0.8.17.

The user: a table must be written as a table. The call program now writes a table result as a heading of its columns and a line per row, through string templates with WIDTH (checked first that the bundled transpiler formats WIDTH); a column is a simple field of the row (VALUE for a table of simple rows), as wide as its type - c/n/x LENGTH n, CHARnn, NUMCnn, 8 for a date, 11 for an integer, 20 for a string, 16 otherwise, at most 40 - and never narrower than its name. Output is a monospaced <pre>, so the columns line up. Z_VX_CALC_FREIGHT's ET_LOG came out as STEP (30) / AMOUNT / TEXT with two rows. Also explained to the user: the "incorrect ABAP" earlier was the code inside a VERTEX test, not theirs. Rebuilt 0.8.17.

Then Z_VX_CALC_FREIGHT ran from its parameter screen and said "Local ABAP completed without a recorded statement". The record is made by instrumenting each generated .mjs from its source map, and only the map's first source was read; a function group compiles into one zvx_calc.fugr.mjs from its TOP include, SAPL and modules, the first of them not the module - and with the call program unrecorded, nothing was. local-trace.js now places each generated line by source and line (`mappedPlaces`) and instruments every ABAP source of a map (`instrumentSources`), each with its own owner, routine (FUNCTION ... ENDFUNCTION counted as one) and recorded names - a module's parameters taken from its Local Interface comment, since their declarations are in the group's XML; FUNCTION-POOL and ENDFUNCTION are no steps, and the record's stack knows .fugr.mjs frames. `instrument` keeps its single-source signature. Traced the module directly: 16 stops from line 19, the first holding iv_transport, is_context, it_steps, iv_rate, ev_amount, et_log and cv_note. A test covers a two-source map. Rebuilt 0.8.17.

## 2026-10-14 — VS Code 0.8.16

Raised the VS Code extension to 0.8.16 and built it with vscode/package.ps1 from commit 5379199, the sources brought over from the other laptop. Eclipse was not rebuilt and stays 0.8.15.202610141238; README and eclipse/README now say the two numbers differ.

## 2026-10-14 — Visual Debug repairs and Formula from the record

The 2026-10-14 "fixes" commit had replaced live transpiler stepping with a full recorded run; its live mode in `local-run.js` existed but was not wired. The adapter now launches live, runs to the first breakpoint, and `step` with `live` resumes the paused process. Two stalls followed in VS Code: the page recorded the adapter's in-between picture into the timeline (now ignored while fetching), and `WRITE 1.` left the trace record on the same stdout line as the program's output (the marker is now found anywhere in the line). F8 from the editor sent `continue` to a button named `cont`.
Inline `DATA(` lines were excluded from instrumentation with declarations.
Diagram: the transpiler records no calling line, so routines were linked only from a recorded caller statement and most stayed unreachable; routines are now linked along the stack from the recorded statement above them, else from their caller - for SAP too. Methods and Statements still showed only a root on SAP: `unitOf` named the event `EVENT START-OF-SELECTION` and the stack frames `START-OF-SELECTION`; `recordedUnitKey` now drops the unit-type word. ELK draws routine frames as id-less `g.subgraph`, so the context menu reached only clusters; frames are now named after the hidden entry node inside them. Reverting the diagram block of "fixes" was tried and rejected - the reordering had worked.
Formula/Expression: a recorded run built the diagram with empty formula data, and the transpiler's Analyze flow path went to the SAP branch. The record now carries the analysis's formula and panes, the local analysis reads the workspace file, and `record-formula.js` builds Formula and Expression from the values recorded at every stop: where a value differs from the stop before, abaplint reads that statement's target and field chains, and each operand is derived the same way. A first version listed the changing statements as Expression and credited a value returned by a call to the callee's last stop; now the change is credited to the stop at the depth it is seen at (the call), the returned value is followed to the callee's variable holding the same component at its last stop, a parameter set on entry stays a name, and Expression substitutes right-hand sides from abaplint's Source pieces. Replacing the analysis's formula after a run by one written out from the record was tried and dropped at the user's word: the analysis's formula stays, with the final recorded values in brackets after its names and the total; its variants are sifted by the run - `formula(graph, keep)` keeps only definitions whose object and line the record executed (the host keeps the last analysis graph for this); modifiers that all ran still showed as `otherwise | when` alternatives, so the order of first execution per class is given to `sequence` as the pipeline (`byRun`, captioned as the run's order); the record's Expression is only for a run with no analysed path, and Formula puts the formula above the record's tree. The record's formula needed three repairs to reach that: the cycle guard is name and stop (x = x + y), reads are told from targets by position, and a value changed by a call is followed by its component to the statement that last wrote it inside the call, because the record taken before each statement never shows the callee's last result. With values also annotates the analysis's Expression names (`data-full`/`data-location` on its links) from the record, in the routine the analysis names; SAP snapshots read structure components one level down so components resolve. The record's Formula diagram hit Mermaid's 50,000-character limit: object references were written as whole JSON instances. Values now read `object`, `n rows` or `n fields` past 80 characters, diagram labels are cut at 100, and the window raises `maxTextSize`. A failed SELECT reached the program as an empty result, so a run read zeros without a word; the reason now goes to the run's Output and the VERTEX Local ABAP channel. The editor's line mark stayed on the last line after the program ended; an ended Run or step clears it. A failed SELECT reached the program as an empty result, so a run read zeros without a word; the reason now goes to the run's Output and the VERTEX Local ABAP channel. Eclipse: the analysis in its browser (eclipse/debug-analysis.js) now answers recordFormula and pathFormula; the path reading moved to vscode/value-origin-path.js so both hosts share it. Where used and Clear need a host function Eclipse lacks and stay hidden there. Built a local update site 0.8.8.20261014123330 with eclipse/package.ps1 (javac from the Eclipse JustJ JRE, bundle pool ~/.p2/pool/plugins); its jar carries the new page, frontend bundle and vertex-flow.js. Eclipse tests: 3 failures, all present before (5 before prepare.js refreshed the bundle). Not run inside Eclipse. The Eclipse feature and bundle were then raised from 0.8.8 to 0.8.15, the VS Code number, and the published update site in docs/ was exported by PDE as 0.8.15.202610141238. The last WRITE, with no line break after it, stayed in the stdout buffer and was lost at exit; it is flushed on close. The transpiler's record keeps every routine's names together, so a stop in the report listed the locals of every method it had called; Variables at a stop - live in the adapter and replayed in the page - now take only the values of stops in the same owner and routine. Opening a structure at a transpiler stop failed with "reading toUpperCase": the adapter took the variable's name from the path inside find, once per variable compared, so only the first variable could ever open. The line of run statistics was lost when the transpiler moved to live stepping; it is back, counting only the time the program ran (the adapter times each live leg). `vertex.runTranspiler` opens the same panel and runs at once (`autoRun`, not after Clear); opened that way (`runOnly`, not by Visual Analysis / Debug, which stays whole for analysis), with no active breakpoint the page hides everything but Run and Output (`vx-run-only`, re-evaluated on every picture), and the selection screen moved from the panel into a modal dialog asked on each Run. The transpiler's WRITE output was collected (`live.output`) but never shown; the panel now has an Output section, filled from Run and every live step. Following became a list (`followed`): a structure expands to its components (changed in the record, else declared), a select on the chip and at the left of the diagram toolbar switches the chosen value, and the analysed path is cached per value and point (`flowByValue`). Three tests were given the new globals. A record replaced the analysed path as soon as it had one step, so a run paused before RUN showed three statements; the analysed path is now drawn whenever there is one, and branches are sifted by the run only once it is over. Choosing in the list redrew the diagram only with a record, and the slice that arrives for a newly chosen value wrote into the previous value's cached path; the choice and the slice now redraw, and a value not yet analysed starts from a copy. Names of the record's formula and tree, and the formulas of the analysis's Formula tree, are links to their statement; the separate </> buttons are gone. The Formula tree drops a node that leads to the same code as its only child, or a parameter whose call is already shown above it: three levels per modifier became two, and Expression is still written from the whole tree. Visual Debug covers both analyses (Analyze flow path, Where used), so at the user's word the command became "VERTEX: Visual Analysis / Debug" and `vertex.valueOrigin` / `vertex.backwardUsage` were taken out of the editor menu and the palette; they stay registered, since Where used runs the backward one. In the transpiler panel the breakpoints are VS Code's, but the page heard of them only with a debugger event, so a point set in the editor did not show and Analyze flow path asked for a second one; `onDidChangeBreakpoints` now republishes the picture. Analyze flow path no longer needs a second point: with none met it runs to the end of the flow. Opening the panel again for the same object set the same HTML, which VS Code does not reload, so the old diagram stayed; each opening is now marked to load anew, and a Clear button starts the panel again for its object. Opening Visual Debug replaced the page but kept the old adapter's paused transpiler process, the last Node debug variables, the history mark and the host's last analysis graph; these are now dropped on open (`dispose`, `forgetOrigin`), while a live SAP session and the breakpoints stay. Bounding the editor's analysis by breakpoints again was discussed and dropped: bounded analysis stays in Visual Debug, where a point now also offers Where used - the docked panel opens the point's line, runs `vertex.backwardUsage` with the chosen value as an argument (the command now takes one; from the editor it still reads the cursor). A notice that Rec steps cannot give a formula was proposed and rejected: without values the last executed statement that writes the value is its definition, read the same way. Steps & values therefore reads values at every SAP stop instead of at routine starts and ends, and adds globals in report events.
Verified against a real transpiler run of `ZVERTEX_DEBUG_LAB` (Node harness and the real page in a browser with a stubbed host); four record-formula tests added. Not run against a live SAP system in this landing. The remaining 11 Visual Debug test failures predate it; two tests were adjusted to load the new key helpers, and one now expects a routine to be entered from the recorded calling statement.
The recorded-run slider `#fslide` set only `accent-color`, so its track stayed native white in a dark theme; it now uses the `.diagram-zoom` track and thumb from theme variables. `log-report.js` reads `resources/log-report.html`, which had been written into the git-ignored `vscode/resources/` and never committed, so packaging failed its check; the page was rewritten in `org.vertex.abap.ui/resources/`, where `copy-pages.js` takes it from. The BSE slice (`.bse-operation`) lost its 12% green fill, which read poorly on dark themes, and its green bar; only the statement link (`.code-location`) is green with no chip background, in every theme, not the fold arrow; the Depth control on the root caption keeps its own colours. Variables marks a chosen row (`tr.chosen-row`) with the same green text instead of the selection background.

## 2026-10-12 — Local transpiler launch prototype

Added a VS Code local-run module that finds a project configuration or generates one under the OS temporary directory, invokes a project CLI when present or VERTEX's bundled CLI, and launches a selected report or the ABAP Unit entry point in a terminal or the Node debugger. The extension bundles the CLI and runtime, staging runtime files beside generated output when the project does not install them. Open Visual Debug uses a local panel with a radio choice from the same parser as Value Origin, applies that choice to transpiled variables, and starts a Node debug session. A real report transpiled and printed 5 locally; a radio-button choice changed the actual result.
Added the serverless ABAP Unit CI use case to user documentation. The user-supplied abap-unit-runner-ci reference was checked and requires a SAP endpoint, so the no-SAP example points to open-abap-core's Node pipeline instead.

## 2026-10-12 — Package analysis progress and local cache

The shared Metrics/UML webview now shows a live spinner, stage, processed/total objects and elapsed time. The frontend analysis yields before synchronous diagram and metrics construction so the status can paint. VS Code local package sessions keep one analysis API object to reuse the frontend parser cache across UML/Metrics requests and invalidate on document-version changes. Focused analysis-progress and local-analysis tests: 24 passed. A local 17-object folder measured about 3 s for a cold UML request and 4 s for subsequent Metrics; no previous-build baseline was available.
Built Eclipse update site 0.8.8.20261012135444 and verified VS Code VSIX 0.8.10 after shared resource preparation.

## 2026-10-12 — VS Code session log viewer

Added a sidebar scroll button and a report webview that reads the configured `claude_compatible/*.jsonl` files. The parser groups human prompts with model usage, answers and tool records, skips tool-result continuations as prompts, and deduplicates model message IDs. The report uses VS Code theme variables and DOM text insertion for log content. Focused tests cover parsing, token totals, button registration and the report panel.
Verified eight focused tests and the report script syntax. Rebuilt VS Code 0.8.10; the VSIX archive verification includes the new report module and page.

## 2026-10-12 — Metrics method navigation

Passed `beside` and `preserveFocus` from Metrics source links to the existing VS Code source bridge. Package tables also supply the row's object name and type, retained through sorting. A focused test checks a qualified interface method in a package table.
Verified 13 focused tests and rebuilt the VS Code 0.8.10 VSIX; package validation passed.

## 2026-10-12 — VS Code UML side-by-side source

UML method clicks send `beside` and `preserveFocus` through the existing source bridge. Both the local file navigator and the SAP source navigator honor these options; the latter also moves a source already visible in the UML group to the adjacent editor group. Focused tests cover both paths and the click payload.
Verified 12 focused tests and rebuilt VS Code 0.8.10; the VSIX archive passed packaging checks.

## 2026-10-12 — Interface methods in UML class cards

Extended the shared frontend declaration graph to collect qualified `METHOD interface~name` implementations alongside directly declared methods. Verified the result against the `debugger_tests/src` package: all `ZCL_MOD_*` classes show `APPLY` and `NAME`, and `ZCL_PRICE_ROAD` shows `CALCULATE_BASE`. A focused test also preserves private declared methods.
The previous UML link binding only covered Mermaid's `g.classGroup` renderer; the visible cards use `g.node` with a `.classTitle`. Linked both forms, added a renderer-variant test, and rebuilt VS Code 0.8.10 and Eclipse update site `0.8.8.20261012130953`.

## 2026-10-12 — UML method navigation

Marked Mermaid UML method labels as keyboard-accessible source links and routed them through each host's existing source navigation bridge. Both VS Code and Eclipse now fall back to method declarations for interfaces. A focused test checks class and interface link targets.
Verified the focused VS Code analysis and UML tests (21 passed), packaged VS Code 0.8.10, and built Eclipse update site `0.8.8.20261012125919`.

## 2026-10-12 — Direct assistant tool logging

The VS Code chat already logged user and assistant messages through `session-log.js`, but direct provider `callTool` handlers bypassed its tool wrapper. Added an adapter around the existing `codeTools.execute` that emits Claude-compatible `tool_use` and `tool_result` entries while preserving return values and errors. A focused test verifies linked IDs and source redaction.
Follow-up: direct Anthropic, compatible API and Copilot adapters call `onModelCall` for each model round, so `chat.js` logs every observable round in the common JSONL schema instead of only the final answer. The CLI subscription adapters still expose only a VERTEX invocation aggregate. Added a native folder picker in LLM Providers and a command link in the log path setting, with tests for per-round callbacks and folder selection.

## 2026-10-12 — Package Metrics object toggle

Added a bulk toggle to the shared metrics page's package object section. It opens all object details when any are closed and closes all when every object is open; its label and accessibility state follow individual details changes. Verified embedded page syntax and analysis tests.
Built VS Code 0.8.10 and Eclipse update site `0.8.8.20261012123230`; both package archives completed successfully.

## 2026-10-12 — API token accounting

The compatible API adapter previously passed `prompt_tokens` and `completion_tokens` through unchanged, while chat.html reads `input_tokens` and `output_tokens`, displaying zero. Normalize usage on every response, subtract cached prompt tokens from uncached input, and sum all rounds of a tool-using answer. A Mistral-style two-round test verifies the totals.

## 2026-10-12 — Local folder as package

Added a VS Code Explorer command that gathers `.abap` files recursively, reads current editor buffers, and supplies the objects to the existing package UML and metrics frontend. Local package source links resolve to the gathered documents. A focused test covers two classes in nested folders and excludes files outside the selected folder. Rebuilt VS Code as 0.8.10.
Follow-up: source lookup caches by object type and name and prefers the active file's directory before other workspace files. A recursive package scan rejects duplicate type/name pairs across folders so a graph link cannot silently target another package. Focused tests cover both cases.
The package command now opens a native folder picker when invoked without an Explorer URI. This covers custom Explorer views that do not expose the standard folder context menu. A command test checks the picker and UML initialization.
The generic VS Code Tools page now offers Local Folder in its type selector, invokes the host folder picker, binds a local analysis session to the existing window and enables source links. A Browse button permits repicking; switching back to an SAP type clears the local session. The option is injected only when the VS Code bridge is present, keeping Eclipse's shared Tools list unchanged.

## 2026-10-12 — Mermaid edge limit in both hosts

The shared `vertex-flow.js` renderer and the Value Origin page initializer still used Mermaid's 500-edge default, while `metrics.html` and Visual Debug already set 100,000. Set 100,000 in the missing initializers and added a generated-page regression check. The shared script is packaged for VS Code and included in Eclipse resources.
Eclipse Tools now initializes from the active ADT editor when its secondary view ID has no object, and follows a newly activated editor if the window is still empty. Built the Eclipse update site as `0.8.8.20261012112215`; Java compilation and archive verification passed. The update site was not copied to `docs/`.

## 2026-10-12 — Local ABAP navigation and analysis

Bound Tools context commands to the active local ABAP document and supplied its current text to the existing abaplint-based frontend analysis. Added local source resolution for related class files and diagram links; version history is explicitly unavailable for local files. Editor Outline, Go to Definition and Back now work on local source. Forward usage loads local source and workspace dependencies through the existing demand-based pipeline. Backward usage scans local workspace calls and parses matching files; the scan is textual, so ambiguous calls can require inspection. Rebuilt VS Code 0.8.10 locally; Eclipse unchanged.

## 2026-10-12 — VS Code 0.8.10 local rebuild: bulk model toggle and local ABAP context

The LLM Providers webview now offers a stateful Clear all / Select all button above each loaded model table. It updates the provider's in-memory row state and visible checkboxes without reloading model data. The existing save validation remains in force. The chat supplies up to 24,000 characters of active local ABAP source, including unsaved edits. With no SAP system configured, SAP tool schemas are withheld, and Codex does not receive the MCP server. The version is locally rebuilt as 0.8.10 at the user's request; Eclipse unchanged.

## 2026-10-12 — Named API key profiles

Added per-provider key profile metadata and separately stored secret values, with active-profile selection in LLM Providers. Existing scalar keys are exposed as `DEFAULT` without migration or reentry. Chat model loading and API requests use the active profile; changing it invalidates the model cache. Targeted tests cover separate keys, manual selection and legacy-key compatibility. VS Code moves to 0.8.12; Eclipse unchanged.

## 2026-10-12 — OpenAI-compatible providers and model-list folding

Added fixed HTTPS endpoints corresponding to the seven OpenAI-compatible providers seeded by ABAP-AI-Code's `Z_ABAP_AI_KEYS`. The VERTEX chat lists provider models, sends requests with private SAP function tools, and reads each key from SecretStorage. LLM Providers shows a separate expand/collapse button and key action for each API provider. Manifest and lockfile move to VS Code 0.8.11; Eclipse build metadata remains unchanged.

## 2026-10-12 — Copilot Language Model adapter for VS Code 0.8.10

The built-in VERTEX chat now lists signed-in Copilot models through `vscode.lm.selectChatModels`, sends its existing context, runs private SAP tool calls and accepts a structured navigation plan or plain answer. Added provider configuration and adapter tests. VS Code manifest and lockfile move to 0.8.10; the Eclipse host is unchanged. The current Marketplace README begins Getting started without the unrelated source-navigation text shown in an older screenshot. Removed the redundant ABAP registration sentence and optional SAP ADT prerequisite paragraph from that section.

The first live Copilot request revealed that `vscode.CancellationToken.None` is undefined. Replaced it with a per-request `CancellationTokenSource`, disposed after the tool loop, and tightened the adapter test to require a real token argument. Repacked the local 0.8.10 VSIX with the corrected adapter.

## 2026-10-12 — Implementation targets and tab reuse

The ADT foreign-definition fallback returned METHODS for chained instance calls. It now recognizes the method invocation at the cursor, reads assembled class source and targets METHOD; an unavailable implementation does not silently substitute the declaration. Navigation closes only the active clean source tab before opening the destination as preview, and Back uses the same policy. Unsaved tabs are preserved. Regression covers NEW-to-method navigation with ADT pointing to its declaration.

## 2026-10-12 — Keep development reports in histories

Cleaned repository, Marketplace and landing-page documentation of local rebuild narratives and implementation-fix reports. Reorganized VS Code setup under Getting started. Replaced Eclipse's accumulated changelog sections with current feature and installation descriptions; the original notes are archived in history.md. Runtime sources unchanged.

## 2026-10-12 — VS Code ABAP recommendation

Added .vscode/extensions.json with larshp.vscode-abap in recommendations at the user's request. Updated repository, Marketplace and landing-page documentation with the optional companion link without making it a runtime dependency.

## 2026-10-12 — Welcome command and command palette cleanup

Registered vertex.getStarted to open the extension's vertex.start walkthrough. Hid generated launcher/debug view focus and container commands through commandPalette visibility conditions, preserving panel access. Removed the redundant title prefix on the categorized MCP command. Reset VS Code manifest and lockfile to 0.8.9 at the user's request; Eclipse metadata unchanged.

## 2026-10-12 — Rebuild VS Code as 0.8.10

Bumped the extension manifest and lockfile root versions from 0.8.9 to 0.8.10. Sixteen tests covering the extension host, assistant invocation/detection, ABAP language declaration and ADT Discovery passed. The reported 0.8.9 error was not specified, so this landing is a rebuild rather than a diagnosed runtime correction. Eclipse metadata unchanged.

## 2026-10-11 — Shared Welcome information actions

Generalized the MCP information action across all four walkthrough steps. Each Info button opens only its corresponding packaged Markdown page in VS Code preview. The host test invokes all four actions and verifies their preview paths; targeted tests passed. Native walkthrough buttons inherit VS Code theme styling.

## 2026-10-11 — Combined MCP registration and Welcome information

Removed the separate debugger choices from the assistant picker. The clipboard contains two Codex TOML sections or two Claude commands, retaining separate server names and endpoints. Updated the cancellation and clipboard regression checks. Added a Welcome information link that opens the packaged MCP walkthrough in Markdown preview with capabilities and setup instructions. Eclipse unchanged.

## 2026-10-11 — Detect standalone Codex CLI

Inspected the installed npm wrapper and platform package: its native executable is under `vendor/x86_64-pc-windows-msvc/bin/codex.exe`, rather than the older `codex/` subdirectory. Added the bin layout for each candidate package and a Windows APPDATA/npm fallback. Verified locate() returns the installed executable without launching it; twelve targeted tests passed.

Extended the Claude native CLI fallback to Codex. A PATH directory is checked for the native executable and for Codex vendor binaries in legacy and platform-specific global npm layouts, including nested optional dependencies. The executable is launched directly with the existing argument and isolation handling, without invoking npm shell wrappers. Regression tests cover native Windows and three npm layouts.

Local VSIX 0.8.9 rebuilt with Claude availability checked before loading models in settings. The packaging wrapper verified dependencies, archive contents and packaged Scheme navigation. Fifteen targeted tests passed. The broader suite recorded 457 passes and 30 failures; live VS Code/SAP verification remains pending.

## 2026-10-11 — Register ABAP for the 0.8.9 VS Code build

Claude detection previously required `anthropic.claude-code` even if the native CLI was installed separately. Added a native executable fallback through PATH and the standard ~/.local/bin directory when the extension is absent. Tests exercise both locations without depending on installed software and retain the existing assistant invocation checks (ten tests passed).

The assistant's `ZV*LAB` search resolved one object and opened a document, but `setTextDocumentLanguage(document, "abap")` failed because the manifest declared ABAP breakpoint support without declaring the language. Added a language contribution with the ABAP aliases and `.abap` suffix, covering the existing source and draft paths without swallowing editor errors. Added a manifest regression test and bumped the VS Code manifest and lockfile to 0.8.9. Eclipse metadata unchanged.

## 2026-10-11 — Correct ADT Discovery content negotiation

The connection-test screenshot showed HTTP 406 with `application/atomsvc+xml` as the accepted type. The extension's HTTP helper defaulted to JSON for every resource, including discovery used by connection checks and CSRF-token retrieval. Discovery paths now select Atom service XML, including requests with a sap-client query; other resources retain JSON and explicit headers still override the default. The regression test simulates a server rejecting the wrong Accept type and checks both discovery uses and the other-resource default. Three targeted tests passed; no package was built or live SAP check performed.

## 2026-10-11 — Align MCP setup with the ADT reader

Checked `mcp/sap.js`: the logical `/vertex/review/` request is handled by `vscode/review-front.js`, not sent to a custom SAP resource. Corrected Eclipse Copilot prerequisites and troubleshooting, added `npm ci` in `vscode/`, replaced the obsolete standalone architecture diagram, and aligned the repository, Marketplace and update-site descriptions. Documented saved `ZAVE_REVIEW` reads and the unsaved review built from ADT history when no saved review exists. Documentation only; no packaging or host version change.

## 2026-10-10 — Eclipse live debug editor navigation

The Eclipse Visual Debug host called `sdeReveal` after every native stop, causing repeated class editor openings while ADT was already navigating the active frame. The live-stop callback now updates the Visual Debug page without reopening the editor. Explicit links retain ADT navigation. The host regression test asserts that a stop records its picture and makes no editor-open call.

SelecTor field labels now share a remembered Technical names / Text preference. It changes Selection labels and table/join/pivot result headings without changing query field keys or selection values, using the canonical segment toggle.

Forward Usage Analysis now passes an explicit selected-value flag into the shared flow UI. With no variable selected, native disabled buttons prevent entering Formula, Expression or BSE; FLOW and Full remain available.

## 2026-10-09 — VS Code 0.8.8 breakpoint gutter markers

Follow-up: restored tabs used fileEntry metadata without a live document reference, so native mirroring still skipped them after reload. Synchronization now attaches workspace and visible editor documents before matching points. A regression test restores a class tab in a fresh extension host and verifies the marker and removal from SAP.

Visual Debug and MCP points were present in SAP but missing from editor gutters because only native VS Code points supplied editor markers. The first fix used decorations, which could not be removed by clicking. The workbench now mirrors SAP points into native SourceBreakpoints and maps their IDs back to SAP. Mirrored add/remove events are suppressed to prevent feedback; user removal clears SAP. State, conditions and logpoint mode are refreshed from the debugger, with system filtering. The regression test covers mirroring, disabled/log state and user removal without duplicate SAP writes. Packaging verifies abap-adt-api and abaplint.

How SelecTor got out of SAP GUI and into two editors, in the order it actually happened —
including the wrong turns, because those were the expensive part.

The work spans three repositories: the ABAP backend in
[Simple-Data-Explorer](https://github.com/ysichov/Simple-Data-Explorer), this frontend, and later
`AVE` and `ACE` as further backends.

---

## Stage 0 — checking the premise

The starting point was an outside analysis claiming SDE could be rebuilt as an Eclipse plugin or a
VS Code extension. Most of its architecture was right; the estimates were not.

Measured against the actual code rather than taken on faith:

- It named `ZCL_SDE_SQL` as "the dynamic reading class". That class is 62 lines — a `SELECT *
  FROM (name)` wrapper and three existence checks. The real logic lives in `ZCL_SDE_TOOLS` (3054
  lines) and `ZCL_SDE_SEL_OPT` (738).
- It measured the job as "rewrite the UI". The expensive part is elsewhere: `ZCL_SDE_TABLE_VIEWER`
  is not a table, it is a field-catalogue model — F4 helps, ALPHA conversions, units, currencies,
  domain texts. None of that exists in a browser.
- It was right about one thing that mattered a lot: the pivot and the join builder already render
  through `CL_GUI_HTML_VIEWER`. `ZCL_SDE_PIVOT` has zero `CL_GUI` references and returns
  `rv_html`.

**Lesson.** Measure the codebase before believing an estimate about it. Two greps changed the plan.

---

## Stage 1 — the ABAP side: a custom ADT REST resource

Target system: S/4HANA 2023, `SAP_BASIS 758`. All prerequisites present.

The route chosen was an ADT REST resource rather than a plain ICF service, because
`CL_ADT_RES_APP_BASE` inherits `CL_REST_HTTP_HANDLER` and its `get_static_uri_path()` returns
`/sap/bc/adt` — so the resource attaches to the node ADT already owns. No SICF node, no
authentication of our own, no CSRF handling.

Two classes and one BAdI implementation. The classes took minutes. The registration took an hour.

### What went wrong, in order

**The wrong BAdI.** Spot `SADT_REST_RFC_APPLICATION` contains both `BADI_ADT_REST_RFC_APPLICATION`
and `BADI_ADT_DISCOVERY_PROVIDER`. Implementing the second one activates cleanly, adds
`INTERFACES IF_ADT_DISCOVERY_PROVIDER` to your class (a missing implementation is only a warning),
and the route 404s. Verified afterwards with `SELECT * FROM enhobj WHERE enhname = '...'` — the
`INTF` row must read `IF_ADT_REST_RFC_APPLICATION`.

**The filter is mandatory.** Leaving it empty fails activation with one "active simultaneously"
conflict per existing implementation — 134 of them — because an empty filter claims every URI.

**The filter value is the full path.** Reading
`CL_ADT_REST_REGISTRATIONS=>get_all_adt_registrations` suggests filters are ignored: it takes every
implementation and calls `fill_router` on each. That method is a dev-time listing. The dispatcher is
`CL_ADT_WB_RES_APP` → `CL_ADT_RES_APP_ACCESS` → FM `SADT_CREATE_APPL_REST_RESOURCE`, which does
`GET BADI ... FILTERS static_uri_path = i_uri` with the complete request path. So the value is
`/sap/bc/adt/zsde/*` with `CP`, not `/zsde/*`.

**`CP` looks absent in SE19.** The filter dialog is laid out as an interval,
`Value1 <Comp1> Filter <Comp2> Value2`, and Comparator 1 offers only relational operators. Entering
the condition in the right half stores it as `COMPARE = CP`. Confirmed against SAP's own
registrations: `SELECT ... FROM badi_string_cond WHERE filter_name = 'STATIC_URI_PATH'` shows
`/sap/bc/adt/bopf/*`, `/sap/bc/adt/ato/*` and friends, all `CP`.

**Lesson.** When a framework has two code paths reading the same registration, find the one that
serves requests. Reading the wrong one cost most of that hour.

The recipe is written up in `ADT.md` in the backend repository.

---

## Stage 2 — real data

`GET /sap/bc/adt/zsde/table/T001?rows=100` returning rows plus a field catalogue as JSON.

`CL_ADT_REST_JSON_HANDLER` turned out unusable: it serializes through a Simple Transformation named
at construction, and an ST is statically typed, so it cannot describe a structure known only at
runtime. `/UI2/CL_JSON` builds from RTTI instead, returned through
`CL_ADT_REST_PLAIN_TEXT_HANDLER` constructed with `content_type = if_rest_media_type=>gc_appl_json`
— that handler takes the content type as a constructor parameter, so no extra ST object was needed.

The catalogue is one call: `cl_abap_structdescr->get_ddic_field_list()` returns key flags, DDIC
types, lengths and field texts together.

Deliberate gaps, stated rather than hidden: no conversion exits (values arrive as stored), transparent
and cluster tables only, no paging. A missing table answers a real 404 instead of an empty result,
because `ZCL_SDE_SQL=>READ_ANY_TABLE` silently returns nothing for an unknown table.

**Volume, measured rather than guessed:** `TADIR?rows=10000` came back in 2–3 seconds. Accepted.
Worth remembering that roughly half that payload is field names repeated on every row, and that
2–3 seconds is a page-load budget, not a keystroke budget — reactive filtering needs a small page.

---

## Stage 3 — the Eclipse plugin

The toolchain was almost complete already: ADT installed (275 `com.sap.adt` bundles), Eclipse on its
own bundled JustJ JRE 21. Missing: PDE — the "for Java Developers" package does not include it.
One install from the release update site, no new IDE, no JDK.

There is no separate ADT SDK. The installed ADT bundles *are* what you compile against, and PDE uses
the running Eclipse as its target platform.

### Three steps, one risk each

1. **A view that opens.** A `ViewPart` showing a label. Proves PDE, the manifest, the extension
   point and the runtime launch — nothing else.
2. **An SWT Browser loading the URL.** Proves the data arrives. `SWT.EDGE` pinned deliberately:
   the default on Windows may be the legacy IE control, which cannot run the intended front end.
3. **Reusing the ADT session.** No login dialog at all.

### Talking to ADT

The API has no public documentation, so it was read off the bundles with `javap` from the p2 pool.
That technique — `unzip -l` for classes, `unzip -p ... MANIFEST.MF` for exports, `javap` from the
JustJ JRE for signatures — replaced every guess for the rest of the project.

```java
IProject project = AdtProjectServiceFactory.createProjectService().getAvailableAbapProjects()[0];
String destinationId = project.getAdapter(IAdtCoreProject.class).getDestinationId();
IRestResource r = AdtRestResourceFactory.createRestResourceFactory()
        .createResourceWithStatelessSession(URI.create("/sap/bc/adt/zsde/table/T001"), destinationId);
r.addContentHandler(new JsonContentHandler());
String json = r.get(new NullProgressMonitor(), String.class);
```

The URI is relative to the system root. A content handler must be supplied — ADT's own
`PlainTextContentHandler` sits in a non-exported package, so `JsonContentHandler` implements
`IContentHandler<String>` here. Declaring `application/json` matches a response sent as
`application/json;charset=utf-8`.

These packages are exported with `x-friends` naming only SAP bundles, so the compiler reports
*Discouraged access*. That is a warning, and abapGit's ADT plugin depends on them the same way.

---

## Stage 4 — three failures worth recording

**An invalid escape sequence.** A `\\` collapsed to `\` while writing a file, and `"<\/"` is not
legal Java. Two remote guesses failed to find it; one line from the **Problems** view found it
immediately. Since then the Java sources avoid backslashes entirely — single quotes in generated
HTML, `" | "` instead of newline escapes — and every write is checked with `grep -c '[\]'`.

**The WebView2 deadlock.** `SWTException: Waiting for Edge operation to terminate timed out`. A
`BrowserFunction` callback runs inside the WebView2 message pump; the HTTP request and a modal logon
dialog were sitting in it. The fix is the whole architecture of the bridge:

```
JS  sdeLoad(name, rows, query)  →  host queues the work and returns at once
host, outside the callback      →  logon, request, result into a field
host browser.execute("sdeReady()")
JS  sdeReady() → sdeTake()      →  takes a string already in memory
```

`sdeReady()` takes no arguments on purpose, so no data passes through a JavaScript literal and
nothing has to be escaped. This accident turned out to be the reason the page later ported to VS
Code unchanged — a webview cannot call its host synchronously either.

**Views stacking instead of splitting.** `showView` puts each new instance in the same part stack,
where it hides behind the current tab; after eight clicks there were eight invisible tabs. Splitting
needs the E4 model, and a 3.x view sits in the perspective as an `MPlaceholder` while the `MPart`
itself is shared — so it is the placeholder that has to move. `findPlaceholderFor` exists for
exactly this.

---

## Stage 5 — filters

Passed as indexed query parameters, one part per parameter: `f1`, `s1`, `o1`, `l1`, `h1`. Nothing is
packed into a separator-delimited string, so a colon in a `TIMS` value cannot break the request.

Structured rather than a raw WHERE string, for one concrete reason: `ZCL_SDE_SQL=>READ_ANY_TABLE`
catches `CX_SY_DYNAMIC_OSQL_SYNTAX` with `#EC NO_HANDLER`. A malformed condition would return an
empty table and no complaint, and a user who mistyped a field name would conclude there is no data.
Passing the parts separately lets the resource answer 400 with a sentence.

Semantics are real select-options: lines for one field are ORed, an excluding line becomes
`AND NOT`, different fields are ANDed — matching `ZCL_SDE_SEL_OPT`, so moving the real select-options
across later needs no rework.

The client field is dropped from the catalogue by data type `CLNT` rather than by name, which covers
the same cases as the GUI version plus tables where it is called something else.

---

## Stage 6 — VS Code

### Pilot one: portability, on a stub

Before writing a second host in earnest, the cheapest possible question: does the page run in a
webview at all? A ~130-line extension in plain JavaScript, no `npm install`, no build step, serving
the very same `resources/table.html` from the Eclipse plugin's folder and answering with fabricated
rows.

The stub did one deliberate thing beyond returning data: it sent the query the page had built back
as a visible row, `query: f1=bukrs&s1=I&o1=EQ&l1=0001`. So the run proved not only that the grid
renders, but that the selection panel reaches the host with everything intact.

It rendered unchanged. That settled the architecture: the page knows nothing about SAP, and only the
host is written twice.

The shim is fifteen lines, and it fits because of an accident. `sdeLoad` never returned a value —
that shape was forced by the WebView2 deadlock in stage 4 — and a webview cannot call its host
synchronously either. The contract the Edge bug imposed is exactly the one VS Code requires.

### Pilot two: removing the stub

Then the real connection, and this is where the time went — none of it in the code.

**The settings were invisible.** `selector.*` only registers when the extension runs, so searching
for it in the development window finds nothing. The extension lives in the second window, the one
titled `[Extension Development Host]`.

**`Ctrl+,` did nothing** — the focus was inside the webview, which swallows the keystroke. The
command palette route works: `>Preferences: Open User Settings (JSON)`.

**JSON needs its commas.** Settings inserted at the top of `settings.json` need a trailing comma;
the instructions had assumed the bottom.

**The certificate had expired.** Not self-signed — expired. Node refuses, correctly. The answer was
an explicit `selector.allowInsecureCertificate`, off by default, whose error message names it: the
check is disabled by a deliberate act, not bypassed quietly.

**`Response is not JSON:` with nothing after it.** The body came back empty on a 200, and the
message truncated because there was nothing to show. An empty 200 is not success, so the host now
reports the status with `content-type`, `content-length` and `location` — it never recurred, but the
diagnostic stays.

**The extension host itself was the worst of it.** It launches with every installed extension
enabled; one of them called `process.exit()` in a loop, drowning the log, and it was never clear
which of two identical-looking windows was which. `--disable-extensions` in the launch configuration
made the runtime clean and, as a side effect, told the windows apart — the notice *"All installed
extensions are temporarily disabled"* only appears in the right one.

In the end the second window was removed from the loop entirely: a directory junction from
`%USERPROFILE%\.vscode\extensions` to the repository folder makes it a normally installed extension,
edited in place and reloaded with *Developer: Reload Window*.

### What the host is

About 200 lines, no dependencies: settings for the system, the password in the OS credential store
via `SecretStorage`, a plain `https` request. A 401 discards the stored password and says so,
because a wrong password kept in the store would block every later attempt with no visible way out.

Real `SCARR` data arrived with Ukrainian column headers, where Eclipse had shown English ones — the
DDIC texts follow the logon language, and basic auth uses the user's own while the ADT session uses
the project's. A small thing, but it confirmed the catalogue really comes from the dictionary.

What Eclipse gives free — the session — has to be built here. What needed E4 model surgery in
Eclipse is one argument in VS Code: `ViewColumn.Beside`.

---

## Stage 7 — one page, two hosts

The palette moved into CSS variables with three selectors, because the hosts report the theme
differently: `:root` for light, `prefers-color-scheme` for the OS (which is what the browser inside
Eclipse reports), and `body.vscode-dark` / `.vscode-light` for VS Code, winning over `:root` by
sitting closer to the content.

---

## Stage 8 — launching from the object

Right-click an ABAP object → **AXE** → a service. Two adapter facts, both non-obvious, and both
found by reading the bundles:

- The menu entry appears with `<adapt type="com.sap.adt.tools.core.IAdtObjectReference"/>`, but in
  the handler `IAdaptable.getAdapter` returns null for exactly those selections. It does not consult
  registered adapter factories; `org.eclipse.core.runtime.Adapters.adapt` does.
- The selection is an ADT tree node. It yields the object, but does **not** adapt to `IProject`. The
  project comes from `com.sap.adt.project.IProjectProvider.getProject()`, which the nodes implement
  through `IAbapRepositoryBaseNode`.

The project matters because it decides which system answers. Two windows opened from two projects
showed `A4H` and `EXX` side by side — which is the point.

Per-instance state travels in the view's **secondary id**, because that is the only thing Eclipse
restores when it recreates views after a restart.

---

## Stage 9 — metrics: the second backend

VERTEX is one frontend for three ABAP tools: SDE for data, ACE for code, AVE for versions and
review. Only the first had a way in. Metrics were picked as the first slice of the second, because
they need no write, no history and no diff: if it broke, there would be one reason.

### Reaching ACE without SAP GUI

`ZCL_ACE_METRICS=>CALCULATE` does not take an object name. It takes the parse result, and that
lives in `ZCL_ACE_WINDOW`, which has thirty `CL_GUI` references and is built by `ZCL_ACE`'s
constructor before anything else happens. Instantiating the orchestrator inside an HTTP request
was never an option.

The way through is one class-method that nothing in ACE advertises as an entry point:

```abap
DATA ls_source TYPE zif_ace_parse_data=>ts_parse_data.
zcl_ace_parser=>parse( EXPORTING i_program = lv_program i_include = lv_program
                       CHANGING  cs_source = ls_source ).
DATA(ls_result) = zcl_ace_metrics=>calculate( is_parse_data = ls_source
                                              i_program     = lv_program ).
```

`ZCL_ACE_PARSER` has no `CL_GUI` reference at all and fills the structure through a CHANGING
parameter. It also instantiates `ZCL_ACE_PARSE_CALLS_LINE`, which is what fills `TT_CALLS_LINE` —
the table of unit boundaries the metrics read to find methods. So the whole parse the metrics need
happens without a window, and the three statements above are the entire backend.

**`i_program` and `i_include` are not the same argument.** Every caller inside ACE passes the same
value for both, and for a class that is wrong here: a class pool holds nothing but `INCLUDE`
statements, the method bodies live in its `CM` includes, and `CALCULATE` aggregates
`tt_progs WHERE program = i_program`. Parsing each include *under the pool* — include the include,
program the pool — is what makes the methods of a class add up to one object.

### One prefix for three backends

The route was attached to the existing application class rather than to one of its own:

```abap
router->attach( iv_template      = '/zsde/metrics/{name}'
                iv_handler_class = 'ZCL_SDE_ADT_RES_METRICS' ).
```

A second prefix would have meant a second BAdI implementation and a second `STATIC_URI_PATH`
filter — the hour that stage 1 cost. One frontend spanning three backends does not need three
registrations; the path prefix is not the identity of the service.

### What went wrong

**The system includes.** `D010INC` returns `<SYSINI>` alongside the real ones, so `SYSTEM-EXIT` and
`%_CTL_END` arrived as code units of the object under measurement, and were counted into its
totals. ACE never meets this because it selects `CM%` for a class; the general query does not.
An angle bracket cannot occur in a repository object name, so that is what the skip tests.

Nothing caught it. The syntax check passed, the local lint passed, the stub run passed — the two
rows were seen on a screenshot of the finished view.

**A linter arguing with itself.** The first lint run reported parser errors on `IF`, `LOOP`,
`APPEND` — statements that plainly exist. The source had been HTML-escaped in transit, so the
linter was parsing `&lt;&gt;` where the code has `<>`. Five lines containing one `<>` and one `&&`
separated the tool from the code in a single run.

**Lesson.** When a check reports something impossible, check the check. And a screenshot of the
real thing still finds what three green checks miss.

### The page

`resources/metrics.html` keeps the host contract of `table.html` unchanged — `sdeLoad`, `sdeTake`,
`sdeReady` — so the fifteen-line VS Code shim covers it as it stands. It was run against a stubbed
host before Eclipse ever saw it, the same order as the VS Code pilot in stage 6: the page first,
the connection second.

`MetricsView` stopped being a label and became a second copy of `SelectorView`'s transport half.
Two copies is where a base class is proposed and not yet written; the version explorer would make
it three.

### The contract for what comes next

AVE renders finished HTML in ABAP, and porting that as it stands would have been the cheap way in.
It was rejected: a review is hundreds of approve/decline clicks, and returning a page per click
recreates the document every time — scroll position, collapsed groups and filter state included.
AVE has ABAP code whose only job is to restore the scroll position, which is the same cost paid
from the other side. Measured in SAP GUI, one approve takes one to two seconds.

So the ABAP will return hunks and metadata as JSON and the page will render them, on the browser
port of AVE's own diff algorithm that already exists in `html_simulator`. Saving leaves the click
path, which makes an explicit unsaved indicator mandatory: a green tick over a failed write is
exactly the silent success this project keeps refusing.

---

## Stage 10 — versions: the third backend, and the easy one

AVE was expected to be the hard port and turned out to be the easy one. Where ACE keeps its parse
result inside a window object with thirty `CL_GUI` references, AVE's whole version layer is
already free of the GUI — the object handlers, the version directory reader, the version itself,
the author resolver and, importantly, the diff engine. Not one `CL_GUI` between them.

So there was no way *in* to find. There was a published contract to call:

```abap
DATA(lo_object) = NEW zcl_ave_object_factory( )->get_instance(
                      object_type = 'CLAS' object_name = lv_name ).
DATA(lt_parts)  = lo_object->get_parts( ).
DATA(lo_vrsd)   = NEW zcl_ave_vrsd( type = ls_part-type name = ls_part-object_name ).
DATA(lo_ver)    = NEW zcl_ave_version( ls_vrsd ).
```

A part carries its class, its unit and the VRSD key; a version carries number, date, time,
author, the author's real name, request and task — with the transport of copies already resolved
behind it. The factory raises `ZCX_AVE` for an object it cannot find, which is a 404 for free.

### Two requests, not one

The parts of a class are its sections, its local includes and one entry per method. Answering
parts and versions in a single call would read the version directory once per method just to draw
a list of names — eighty reads to show eighty rows. So the resource has two shapes, and the page
asks twice: the parts, then the versions of the part that was clicked. That is AVE's own left and
middle pane, for AVE's own reason.

### What was refused, and should not have been

A transport request and a package. Reading them is the whole point of AVE — a change is a
transport, not an object — and AVE shows a progress bar with an estimate while it works. One
blocking HTTP call has nowhere to put that, so the resource answered 400 and said why.

That reasoning was about the wrong method. AVE's progress bar belongs to its *review
preparation*, which reads every version of every part of every object. Listing a transport is the
other one: `ZIF_AVE_OBJECT~GET_PARTS` reads the object keys of the request and stops. The
expensive `GET_PARTS_EXPANDED` sits next to it in the same class and nothing here calls it.

Worse, the answer was already in the design. The parts-then-versions split exists precisely so
that no single request is long, and that is the progress channel the refusal claimed was missing.
A transport is now a scope like any other: its objects come back as the parts list, clicking one
opens it, and a row at the top leads back.

**Lesson.** A refusal is a claim, and this one was never measured — the cost of two methods was
read off the name of one. The cheapest check would have been to call it.



### ZCX_AVE says nothing

Its constructor passes `previous` to the superclass and nothing else, so `get_text( )` on the
exception itself yields the generic class text. The sentence worth showing is always one or two
links down the chain, and the resource walks it. An error page reading "AVE cannot list the parts
of ZCL_X" and stopping there would be exactly the silent failure this project keeps refusing.

### What went wrong: a key made of blanks

Every method reported no versions at all. Class sections and programs were fine, which is what
made it readable: their names carry no internal padding and the methods' do.

A method's entry in the version directory is keyed by the class name padded to thirty characters
followed by the method name — the blanks in the middle *are* the key. The resource put that name
through `CONDENSE`, which collapses runs of blanks to one. The key was destroyed on the way out,
before the client ever saw it, and no round trip could restore it. `CONV string` alone does what
was actually wanted: it drops the trailing blanks and touches nothing else.

Two further edges came out of the same look:

- `URLEncoder` writes a space as `+`, which stands for a space only under form encoding. A key
  that is mostly spaces should leave nothing for the other side to interpret, so it is
  percent-encoded strictly.
- The same `CONDENSE` sat on the author's name, the request and the task. A person with two
  spaces in their name is not ours to rewrite.

**Lesson.** The failure was visible for one screenshot and invisible in every check before it,
because an unknown key answered with an empty version list — which reads exactly like a part
nobody ever changed. The resource now verifies the key against the object's own parts and answers
400 naming the padding as the likely cause. A wrong answer that looks like a legitimate one is
worse than an error, and this project keeps rediscovering it.

### The handlers, third copy

`DataHandler` and `MetricsHandler` were the same thirty lines twice: read the selection, refuse
loudly if it is not an ADT object, count up, open the view. A versions handler would have been the
third, which is the point at which stage 9's argument applies again — so `ServiceHandler` holds
the three steps and a handler now names its view, its secondary id and what to say when the
workbench refuses.

### Not done here

The diff. `ZCL_AVE_POPUP_DIFF=>COMPUTE_DIFF` is a class-method over two source tables — the name
promises a popup and there is none — so the ABAP side of it is three statements. The work is in
the page, and AVE has already done half of it: `html_simulator/diff.js` is its diff algorithm
ported to the browser.

---

## Stage 11 — the context menu was the wrong front door

Right-click an object, find VERTEX near the bottom of a long menu, pick a service — once per
object. Fine for the first look at something, tiring as the way in.

SelecTor never had that problem, because its page carries the table name and a Load button: open
the window once and drive it from inside. The two new pages now carry the same thing, an object
type beside a name field, and the context menu becomes what it should have been from the start —
a shortcut that prefills, not the only door.

Three consequences, none of them in the pages.

**The type list belongs to the resource, not to the page.** Each page offers the types its service
reads, but does not enforce them: a type the resource refuses comes back as its own sentence. One
authority for that rule is enough, and it is the one that can be wrong about it.

**A window can now be opened with nothing selected.** Show View gives no object and therefore no
project, and until now only SelecTor could handle that — it asked which ABAP project to read from.
That question is the same for every service, so it moved into `PageView` and SelectorView's copy
went with it. A window whose remembered project has since left the workspace asks it too, instead
of refusing.

**A tab that names an object has to keep up with it.** The title was set once, from the object the
window was opened on, which was true right up until the input bar changed the object under it. The
page now reports what it actually loaded and the view renames the tab. It is an optional call:
a host with no tab to rename does not define it, and the VS Code shim is exactly that host today,
so the page checks before calling rather than assuming a contract both hosts have not agreed to.

The tab also names the service before the object — `Metrics: ZCL_X` — because two windows can
stand on one object and Eclipse truncates a tab from the right, eating the object name first.

**The ADT type carries a subtype.** `CLAS/OC` selects the CLAS entry by its head. A head the list
does not know is added rather than dropped, so a window opened on an object type the service does
not read still shows what it was opened for and lets the refusal explain itself.

---

## Stage 12 — the diff

The last piece of the version explorer, and the cheapest of the three services on the ABAP side:
`ZCL_AVE_POPUP_DIFF=>COMPUTE_DIFF` is a class-method over two source tables. Its signature carries
`i_title` and `i_confirm_key`, which read like a progress dialog waiting to happen inside an HTTP
request — they are never read. The progress indicator lives in the blame builder, one method
further down, and `compute_diff` reaches only `diff_lines` and `RS_CMP_COMPUTE_DELTA`. Checked
before calling, not after the first dump.

What it returns is already the right shape to send: `op(1)` and `text`, which serialises to
`{"op":"+","text":"..."}` — and that is, character for character, the shape AVE's own browser port
in `html_simulator/diff.js` produces. The two halves were written years apart on two sides of the
wire and they meet.

### What the page draws, and what it does not

The page renders the operations itself: line numbers following the new version, a marker column,
and a compact mode that folds unchanged lines more than three from a change. Deleted lines carry
no number, because they are not in the source you would open in the editor.

What it does *not* do yet is the character-level highlight inside a changed line, and the pairing
pass that decides which deletion belongs to which insertion. Both exist twice already — in the
ABAP and in `diff.js` — and porting the renderer wholesale was tempting. It was left out on
purpose: `diff.js` writes its colours inline (`background:#ffffff`), which would fight the palette
that makes one page work in a light editor, a dark editor and whatever the OS reports; and taking
a copy of it would fork a file AVE keeps deliberately in step with its ABAP.

### What went wrong: the newest version had nothing below it

The first real diff came back as the whole method added, `+198 −0`, with the pair printed as
`00000 → 99998`. Neither number is a version anybody can look up.

`99998` is AVE's key for the **active** version — the directory keeps it as `0`, and AVE re-keys it
so that it sorts after the numbered ones, which means the list arrives **oldest first**. The page
compared the clicked version with the row *below* it, and below the newest there is nothing. So the
old side was empty and every line counted as added.

`00000` was the same mistake seen from the other end: the page sent an empty FROM, `VERSNO` is
numeric, and an initial one prints as `00000`. The answer echoed a version number that was never
asked for.

Three things came out of it. The resource sorts newest first, because that is the order a reader
wants and the order the "compare with the one below" rule needs. An absent FROM is echoed as
absent. And `99998` is shown as **active**, since a five-digit sentinel means nothing to the person
reading it.

**Lesson.** The screen was full of plausible content — a real diff of a real method, only against
the wrong side. SAP's own *Compare Method Implementations* on the same object took ten seconds to
open and showed what the answer should have been. A second opinion that already exists is cheaper
than reasoning about which of your two version numbers is the fake one.

### Reading a version means reading the change it made

Clicking a version compares it with the one below it in the list, not with the newest. That is the
change *that* version made, which is what a version number means to a reviewer. The oldest has
nothing below it and is compared against nothing at all — every line added, which is what a first
version is.

The resource refuses a version number that is not in the directory rather than diffing against an
empty table. Both produce a screen; only one of them is an answer.

---

## Stage 13 — the join, and a constructor in the way

The fourth service, and the first one whose backend did not hand itself over.

SDE's join builder discovers what the dictionary offers around a table, keeps the join model,
and generates the statement. All of that is clean code with no control in it. It was simply
unreachable: the constructor built splitters, HTML viewers and, without a parent, a dialog box,
and it demanded a reference to the table window itself.

**Counting is not reading.** The first thing I reported was that the joins were not portable,
because the class holds seventeen `CL_GUI` references against the pivot's zero. Asked what those
references actually were, they turned out to be nine of HTML-viewer plumbing and six of the
frontend file dialogs behind the layout files. Candidate discovery, the join model, the statement
builder: none. The measurement was real and the conclusion from it was wrong, and it would have
cost a rewrite of a hundred and twenty-nine lines of foreign-key knowledge that already worked.

**Lesson.** A count over a file answers a question about the file, not about the thing you want
out of it. Read the lines the count is made of before planning around them.

### The way in

`IO_VIEWER` became optional, the base table can be named instead, and without a viewer the
constructor discovers the candidates, builds the selection and returns before creating a control.
Nothing else needed guarding: every render method already checks that its own control exists, and
the ready flag stays false, so nothing pushes a result into a window that is not there. The class
had been written defensively enough that the door only had to be opened.

`CACHE_WHERE_SELECTION` is skipped with the rest — the filters of a headless caller arrive with
its request; there is no selection panel to read them from.

### Replaying a stateful builder over a stateless protocol

The builder hands out an alias when a table is first taken into the join and never reuses it. HTTP
has no session to keep that in, so the client sends its whole selection on every request, in the
order it made it, and the model is replayed from the base table. Same order, same aliases. A
client that reorders its own list renames its own columns, which is worth knowing before writing
one.

`TOGGLE_CANDIDATE` ignores a table name it was never offered — a join quietly missing a table. The
resource checks the name against what the dictionary proposed and answers 400 with the way to see
the list, because a silently smaller join is a wrong answer wearing the shape of a right one.

### Running it

`EXECUTE_SQL` turned out to be the same shape as the constructor: two hundred and fifty lines of
work — normalising the statement, cutting `UP TO` and `ORDER BY` and `GROUP BY` back out of it,
resolving every `alias~field` to its dictionary type, building the structure, running the dynamic
`SELECT` — and then three lines that hand the result to the window. It returns the result now and
rebinds only when there is a window to rebind into.

Seven ways out of that method were a `MESSAGE` the GUI shows and a caller without one cannot see.
For the resource that is an empty result with no reason attached, which is the failure this
project keeps refusing, so each of them now also reports its text. The GUI passes neither of the
new parameters and behaves exactly as before.

The rows are asked for separately. Assembling a join means ticking one table after another, and
reading the database on every tick to answer a question nobody has asked yet is not free — so the
statement comes back without a row count and the Run button supplies one.

### Finishing the builder, and a chip that lied

What shipped first was a join you could assemble and not shape: every field of every joined table
in the SELECT list, and the type and condition the builder proposed with no way to argue. Both
were already there — `HANDLE_FLD_ACTION` had the codes the field toolbar sends, the model had the
type and the condition — and both were private. A fourth door.

The field list travels as a **set**, not as the click that changed it: `pick=X` says the list is
the caller's and the rest name what is in it. That is the same choice as the tables, made for the
opposite reason. The tables have to be replayed in order because an alias depends on when a table
was taken in; the fields have no such memory, so sending the set lets the page rebuild the request
from what is on screen rather than from how it got there.

An empty set needed the flag: without it, "no fields" and "no opinion about the fields" are the
same absent parameter.

**And a chip that lied.** The pivot's field chips showed the bare field name. Joining SCARR to
SFLIGHT produced two chips both reading `carrid`, one from each table, doing different things.
Seen on a screenshot again — the stub had one table in it, which is exactly the case where the bug
cannot appear.

### The filters were already reachable

The `WHERE` looked like the part that would have to be rewritten, since it is built from the
selection panel and there is no panel. It turned out `BUILD_WHERE` reads a member cache first and
only falls back to the panel when that cache is empty — because filters restored from a layout
file exist before the panel is built. Filling the same cache is all a headless caller has to do,
and not one line of the `WHERE` logic changed.

That is the third time in this stage that what stood in the way was an entry point rather than the
code behind it — and none of the three needed the logic touched. SDE was written the same way this
front end is being written, with Claude Code, and the separation was habit rather than foresight:
nothing in it anticipated a second caller. Habit was enough. What it did not produce was a way in,
because nothing ever asked for one.

The page sends the criteria it already has: a filter typed on the table applies to the join built
from it, which is what it does in SDE. Filters on a joined table wait for the panel to learn about
its columns.

### abaplint, when the system is not there

The SAP connections dropped mid-session, so the usual syntax check against the system was not
available. `npx @abaplint/cli` parses ABAP locally with no system at all, and it caught a real
error immediately: a table expression indexing the result of a method call, which is not
something ABAP allows. It cannot see the SAP standard classes, so it is a parser, not a syntax
check — but it catches exactly the class of mistake that a careful writer still makes.

What it cannot catch is anything that depends on the dictionary. It passed the filter code
cleanly; the system then rejected it, because a free-selection range calls its component `OPTI`
and not `OPTION`. A parser with no dictionary cannot know the components of a structure, so every
field name written against a DDIC type is still owed a real check.

---

## Stage 14 — the pivot, and the exception that became a rule

The pivot model was the one part of SDE that needed nothing at all: no control in it, a layout
that can be set directly, a statement built over the join's own `FROM`. Everything the previous
stage learned applied again, and `EXECUTE_PIVOT` needed exactly the two changes `EXECUTE_SQL` had
needed — the result back through a parameter, the reasons back through another, and the window
required to hand the matrix over rather than to build it.

**The exception I granted myself.** For the join I refused to set the application's global row
count, on the grounds that a caller over HTTP has no business setting a global. Two hours later I
set it for the pivot, because the row limit was read from it deeper down and passing a parameter
meant touching one more signature. Caught it on re-reading, made it a parameter, and the rule
survived. A rule stated once and broken once is a preference.

### What the page shows

SDE's tools area has two cards, Join and Pivot table, and the page now has the same two. In pivot
mode the join's fields become chips with three buttons each — row, column, measure — because a
chip is small, an Eclipse view is smaller, and a drag that misses its target is worse than a
click. Measures carry an aggregate.

The matrix is spread in ABAP rather than by the database: a dynamically specified SELECT list
cannot carry the CASE expressions a SQL-side matrix would need, so the statement groups by the
dimensions and every line of its result is one cell.

An aggregate the field's type cannot carry is settled rather than refused — `SUM` over a character
field comes back as something that field can do. That is worth knowing at the page: what returns
is the answer, not necessarily what was asked for, and the statement says which.

---

## Stage 15 — catching the second host up

Four services had grown in Eclipse and the VS Code host still knew one: the table. Every page had
learned to ask it for something it could not answer, and the pages had learned to check before
asking - `if (typeof sdeTitle === "function")`. That guard is honest, and a project where it
spreads is a project with one host and a museum piece.

**The shim stopped naming arguments.** It used to forward `name, rows, query`, which is the table
page's own signature; metrics asks with two arguments, versions with six, the join with six others.
A host that names them needs editing every time a page learns one. It now forwards the argument
list as it comes, and what the arguments mean belongs to the service:

```js
window.sdeLoad = send('load');
window.sdeJoin = send('join');
```

**The path builders are duplicated, deliberately.** The same four URLs are built twice, once in
Java and once here, because the two hosts share no language. They sit in one table at the top of
the extension so the divergence is at least visible in one place. A service the host does not
answer says so through the page's own error path rather than silently doing nothing.

**What is still not the same.** Eclipse takes its session from the ABAP project and opens a view
from the object tree; VS Code has neither, so the three commands open an empty page and the input
bar in each of them is the way in. That bar exists because of stage 11, which was asked for in
Eclipse - and it is what made the VS Code side possible without inventing a second way to name an
object.

### A backslash that was eaten twice

The edit that broke this stage open was not the code. Writing these files through a shell heredoc,
one level of escaping disappeared before Python saw it, so `\n` in a script became a real newline
in a match string and every replacement of that block failed. It failed loudly, which is the only
reason it cost minutes rather than a corrupted file.

Two things came out of it. The pages had been written with `String.fromCharCode(10)` for exactly
this reason since stage 4, and the same trick now keeps the shim's own `join` free of escapes. And
the tooling rule: a file with escapes in it is written with the editor, not with a heredoc.

---

## Stage 16 — the review, read first

Approve, decline and comment are the last thing AVE has that VERTEX does not, and they are also
the first thing that would write. So the stage was split at that line: read the saved review now,
decide about writing separately.

**Where it lives was the design question.** A review is a different activity from browsing
versions - its own state, its own persistence, its own navigation - which argues for a service of
its own. What decided it the other way was the entry point: you review *this transport*, and the
transport is already on screen. A separate command would have opened empty, asked for the request
again, and loaded the same scope the versions view had just loaded.

So it is a card, beside Versions, exactly as Join and Pivot are cards inside SelecTor. The project
now has one idiom for "same scope, another question" instead of two. The card only appears for a
transport or a package, because in AVE the unit of work is the request and a review of one object
is not a thing.

And a card rather than a hidden mode for a second reason: that boundary is where writing will
start. Everything until now only reads. A person should be able to see when they are in the thing
that saves.

**A fifth resource rather than a fifth branch.** The versions resource answers three questions on
one path by which parameters arrived - parts, versions, diff - and a fourth condition would have
meant reading the whole method to know which of them you get.

**Not written, and the page says so.** With no approve button there is nothing to press, which is
the honest state: AVE prepares a review and this reads it. An approve button that only looked like
one would be worse than none.

Two answers that are not errors and had to be said as such: a system with no `ZAVE_REVIEW` table,
and a request with no review saved. AVE answers the first with a setup page rather than a failure,
for the good reason that nothing is broken - a review has simply never had anywhere to go.

---

## Stage 17 — drawing what was saved

The summary of stage 16 showed how many blocks an object has and how many of them carry a verdict.
Clicking a row did nothing, because the blocks themselves were not there yet.

**The plan for this was wrong, and one question corrected it.** The next step looked like a diff
engine: compute the blocks of a part on the fly, with a progress bar, reusing AVE's pair selection
so that the hunk keys mean the same thing on both sides. Then came *"и в расчетах в таблице всё же
готово? просто отрендерить данные?"* — is the computation in the table already done? Reading
`ZIF_AVE_ACR_TYPES` answered it: `TY_DIFF_DATA-DIFF` is `ZIF_AVE_POPUP_TYPES=>TY_T_DIFF`, the very
`{op,text}` list our own diff endpoint already returns, and the saved payload clears every hunk's
html precisely so that the operations are what persists. A prepared review needs no computation at
all. The work went from a diff engine to a read.

It also closed the hazard named in stage 16: the hunk key is `type~object~n` and carries no version
pair, so the same key means different lines under a different comparison. The stored diff carries
its pair in `TY_DIFF_DATA_KEY`, so for saved data the question does not arise.

**What the page cannot work out for itself.** Where a block starts and ends among the operations.
Reading `ZCL_AVE_ACR_HUNK_INFO=>COLLECT` shows why: a block swallows the context lines inside an
unfinished ABAP statement (so that a call and its parameters are approved together), keeps a blank
line when more changes follow, and is dropped entirely when `HAS_VISIBLE_CHANGE` finds no colour in
its rendering. A client re-deriving "a run of changed lines" would disagree with AVE about how many
blocks there are, and the numbering the keys are built on would shift.

What survives the save is `START_LINE` — the line of the *new* version a block opens on, counting
insertions and context but not deletions — and `CHANGE_COUNT`. Replaying that one counter over the
stored operations places every block exactly, with no rule to keep in step. The resource does it and
returns `op_from` / `op_to`; a block it cannot place comes back with zero rather than dropped, and
the page prints it above the diff, because a payload whose blocks and diff disagree has to be seen.

**One rendering.** The action row of a block is a row inside the diff table, and `diffTable` took a
second, optional argument instead of gaining a twin. Had the review drawn its own diff, the two
would have drifted — the compact fold alone would have been enough to make them disagree.

**A dictionary object has no lines.** `TABD`, `DOMD` and `DTED` are reviewed in AVE as a table of
fields, and that page is kept as ready-made html because nothing remains to rebuild it from. The
resource marks it `ddic` and the page says it does not render that yet, rather than showing an empty
diff and letting it read as "no changes".

---

## Stage 18 — the law, and what it cost to keep

Stage 17 shipped a review page that was right about what it showed and wrong about how it got
there. Two things came back at once.

**The objects were in a heap.** A transport touches forty parts, and the table listed them in
payload order: `GET`, `Public section`, `GET`, `Private section`, `GET` — a method's name means
something only inside its class, and every class has the same sections. AVE's own report groups them
by class, and had all along.

Then the rule that governs this project was stated outright: **reuse and reproduce the
functionality; where you cannot reuse, change the backend until you can.**

It is not a style preference. VERTEX shows the same data as three tools its user already trusts, and
a second opinion about that data is a bug the moment a reader notices it — they will be comparing
the two screens.

**First reading: what was already public.** `CAT_ORDER` and `CAT_LABEL` were public class methods on
`ZCL_AVE_ACR_REPORT`. The ordering around them was not, so the report grew
`REPORT_OBJECTS( it_obj_stats )`: the objects it lists, in the order it lists them, with the class
name filled in where the statistics carry none and objects with no changed line left out. `TO_HTML`
lost forty lines and calls it; the resource calls the same thing. One rule, two front ends.

**Second reading, and this one had been written the wrong way the day before.** The resource located
each saved block among the diff operations by replaying AVE's line counter — carefully, correctly,
and entirely by hand. The documentation for it even said the rule "is not one a reader of the result
can reconstruct", one paragraph above reconstructing it.

The real walk was in `ZCL_AVE_ACR_HUNK_HTML=>COLLECT_ROWS`, cutting the same blocks on its way to
rendering them. It came out as `HUNK_RANGES( it_diff )`, returning for each block where it starts and
ends among the operations, the line it opens on, and whether it changes anything visible.
`COLLECT_ROWS` renders from those ranges; the resource reads them. The hand-written replay is gone.

**Third: the walk that named the blocks.** `ZCL_AVE_ACR_HUNK_INFO=>COLLECT` had a walk of its own,
because it counts authors and kinds as it goes, and its comment said it must make "the same
decision" as the renderer. That is a promise kept by reading, and it was already broken. It now
takes the ranges too and only measures what is inside them: 180 lines became 90, and AVE has one
walk instead of three.

**Proving a refactor without a system.** `COLLECT_ROWS` is AVE's review rendering and `COLLECT` is
what the hunk keys are built from; either off by one operation would renumber every block a review
is filed under. All three walks were transcribed into JavaScript and run against random diffs.

| Compared | Input | Result |
|---|---|---|
| `COLLECT_ROWS` before and after | 5000 diffs, 17606 blocks | no difference |
| `COLLECT` against `HUNK_RANGES` | 20000 diffs, 75722 blocks | one difference, below |
| Is a start line unique to a block | 21983 ranges | no two share one |

**The one difference was a bug, and it was COLLECT's.** Its walk closed the last block on a sentinel
`=` appended to the operations — except that a sentinel is also a context line, so when the diff
ended with an ABAP statement still open, the sentinel was swallowed as "context inside the
statement" and the final block was never closed. It was rendered, because `COLLECT_ROWS` closes on
the end of the table, and then discarded, because `COLLECT` did not. The last changed block of such
a part had no key, no verdict and no place in the counts. Taking the ranges fixes it: 1759 of the
20000 random diffs ended that way, far more than real ABAP will, since an include usually ends on
`ENDMETHOD.`, but not never.

---

## Stage 19 — the first write

Everything until here read. Approving, declining and commenting change state on the server, and the
law decided the shape of it before any design did: **reuse and reproduce; where you cannot reuse,
change the backend until you can.**

**Most of it was already reusable.** `APPLY_SAVED_PAYLOAD` unpacks a saved review into working
tables, `BUILD_SAVE_PAYLOAD` packs them back, `SAVE_REVIEW_PAYLOAD` writes. All public, all free of
`CL_GUI`. The resource loads, hands over, and saves; it knows nothing about what approving means.

**What was not reusable was the middle.** What a reviewer actually does to a block lived inline in
two places in the SAP GUI front end — approve and undo in the command handler, decline and comment in
the note dialog's handler — reading and writing the popup's own member tables. It came out as
`ZCL_AVE_ACR_STATE=>APPLY_REVIEWER_ACTION`, one method for all four, and both old callers now go
through it. The rule about a repeated message being a double click rather than a second comment, the
one about a note being filed under whoever wrote it, the one about a thread keeping what the block
looked like: all of it happens once, for both front ends.

**Two decisions where a quiet default would have destroyed something.**

`APPLY_SAVED_PAYLOAD` drops generated Gateway classes when told to, mirroring a setting in AVE. The
default is to drop. VERTEX passes false: a write that adds one verdict must take nothing away, and
the setting is not this program's to act on.

A save writes the whole payload. Two reviewers on one request is the normal case, so a write built
on a state that has moved since the page read it would carry the other reviewer's approvals off with
it. The page sends back the stamp it read and a changed one is refused, loudly, with who saved it.
There is no merge. A merge nobody asked for is exactly how a review would quietly lose work.

**The hosts differ, and only here.** Eclipse posts through the ADT communication layer, which holds
the destination and carries the CSRF token out of sight. The VS Code host authenticates with basic
auth and has no such layer, so it fetches a token from the discovery endpoint and sends it back with
the cookies of the response that issued it. One page, two hosts, and the difference confined to the
transport.

**Self-review is on, and it is temporary.** `C_ALLOW_SELF_REVIEW` exists because the request being
tested is entirely the tester's own work, and with AVE's rule on there would be nothing to press. It
is a named constant rather than a missing check, so removing it is one line and finding it is one
grep.

---

## Stage 20 — the order the statement is written in

SelecTor's join in the SAP GUI has a strip of chips you drag: the tables of the FROM, and the fields
of the SELECT, in the order they come out. VERTEX had the lists but no way to order them.

**The stateless replay made this easy rather than hard.** The join request already carries the
tables as `t1..tN` and the SELECT list as `sf1..sfN`, so the order on screen is already the order in
the statement. Moving a chip is moving one entry of an array and asking again. Nothing on the server
changed.

Two drop targets, the same two the GUI has: another chip means "before that one", and a dashed end
marker means "last". The marker is not decoration — without it there is nothing to drop on after the
last chip.

**Moving a table throws the SELECT list away, on purpose.** An alias is handed out by position, so
`T1_MATNR` becomes `T2_MATNR` the moment two tables swap. A field list keyed by alias would then name
columns that no longer exist. It goes back to what the builder proposes, which is the same thing
taking a table into the join already did.

The base table is drawn and cannot be moved: the request is replayed from it, so moving it would be
choosing a different base, which is a different question.

**Three more things the screen itself said, once it was used.**

The tables around SFLIGHT are sixteen, and sixteen checkboxes with a name and a description each is
a screenful of list before the join comes into view. They are chips in rows now, name and an arrow
for which way the key points, with the word and the description one hover away. Four rows instead of
sixteen.

The rows moved to the top of the join. What is being assembled and what it returns belong on screen
together, and the answer should not be the thing below the fold.

And every change runs the join again. It used to return the statement alone, to keep a tick of a
checkbox off the database — a defensible rule that turned out to mean the rows on screen belonged to
an older join than the one being looked at, and that Run had to be pressed after every move. A read
of a hundred rows is cheaper than that.

**A comment keeps its shape.** The box takes several lines, so the box that shows it has to give
them back: `white-space: normal` on the cell had been folding a pasted snippet onto one line. AVE
keeps the line breaks and loses the leading spaces, for the same reason in HTML; one `pre-wrap` in
its renderer would settle it there too.

---

## Stage 21 — the pivot, and what auto-running turned up

The pivot became the cross SDE draws in the SAP GUI: columns across the top, rows down the left,
measures beside them, the fields underneath. A field goes into a slot by being dragged onto it, or by
being clicked and then having a slot clicked — the second way is in the GUI for a reason, and a slot
in an Eclipse view is small. `MIN_SLOTS` and the growing rule are read from `ZCL_SDE_PIVOT`: one more
slot than the section holds, never fewer than three.

**The aggregates are asked for, not guessed.** Which ones a field may be taken under is decided by
`ALLOWED_AGGS` from the internal type, and the internal type never travels to the page. They were
private instance methods that used no instance state, so they became public class methods and the
join resource sends the list with every field. A page that offered `SUM` on a `CHAR` field was
offering something the pivot then quietly turned into `COUNT`.

**Colour by table, six of them, cycled — the GUI's own palette**, defined for both themes. Key
fields keep the doubled border SDE gives them. The field list breaks into a row per table with its
own all/none/keys, because a table that starts halfway along a line is one the reader has to hunt
for.

**Auto-running the join found a real bug.** Pressing *none* returned `HTTP 400: Unknown field
SFLIGHT-*`. `BUILD_SQL` writes a star when its list is empty, and `EXECUTE_SQL` parses the SELECT
list with a regular expression that has no case for one. It had never surfaced because assembling a
join used not to run it.

The fix is not in either of them. A star means *all the fields*, and a caller who cleared the list
asked for the opposite. Nothing chosen is not everything chosen: the resource now answers an
explicitly empty list with no statement and no rows, and the page says a statement starts at one
field. `BUILD_SQL` keeps its fallback, because the GUI reaches it by a different road.

---

## Stage 22 — the half that is missing, and the half that ships

**A plugin without its backend now gets a page, not a red error.** VERTEX is a
front end and a set of ADT resources, and installing one without the other is a
setup state rather than a failure: nothing is broken, the ABAP has simply never
been put there. The hosts tell the two apart at the source, where the status code
actually is — Eclipse catches `ResourceNotFoundException`, VS Code reads a 404 —
and mark the answer. Everything else stays a failure.

Each window names the repositories **it** reads. SelecTor needs the resources,
Metrics needs ACE as well, Versions needs AVE. Naming only the first would send
somebody who is missing the second to install what they already have. The same
list is a short line on the start screen, always, because the person who has just
installed the plugin and typed nothing yet is exactly the one who needs it.

Opening a link had to become a host function. In Eclipse an anchor would navigate
the view away from the page it is on, and a webview cannot open one at all, so
`sdeBrowse` goes to `Program.launch` on one side and `openExternal` on the other.
A host offering neither leaves the address to be copied.

**The extension could not have been published at all.** Its pages are the Eclipse
plugin's and live in that bundle, read across the repository with a `..` path. A
vsix carries only the extension folder, so the packaged extension would have
started with no pages. `vscode:prepublish` copies them in, and the extension
prefers a local `resources/` when it finds one — one source of truth, one copy
made at packaging time, and nothing to decide at run time. Confirmed by packaging
for real: the vsix now carries all three pages.

---

## Stage 23 — Flow: the picture ACE already draws

**A method's branch scheme instead of its numbers.** The Metrics window got a *Flow*
toggle; with it pressed, a click on a row replaces the table with the control-structure
diagram of that unit — `IF`/`CASE`/`LOOP`/`TRY` with the straight stretches folded into
"N operations" nodes that open when clicked. Escape or *← Units* goes back.

Nothing about that picture was invented here. `ZCL_ACE_CODE_HTML=>BUILD_SCHEME` already
writes it, for the *Scheme* window in SAP GUI, and it writes mermaid text. So the resource
returns that string and the page draws it — the same division as everywhere else, and this
time the law cost almost nothing to keep.

**What ACE had to give up to be asked from outside.** Three things, all of them extractions
rather than new logic:

- `BUILD_SCHEME` gained `I_OFFSET`. It used to assume its source started at line 1 of the
  scan, which is true for the whole include the GUI window shows and false for one method
  cut out of a program. `ANALYZE` already took an offset for exactly this reason; the
  parameter only had to be forwarded.
- The walk that finds where each unit begins and ends left `ZCL_ACE_METRICS=>CALCULATE` and
  became `UNIT_BOUNDARIES`, public, now also carrying each unit's first and last **source
  line** and its qualified name. The metrics list and the diagram have to agree about which
  method a row is; a second walk here is precisely how they would stop agreeing.
- `ENSURE_CALLS_PARSED` left `ZCL_ACE_WINDOW` and became `ZCL_ACE_PARSER=>PARSE_CALLS`.
  Without it every call folds into an "N operations" node like ordinary code — the parser
  fills `TT_CALLS` a statement at a time, on demand, and a diagram needs the whole include
  up front.

On the SDE side, resolving an ADT name to the program ACE parses, and parsing it with all
its includes, were the metrics resource's private business. `ZCL_SDE_ACE_SOURCE` now holds
both and `ZCL_SDE_ADT_RES_METRICS` calls it, so `ZCL_SDE_ADT_RES_FLOW` is left with only
the part that is its own: find the unit, cut its lines out, ask for the scheme.

**The one thing the page decides is a click.** ACE marks the nodes that fold with a
`sapevent:aceexp_<line>` link, and the page reads the line out of the href and asks again
with that line added to the open list. It never decides which nodes those are. The other
link ACE writes, `acego_`, selects code in its source window; there is none here, so it is
swallowed rather than followed.

**mermaid ships inside the plugin.** The page is handed to the browser as a string —
`setText` in Eclipse, `webview.html` in VS Code — so it has no address to resolve a
`<script src>` against, and a CDN would fail silently on a machine behind a corporate
proxy. So the library is a file next to the pages, the host reads it and returns its text
through a new `sdeAsset` call, and the page runs it. It is handed over the first time a
diagram is asked for, not on every open, because it is megabytes and most visits to this
window never press Flow.

---

## Stage 24 — the flow, and what it cost to leave the window behind

**The Metrics window became a window with three pictures.** A mode list replaced the
Flow toggle: *Flow*, *Scheme*, *Metrics*, in that order, with the numbers last. Which
one a window opens on follows from the object rather than from a preference — a
program or an include has code above its units, so the order things run in is the
first thing worth seeing; a class has no such code, its pool is nothing but `INCLUDE`
statements, so it opens on the list of its methods. The flow takes the whole window,
because it is about the object and has no unit to point at; the scheme keeps the
narrow list beside it, because picking a unit is the whole interaction.

**ACE had to learn to exist without a screen.** `ZCL_ACE`'s constructor builds a
window and an object tree — SAP GUI controls — and an ADT resource has no session to
build them on. But the analysis never wanted them: every scanner uses the viewer as a
place to keep the parse, the step table and the depth, and asks it to draw nothing.
So both constructors took an `I_HEADLESS` flag and return at the line where state ends
and the first control begins, and `SET_PROGRAM` gave up its data half as
`PARSE_PROGRAM` — the parse plus the call walk, no controls. Four lines of state, and
the whole flow becomes reachable from outside.

**`STEPS_FLOW` split the same way**: `BUILD_STEPS_FLOW` is the picture, a function of
the step table and the parse; the instance method keeps the filter that needs the
viewer's own code-flow walk, and the drawing. Depth and Only Z needed nothing at all —
`M_HIST_DEPTH` and `M_ZCODE` were already public, so they became query parameters.
The window opens at depth 3 rather than ACE's 19: nineteen draws a picture too large
to read on first sight, and winding it out is one field away.

**Three errors, all from the same step, and none of them findable here.** Making a
method static takes away the instance, and the compiler says so three separate ways:

- `I_FOCUS` typed `STRING` against a `PROGNAME` field — not type-compatible.
- `CLEAN_LABEL` and `FORMAT_NODE_LABEL` called by their short form from a static
  method, which only static methods may be. Both are pure text; both became static.
- `IS_PARSE_DATA` written to. The drawing is not a pure reader: with a focus it dips
  back into the parser for bindings nobody resolved yet and fills them in. It became
  `CS_PARSE_DATA`, CHANGING, because a local copy would throw that work away and the
  caller would pay for it again.

`abaplint` reported zero parser errors before and after each of them. They are type
and scope errors, not parse errors, and only the syntax check on the real system found
them. Which also settled how this half of the work should go: write, push, pull,
`SAPDiagnose action="syntax"`, fix — and never build the next layer on ABAP that has
not been through it.

**A day lost to the wrong server.** `arc` points at a local trial on `127.0.0.1:50000`
that is down after every reboot; QAS is `arc-qas`. Reporting "the system is
unreachable" for a whole session, and planning around it, was a failure to look at
where each connector pointed.

---

## Stage 25 — handing the tools to somebody else's agent

**VERTEX does not get an agent of its own.** The editors people already sit in have
one: Copilot, Claude Code, Codex. They have the loop, the chat, the model picker and
the user's own subscription, and every one of those is better than what would be
written here. What none of them has is any idea what SAP is. So the extension stopped
being only a set of windows and became a **source of tools**.

The way in is **MCP**, because it is the one door all of them open: VS Code registers
an extension's server through `mcpServerDefinitionProviders`, and Copilot for Eclipse,
Claude Code and Codex all take a server address. A VS Code-native `languageModelTools`
registration would have reached Copilot in VS Code and nobody else.

**The pilot is a transport review**, and it needed no ABAP at all. `ZCL_SDE_ADT_RES_REVIEW`
already computes exactly the right thing — AVE's own change set for a request: which
objects moved, who changed them, the diff of each against its previous version, cut into
the same blocks the reviewer approves, carrying the verdicts and the notes already given.
Two tools read it:

- `sap_transport_changes` — the objects of a request, with block and line counts and
  whether anything is still open;
- `sap_transport_diff` — one object, or the whole request up to a size budget, rendered
  as a unified diff whose hunk headers are AVE's blocks.

The block boundaries are deliberately AVE's rather than recomputed. The saved verdicts
are filed against them, so hunks cut a second way here would put the model's findings on
different ground than the reviewer's own buttons.

**The connection is the extension's.** Every tool call goes through the same `fetch()` the
pages use, so the active system, the user and the password in the OS credential store are
already there. Nothing is passed to a separate process, and the server learns no secret.

**What a local HTTP server has to get right**, from the specification rather than from
taste: one endpoint, POST answered with plain JSON, notifications answered `202` with no
body, `405` for the GET stream that is not offered, the `Origin` header validated,
binding to `127.0.0.1` only, and a bearer token — "on this machine" is not the same as
"any process on this machine". The port is the one the system hands out, because several
windows each run their own server and a fixed number would make the second one fail.

**The first version called an unprepared review a clean transport.** The summary lists
objects only out of the review AVE has saved, so for a request nobody has prepared yet the
list is simply empty — and the tool read that as "the request holds no versioned source".
A model handed that sentence reports that nothing changed. It was found by reading the
resource again while picking a real transport to try the pilot on, not by a failed run.
An empty list now has its three meanings told apart: no `ZAVE_REVIEW` table, no saved review, and a saved review with no
changed line. The first two are tool errors — there is nothing to read, which is not the
same as nothing to find.

Eighteen checks, run from a scratch script rather than kept in the repository, drove the
real server over real HTTP with a stubbed system behind it:
the four guards, the lifecycle, version negotiation, an unknown tool as a protocol error,
a missing argument as a tool error rather than a crash, the rendering of both tools, and
the two states in which there is nothing to read.

**Read-only, on purpose.** A tool result goes to the model, so the first version offers
what a reviewer looks at and nothing that writes. The same reasoning keeps SelecTor out:
table contents are business data, and a diff is not.

**This does not replace ABAP-AI-Code.** That project exists because in many SAP shops the
code may not leave the system through a laptop at all; it keeps its own agent, its own
encrypted keys and its own loop inside the system. Using Copilot or Claude Code means the
source travels system → laptop → vendor. The two serve different policies, and neither
makes the other redundant.

---

## Stage 26 — an address that outlives the window, and a server without the editor

**The pilot's address died with the window.** Stage 25 let the system pick the port and drew a
fresh token on every start, reasoning that several windows each run a server and a fixed number
would make the second one fail. That was right about windows and wrong about what mattered.
Copilot never noticed — VS Code asks the provider again and is handed whatever is current — but
Claude Code and Codex store the address they were given, so every window reload quietly broke
their registration. The port became a setting, `vertex.mcp.port`, 37777 by default, and the token
moved into VS Code's SecretStorage, so both survive a reload. A second window on the same port is
an error naming the setting: falling through to a free port would leave the registered client
talking to whichever window holds 37777, possibly on a different SAP system. Port `0` keeps the
old temporary behaviour for whoever wants it.

**A stored address also needs somebody listening.** An external client cannot trigger a VS Code
MCP provider, and until now the server started only when Copilot or the command asked for it. The
extension activates at `onStartupFinished` and starts the server itself whenever the port is fixed.

**Codex came in through the same command.** It asks which assistant the address is for: Claude
Code gets the `claude mcp add` line, Codex a `[mcp_servers.vertex]` section for
`~/.codex/config.toml`. Both carry the token, which is why the README keeps them out of version
control.

**Then a server with no editor at all.** `mcp/server.js` is the same two tools behind stdio:
Claude Code or Codex starts it as a child process, and VS Code may be closed. It does not
re-implement them — it imports `dispatch` from `vscode/mcp.js`, so a model reads the same texts
whichever way it connects. What it cannot borrow is the connection, so `mcp/sap.js` reads SAP on
its own, and its rules are about the password it now holds:

- credentials come from `VERTEX_SAP_*` environment variables — never from VS Code's
  SecretStorage, never written to disk;
- only `/sap/bc/adt/zsde/review/` may be requested;
- redirects are not followed, because Basic credentials would travel wherever `Location` points;
- every request has a wall-clock deadline and a 16 MiB ceiling on the answer;
- stdout belongs to MCP alone, and errors on stderr never carry the password.

`mcp/configure-local.py` writes both assistants' configuration from the active VERTEX system with
the password left empty, refuses to overwrite an existing `vertex` entry, and backs both files up
first.

**Two Claudes, two configuration files.** Claude Code used the tools; the chat in Claude
Desktop, asked the same thing, answered that no VERTEX server was connected. They are different
clients. `claude mcp add` writes `~/.claude.json`; the chat reads `claude_desktop_config.json`,
where a local server is a command to start. The standalone server is what fits there, with its
SAP connection in the entry's `env` — the app is not started from a terminal, so nothing set in
one reaches it.

### What went wrong: a label in the name field

In a scope — a transport or a package — the Versions window treated every row as an object to
open, and filled the name field from `unit`, the row's display label. A transport's rows are
mostly parts: `REPS ZEXAMPLE_REPORT`, or a method keyed by its class name padded to
thirty characters. Neither is an object, and a label is not a key. Now only `CLAS`, `INTF` and
`FUGR` expand, by technical name; every other row asks for its versions inside the scope, with
the version directory's key passed exactly as it came, blanks included — Stage 10 is why that
last part matters. The test that pins it down uses the very row from the DEVK900578 screenshot.

**The first tests kept in the repository.** Seven of them, run with
`node --test mcp/test/*.test.js vscode/test/*.test.js`, need neither SAP nor an editor: the
standalone process over real stdio against a fake SAP endpoint; a bad configuration failing on
stderr without the password; SAP errors, a redirect and a deadline; the command without Copilot's
API; the HTTP server keeping its port and token across a restart and refusing a second one on the
same port; and the two Versions cases. `test/**` and `*.vsix` stay out of the package.

---

## Stage 27 — a sentence instead of the clicks

**SelecTor got a chat.** "Open SFLIGHT for carrier AA, join SCARR" instead of typing the name,
pressing the magnifier on a column, filling in the panel and picking a chip. The first proposal
was a model of VERTEX's own — Copilot's through `vscode.lm`, or an API key — and it answered the
wrong question. VERTEX already knew which AI it talks to: the quick pick of the MCP command,
Claude Code or Codex. The chat offers the same two, and the model the chosen one offers.

**The assistant configures; SelecTor runs.** What comes back is not an answer about data but
the whole state of the page — table, filters, join, SELECT list, pivot — in a JSON schema both
command lines enforce (`--json-schema`, `--output-schema`). The page applies it through the same
variables and the same `load` and `loadJoin` the clicks use, so every chip it set can be moved
by hand afterwards. The model sees metadata only. Its one tool, `sap_table_layout`, reads the
join resource without a row count, which answers with the fields, their texts and keys, the
tables the dictionary offers and the aggregations the pivot allows, and reads no row. The plan
is checked against that same answer before the page is given it: a field the table does not
have is an error in the chat, not a filter quietly missing from the panel.

**Shut in on purpose.** A run starts in an empty temporary folder. Claude Code gets
`-p --tools "" --strict-mcp-config` and one allowed tool; Codex gets
`exec --ignore-user-config -s read-only` with the shell, unified exec, plugins and apps switched
off. The person's own MCP servers are not loaded, and among them are ones that write to SAP and
ones with free SQL. The tool lives at `/selector` on the same local server, so what Copilot,
Claude Code and Codex see at `/mcp` does not change. The token reaches the child through its
environment; the files in the folder name the variable, not the value.

### What went wrong

- **Which Codex.** The `codex` on the path was an npm install of 0.135, and the model the
  person's configuration names, `gpt-5.6-luna`, was refused as needing a newer one. The copy
  inside the Codex extension was 0.154 and ran it. VERTEX now starts the executables that come
  with the two extensions: the same version and the same login the person uses in the editor.
- **A catalogue is not an entitlement.** Codex lists `gpt-5.4-mini`, and so does its app
  server, but a ChatGPT login is refused it, and nothing in either list says so. The list stays
  Codex's own; a refusal reaches the chat in the provider's words.
- **A key where a name belongs.** Asked for a pivot over 2026, the model wrote the date filter
  as `t0~fldate`, the key form the pivot uses. The check refused the plan, which is what it is
  there for. The fix went into the rules and into the tool's own text, which now say that a
  filter names its field plainly; the model's answer is not corrected behind its back.
- **Eclipse** has no assistant yet. The panel is there and says so.

Twenty-one tests more, none of them needing SAP, an editor or a model: the plan check against
the dictionary, the endpoint beside the review, both command lines as they are started and as
they fail, the model lists, and the page applying a plan. Then two runs of the real Claude Code
against a stubbed system — the request as it was typed, in 12 seconds, and the pivot, in 9.

**Lesson.** Before proposing a way in, look for the one the project already has. The choice of
assistant was sitting in `extension.js`, and each of the three options offered instead of it
would have been a detour around it.

---

## Stage 28 — the same chat in Versions

**Versions got the assistant SelecTor has**, on the same runner, the same local server and the
same check-before-apply. "The last change of BUILD_LAYOUT in ZCL_AVE_POPUP", "the review of
DEVK900123, the BUILD_LAYOUT part" — and the window goes there. The host side became general on
the way: each window with an assistant names its rules, tools, plan shape and check, and the
address its tools are served at, `/selector` or `/versions`, beside `/mcp`.

**Lists, never source.** The tools are `sap_object_parts`, `sap_part_versions`, and the review
server's own `sap_transport_changes`, reused rather than restated. The diff tool is not among
them: a line of source is to the Versions window what a row is to SelecTor. The plan is a
destination — type, name, view, the part, the version, the object of a review — and the check
holds it against the parts list, the versions list and the saved review before the window is
sent anywhere.

**A destination is reached in steps.** The window cannot open a version whose part it has not
listed, so a plan is walked the way a person clicks: the parts, then the part, then the version;
or the request, its review, then the object in it. Each step waits for the answer of the one
before it. An answer about something else means the person went elsewhere meanwhile, and the
rest of the plan is dropped rather than sprung on them later; an error from SAP stops it with a
line in the chat. The diff it opens is the one a click opens — a version against the one below
it — so the assistant reaches nothing a person could not.

**The key made of blanks, once more.** A method's key is its class name padded to thirty
characters, and a model copying it could have collapsed the blanks as `CONDENSE` once did. The
tool prints every key as a JSON string, and the check compares keys blank for blank. In the real
runs the model copied them exactly; were it not to, the plan is refused with the reason.

### What went wrong

- **The disk filled up in the middle of an edit.** Three writes to `versions.html` failed with
  `ENOSPC`. The file was checked against the repository before anything else — untouched, since
  the failed writes had written nothing — and the edits were made again once space came back.
  The space was not taken by this work.
- **The session's scratch folder vanished**, cleaned up by another Claude Code process starting
  in the same project. With it went the probe scripts and Stage 25's eighteen checks, which had
  only ever lived there. The tests that matter were already in `vscode/test`.
- **The tests left folders behind.** The runner's tests made temporary extensions and never
  removed them, sixty-five after a few runs. They now clean up after themselves.

Fourteen tests more — the tools and the check against a stubbed system, and the page walking a
plan step by step, dropping it, and stopping on an error — and two runs of the real Claude Code:
the last change of a method in 13 seconds, the object of a review in 12.

---

## Stage 29 — a reviewer that could not read

**Tried on E19 the same day, the Versions assistant answered "describe the method GET" with an
apology.** It could open the object; it could not read it. Stage 28 had carried SelecTor's rule
across by analogy — never a row, so never a line of source — and the analogy was wrong. A table
row is business data. A diff is what a review is made of, and the review server had been handing
diffs to models since Stage 25.

**The assistant now reads what the window shows.** `sap_version_diff` gives the change a version
made, against the version listed below it or against one named, and with `full` the whole source
with the changes marked — AVE's own choice between "AI prompt diff" and "AI prompt full".
`sap_transport_diff` is the review server's, with the blocks, the verdicts and the comments. Both
render through the one `diffText`, which learned a full mode for it, and a whole source too long
to read well is cut with a line saying where. A request to describe or review gets its answer in
the reply, as long as it needs to be; a request to see something still moves the window.

### What went wrong

- **The label named the wrong model.** Asked with sonnet, the chat signed its answers with haiku.
  The label was the first key of Claude Code's `modelUsage`, a report keyed by model that
  promises no order. It now names every model the report lists, the one that wrote most first. A
  plain sonnet run reports sonnet alone, so what put haiku first was not reproduced; the label no
  longer depends on it.
- **One answer was the word "test".** Of two runs of the same request against a stubbed system,
  the first came back with that as its reply — the text of a declined block's comment — and the
  second with a full description of the method. The plan check can tell a wrong key from a right
  one; it cannot tell a poor answer from a good one, and does not pretend to.

Both assistants go out in the extension as 0.5.0, listed under AI and Chat as well.

---

## Stage 30 — finding a request by whose it is

**It started as a review of somebody else's tool.** abap-adt-cli pulls a package onto disk and
pushes it back over ADT, and reading it for ideas turned up two things about VERTEX. One was a
claim to check: that ADT drops a trailing newline when it stores a source, which would make the
check Save & Activate runs after a write fail on a write that had succeeded. The other was a
question from the user: could the Versions window find transports by user, your own by default?

**The claim did not hold, and nothing was changed for it.** `CL_ADT_REST_PLAIN_TEXT_HANDLER` on
QAS splits the body of a PUT into lines after appending one more line break, and SAP's comment
says why: otherwise an empty line at the end of the source would be lost. Reading joins the lines
with CRLF and adds none after the last. Text ending in a newline is stored with an empty last line
and comes back ending in CRLF — the same text once line endings are normalised, which is all the
check compares. Half of the claim is true: a source without an empty last line comes back without
a newline.

**The window now finds requests.** With Transport request chosen, the bar has a user field, a
*released* switch and Find. The list is open requests by default; the switch adds released ones
and those whose release has started. A request whose only link to the user is a task under
somebody else's request is theirs too, the way SE09 lists it, and the status that counts is the
request's own — a task is often released long before its request. A row opens the request exactly
as its typed number would. The field left empty means whoever is logged on, and that is decided in
ABAP: the server knows who is asking, and the page does not know and should not.

The resource is `/sap/bc/adt/zsde/requests` in the Simple Data Explorer hub — the first route with
no name in it, since both of its parameters are optional. The header of each request comes from
`ZCL_AVE_REQUEST=>GET_HEADER` and the full name from `ZCL_AVE_AUTHOR`, so a request reads the same
in this list as in the rest of the window. Eclipse gained one `BrowserFunction`, VS Code one path
builder and one line of the shim, and the page one answer shape, told apart by what it carries.

### What went wrong

- **The function that was proposed is not the one used.** The plan put to the user named
  `TRINT_SELECT_REQUESTS`, SE09's own selection. What it does with a task under somebody else's
  request lives in its form routines, and those were never read: the connection to QAS dropped
  TLS handshakes intermittently that day, so single reads got through while every write — several
  requests in a row — failed, and then the servers disconnected altogether, with E19 not answering
  at all. Two selects on `E070` state the agreed rule outright, the table AVE itself reads for
  requests and tasks. The switch was reported, not slipped in.
- **The page's test harness had no styles.** `loadParts` now shows or hides the finder, and the
  stub elements the tests build had no `style`, so the existing test that goes back to a
  transport would have thrown. The stub learned it.

Not yet run against a system. The ABAP passed abaplint against stubs of the SAP classes it calls —
proved to be checking by errors planted in a copy, which it found — the plugin compiled with javac
26 at release 21 against the bundle pool, and the page was driven in a browser against a stub
host. 105 tests pass, five of them new.

The finder worked on QAS as soon as the commit was pulled — the route with no name in it included.

**Lesson.** A standard function counts as reuse only once its behaviour on the case that matters
has been read. Before that it is a guess carrying SAP's name.

---

## Stage 31 — asking the system what it has

**The finder's first click on QAS opened the setup page**, "The ABAP half is not on this system",
over a system where every other window was working. Nothing was wrong with the page: the commit
with the new resource had not been pulled yet, so the router answered 404, and a 404 was all the
page had ever been told about. It could not tell a hub that is not there from a hub one resource
older than the window. The user asked for exactly that difference — and then for more: ask every
service when the window opens, and do not draw a button that cannot work.

**One question instead of one per service.** Pinging each resource would have meant a stub in
seven classes and, in each window, pings sent one after another, because the host's answer
channel cannot say which question an error belongs to. `ZCL_SDE_ADT_RES_ABOUT` answers for the
whole hub at once: every service, whether its handler class has an active version, and whether AVE
and ACE are installed. The list it reads is the router's own — `fill_router` now loops over
`ZCL_SDE_ADT_RES_ABOUT=>SERVICES` — so what a window is told and what is served are the same rows.
Whether a class is active is read from `PROGDIR` rather than by loading it: a resource class whose
tool had since been removed would otherwise stop the answer with a syntax error.

**What a window does with it.** Each window asks before anything else and waits for the answer
before reading the object it was opened on. What is missing is not drawn — Versions' finder and
Review card, SelecTor's Join, Metrics' flow and scheme — and a red line under the bar names it and
the reason: the hub is older than the window, the class is not active, the tool it reads through is
not installed. A window whose own main service is missing opens on that list. A system that cannot
say — no hub, or one older than `/zsde/about` — changes nothing, and its setup page says that a
hub that old cannot tell what it has. A 404 on a system that has everything is shown as the
resource's own answer rather than as setup: SelecTor asked for a table that does not exist used to
open the setup page too. The answer also names who is logged on, and the finder's user field
starts from it; what somebody has typed there is never replaced.

**The parts of an object became a table** in the same round, at the user's request: type, then
name, headed by the object. The class pool is gone from it, and from the resource rather than the
page: it is generated, nothing a developer wrote is in its versions, and `WORTH_SHOWING` is the one
place that decides which parts are worth a row — the assistant's tools read the same list.

**Then a class was split the way SE80 splits it:** each section, then the methods declared in it,
each marked the way SE80 marks visibility — a green square, a yellow diamond, a red circle — and
last, under Other, the local includes. The section of a method comes from the resource: the class
builder's own `SEOCOMPODF` and `SEOREDEF`, and public for a method implementing an interface.
ACE was the other candidate, since it knows the section by the include a method is declared in.
The answer is the same, but it would have cost a parse of the whole class on every open and made
Versions need ACE installed; the user chose the tables.

### What went wrong

- **The first answer was too narrow.** A sentence for the finder's own 404 was offered first; what
  was wanted was a way to tell every missing piece apart, in every window.
- **Still no way into QAS.** The ARC-1 servers had dropped out of the session, `abap-adt` points at
  the local trial and `fr_abap` at E19, which did not answer. The ABAP was checked with abaplint
  against stubs — the router and the new class both, with planted errors found — and not on a
  system.
- **Metrics has no test harness.** Its startup check was driven once from a throwaway script on a
  stubbed document — the flow modes removed, the setup list for a missing ACE, nothing changed for
  a hub that cannot say — rather than from a test in the repository.

117 tests pass across the VS Code, Eclipse bridge and MCP suites, nine of them new; the plugin
compiles with javac 26 at release 21.

---

## Stage 32 — the ABAP moves in, starting with ACE

**The ABAP half lived in three repositories that are not this one.** Simple Data Explorer held the
ADT hub and the resources; ACE and AVE held the analysis each of those resources reads through.
A window therefore needed four clones to work, and the tools it borrows from are the user's own
projects, which move for reasons of their own. The user asked for the ABAP to live here, renamed
`ZCL_VX_*`, and — after seeing what the dependencies actually were — for ACE to be rewritten so
that a portable core could be lifted out rather than the whole tool copied.

**Tracing what "necessary" meant was the first surprise.** Walking the references from the nine
`ZCL_SDE_ADT_RES_*` classes reaches 110 objects — every class and interface in all three
repositories, with nothing left over. Not because a resource calls all of them, but because
`ZCL_SDE_TOOLS` inherits from `ZCL_SDE_POPUP` and is instantiated with `NEW`, `ZCL_SDE_SEL_OPT`
holds a `TYPE REF TO ZCL_SDE_TABLE_VIEWER`, `ZCL_AVE_ACR_STATE` reaches `ZCL_AVE_POPUP`, and
`ZCL_ACE` is the GUI controller the flow walk keeps its state on. In ABAP a reference is a hard
dependency whether or not the branch ever runs, so the whole SAP GUI of all three tools came with
the ADT half. That is what turned a copy into a refactor.

**ACE first, and the seam was narrower than it looked.** Four things tied the analysis to the
window, and only one of them was real. The seven `ZCL_ACE_PARSE_*` classes named `ZCL_ACE=>TS_CALLS`
and its kin, but those were already aliases of `ZIF_ACE_PARSE_DATA` — 21 references, a substitution.
`ZCL_ACE_CODE_HTML` appeared to need `ZCL_ACE_WINDOW`; the reference was in a comment.
`BUILD_STEPS_FLOW` was locked inside `ZCL_ACE_MERMAID`, which inherits from `ZCL_ACE_POPUP`, yet the
method itself touches no instance at all — its own doc comment already said it answers "where there
is no SAP GUI at all". Only `ZCL_ACE_SOURCE_PARSER` was genuinely entangled, and it reads exactly
six fields off the controller: `MS_SOURCES`, `M_ZCODE`, `M_HIST_DEPTH`, `MT_CALLS`, `MT_STEPS`,
`M_STEP`.

**`ZIF_ACE_WALK`, because of the aliases.** Those six became an interface. The obvious alternative —
a context class owning them — needed about 220 edits across six GUI classes, since `MS_SOURCES`
alone is read 178 times through `MO_WINDOW->`. Instead `ZCL_ACE_WINDOW` implements the interface and
aliases each name back into itself, so every one of those references still compiles unchanged;
`MT_STEPS` and `M_STEP` moved there from `ZCL_ACE`, which cost 33 mechanical edits. `ZCL_ACE_WALK`
implements the same interface and holds nothing else, for a caller with no GUI. The drawing went to
`ZCL_ACE_FLOW`. ACE ends 250 lines heavier and 619 lighter across twelve files, and its windows
behave as before.

The core is 21 objects and reaches no GUI class: the parse, the statement grammar, the metrics, the
code-to-HTML scheme, the walk and the flow picture. Those are now `ZCL_VX_ACE_*` here, together with
the ten hub objects — `ZCL_VX_ADT_RES_*`, `ZCL_VX_ACE_SOURCE` and the BAdI registration
`ZVX_ADT_RES_APP`. The flow resource no longer builds a headless viewer; it creates a
`ZCL_VX_ACE_WALK`, and calls the parser and the scanner in the order `PARSE_PROGRAM` used to call
them. What still points outside is `ZCL_SDE_SQL`, `ZCL_SDE_TOOLS`, `ZCL_SDE_PIVOT`, `ZCL_SDE_SEL_OPT`
and the AVE classes — the next two stages.

### What went wrong

- **The linter said nothing, twice.** The rule is `check_syntax`; `syntax_check` is not a rule name
  and abaplint accepts the file in silence, reporting a contented "0 issues found" over any amount
  of broken code. Without SAP's standard objects it also skips the check it does run. Both were
  caught the same way — by planting an error abaplint had to find, and noticing it did not. The
  check that finally meant something ran with `https://github.com/abaplint/deps` mounted, and was
  read as a diff against the same run on the pre-refactor tree: 61 findings before, the same 61
  after, none of them ours.
- **The only-Z filter would have gone quiet.** `M_ZCODE` was set in the window's constructor, not
  declared with its value. A bare `ZCL_ACE_WALK` starts at zero, and zero means "descend into SAP's
  own code" — so the flow window would have quietly grown the whole standard call tree, with no
  error to notice. The default now sits on the field where it belongs. This is the one that would
  have shipped.
- **Still not run on a system.** `ZIF_ACE_WALK` does not exist on QAS, so a syntax check there would
  only report it missing; nothing was deployed, because deploying was not asked for. Everything
  above is checked against stubs, and the walk has not executed once.
- **The BAdI filter is still `/sap/bc/adt/zsde/*`.** The registration moved and was renamed, but the
  URI it claims did not change, since changing it means changing every client. Two implementations
  claiming one prefix cannot both be active, so a system with both SDE and VERTEX installed has a
  collision waiting. Named, not resolved.

**Lesson.** A tool with no test harness is verified by making the verifier fail first. Two of the
three checks in this stage were worthless and said so in the same words as a passing one.

---

## Stage 33 — the 500 came from the hub that was being replaced

**The pull landed and four windows answered 500.** All 32 objects were written to QAS between
14:51:09 and 14:51:42 and activated; a minute later `flow`, `table`, `join` and `versions` failed
while `metrics` answered. The shape of that split invited a theory — metrics keeps its whole chain
inside VERTEX and short, the other four reach `ZCL_SDE_*`, `ZCL_AVE_*` or the four core classes —
and the theory was wrong in a way no amount of reading the new code could have shown.

**It was not a half-activated pool.** `INACTIVE_OBJECTS` came back empty, and every one of the nine
`ZCL_VX_ADT_RES_*` class pools, every `ZCL_VX_ACE_*` and all three `ZIF_VX_ACE_*` stand at
`PROGDIR-STATE = 'A'`. So the failure was at runtime, and ST22 had six dumps between 14:52:19 and
14:54:47, every one of them `SYNTAX_ERROR` raised inside `CL_REST_ROUTER` at its
`CREATE OBJECT lo_object TYPE (ls_match_info-handler_class)`. The router could not load a handler.
`SYNTAX_ERROR` is a short dump, not an exception, so the `CATCH cx_sy_create_object_error` two lines
below never sees it and the request ends as a bare 500 with nothing in the body.

**The dump named the program, and it was the old one.**
`ZCL_SDE_ADT_RES_FLOW==========CP` — `Method "BUILD_STEPS_FLOW" does not exist. There is, however, a
method with the similar name "STEPS_FLOW".` Exactly one path reaches that class: the BAdI filter
`/sap/bc/adt/zsde/*`. The request was never addressed to `/vertex/*` at all. **The moved core was
never called once.** The half that had been checked so carefully was not in the failing path, and
the half that was failing had been left behind on purpose.

Why metrics worked follows without the theory: `/zsde/metrics` reaches `ZCL_SDE_ADT_RES_METRICS`,
which calls `ZCL_ACE_METRICS`, where the names still agree. `/zsde/flow` reaches a resource that
Stage 32 had rewritten to the new call names while it still pointed at the old classes —
`BUILD_STEPS_FLOW` is the `ZCL_VX_ACE_FLOW` name; `ZCL_ACE_MERMAID` has `STEPS_FLOW`. The old hub
was half-renamed and nobody ran it afterwards. The Eclipse plugin actually installed is older than
the rename; the repository itself has no `/zsde/` address left in it, which is precisely why looking
in the repository said nothing.

**The collision Stage 32 left open is not there.** `BADI_STRING_COND` has the two implementations on
distinct `STATIC_URI_PATH` filters — `/sap/bc/adt/zsde/*` to `ZCL_SDE_ADT_RES_APP` and
`/sap/bc/adt/vertex/*` to `ZCL_VX_ADT_RES_APP` — both active, no overlap, and no ICF node for
either. Stage 32's last bullet is stale.

**Removing the old hub, and what the cross-references said first.** Nothing outside the nine
`ZCL_SDE_ADT_RES_*` classes refers to them; `ZCL_SDE_ACE_SOURCE` has no consumers at all; and the
only includes anywhere on QAS referring to `ZCL_ACE_*` or `ZIF_ACE_*` from outside `Z_ACE` are those
same three. So the hub goes and `Z_ACE` closes on itself, leaving only its own SAP GUI. Deleted into
`ALCK900465`: `FLOW`, `JOIN`, `METRICS`, and `REQUESTS` — that last by hand, after ADT refused the
delete twice with a 404 while the object was still there. Still standing: `REVIEW`, `TABLE`,
`VERSIONS`, `APP`, `ABOUT` and the registration `ZSDE_ADT_RES_APP`, which ADT will not delete through
this interface at all. All ten also live in Simple Data Explorer, so deleting them only on the system
is half the job — the next pull of that repository brings them back.

### What went wrong

- **The wrong half was verified, carefully.** Signatures compared against `git show`, all 32 objects
  checked for both of their files, no `ZCL_ACE_*` literal left anywhere in `src/`, abaplint at the
  same eight findings as the SDE hub it came from. Every one of those held. None of them touched the
  code that was failing, because nobody had checked which address the client was calling.
- **"Nothing calls `/zsde/*`" was asserted, not measured — and a deletion was built on it.** The
  reasoning was that the repository has no old addresses left, which says nothing about the plugin
  installed in Eclipse. `ZCL_SDE_ADT_RES_METRICS` was deleted on that basis and it was the class
  serving the one window that still worked. Recoverable from Simple Data Explorer, but broken by a
  step whose stated reason was false.
- **`is_active` cannot see this failure.** `ZCL_VX_ADT_RES_ABOUT=>is_active` reads `PROGDIR` for
  `STATE = 'A'`, and its comment promises it reports a class "whose tool is not installed". A class
  whose load will not build is active by that test, so `about` reports `true` for a route that dumps.
  The check answers a narrower question than the page asks it.
- **The diagnosis ran without its own tools.** `SAPDiagnose` was unusable for the whole session: the
  client materialises the schema default `includeSubpackages: false` and the server rejects that
  field for every action but `unittest` with `type=DEVC`, so `dumps`, `syntax`, `object_state` and
  `atc` all failed before reaching SAP. The dump headers came out of `SNAP` instead — `FC`, `AP`,
  `AI` and `AL` in `FLIST` give the error id, program, include and line, which was enough to reach
  `CL_REST_ROUTER`. The body is a compressed blob, so the "Error analysis" text that named the class
  had to be read off a screenshot.

**Lesson.** Before proving the code is right, prove the request reaches it. Four careful checks
against the new hub could not have failed, because nothing was asking the new hub anything.

**How it ended.** The VS Code extension was rebuilt from the current sources - `vertex-abap-0.5.6.vsix`,
all eight of its ADT addresses `/sap/bc/adt/vertex/*`, none left on `/zsde/` - installed, and the
join window opened against QAS. It answered, and ST22 gained nothing: the seven dumps of the day
stayed seven. That is the moved hub's first execution, and it also settles a second question for
free - `ZCL_SDE_TOOLS` really does run without a window, not just appear to in the source. The
Eclipse plugin still has to be exported the same way; until it is, it remains on the addresses being
removed.

---

## Stage 34 — SDE moves in: the join builder without its window

**The seam was three classes.** The hub calls `ZCL_SDE_SQL` for three statics, `ZCL_SDE_PIVOT` for two
statics and two types, and `ZCL_SDE_TOOLS`, which `ZCL_VX_ADT_RES_JOIN` instantiates and then drives
through eleven methods. Copied as they stand, those three reach **18 of the 28 SDE objects, 8080
lines** — the whole tool with its SAP GUI, which is the same answer ACE gave in Stage 32 and for the
same reason: in ABAP a `TYPE REF TO` is a hard dependency whether the branch runs or not.

**It widens in four places, and none of them is behaviour.** An optional constructor parameter
`io_viewer` and the field behind it carry `ZCL_SDE_TABLE_VIEWER` — 2787 lines, counting `rtti`,
`plugins`, `dragdrop`, `dd_data`, `transmitter`, `text_viewer` and `py_cluster_viewer` behind it. One
declaration, `on_viewer_sel FOR EVENT selection_done OF ZCL_SDE_SEL_OPT`, carries 739 more.
`INHERITING FROM ZCL_SDE_POPUP` carries 57, and that base is nothing but four `cl_gui_*` fields.
`ZCL_SDE_APPL` is read seventeen times — five of them for `GV_ROWS` — and brings `ZCL_SDE_RECEIVER`
with it.

**The behaviour was already there.** Of the twelve methods the hub calls, exactly one touches the
window: the constructor. Below the facade every access sits behind `CHECK MO_VIEWER IS BOUND` or
`CHECK VIEWER_ALIVE( )`, including the pivot's `rebind`, whose comment says *"No window: the caller
has the matrix in ER_RESULT"*. Stage 13 did that work when it replayed the builder over a stateless
protocol. Nothing had to be made headless; the types had to stop pointing at a window.

**So the cut is fourteen line ranges, not a rewrite.** `ZCL_VX_TOOLS` is 3049 lines against the
original's 3270. The constructor keeps only its headless branch; `OPEN_LAYOUT_FOR` — which opens a
second SAP GUI window — says which table the file belongs to and stops, rather than loading a layout
against the wrong base; `VIEWER_ALIVE` answers `abap_false`; `FILL_SEL_EXTRAS`, `CACHE_WHERE_SELECTION`
and `SYNC_SEL_PANEL` keep their names and empty out, so a subclass with a window overrides them; and
the two `rebind` tails become one hook, `ON_RESULT`. Everything else — `cl_gui_html_viewer`,
`cl_salv_*`, `cl_gui_frontend_services` — is SAP's own and moved untouched.

`ZCL_VX_APPL` is the one object not copied but rewritten: 160 lines down to 63. Out go the icon table,
the report controls, and `MT_OBJ`, the registry of live windows. Out too go `TRANSMITTER` and
`RECEIVER` from `SELECTION_DISPLAY_S` — not for tidiness, but because `ZCL_SDE_RECEIVER` holds a
reference to `ZCL_SDE_TABLE_VIEWER` and one to `ZCL_SDE_SEL_OPT`, so two fields that are always
initial without a window would have pulled the entire GUI back in behind a type nobody reads.

Seven objects, and the hub now points at them: `ZCL_VX_SQL`, `ZCL_VX_DDIC`, `ZCL_VX_COMMON`,
`ZIF_VX_PIVOT_TYPES`, `ZCL_VX_PIVOT`, `ZCL_VX_APPL`, `ZCL_VX_TOOLS`. One `ZCL_SDE_` name is left in
`src/`, in a comment, and it points at `ZCL_SDE_PLUGINS`, which stays where it is.

### What went wrong

- **The recommended approach was wrong, and reading further is what showed it.** The plan was to
  mirror Stage 32: two interfaces, `ZIF_VX_VIEW` and `ZIF_VX_SEL`, aliased back into the SDE viewer so
  one implementation serves both. That works when the seam is fields on a window, as it was for ACE.
  Here `MT_SEL_TAB`'s row type carries `TYPE REF TO ZCL_SDE_TRANSMITTER` and `ZCL_SDE_RECEIVER`, and
  the receiver points straight back at the viewer and the selection panel — so an aliased interface
  re-drags exactly what it was drawn to cut. The hook-and-subclass shape replaced it.
- **abaplint said nothing, a third time.** `check_syntax` alone does not report an unparseable
  statement. Garbage appended to a moved class left the count at 44 and named nothing; the rule that
  catches it is `parser_error`, and with it on the same plant went 81 to 82, named and located. The
  baseline was then recorded per file so the move could be read as a diff: 81 before, 81 after the
  seven objects landed, 59 once the hub was repointed — the drop being the `ZCL_SDE_` classes the
  resources could not resolve. The lesson from Stage 32 held and was not enough: a verifier has to be
  made to fail on the *kind* of error being made, not on any error at all.
- **Two sections named the same thing.** The class already had a lowercase `protected section.`, and a
  second `PROTECTED SECTION` was inserted for the hook. Activation would have refused it; abaplint
  reported `Expected ENDCLASS` against line 1, which is a true statement about the file and says
  nothing about where the fault is.
- **The shell ate the quotes, three times.** Regexes and ABAP literals written through a heredoc lost
  their backslashes and apostrophes, once silently enough that `TYPE 'S' DISPLAY LIKE 'E'` reached the
  file as `TYPE S DISPLAY LIKE E`. The linter caught that one. Text with literals in it goes through
  a file, not a command line.

**Lesson.** The seam is measured, not read. Four references, a script over the reference graph, and
the size of what each one drags — that is what turned "the whole tool comes with it" into fourteen
edits.

**Not done here.** SDE's own `ZCL_SDE_TOOLS` still holds a full copy of the logic, as do `ZCL_SDE_SQL`,
`ZCL_SDE_PIVOT` and `ZCL_SDE_COMMON`. That was first written up here as a drift risk to be closed by
making the SDE class a subclass of the moved one, which was wrong: a ported project is frozen, so the
old copy is not going to change and cannot drift. What is open is not a refactor but a decision —
whether one core can be kept replicated between the two at a price worth paying, and if not, the SDE
side simply ends. Everything is moving to Eclipse and VS Code, so its SAP GUI has nothing to protect.
The AVE classes are the stage after: `review` and `versions` account for 46 of the 59 findings that
remain.

## Stage 35 — choosing the model, and which system a window means

The request was small — the model list showed `haiku`, `sonnet`, `opus` with no versions — and it
opened three questions in turn: what the list is, where it is chosen, and which system a window
speaks for.

The list for a Claude subscription had been a set of aliases on purpose: Claude Code reports no
catalog, and an alias always means the newest of its family, so the list could not go stale. That
reasoning held and was still the wrong answer, because pinning an older version — Opus 5 instead of
5.5 — is exactly what an alias cannot do. The list became VERTEX's own table of full ids, updated by
hand when a model comes out, with the newest of each family on by default. The Anthropic API needed
no such table: `GET /v1/models` answers for the key, the same call ABAP-AI-Code already made. Every
provider then got one **LLM Providers** table, storing what is switched off for the providers that
list their own models, so that a model they add later appears on its own.

The same work renamed the providers. "Codex subscription" named the client, not what is paid for:
the subscription is ChatGPT's, and a subscription has no public API, so it works only through the
vendor's own client. That is now what the labels and the README say.

A VERTEX Tools window then turned out to be named by nothing and bound to nothing: every window read
from `vertex.active`, so two windows on two systems were impossible and a tab could not say which
system it showed. A window now keeps the system it was opened on. Rather than threading a system
through every fetch, the window's messages run inside an `AsyncLocalStorage` scope and `active()`
answers from it. The scope does not cross a process boundary, so the address handed to Claude Code
or Codex carries `?system=`, and the MCP server re-enters the scope for those calls. The panel's
chat went the other way: its SAP tools take `system`, so one conversation can read in one system and
draft in another, and the draft still goes through the reviewer, whose title names the target.

### What went wrong

- **Silent fallbacks, twice.** The first Anthropic model list came from the API with no fallback,
  as intended; the first Claude list kept the aliases *and* added versions, which only made the
  list longer. Both lists ended as one table, and a table with nothing ticked is refused on Save
  rather than quietly emptied into a default.
- **A hover that removed the button.** `button.secondaryHoverBackground` is not defined by every
  theme; where it is missing, the hover rule set an empty background and the button vanished under
  the pointer. The hover now keeps the button's background and adds the theme's focus border.
- **The connection key reached the chat.** A search in VS Code names its system by the repository
  key — url, client, user, name — and the direct-open answer printed it whole. Only the name is
  shown now.
- **Five failing tests were not ours.** The versions tests fail on a clean checkout too — the fake
  DOM has no `classList`. Each change was compared against that baseline, not against zero.

The Versions window took AVE's layout back in the same landing: the list of versions moved from the
right-hand pane, where the diff used to replace it behind a *← Versions* link, into the parts column
under the parts, and the diff keeps the right. That made room for AVE's pinned base — compare any two
versions, not only a version with its predecessor. AVE's three switches followed on the ABAP side,
where the diff is computed: `ZCL_VX_ADT_RES_VERSIONS` takes `toc`, `dups` and `ic`, and each one was
already written — `ZCL_VX_VRSD`'s `no_toc`, `ZCL_VX_VERS_DATA=>REMOVE_DUPLICATE_VERSIONS`, and
`COMPUTE_DIFF`'s `i_ignore_case` — carried over from AVE and never reached from the resource. The
TOC switch applies to the list only: a diff reads both its versions whatever the list shows.

`SAPDiagnose` refused the syntax dry run on QAS for the reason already on record — the client adds
`includeSubpackages` to every call — so the check was abaplint against a baseline: the same fourteen
findings before and after, and a misspelt parameter planted in the new call reported on its line.

The calls flow of `Z_AVE` then disagreed with ACE's own window in SAP GUI: VERTEX drew three
classes called straight from the program and `/UI2/CL_JSON` under one of them, ACE one class and
four under it. Neither was wrong. ACE's `STEPS_FLOW` is called with `I_CALC_PATH` whenever "Show
All Steps" is off, which is its default, and keeps only the events its `GET_CODE_FLOW` marks as the
calculated path; the port had taken the drawing and left the path behind, so VERTEX always drew
every step. Of `GET_CODE_FLOW`'s nine stages the flow reads one thing - the event names of the
lines marked `ACTIVE_ROOT` - so that is what came over, as `PATH_EVENTS`, with ACE's reads left as
they were: a `READ TABLE ... INTO` that misses keeps the previous row, and only the first variable a
line computes counts. Changing either would draw a path ACE does not.

**Lesson.** A list that "cannot go stale" is only right while nobody needs an older entry. Ask what
the list is for before deciding how it is kept.

---

## Stage 36 — the builder and its rows in separate panes

The join and the pivot drew everything in one scrolling column: ten rows of the answer in a
200-pixel box, the builder under it. A wide join left the reader scrolling the page to reach either.
Now the rows are a short pane on top (at most a third of the height) and the settings fill the
larger pane below, each scrolling on its own; Full view removes the settings pane, and the rows get the whole window.

In the same landing View source got Open in the Editor. VS Code reuses `open_sap_object`; Eclipse
navigates through ADT, and a function module's URI is found by quick search because it goes
through the function group, which the page never knows. The button calls the host directly rather
than through `queue()`: that path answers into the page's pending result, which the source page
is not waiting for. Both hosts were bumped to 0.7.0.

LLM Providers became a tree in the same landing: the provider dropdown hid every table but one,
and choosing a provider there doubled as choosing the one in use on Save. Now all providers show at
once, and In use is its own switch. A provider's switch is `off: true` beside its model settings in
`vertex.ai.modelConfig`, so switching it off keeps the ticks. The provider in use cannot be switched
off, and a switched-off one cannot be put in use - the page refuses both, and so does the host.

## Stage 37 — the arrow is not part of the name

Double-click on `load` in `zcl_ave_version_list=>load(` did nothing. The double-click handler only
navigates when the selection equals the word under the cursor, and `wordAt` counted `<` and `>` as
name characters for field symbols - so the word was `>load` and never matched the selection
`load`. The same broke `lo_ref->method(`. Angle brackets now join the name only as a pair around
it, `<ls_row>`. The test host gained a mouse-selection event so double-click is covered.

The hover on `abap_bool` then showed only `ABAP_BOOL (PROG/PY)`: the declaration line was looked
for only in the tab's own source, and `abap_bool` lives in the type pool `ABAP`. When ADT's
navigation points at another URL, that object's active source is now read (`sourceAt`, once per
URL) and the declaration taken from it. Double-click and Go to open it: a class or a program as its
editable VERTEX tab, anything else - a type pool, an interface - as a read-only view, because
VERTEX edits only PROG, CLAS and FUNC. The line comes from the active source, so in an editable
tab with an unactivated change above it the cursor can land a few lines off.

A data element has no source, so for `versno` the hover still said only what it is. Its domain,
type and length now come from ADT's data element properties, read once per name. Double-click
stays on code: a data element is not opened.

The read-only view was a dead end: hover and navigation were bound to `vertex-sap` tabs, and the
view is a `vertex-source` snapshot, so the hover in it stayed on another extension's Loading. The
view now keeps its system and ADT source URL, and the providers and double-click take it as well.

`zif_ave_popup_types` still opened read-only: VERTEX edited only PROG, CLAS and FUNC. INTF
(`INTF/OI`) joined them - an interface is one source, like a program, so reading and saving needed
no change beyond the type. Creating one is refused in `create_sap_object` and left out of the
Create command; nobody asked for it.

On a declaration itself ADT's navigation answers HTTP 400 with an info message, "Definition
location found; where-used list may be possible", instead of a location; arc-1 shows it as
`I::000`, a message without a class or a number. The hover took it for a failure. That answer is
now read as "declared here" and the declaration taken from the line. It is recognised by its
text - there is nothing else to go by, and VERTEX logs on in English.

`NEW zcl_ave_popup(` went nowhere: ADT's navigation on the class name points at the class with
no line. Eclipse goes to the constructor, and so does VERTEX now - `NEW name(` is read as a call
of `CONSTRUCTOR`. A class without its own constructor opens at its start.

Outline was empty for a VERTEX tab: VS Code knows nothing inside ABAP until an extension tells it.
A document symbol provider now builds the tree from the tab's own statements (`abapStatements`),
without SAP, so it follows unsaved edits. A class shows its sections with the declared methods, but
each method's range is its implementation, where a click should land; a section's range therefore
covers its methods in the implementation part too. VS Code's ranges are immutable, so a plain tree is
built first and turned into symbols last.

Double-click on `CASE` went to the first `WHEN`: IF and CASE walked their branches, which is
useful but not what a jump from the opening wants. Asked for long ago: `IF` to `ENDIF`. Now the
double-click jumps from the opening to its end and back, and F12 (VERTEX: Go to) and Ctrl+click
keep the walk through the branches. The first cut sent VERTEX: Go to to the end as well and so
broke F12, which is bound to that command, not to the definition provider. VS Code's selection event carries
no modifier keys, so Ctrl on the double-click itself could not be told apart.


The VS Code extension went out as 0.7.2 with all of this; Eclipse was not rebuilt.

## Stage 38 — an assistant at the debugger

The question was whether an assistant could debug ABAP by itself. A probe outside the extension,
on the same `abap-adt-api` VERTEX uses, answered it step by step on QAS:

- A breakpoint set over ADT stopped nothing on its own. It needs a listener (`debuggerListen`).
- With a listener, a run from WebGUI stopped; one from the standalone SAP GUI never did - not for
  ABAP FS, not for the probe, not for Eclipse. SAP's documentation says it outright: ADT
  breakpoints are not considered in SAP Logon sessions. Terminal mode with SAP GUI's own
  TerminalID from the registry caught neither SAP GUI nor WebGUI. QAS has one application
  server, so it was never a server mismatch. Settled: runs start in WebGUI.
- Stepping line by line and recording what changed traced Z_CALC in 133 steps, first at about
  3 steps a second, then 5 once only the executed statement's variables were read. The trace
  showed the planted bug in two neighbouring steps: the customer changes, the total does not
  reset.
- A condition on the breakpoint is checked by SAP. `lv_customer_total > 1000` on line 45
  stopped exactly on orders 4 and 5: two stops, a dozen requests, under a second, against 451
  requests and 26 seconds for the full trace.
- The first conditional run lost its second stop. After a stop the program stays under the
  attached session, and the next stop is the answer to "continue", not a new listener hit;
  the probe had left the session. "continue" on the last stop throws when the program ends.
- An Eclipse debug session left open took the stops: one listener per user.

What landed is the pilot of that: `debugger.js` (no VS Code API, like `sap-code.js`) and a
second tool set in `mcp.js` at `/debug`, so the review at `/mcp` and what its registrations see
stay unchanged. Breakpoints are sent as the full set and a condition goes in a second round, as
ABAP FS and Eclipse do. Mode `log` records and continues inside the same session; mode `stop`
hands the stop to the assistant. A stop returns the stack, five source lines, the variables that
changed since the last stop and the first rows of a changed table; `debug_read` reads the rest.
Variables are never changed and the program is never jumped around - the user did not ask for
it. An open Eclipse or ABAP FS listener is reported, not taken over. The standalone stdio server
does not get the debugger yet: it has no VS Code to open WebGUI, and a listener has to outlive a
single call.

The first try of the pilot went to the wrong place: the question was asked in the VERTEX chat,
whose assistant had only the source tools, and it found the bug by reading the code - Z_CALC's
planted bug is visible in the text, which makes it a weak test for a debugger. Registering
`vertex-debug` for Claude Code then tripped twice: the command only copies the line, and a window
not reloaded after installing still offered the old two entries. So the chat got the debugger as
well: its `/chat` set now carries the `debug_*` tools beside the source tools (a wrapper whose
schemas and instructions stay getters - `Object.assign` read the source tools' instructions at
activation, before any system was known, and a test caught it). A chat answer that may use SAP
tools waits ten minutes instead of three, for a WebGUI logon and the program's way to its
breakpoints. Released as VS Code 0.7.3; Eclipse was not rebuilt.

Z_CALC proved the plumbing but not the point: its bug reads off the code. `Z_VX_DEBUGGER_TEST`
went into `src/` instead - one screen, four order lines, a total that comes out low, no error and
no line that looks wrong. What goes wrong is what a statement silently does not do, so reading
the code is slow and a stop in the right place is quick. The answer is deliberately not written
in the program or in the user-facing documentation.

Then a run meant for E19 opened WebGUI on QAS. The debugger connected once, on its first call, and
kept that connection for the life of the window; the user had switched systems since. It now asks
which system is active on every call and reconnects when that changed - unless breakpoints or a
stopped program still live on the old one, which would be left behind there: that is refused with
a pointer to `debug_stop`. A test for it caught a second slip - `setBreakpoint` added the line to
its list before checking the system, so even after `debug_stop` the switch was refused.

"Fix it" in the chat opened four windows: the draft, its review, the SAP source tab and a Tools
window on the version diff. The last two were the navigation instructions at work - an editing
request was told to open an editable tab, and the model added a diff view on top. Both showed the
old source, the one with the bug, next to the fix. The first guess here removed the draft's diff
editor instead, which was not what the user meant, and was undone. The instructions now say a fix
goes through `modify_sap_object` alone, with no tab and no navigation.

That still left the draft itself, and the user put the finger on it: the review belongs to saving,
not to the change. A draft was a second, untitled document with no VERTEX menu, whose close asked
to save it to a local file, while the real tab went on showing the source with the bug. Now a
change to an existing object is written into that object's tab through a WorkspaceEdit - unsaved,
undoable - and the repository's draft is discarded at once. Saving is the user's: the tab's Save &
Activate or Review & Activate, the same as for edits of their own. The one guard: a tab with edits
SAP does not have is not overwritten - the change is refused with a sentence saying why, since it
was written against the SAP source and would silently undo the user's work. Creation keeps the
draft, having no tab to write into.

On E19 WebGUI would not open at all: `debug_run` used the system's `url`, an HTTP port by IP
address, and SAP redirected it to HTTPS on the system's own full host name, which the user's
computer could not resolve. The same page answered at the IP on the HTTPS port. The fix is a
setting, not a guess: an optional `webgui` address per system, used instead of `url` when present
and refused when it is not an http(s) URL. The documentation also gives the other way round - a
`hosts` entry for the name in the redirect - for whoever may not change the settings.

The next run on E19 came back with two "bugs found using the debugger" - both wrong, and
`debug_status` showed no stop and no log entry. The model had set its breakpoints and opened
WebGUI; one `debug_wait` of sixty seconds ran out while the user was still logging on; it called
`debug_stop` and reported what it had guessed from the source as if the debugger had shown it. The
tools allowed a longer wait all along. Two sentences went into the server's instructions: wait
again, and ask the user, while nothing has stopped; and no stop, no verdict.

Eclipse went out as 0.7.3 as well, its first build since 0.7.0, so the version numbers of the two
hosts meet again. `docs/` was emptied before the export, as BUILD.md says, and the jar was checked
for what went wrong once before: 49 classes, the Assistant runtime in `assistant/` with the fix-
without-navigation rule, and one build in the catalogue. The VS Code vsix was rebuilt through
`package.ps1` for the release; the earlier packages of this stage had been made with `vsce`
directly, which BUILD.md forbids because it skips the check of `abap-adt-api` and the pages.

The debugger's documentation then got what a first installation needs: what has to be in place -
notably that the ABAP side of VERTEX is not needed for it at all, only standard ADT, the debug
authorisation and WebGUI - a quick start in seven steps, advice to use a strong model (the pilot's
two wrong answers both came from Haiku), and a table of symptoms. One row there documents a limit
rather than a fix: while a Tools window shows a diff, UML or metrics, the chat answers without
tools. Changing that rule was proposed and not decided, so it is written down instead.

It was decided the same day, the other way round: the row came out of the table and the rule out
of the chat. The rule had been a token guard - a short question about the method on screen should
not start an agent loop - and it cost more than it saved: the chat lost every tool without saying
so, `debug_status` came back as "not available", and with several Tools windows open nobody could
tell which one had switched the tools off, since the context is the last window to report, not
the one in view. Now the tools always stay; the screen still travels with the question, with an
instruction to answer from it when it is enough and not to read the object again. The two tests
that pinned the guard now pin that instruction and the kept tools instead.

## Stage 39 — Visual Debug: the debugger on screen

Smart Debugger shows the whole state of a stopped program at once, but it is a SAP GUI debugger
script built on `CL_GUI_*` controls; none of its code can run in a webview. What carried over is
the picture: all variables in trees by group, initial values hidden, objects unfolded by
visibility, tables in grids of their own, changes since the last stop marked. The pilot takes
that and leaves out the rest - stepping back, coverage, diagrams.

Two questions were settled before any code. **VS Code only**: Eclipse has its own debugger, to be
looked at separately. **One session with the assistant**: SAP keeps an IDE's breakpoints by user
and IDE id, and one listener takes a stop. A second debugger in the same window would have taken
the assistant's stops at random, and the assistant could not have read the stop on screen. The
cost is that a step or `debug_stop` from one side moves the other.

What that meant for `debugger.js`:

- **The window must not eat the assistant's news.** `debug_wait` collects stops, ends and
  problems once. The window reads a separate `picture()` and is woken by `watch()`; a step from
  the window is `advance()`, the step without the collecting that `debug_step` does after it. A
  test pins it: a step from the window, then `wait()` still returns the stop.
- **One request at a time on the stopped session.** Before, only the assistant used it, one tool
  call after another. Now the window reads variables while the assistant may step, so every use
  of the stateful session goes through one queue (`exclusive`).
- **The lines are the active version's.** The source VERTEX shows is the working area; a
  breakpoint counts lines of what runs. The window reads the active source on the stateless
  connection.
- **Breakpoints by source URL**, since the window knows what it shows, not a type and a name:
  `objectOf()` reads the object back from the URL. That brought function modules in, whose URL
  names the group. The assistant's tool schema was left as it was.

Visual Debug had to stay out of Eclipse, which loads the same `object-tools.js` and `tools.html`.
The shared model got `enable()`, which only VS Code calls - in its Node module and in the page it
builds - and `tools.html` routes to the page and to the debugger only when the host defines
`sdeDebug`. The page itself lives in `vscode/pages/`, outside the shared resources. Its
instructions are now read when asked, so the text the assistant gets names the action only
where it exists.

Checked with tests on a fake SAP and with the page in a browser against a stubbed host. Not yet
against a live system - which names SAP gives the variable groups, whether a class or function
module stop reports the URL the breakpoint was set on, and what `ACCESS_KIND` holds for
attributes are all the first things to see on A4H.

The first run on E19 went through. What it asked for next was speed. ADT has no "what changed" -
Eclipse compares too - so exactly the changed variables cannot be read. The window now reads again
only what a plain statement names, and everything switched on after a call, a step out or a
Continue; group switches turn reading off altogether. And to know what a step costs at all, Visual
turns Continue into a run of F5 steps with no variables read: `advance(kind, quick)` skips the
snapshot the assistant gets, and returns the time of SAP's step request and of the whole step. The
assistant, which has no such run, still gets what changed at the next ordinary stop, against the
last values read.

The first Visual run measured about 335 ms a step, 160 of them SAP's step request. The rest was
mostly the stack, asked after every step because SAP's answer to a step carries no position at
all - not a line, not an include. The idea of skipping it "when the stack does not change" does
not hold: the stack may not change, but the line does, and nothing else says which. What does is
ACE: its parse already holds every statement of every include, cut by SAP's own scanner, with its
keyword and tokens. A new `statements` mode of the flow resource hands that over as a map - start
and end line and a kind: `decl`, `plain`, `call`, `flow`. From plain to plain the next line is
certain unless the statement raises; everywhere else the stack is asked. The raise case is not
hidden: whenever the stack is asked after a plain statement, the window checks that the program
stands where the map said and reports the miss. Classes and function modules are left out for
now - their frames count lines in the main source, the map in the include.

The first version of the map did not reach the system: two pulls left the old class active and
nothing on the inactive list, and the window got the old "Parameter include could not be found".
The keyword lists had been written as literals joined with `&`, which the compiler folds into one
literal - and a literal may not be longer than 255 characters. A syntax check of the source
through `fr_abap` named it at once (`arc-e19`'s SAPDiagnose refused the call over
`includeSubpackages` again). The lists are now joined with `&&` at run time.

With the map in place the same run took 12 of 31 steps without the stack, 320 ms a step down to
260. What decided the other 19 was not the stack's depth - a LOOP or a WRITE leaves it as it is -
but the line, which only data decides at a LOOP, an ENDLOOP or an IF. A plain PERFORM is
different: where it goes is in the text, and so is where its ENDFORM returns to. The map now
names the form of each FORM and plain PERFORM; the window adds a frame on the way in and drops it
on the way out, marks such a stack as predicted - no level of it can be switched to - and asks
SAP once where the run stopped, checking the prediction against it.

Looking for what else a step costs turned up the transport: the HTTP agent VERTEX gives
abap-adt-api was created without `keepAlive`, so every request to SAP - every step, every stack -
opened a new connection with its own TLS handshake. It keeps the connection now, for all of
VERTEX, not only the debugger. It did not show in the numbers: a step stayed at 159 ms, a stack at
156 - the time is SAP's own.

That left the steps only data decides. The answer to those was not to predict them but to skip
them: nobody watches a loop go round, so at a LOOP, DO or WHILE the run now sets a point on the
statement after the matching end - found in the map by nesting - and runs to it with F8
(`runTo`). The point is the window's alone: it goes to SAP with the user's breakpoints, is listed
nowhere, and is taken away before the stop is read, so the stop is never taken for one of the
user's. A breakpoint of theirs inside the loop still stops it, as F8 would.

Local methods came the way PERFORM did. The map names each METHOD by its class, and a standalone
call by the method it enters where the text settles it - `lcl=>m( )`, `me->m( )`, `m( )`,
`CALL METHOD m`. Two things can make the name lie, and the map drops the name for both: a local
class inheriting from the class, so that ME may be the subclass with the method redefined, and a
class constructor, which runs first the first time the class is touched.

A run through Z_ACE went 966 steps deep into SAP's own classes and slowed the whole machine. The
window was the cause: every change of include redrew the source whole - four thousand lines of
`CL_GUI_SOURCEEDIT`, a node per word - read it from SAP again though it had it, and drew each
stop twice, once from the run and once from the debugger's event. Drawn sources are now kept (the
last six) and put back, read ones are not read again, and the event is ignored while a run draws.

The same run showed why a global class got no prediction: its frames count lines in the class's
main source, the map in the method's include. The window finds the METHOD the stack names in the
main source and shifts the include to it; the same check - each statement on its line with its
keyword - decides whether the shifted map is used.

Z_ACE then ran 115 steps with 110 predicted - and showed the wrong code. The program has local
classes named as global ones, and ACE's parse of a program brings in the global classes it
refers to: the map for Z_ACE held the global ZCL_ACE's includes, a call was predicted into one
of them, and the window drew that include while SAP was elsewhere. The map now holds the
program's own includes only; a call into a global class is left to SAP. The statistics gained
a "window" figure - a step's time less SAP's requests - so that what the window itself costs is
read, not guessed: about 20 ms of a 180 ms step.

In Z_ACE_STANDALONE the line stopped moving. `mv_prog = i_prog. mv_package = i_package.` is two
statements on one line, and the window found "the statement at this line" by the line alone - the
first one, every time. The step from the first to the second was predicted, the line did not
change, and the next step started from the first statement again: the same line, predicted
forever, while SAP went on - and all plain, so nothing asked SAP and nothing caught it. The window
now keeps the statement it arrived at for each level of the stack; where a line holds several and
the window came there by the stack, not by a prediction, it does not know which one and asks SAP.

Z only first worked after the fact: F5 into the call, see that it is not Z/Y, F7 back - two steps
and two stacks for every standard call. Where the text already says whose code a call enters,
that is waste: the map now lists, for a statement with calls, the owner of each - the class of
`cl=>m( )` and `NEW cl( )`, the function module of a literal `CALL FUNCTION`, the current class
for `me->m( )` - and ? where only the data knows. A statement whose calls all go outside Z/Y
is stepped over with F6, and the next statement taken from the map.

A run of 325 steps over Z_ACE suggested what a run is actually good for: the flow, which routine
calls which, recorded rather than guessed - ACE's Calls diagram walks every branch, a run only the
one taken. For that the statements in between do not matter at all. A Flow run therefore does not
step: in a routine it sets points on every call that may enter Z/Y code and on the routine's
end - on all of them, since which branch runs is the data's to decide - and runs to the first one
reached; a routine with nothing to call is left with F7 at once. `runTo` took a list of lines for
it. Every stop records the stack against the one before; each level added is an edge. The picture
is Mermaid, loaded as Metrics loads it: by class, or by routine grouped by class.

The first Flow run on ZSDE2 went through a whole Z constructor without a stop: `CREATE OBJECT
<obj>-alv_viewer EXPORTING ...` has no bracket, no arrow and no calling keyword, so the map had
it as a plain statement, and no point was set on it. `CREATE` is a call now; its owner is the
class after `TYPE`, or ? where the reference's type decides - and CREATE DATA, which runs
nothing, is stepped over.

The same run showed the other half: `CHECK zcl_sde_sql=>exist_table( gv_tname ) = 1.` is a flow
statement to the map, and Flow set points only on call statements, so the method it calls was
never entered. A statement's kind says where the program may go next; whether it calls
something is a separate question. The map now answers it on its own (`calls`), with the owners
of the calls for any statement that has them. Flow stops at every statement with a call that
may enter Z/Y code; the F6 prediction stays with call statements alone - after `IF cl=>x( )`
the condition, not the text, decides the next line.

On A4H the map was there - active, fresh, the window reloaded - and still nothing was predicted
and no call stopped. The check that lets a map be used on a source had demanded that every
statement it looked at start its line with its keyword, and one that did not switched the map
off for the whole include, silently. `ENDIF. LOOP AT ...` is enough for that. The keyword may now
stand after a period or a colon too, nine statements in ten must stand where the map says, a
statement whose own line did not check out is never predicted from or to, and a map that does
not line up says so, with the count.

That was the wrong answer, and the user said why: patterns over the text are one guess on top of
another, and each new program finds a hole in them. ACE never read the text to follow a run - it
took the include and the line from the debugger. ADT's stack does not give a class frame's line
in its include, but SAP says the rest itself. A frame at the address of a program or an include
counts the same lines as the map of that include, by construction. A frame of a global class
counts in the class's main source, and ADT's class structure (`classComponents`) gives each
method's implementation line there; the frame's method is the stack's `eventName`. The offset is
that line less the METHOD line in the map. Nothing is compared with the text any more; what fits
neither case is not predicted.

A line of diagnosis under the buttons then showed the map, the statement and the points all
right - `points on 110, 111, 112, 127, 128, 129, ...: F8` - and the program running past 127 to
the user's breakpoint at 132. The points had never worked. ADT keeps two sets of breakpoints:
scope "external", for the runs to come, and scope "debugger", the set of the program being
debugged, sent on its own session. `runTo` had put its points into the external set, which a
program already stopped in the debugger does not look at. Every loop "passed" so far had in fact
run to the user's next breakpoint, and the counter counted points placed, not points reached; the
fake SAP of the tests stopped wherever it was told, so no test could see it. The same held for a
breakpoint the user set by a click while stopped: it was for the next run, not this one. The
points now go into the stopped program's own set, beside the user's breakpoints with their
conditions, and are taken out of it before the stop is read; a change to the user's breakpoints
reaches that set too. The fake SAP keeps the two sets apart, so the test now checks the scope.

With the points working, Flow on ZSDE2 still left out a call the Visual run showed: from the
constructor's line 124 into `GET_FIELD...`. The call is written bare, `get_field...( )`, in a
method include of a global class; the map could not say whose it was and left the owner empty,
and the window read an empty list of owners as "all outside Z/Y". The deeper fault was the map
guessing calls from tokens at all, when ACE resolves every call of a statement itself - ME,
SUPER and references by their declared class, CREATE OBJECT as its constructor, FORMs and
function modules by name. The map now takes a statement's calls and their owners from ACE's
`parse_calls`; my token reading of owners is gone. An empty owner list counts as unknown, and the
step log gained a column saying, for every statement of the routine with a call, what the run
made of it - so a Flow run and a Visual run over the same program can be laid side by side.

A Visual run then went seven levels down into CL_GUI_ALV_GRID and on to ALEWEB_GET_CONTEXT with Z
only on. Z only had one trigger: a step from a Z/Y frame that landed outside Z/Y. Anything that
brought the run into SAP's code another way left it there, stepping F5 through it. The likely
way in was the predicted F6: `mo_alv = NEW #( ... )` placed by ACE as a CL_GUI_ALV_GRID call,
stepped over, and its next line taken from the map without asking - while SAP had stopped inside
the constructor. Z only now looks at every stack: whenever the top frame is not Z/Y and Z/Y code
lies below it, the run steps out, as often as it takes, before anything else. An F6 over a call
outside Z/Y reads the stack after it instead of predicting the line.

The next run showed the step out itself was too small: 41 standard calls "passed", and the run
was still six levels down in CL_SALV_GZ_FACTORY's class constructor. F7 leaves one level; `NEW
cl_gui_alv_grid( )` is a chain of constructors and class constructors, and after each F7 the
program stood in the next one of them. The way back is now one jump: the nearest Z/Y frame on the
stack is found, points are set on every statement of its routine and on its end, and F8 runs to
the first one reached - F6 as seen from our code. F7 is left for a frame the map does not cover.
The statistics and the log show the depth of the stack.

The first full log of a Visual run over ZSDE2 - 777 steps - was mostly three loops stepped
through pass by pass: GET_FIELD_INFO's twelve times over, CREATE_FIELD_CAT's, and the outer loop
of HANDLE_USER_COMMAND, whose inner loop was passed in one jump each time. The jump had one
point, the statement right after ENDLOOP, and gave up when that statement closed a block - an
ENDMETHOD after a loop at the end of a method, an ENDIF after a loop inside a branch. It now sets
points on every statement of the routine after the loop, its end included, and stops at the first
one reached. Copying that log froze the window for seconds: the page fell back to a selected
textarea holding all of it. The text goes to VS Code's clipboard through the host instead.


## Stage 40 — ABAP Unit in the Test Explorer

Eclipse runs a class's tests with Ctrl+Shift+F10; VS Code had nothing. The ADT call is the same
`abapunit/testruns`, and `abap-adt-api` already had `unitTestRun`, so the work was on the VS Code
side: a Test Controller whose tree is object, test class, test method, as Eclipse's ABAP Unit
view. SAP answers with a whole run at once, so the tree is rebuilt from each result, not
discovered beforehand. A failure's stack points at an include and a line
(`.../includes/testclasses#start=19,4`); that opens the include as a VERTEX tab and becomes the
message's location. Only harmless tests run, every duration: a test marked dangerous changes
data, and choosing that stays the user's. A dirty tab is refused rather than run against a source
the user is not looking at. View source got the same run as a button beside Open in the Editor;
the page is shared with Eclipse, so the button shows only where the host defines
`sdeRunUnitTests` - VS Code does, Eclipse not yet.

ATC followed the same way. ADT runs it in three calls: the customizing names the system's default
variant, the variant opens a worklist, a run over the object fills it. The findings are not a
test tree but places in source, so they went to the Problems view as diagnostics rather than to
the Test Explorer. The URI parser written for the unit-test stack became the general one for "which
VERTEX tab holds this ADT source": class includes, programs, function modules, interfaces. A
finding outside those - a program include, say - is named in a warning instead of being dropped,
and a system without a default variant is an error, not a guess at one.

The first function module checked came back with "0,0,0" - no findings in any priority - and so
did a Z module with an unused variable and a `SELECT SINGLE *` planted in it. ATC checks
repository objects, and a function module is not one, its function group is; the run now goes over
the group. It still found nothing, and ATC in SAP GUI on the same group said the same - "passed the
chosen checks without any finding". The zeros were the DEFAULT variant's, not VERTEX's: it does not
flag either planted line there. Whether a run over the module's own URI had checked anything was
never settled; the group is the object ATC knows, so that stayed. The per-priority
counts SAP sends back as an info (`FINDING_STATS`) had been shown as a warning; they are left out,
the summary carries the count.

Where-used and the keyword documentation came next, both already in `abap-adt-api`. Where-used is
two ADT calls - the objects that use the name, then the places in each - and it went into VS
Code's reference provider, so Shift+F12 and the references list are the native ones. SAP searches
the saved source, and a cursor in an unsaved tab points somewhere else, so that is refused. Each
object found is read once to have a tab its places can open. The documentation is SAP's HTML page
for the position, shown in a webview without its scripts and repainted in the theme's colours; its
own links are left dead for now.

The first where-used on a class method landed on `PRIVATE SECTION` and `DATA` lines. A place
inside a class comes back as a fragment, `#type=CLAS/OM;name=<method>;start=N`, with N counted
from that method; `urifragmentmappings` tells where the method starts in the source, and the line
is counted on from there. SAP also sends each place's line text, so a line that does not hold it
is named in the warning instead of being shown - a wrong place is not passed off as a right one. F1 was taken for it in SAP tabs, as in Eclipse, at the cost of
the command palette key there.

The hover said "SAP could not describe this name - Incorrect cursor position" over every keyword,
which was true and too much. It was told apart by what SAP answered, not by the word: ADT returns
HTTP 400 for a position with no name it knows, and the library keeps the status on its exception.
That answer gives no hover; a failed connection or a 500 is still said in one.

View source opened on the whole class, but once a part was picked there was no way back to it
except Back, step by step. The object's name above the Parts list now asks the page for the whole
source (`sdeShowWhole`); only View source answers, so on other pages the click does nothing.

## Stage 41 — the pages that describe VERTEX fell behind the editor

0.7.6 gave the VS Code editor ABAP Unit, ATC, where-used and the keyword documentation, and the
release notes and this repository's README said so the same day. Two other pages did not. The
Marketplace page (`vscode/README.md`) documents each of the four commands in its body, so the
gap was only its summary table at the top, which still read "Hover, navigation, outline" - the
line a reader on the Marketplace sees first and often the only one. The update site's page
(`docs/index.html`) named 0.7.5 as the VS Code build and described LLM Providers as the newest
thing in it.

Both were written for the landing they were part of, not audited afterwards, which is how a
table cell survives four features. The fix is the cell and the paragraph, and it ships as 0.7.7,
whose vsix also carries that README: the README is the Marketplace page, and there is no other
way to correct it. The Eclipse plugin has none of these four features and was not rebuilt, so
the update site still says 0.7.3 for it.

**The backend was not the prerequisite the documentation made of it.** Every page opened with
"it needs an ABAP backend", and the VS Code first run put pulling `src/` before anything else.
That was true when the windows were all there was. Since then the editor, the ABAP Unit and ATC
runs, where-used, the documentation, the chat's source tools and the whole debugger have been
built on ADT through `abap-adt-api`, and none of them asks the hub anything. What reads
`/sap/bc/adt/vertex/*` is the explorers: `table` and `join` for SelecTor, `metrics` and `flow`
for Code Explorer, `versions`, `review`, `prepare` and `requests` for Versions and the MCP
transport tools. Visual Debug sits between the two - it works without the hub, and without it
`flow?mode=statements` is missing, so every step asks SAP for the stack and a stepped-over call
shows its class without its method; the page already says so in a notice. The pages now carry a
table of that, grouped the way a reader meets the tools: editor, debugger, assistant, then the
three explorers. The rows were read off the code, not off memory.

**The half of them that could become tools.** The four features are editor commands, and the
chat could not ask for any of them. Two of them took nothing to hand over: `unitTestsOf` and
`atcOf` already accepted an object by name and type, because View source calls them that way, so
`run_abap_unit` and `run_atc_check` only had to be schemas in `code-workbench.js` and two lines
in the dispatcher. What they lacked was an answer. A run wrote into the Test Explorer and the
Problems view and returned nothing, which is enough for a button and useless for a chat: "see
the Test Explorer" is not an answer. `runTests` now counts the classes, the passes, the failures
and their messages into a summary and returns it, and ATC returns its variant and its findings,
the first 50 when there are more. The unit run's `catch` shows SAP's refusal in the Test
Explorer and swallows it; a caller waiting for an answer is thrown to instead, or it would be
told a clean run that never happened.

The other two stayed out. `usageReferences` and `abapDocumentation` are asked for a line and a
column of the saved source, not for a name. Where-used of an object as a whole would work -
ADT's line and column are optional - but where-used of a method, which is what the request
usually means, would mean finding `BAR` in the text, and this repository does not read ABAP as
text. The keyword documentation has no name-only call in `abap-adt-api` at all; answering *show
help for LOOP AT* would mean a new ADT endpoint. So the instructions tell the chat to name the
key instead - Shift+F12, F1 - rather than guess from a search or from the source, which is the
failure mode worth preventing: a plausible where-used answer with nothing behind it.

## Stage 42 — Value Origin stops reading ABAP as text

The initial local analyzer could not connect a returned structure component to a
NEW call. Added an ACE index response containing scan tokens with positions,
statement identities, calls/bindings, units and parameter metadata. The VS Code
loader reads the dependency closure in the editor's SAP system, preserves include
locations, and refuses stale/unsaved root source instead of mixing revisions.
The dependency engine consumes those facts and projects components across copies,
RETURNING and CHANGING, resolves factory-created references, and retains conditional
and loop boundaries. Its offline scanner serves fixtures; production SAP source
uses ACE's statement boundaries. Tests include the debugger_tests calculation rig,
same-line assignments, ACE composite tokens and method includes, load failures and
read-only endpoint/schema handling. VSIX remains 0.7.9 for testing. ABAP activation
could not be verified because the configured local SAP endpoint refused connection.

Interface dispatch exposed a gap in the first index response: an implementation can be analyzed
from a generated CM include that does not contain its `INTERFACES` declaration. The backend now
emits the ACE-scanned class-to-interface relation alongside reference types; the dependency engine
uses those facts to select the concrete `CLASS->INTERFACE~METHOD` implementation without regex parsing.
Editor navigation now resolves calls before requesting ADT's definition and refuses an interface
`METHODS` declaration as a target of an invocation.
It also uses the active editor group for every ordinary navigation; only Value Origin's explicit Ctrl+Click opens beside.

The live closure exposed a further ACE transport gap: `ZCL_PRICE_ROAD` appeared only as a CU include under
the pricing factory. `ts_prog-class` is now emitted for each include, so the client requests the actual
class pool and obtains its CM implementation rather than treating a foreign declaration include as complete code.

Value Origin links open the standard VS Code editor (or beside it with Ctrl+Click).
The test manifest contributes ABAP breakpoint support, so VS Code exposes its native
leftmost-gutter click in that editor; those breakpoints synchronize to the same SAP
debugger session as Visual Debug.

The standard source editor can now reveal a right-hand Visual Debug panel for its
current object, while its source stays in the normal editor and highlights the
actual stopped line. Its F5-F8 bindings are limited to `vertex-sap` ABAP documents
and call the shared debugger's into/over/out/continue operations; other VS Code
editors retain their normal shortcut behavior.

## Stage 43 — the execution flow drawn as a hierarchy

Mermaid execution-flow layout uses top-down caller-to-operator edges. Operators in the same invocation are siblings in execution order; enclosing subgraphs and the sequential edge chain were removed.

Retained procedure ids on resolved targets instead of looking up executable sources through editor navigation addresses. The relevance mask now uses reached statement identities without requiring populated per-step calculated facts. Procedure bodies supply method scope when flow event names are empty. The new demo regression exercises nested execution flow and diagram parity; existing tests previously covered BSE nodes only. Mermaid clicks now resolve flow indices to their original source locations.

The persistent unresolved dispatch came from collectSources skipping every name in the index's interfaces map, which also contains CLASS declarations. A foreign CU therefore suppressed loading its CP/CM sources. Replacing the empty CU regression fixture with a real CLASS declaration reproduced the failure. The loader now allows these global object requests; a transport-level calculation-rig regression verifies base-price arithmetic and all five modifier implementations after loading the closure.

**The file that had to come back from a backup.** On 28 September `value-origin-view.js` was
restored from a backup mid-work, and the copy it was restored from was committed beside it as
`value-origin-view.recovered-20260928-1403.js`. The manifest went to 0.7.10 in that commit and
back to 0.7.9 in the next one, so 0.7.9 through 0.7.11 name no build and never will. Neither the
stray copy nor the version numbers were cleaned up at the time; both were, on 30 September — the
copy deleted and the manifest put back to 0.7.9. A backup taken outside git is not a version, and
committing it beside the file leaves the repository with two answers to the same question for as
long as it sits there.

## Stage 44 — one picture instead of two, and the node that failed the diagram

**A method opens inside the Calls diagram.** Calls and Logic had been two views of the same
object: one showed which methods call which, the other the branches inside one method, and
reading a call meant leaving the first for the second. Clicking a method block now draws its
Logic diagram inside the Calls canvas, joined to the block it came from, with a connector drawn
over the pane rather than inside either SVG — the two are separate mermaid renders, and a single
graph would have had to be regenerated on every open and close. The open block is marked in the
theme's focus colour, and the inner diagram is turned to match the *Top-down* / *Left-right*
choice so the continuation reads in the same direction as the caller.

**The magnifier stopped guessing.** The lens used to switch itself on wherever the rendered text
fell under 11px. It measured the text against the current scale, so zooming the diagram turned
the lens on and off under the reader's hand. It is now an explicit *Lens off* / *Lens on* toggle
serving UML, Logic, Value Origin and every block opened inside Calls, and nothing second-guesses
it. Whether text is too small to read is the reader's call, and a control that changes state on
its own is worse than one that does nothing until asked.

**An empty node failed the whole diagram.** Drawing the operations that ACE finds after `METHOD`
on the same row brought comment statements into the picture: the scanner returns them like any
other statement, they passed the one check there was — the text is not empty — and then
`SCHEME_LABEL`, whose job is to strip the comment off a line, returned nothing at all. What
reached mermaid was `p2("")`, which is a syntax error, and a syntax error anywhere in the source
fails the diagram entirely rather than dropping the node that caused it. That is why it looked
intermittent: it depended on whether a comment fell inside the stretch being drawn. The label is
now computed before the node is, and a statement with nothing left to show is left out of the
chain; where a statement can be pended into an *N operations* box, the check runs before it is
pended, so the count matches what would be drawn if the box were opened. The older
`ZCL_VX_ACE_FLOW` had the same guard, falling back to `"?"`; the guard did not travel with the
code when the Logic diagram was written.

The three structural nodes — the branch join, the unit box, the loop frame — were deliberately
left without the guard. Dropping one of them would break the joining of branch tails or the
nesting of frames, and they cannot come out empty: a line is only marked as structure when its
first word is a keyword `CLOSER_OF` recognises, so its text always carries that word.

**Two regressions were committed red.** `formula-diagram.test.js` arrived asserting on exact
strings of minified page source — `/shown=formulaMode\?formulaVisible\(\):visible\(\)/` — and
failed on arrival, because the implementation it was written against changed in the same
landing. A test that reads generated source as text fails for the same reason this repository
does not read ABAP as text.

## Stage 45 — the ending SAP does not name

**What was missing.** The debugger was told the run was over and never told why. A step
that kills the program throws, and `end()` treated every throw the same: the message went
into a note unless it matched "exception was raised", which is what an ordinary end says.
Two endings, one signal. F5 into a class whose load fails — `SYNTAX_ERROR` in a `CM001`
include, two lines in — came back as a finished run. Worse, a program that dumped before
reaching any breakpoint produced no step and no stop at all: the listener simply went on
listening for something that would never arrive, and the only thing that ever noticed was
the wait running out.

**Where the answer was.** ADT publishes the short dumps as a feed, and `abap-adt-api`,
already a dependency, already wraps it: `client.dumps(query)` over
`/sap/bc/adt/runtime/dumps`. Nothing had to be added on the ABAP side — no hub route, no
`ZCL_VX_*`. That is worth saying because the reflex in this project has been to extend the
backend, and here the backend was not the missing piece.

**Ids, not timestamps, and not a query.** The parsed feed entry carries `id`, `author`,
`categories`, a summary and links — no time of its own. The `$query` syntax of the feed is
not documented anywhere reachable, and guessing a filter that silently matches nothing
would have been the worst possible failure for this feature. So the run takes a baseline
instead: every dump id in ST22 when it starts is remembered, and anything appearing later
under this user is new. No clock to be wrong about, no query to get wrong, and somebody
else's dump of the same minute cannot be mistaken for ours.

**One ask now, the rest in the background.** The first implementation asked three times,
1.5 seconds apart, and awaited all three — which made every ordinary end of every program
three seconds slower, to look for a dump that was not coming. The test suite said so
immediately: a terminate test that had run in milliseconds took 3011 ms. It now asks once,
synchronously, so the answer rides back in the answer to the step that killed the run; if
that comes up empty the remaining tries are fired off unawaited, because SAP writes the
dump after the program is gone — "short dump is being formatted", as the WebGUI screen
says. What they find reaches the assistant through the next `debug_wait`.

**The listening case is a poll, and only while somebody waits.** For the run that dies
before any breakpoint there is no event to hang the question on, so `debug_wait` asks the
feed every ten seconds inside the one-second tick it already had. No timer, no background
work when nobody is waiting: a poll that runs when no one is listening is a poll that
costs requests for nothing.

**A feed that cannot be read is a problem, not an empty answer.** `markDumps` failing sets
the baseline to null and pushes a problem saying that a run dying of a dump will not be
reported. The alternative — treating an unreadable feed as "no dumps" — is the exact
silent degradation this project has been bitten by before, and here it would hide the one
thing the feature exists to show.

**The window had to say it too.** The first landing wired the dump into the answers the
assistant gets and stopped there, which left the reader of Visual Debug looking at "The
program ended." for a program that had not ended - the window counts endings and had
nothing else to go on. The ending now travels in `picture()` by reference, so a dump found
by a background try reaches the window on the next wake without it asking again, and it has
a Dump section of its own that opens itself when a run dies. The feed's own address is an
ADT resource rather than a page, so **Open ST22** goes to the transaction through WebGUI -
the same route `run()` already opens a program by - where that dump is the first entry.

**Where the dump happened, without scraping anything.** The feed entry has no place in it -
id, author, category and a summary, and that is all - so the first reading was that the
include and line live in the dump body behind the entry's link, as HTML to be parsed. Asking
the system settled it: ST22 keeps the dump in `SNAP`, and its `FLIST` is a string of tagged
records - two letters, three digits of length, then the value. `FC` is the runtime error,
`AP` the program, `AI` the include, `AL` the line. Structured data, not markup. `SNAP.FLIST`
is `CHAR 200` with eight continuation columns rather than a LOB, so VERTEX's existing table
resource can select it, and its `f/s/o/l` filters take `DATUM`, `UNAME` and `SEQNO` - no new
ABAP route, which was the other thing the first reading got wrong. It does mean this one
part of the debugger wants the backend, where nothing else in it does; a dump whose place
cannot be read is still reported, and carries the reason instead of a silent blank.

**The editor that would not follow.** Stepping into a method showed it in VERTEX's own
source pane and left the standard VS Code editor on the caller. The cause was a deliberate
refusal: `followStoppedFrame` opened the stopped frame only when its source tab happened to
be open already, to stop a stop in a callee from opening every class on the runtime stack.
The fear is real but the cure was too broad - a debugger that will not show you the line you
just stepped into is not following anything. It now opens the current frame's source when it
has to, and only the current frame, which is what keeps the rest of the stack out of the
editor. What makes this worth recording is how it was first explained away: the same session
had just landed dump detection, the run had died of a `SYNTAX_ERROR` in `ZCL_CALC_FACADE`,
and the obvious story was that there was nothing to step into. `SNAP` said otherwise -
`AI` naming include `CM002` and `AL` naming line 3, inside `METHOD RUN`. The dump was not
from the first line, so the program had entered the method, and the editor simply had not
gone with it.

**The program let go.** Detach continues the program and stops listening, which leaves the
dump watch with nothing to hang a question on: no step throws, no stop arrives, and the
ten-second poll is tied to listening. A run that died after Detach was invisible - in the
one feature built to make exactly that visible. The fix deliberately does not add a timer:
after Detach the program is not ours to watch, and a poll nobody is waiting for is requests
spent on nothing. Detach takes one look after letting go, unawaited so it answers at once,
and everything later is asked for - a button in the section, `debug_dumps` for the chat.
`SNAP` names the program in `AP`, so what comes back says which program it belongs to
instead of being assumed to be ours.

**Four ways to arrive nowhere.** Making the standard editor follow the stop took four
attempts, and every one of them failed silently, which is why it took four. A method frame
names its generated CM include, and the first version skipped anything that was not
PROG/CLAS/FUNC. The second read the frame's source address, which SAP does not always give,
and gave up before reaching the code that knew better - the class and the method are in the
frame itself, in `program`, `eventType` and `eventName`, whether or not a uri came with them.
The third asked for an entry with a live document, and an editor tab that outlived a reload
is restored by the file provider as data and a repo with **no** document: the working
go-to-definition path had always looked the entry up by uri key and never needed one, which
is what the user pointed at. The fourth opened the class in whichever group was active.

Each of those was a bare `return`. A silent skip is defensible for a system frame nobody can
open, and indefensible for a frame we could name - so the failures that remain now say so.

**Folding came back.** Sections could be shut by their heading and could not any more; git
has no handler on those headings in this file at any commit, so whatever was lost was lost
before it was ever committed here. It was rewritten rather than restored: a `folded` class,
`flex:none` while shut so the other sections take the height, the remembered size kept for
when it opens, and a click on a control inside a heading left to that control.

**The fakes were part of the contract.** Every fake connection in `debugger.test.js` had
to grow a `probe`, because a connection without a dump feed is now not a connection the
debugger can work on. Three tests failed the moment the feature landed, and they were
right to: they were modelling a SAP that no longer matched. The two new regressions cover
both endings — a step that dumps, with an older dump of this user and a same-minute dump
of another user in the feed to be ignored, and an ordinary end asserting that it took less
than a second. Both were checked by breaking the feature on purpose and watching the right
one fail.

---

## Stage 46 — the source is the editor

**The freeze was not where it was looked for.** A 147,000-line program hung the laptop in
VERTEX and opened in seconds in the standard editor, and the first suspicion was the ADT read
and ACE. Neither: the page's `outline` takes 80 ms on that file, `variableTypes` 96 ms,
`methodTypes` 23 ms, the editor's statement scanner 340 ms. The first investigation went to the wrong
window, too - the VERTEX source *tab* instead of the Tools window's View source - because the
report said "the standard window" and the code has two sources. A headless Edge run of the
real page on the real file settled it: 4 s of script, then about five minutes of layout and
paint for ~670,000 nodes, growing faster than linearly (5k lines 0.24 s, 10k 0.63 s, 20k 1.9 s).
The editor is fast by drawing only what is visible; the page could not be made fast
without becoming a second editor, and it should not be one.

**Two sources to one, then to none.** The first answer was a dock mode: the page keeps Parts and
sends no text, the host computes parts and lines, and a part click reveals a line in the open
tab. It worked, and then the question that mattered came from the user: what is left of
View source once the editor shows the code and Outline shows the structure? Buttons that are commands anyway.
The mode was built, shipped in a vsix, tested on the file, and removed within hours - the page,
its bridge, the host's parts module, the part-text lookup for the assistant. Writing the
parts module also produced the one reusable finding: a program's list of `CLASS=>METHOD`
from ACE has no counterpart in the page's own outline, which knows forms and events only.

**What stays.** Parts in Tools, for the Logic and Calls diagrams, which follow one part - Metrics and UML draw the whole object and
do not show the list. Outline for reading.
The model of both hosts lost `view`; defaults fall to UML (class, package) and Metrics (program).

**Visual Debug left Tools for the same reason**, and was found broken by the change before it:
it read `source_url` from the answer the dock mode had just reduced to parts. A copy of a
function that has a better home is a copy that breaks first. The docked panel kept its page and
stopped building the hidden pane.

**The guard that remains.** Hover, Ctrl+Click and F1 post the whole source to ADT for every name.
Above 20,000 lines that is refused with a sentence; one request at a time; 20 s and given up.
ADT cannot abort a request, so SAP may finish what the extension has stopped waiting for.

**One thing the move had never covered.** The step log's Copy button was handled only in the Tools window's bridge, so the
docked panel never copied anything; it showed only once the Tools copy was gone and the panel was the one in use.

**Points found nothing for `LS_RESULT-AMOUNT`, and the editor found everything.** Both use the same analysis, and the
first suspect was the analysis. It was not: the editor draws the nodes of the slice, Points kept only ACE flow rows the
slice had "reached" - a second, narrower list. Points now come from the same nodes (`value-origin-points.js`), checked
on the demo fixture against the chain the editor draws; not yet seen on the live record. The live record then said "read 96 sources, 2 nodes in the slice": the analysis had been started at column 0 of the
stopped line, before an indented statement, so it anchored on the statement above and had nothing to follow; the editor passes the
cursor's column. A first look at the editor's
own empty panel had been a mis-click, the cursor in the word `Returned` of a text literal. Two further directions were
discussed and neither is started: ACE's own backward propagation over `flow_steps` and call bindings (as in
`propagate_vars_backward`, the static flow that will also serve the optimisation of the debugger's steps), and a slice over
the recorded steps that links a value across calls through ACE's parameter bindings (needs a record made with Steps &
values). Deferred by the user until the static flow is wanted for the debugger.

**Twenty attempts at one colour.** Points and BSE of the record stayed empty for a long evening, and each fix was real:
column 0 of an indented line anchored on the statement above; ACE and the debugger counted a class's lines differently
(per method include, per class source); the method starts were cached across a class being pulled again; a slice that came
back empty was kept for the whole session; a line of another object was passed to the analysis. Each was found by a
screenshot, not by thought, and the last one was the cause under all of them: the analysis was started from where the
run *stood* - before the value existed - instead of from where the value is *used*. A replay of the pasted record against the
new code (38 places of the slice, the record on 36 of them, the other two branches not taken) showed the client side
was right all along; the chip's counts exist so that the next mismatch is read off the screen.

**Not spending time on steps that cannot matter.** A Predict log of 155 steps showed one predicted: the map can name the next line only after a plain statement, and everything else - calls, IF, CASE, SELECT, ENDMETHOD - asked the stack. The first attempts were worth less than they looked. An F8 to a temporary point is four requests (the points are set, the run goes, they are taken away, the stack is read), about 790 ms against a step's 380, so passing an IF block whose branch is not taken cost twice what stepping it did, and a global `BRANCHES` of mine was silently replaced by another declared further down the page, which let the skip start from an IF; the thresholds (three statements, four in a block) and a test against doubled names came from that log. What paid was F6 over calls, which the user had proposed from the start: a call is not entered while a value is followed, the record keeps its line, and the stack is not read after it. The first version judged a call by its class and method and so left every call with an owner `?` alone; the second by whether the call is itself a place of the slice; the third did not enter any. 146 steps in 97.7 s became 111 in 67.4 s. The log of that run, read against the source, still showed the calls that matter most entered: a call followed by ENDIF or ENDMETHOD was refused the F6 prediction because the map's next statement was a closer, so the five `apply( )` calls (about 60 steps) and every `name( )` and `log->add( )` before an ENDMETHOD went in. The same log showed what SAP stops at: ENDIF and ENDCASE are not stops (from the end of `APPLY` the debugger goes to ENDLOOP, never to the ENDIF), ENDLOOP, ENDSELECT and ENDMETHOD are; the prediction now reads the next stop that way. That made the next result wrong: with every call stepped over, the diagram lost the calculations of `cs_context-amount` inside the five `apply( )` bodies - the BSE the whole exercise was for. An offline run of the analysis on the test code settled it: the calls that lead to the value (lines 28-31, 33, 34, 36 and 38 of `RUN`) are places of the slice, `lo_log = NEW` (27) and `log->add` (32) are not. So the junk is determined by the analysis itself, from the slice, and only a call outside it is stepped over; a call in it is entered. A first sketch of 'fictitious steps' written from the analysis for the skipped callees was dropped for the same reason.
The next idea was to put the analysis into the debugger itself: two breakpoints bound a path, built before the run starts. A first check said a path needs a value, because the nested calls of `executionFlow` are found by walking back from one; the user's answer was that the analysis already makes the flow - and it does: `fullFlow`, ACE's statement stream, comes back with 137 rows for an empty variable, and the slice only marks the rows it reaches. So the first step is the same analysis Value origin runs, started from a breakpoint of the panel (*Analyze flow path*), its `fullFlow` listed under the point as a tree by routine, the slice marking where a value is chosen. The first live click failed with 'Cannot place ZCL_CALC_FACADE=>START-OF-SELECTION': the debugger's line move, which Value origin never needs, made one row the model files under START-OF-SELECTION - a class's text between its methods - stop the whole list. The move now serves only the click: such rows are dropped (they run nothing), and a row ADT cannot place stays listed, dimmed, without a click. The first list under the point worked (90 statements from line 10 to 16, between ZVERTEX_DEBUG_LAB and the classes) and was the wrong place for it: the user expected the flow in the diagram, the one place a flow is read. The diagram takes a graph in the form `bseFlow:{nodes,edges}` rooted at `bseroot`; the flow is now built in that form - program, classes, routines, statements with blocks as parents, the slice as `bse` - and shown while nothing is recorded, the point keeping a one-line summary. That first drawing hung every class and routine flat under the program, and the user saw at once what was missing: the order of the calls and the stack - everything seemed to come from RUN. The flow of statements has no calls in it, and the model found calls only while walking back from a value, so it now makes a pass of its own over every statement (`callSites`: the call the model's own token reading finds, the routines its resolver reaches), and the drawing is a walk in execution order: a routine where it is called, its statements, a call under its statement one level deeper.

**One magnifier, one depth control, the variables before the run.** Several smaller things followed from reading the same diagram. The analysis found `lo_log->add( )` neither as a call nor as a typed receiver: `ADD` is on the model's list of ABAP statements, which it applied after an arrow too, and `io_log` is a parameter whose type stands in the signature; the ACE backend never had the first fault (its built-in list is applied only to a call with no arrow). The flow's nodes open as Value origin opens its own, by the analysis's sources, since the debugger counts a class's lines in the method's include and the editor in the main source. Collapse all / Expand all became the two ends of the Depth control, in the shared view. The variables are shown before the program runs, from the analysis's declarations, for the routine the reader is in; the panes follow the program, and with no value chosen there is no BSE and no Full/BSE toggle. The magnifier was written three times, and the debugger's copy hid itself whenever the diagram was larger than about 80% (`14*scale>=11`), a rule the Tools copy had dropped because it flickered; the remark that the Tools one does not go out on hover was the whole specification, and the lens is now `vertex-lens.js`, one module with the Tools behaviour (pointermove on the SVG, the copy made when the pointer first comes, over any point of a flowchart, Shift and the wheel for strength) and the switch as an icon. Tools gets it through a marker the host replaces (`/*VERTEX_LENS*/`, inside the page's own script so a test that runs the page's script finds it), the flow views by being loaded after it, and a page that draws a flow without it fails loudly. The packaging check found the first version of that: a marker in a script block of its own was taken by the test for the page's script.

**Not built.** The Eclipse plugin lost the page, its bundle entry and `sdeSource`; no Eclipse
release was built for it. The shell this was worked in turns backslashes in commands into
control characters, which twice damaged a file and once a test; each was caught by the next run.

---

## What the practice turned out to be

**One risk per step.** Every stage above was shaped so that a failure named its own cause. The steps
that skipped this — the first BAdI registration, the first VS Code launch — cost the most.

**Read the API, do not guess it.** `javap` against the p2 pool for Java, `SAPRead` and `API_STATE`
against a live system for ABAP. Web search returns nothing usable for `x-friends` packages.

**Check before it runs.** ABAP syntax against the real system before the user pulls; `javac` against
the bundle pool before rebuilding in Eclipse. Both caught errors that would otherwise have surfaced
as a dialog three steps later.

**Fail loudly.** Every silent branch in this project cost time: a swallowed OSQL syntax error, a
handler returning `null`, a 200 with an empty body. Each one now says what happened.

**Prefer the host's own facilities.** ADT already has a debugger, a compare editor and an object
history service. `IAdtObjectHistoryService` can list revisions and fetch their content client-side —
which means half of a code-review tool needs no ABAP at all.

**Flow chart top-down; a hidden duplicate.** The flow chart became `flowchart TD`, so the caller sits above its callees and the levels read as stack depth. SAP standard keeps one block per class, drawn dashed and grey, so its cost stays visible in a performance reading. The number on an arrow is how many times that call was recorded. Checking the diagram against a log turned up two functions named `unitOf`: the Flow one, declared later, silently replaced the step helper, and the "same routine" test after a manual step compared objects and never matched, so every manual step read all variables again. The helper is now `unitName`.

**The chart moves right and draws live.** The diagram left the source column for the right one, under Variables. With Visual on, it is redrawn whenever the stack changes. The renders are queued one at a time, and only the newest waits. Mermaid takes longer than a step, so without the queue, renders started at every stack change would pile up behind each other. The running block gets a green frame, and a green fill once the recorded calls into it pass one. The first live run kept the old zoom, so a growing chart ran off the pane; now every drawing fits the pane until the zoom is set by hand, and Fit restores fitting. Fitting measured the pane only when a drawing arrived, so folding Variables left the chart small in a larger pane; a ResizeObserver now fits it again whenever the pane changes size. That was not the whole cause: the pane itself was a fixed 45% of the column, so folding the bars above it left empty space below instead of growing it. The pane now takes the free space (flex, 45% as its basis), and the observer refits into it.

**A mark, not a drawing; a player.** The live chart first redrew at every stack change just to move the green frame. Only the marked block changes, so Mermaid now runs only when the record gains a block or an arrow. Otherwise `markNow` swaps a class on the drawn SVG node, found by the Mermaid id `flowchart-nX-`. The record keeps, for each stop, the calls made so far, the block and the source line. ◀ ▶ step through those stops and ⏵ replays them one per animation frame, moving the source line and the green block together without asking SAP, and shows ms per frame as the window's own speed limit. SAP standard turned dashed blue. In the browser pane used for testing, ms per frame was 480-800, because a background pane throttles animation frames; the real figure must come from VS Code. Class frames in Methods broke the depth reading: a frame pulls its methods onto one level, so a constructor and the method it calls sat side by side. The frames are gone. Each routine is a two-line block (class, then method) in its class's colour, and Mermaid ranks the blocks by the calls alone. Mermaid's `classDef color` does not reach SVG text when labels are not HTML, so the blue text of standard blocks comes from page CSS. Dark themes drew the chart in Mermaid's light colours. The theme was read from `vscode-dark` on the body, and inside the Tools window that class is not on this page. The page now reads the brightness of the pane's real background colour. With class colours, the green mark vanished: Mermaid writes each `classDef` as an `#svgid .cN>*` rule with `!important`, which outranked the mark. The mark's rule now carries more specificity. The player gained ⏮ and ⏭ and a slider over the stops: stepping back from stop 108 of 124 one click at a time was the only way to the start.

**Rec and clickable blocks.** The window drew each step in 20-100 ms against SAP's 190 and the stack read's 260, so drawing was never the brake. What a replay lacked was detail: Flow stops only at calls. Rec, beside Visual, runs Continue with the Visual logic (F5, prediction, loops passed with F8, Z only) and records every stop into the flow record. The record holds the stack path, the source line and the calls so far, and nothing is drawn until the run ends. The player then shows the run statement by statement at the window's own speed. A click on a chart block moves the player to the next stop where the run entered that routine, with the stop before it elsewhere, wrapping round. Standard blocks do not react, because their type (class or function module) is not known from the record. The block a run starts in is now kept on the chart, so a run that calls nothing still shows it. Each recorded stop also keeps its stack labels, and the player draws them in Stack, marked "recorded" and not clickable, since no debugger stands there. Variables are not in the record: reading them costs an SAP request at every stop. Replay at full speed covered 100 stops in 2-3 seconds, too fast to follow, so ⏵ now takes a pace: 1, 2, 3 (the default), 5 or 10 stops a second, or max. The ms-per-frame figure counts only the time the window spends showing a stop. For a flow the values that matter are those where a routine starts and where it ends, and a read costs little next to a step. Flow and Rec therefore read Parameters and Locals (one `scopes` request and one per group) at a stop that enters a routine, and at one standing on its ENDMETHOD, ENDFORM or ENDFUNCTION. The values are kept with that stop. The player shows them in Variables, and at the stops between it shows the last values read in the same routine, saying from which stop. A failed read is kept as its message and shown there, not skipped. The ms-per-frame figure now stays after a replay ends. In VS Code, 10/s played at about 2/s while a stop took 14-21 ms to show. The pace came from `setTimeout`, and timers inside the Tools window's nested frame are slowed down while animation frames are not. The pace now waits on animation frames for the stop's due time. A click on a block first also opened the class in a new editor tab. The intent was the source in this window, which the player already shows, so the editor call was removed. Stack became a table like SAP's own: depth number (the deepest on top), event type, event, program, include and line, from the frame fields ADT already gives. The recorded stops keep those fields rather than a label, so the player's stack is the same table. A standard block the run stepped over has no stop to go to, so a click shows its source instead. The record names it but not its kind, so the page asks the host's source reader for a class, then a function module, then a program, and says so if none is found. In Flow with Visual on, the source moved only when the stack changed, so inside one routine it stood still while the run went on. A stop in the same routine now moves the line mark and scrolls to it, with nothing else drawn. Standard blocks carried only a class name, because the page named a stepped-over call by its owners. ACE's `tt_calls` has the method too, so the statement map gained `callees` (`CLASS=>METHOD`, `PROGRAM FORM NAME`, a function module's name), and a call stepped over now puts its method on the chart. A map from before the field existed is announced once, and the blocks then carry the class alone. Hovering a table showed its first rows as values joined by bars, with no column names. The hover now builds a small grid: column names, row numbers, and a line for the rows not shown. A structure shows as field and value rows. Rec recorded only its own Continue run, so a few F5s with Rec on left nothing to replay. Rec is now general. Every stop the page draws goes into the record while Rec is on: steps made here, the assistant's, a breakpoint hit. A stop drawn twice (a refresh, a second event) is recorded once. Flow and Rec runs still record their own stops. One gap remains: two stops with the same line and stack depth in a row count as one. An SE37 test run put four frames of the test tool under the function module, both in Stack and on the chart (SAPLSEUJ above the group). The page finds the object's outermost frame from the frame fields: the function module by its event name, a class by its pool, a program by its name. The frames below it are folded in Stack behind a line that shows them, and left out of the flow path. A FUNCTION frame is now its own block, named by its event, as the ABAP side already names owners. Run moved to the front of the header, before the object's name, as "Run in SAP" with an SAP-style execute icon (a clock with a green tick). The program field follows it. The step buttons took the classic debugger's names and look: Single Step (F5), Execute (F6), Return (F7), Continue (F8), each with a red arrow beside lines of code. Pause now changes only the label, so the icon stays. The Tools object field took the whole header width and knew only exact names. It is now at most 380 px, and a name with `*` or `+` is sent to ADT's quick search for the chosen type. The matches drop down under the field, and a pick fills the name and runs. Both hosts had to let this one read through, strictly shaped: operation, a number, an ADT type, a mask. That means `allowed()` in VS Code and the route check in Eclipse's `ToolsView`. The Eclipse plugin was not rebuilt. With the caller's frames folded, Stack's depth now counts from the object, so an SE37 test starts at 1 instead of 6. Terminate and Stop did not say what they do. Stop in particular let the program go, stopped listening and deleted every breakpoint, all under one word. They were weighed against four cases: kill the program here, let it finish, end the session, start again with other points. They became Exit program (unchanged: `terminateDebuggee`, points kept) and Detach, a new `detach()` in the engine: `stop()` with the breakpoint list restored locally, SAP's copy gone. Clear all sits in the Breakpoints bar. Because Detach leaves points that nothing listens for, `run()` now syncs them and starts listening when it is not. "Let it finish without stops" stayed out: it is not asked for yet. Breakpoints can now be switched off, as in SAP's debugger. The engine keeps `active` on each entry. `sync()` and the debugger-scope `scoped()` send only the active ones, and `activateBreakpoints(id, on)` covers one or all. Setting a point again turns it back on. The assistant's `debug_status` marks an inactive one, and Run in SAP needs an active one. In the page, an inactive point is a grey ring: Ctrl+click toggles it, the right-click box has Deactivate and Activate, and each row in Breakpoints has a checkbox, next to Deactivate all and Clear all. Auto-fit also blew a one-block chart up to 400 %, so fitting is now capped at the chart's own size. The engine file is CRLF, so the edit scripts learned to match either line ending. The right column changed shape. Sections used to fold to their bars, and Diagram and Log shared one pane with a header button to open it. Now a row of switches at the top of the column shows or hides each of Stack, Breakpoints, Variables, Diagram and Log. The visible ones are stacked with a draggable line between each two, and dragging moves height from one to the other, 40 px at least. Folding went, since it fought the sizes. Log became its own section, and "log" stopped being a mode of the chart. The pane layout lives in `layoutPanes()`, and the sizes stay in memory for the window's life. The mask search failed in VS Code with HTTP 406. The extension's `fetch` sends `Accept: application/json` for the VERTEX resources, and ADT's quick search answers in XML only. `fetch` now asks for XML for that one resource. Eclipse already did, through `ChatView.accept()`. A plain name now goes through the quick search as NAME* first. Found as typed, it runs. Not found, but with names that start with it, those are listed. When nothing at all comes back, the name runs as typed, because the type-filtered quick search can miss a standard function module that the function itself opens. Parts came to function modules, but only where they help. A function module rarely has parts, though some carry local FORMs written after ENDFUNCTION in the same include. `ZCL_VX_ACE_SOURCE=>resolve` learned FUNC: TFDIR gives the group's program, and from it the FM's include `L<group>U<nn>`, with a namespace kept in front. The metrics resource then returns only that include's units. The page asks for them as for a program, and shows the list only when a FORM is among them. The ABAP was not syntax-checked here, because SAPDiagnose refused the call over `includeSubpackages` again. The pull's activation is the first check. Rec wrote manual stops into the flow record but not into the step log, which only runs filled, so Log stayed empty after a few F5s. `recordStop` now also logs the stop. A step made here carries its key (F5-F8) and the milliseconds from the click. Any other stop (the assistant's, a breakpoint) is logged as "stop". Z_CALC is a report with no event statement at all: its code runs as the implicit START-OF-SELECTION. ACE found no unit in it, so Metrics and the Logic diagram said "No code units". `unit_boundaries` now gives such a program one EVENT unit, START-OF-SELECTION, from the statement after REPORT to the last. That happens only when the main include has no unit and no event, form, module or method exists anywhere in the program, so pools and function groups never get one. The flow resource reads the same boundaries, so the scheme follows. The ABAP is not checked on a system yet. View source has a Parts column of its own, and for a function module with no parts it stayed: a heading over an empty 280 px strip, with no way to fold it. With no parts, the column and its splitter are now hidden. With parts, the heading carries a ‹ › button that folds it to a bar, as the Tools parts list does. A new class listed Local class definition, Local class implementation and Local macros in Parts, and none of them opened. SAP generates those includes holding one comment, which the empty-part rule did not catch: it only dropped includes with no text at all and sections with nothing but their header. `worth_showing` in the versions resource now runs ABAP's own `SCAN ABAP-SOURCE` over a CDEF or CINC include and drops it when no statement is found. That is SAP's tokenizer, not a text pattern. The same list feeds Diff, so a local include emptied back to its comment leaves Diff too. Picking Private section in Parts showed nothing new. The page looked for `PRIVATE SECTION.` in ADT's `source/main`, which ADT assembles from the section includes and the method includes, and scrolled to it. A read-only window can instead show the part itself, and SAP keeps each part as an include: CU, CO and CI for the sections, CMnnn for each method, CCDEF, CCIMP and CCMAC for the local ones. The versions resource got `now=X`. With a part and its type it returns that include's current text via `READ REPORT`. `part_include` knows the section names, the method include (`get_method_include`) and the local includes by name, and `worth_showing` now uses it too. Tools gives pages `sdePart()` for it. View source shows the text numbered from 1, names the include in its hint line, and keeps ← Back through a chain of parts. Nothing is cut out of an assembled text, so no pattern over ABAP is involved. A class opened from a package in Diff showed its parts differently from the Tools list: a Type | Name head row and methods in capitals. Diff keeps its own list for AVE's layout, but the look should match, so methods are shown in lower case and the head row is hidden. Leaving the head row out first broke the layout everywhere: the column widths came from rules on the head cells, and with no head the Type column spread and the names shifted, classes included. The head row now stays in the table and is hidden with `visibility: collapse`, which keeps the widths exactly as they were (checked in the browser: height 0, columns 12 / 54 / 233 px). The list lost its stripes too, as the Tools list has none. Packages had no View source, only UML, Metrics and Diff. Now they have it. The Tools parts list loads a package's objects from the versions resource, as it loads a class's parts, and shows the list for View source only. View source opens a package with no text and hides its own parts column. A program, class or function module picked in Parts is read through the host's `sdeSource`; any other type says it has no ABAP source. Diff's parts column also drew on the editor-widget shade, which differs from the theme's background. It now uses the editor background. These changes shipped as 0.7.5, and `history.md` got its own section for them. The 0.7.4 Flow entry, bent out of shape by edits made during the day, went back to what 0.7.4 shipped.

**Value Origin folds as a whole.** Every Type kept its own expansion state and no control acted on all of them, so reading a wide graph meant clicking branch by branch. A Collapse all / Expand all segment toggle now sits beside the Type selector. For Code, Data and Formula it sets `open` on the `details` nodes; for FLOW it rebuilds `flowExpanded` from the edge list and re-renders the tree, since the FLOW tree is built in the page rather than in the HTML. The per-node `toggle` listeners that redraw the diagram are suppressed during the bulk change, so one rebuild follows instead of one per branch. Switching Type reapplies the current choice, so the toggle never claims a state the shown tree does not have. Collapsed stays the starting state, which it already was.

**The one script string that still carried raw `<`.** The Value Origin page embeds several JSON blobs in its inline scripts, and every one of them escapes `<` as `<` so nothing in the data can be read as a tag by the HTML parser — every one but the BSE FLOW pane's initial `innerHTML`, which was built from the flow tree and stringified as it was. A script block that the parser ends early takes the whole page's behaviour with it: the heading keeps its placeholder, the Type selector and the toggles are never created, and only the inline `<style>` still shows. That is the shape of a break reported against 0.7.9 with the Type selector gone. It could not be reproduced from a generated page here, so this is the hole closed, not the cause proven; the webview's own console has to name it. The line now escapes like its neighbours.

**Value Origin: the link, the branches, and what Formula is for.** Three reports against 0.7.9, one shape each. The `</>` button was drawn as a full-width framed box under its statement: the page's general `button:not(.data-composed)` rule (one element, one class) outranks `.location` (one class), and the width, padding and border it sets won. The rule for the link is now `button.location`, equal in specificity and later in the sheet, and it says `display:inline-block` for its own sake. Nothing else on the page changes, because every other button wants the wide form. — FLOW built its block stack from `IF/CASE/LOOP/DO/WHILE/SELECT` only, so `WHEN`, `ELSE` and `ELSEIF` were ordinary statements: a `WHEN 'ZCL_MOD_FUEL'.` and the `ro_modifier = NEW zcl_mod_fuel( ).` it selects were siblings under the `CASE`, which reads as ten unrelated children instead of five choices. The stack now holds `{id, branch}`; a branch closes the open branch before it, becomes the parent of what follows, and `ENDCASE`/`ENDIF` pop both levels. This is what Logic already does in `code-workbench.js`, and it was taken from there rather than invented again. Tree and diagram are drawn from the same edges, so one change moved both. — Formula was meant to read as the calculation itself: `a = b + c` at the top, `b` and `c` as equal branches, and each of them opened the same way, so a `b = SELECT … * 5 - y` costs two more edges. The mechanism was already that (`formulaSteps` over `formulaInputs`), but three things hid it. The diagram pulled all `pipelineCandidate` nodes — those whose location matches `->ZIF_CALC_MODIFIER~APPLY` — out of their parents into a `subgraph` ordered by `step_no` from the configured pipeline. That is a grouping by configuration, not by what feeds what, and it was also the one element on the page drawn in Mermaid's own colours, since `applyDiagramTheme` styles nodes, edges and labels but never `.cluster rect`; removing the cluster removes the theme break with it, and the pipeline is still shown in its own status panel. A node was labelled with the whole statement, so a `SELECT` with a wide projection was a leaf half a screen across and the tree only fitted at 16 %; `formulaLabel` now reduces a `SELECT` to its `INTO` target, at most three fields and its table, and leaves an assignment alone, because an assignment already is the expression. And `formulaSeen` was a module-level set marked before expansion, so a variable read by two branches expanded under the first one only and the second ended silently without its inputs — the guard is now the path walked to the node, which still cuts cycles but lets a diamond expand on both sides. The known cost is that a value shared by two branches is now emitted twice in the tree; the graph still holds one node and one edge per pair, and whether the duplicate is worth folding is a question for the next reading. Two Formula tests were already red before this work (`uses only nodes visible in the expanded Formula tree`, `switching visualizers preserves Formula`) and are still red; the pipeline-grouping test was replaced by one that asserts the grouping is gone and that a `SELECT` label is shorter than its statement.

**One top for a derivation.** Formula started at `formulaSteps(graph.root)`, which returns every definition of the selected value, and each of them became a root of its own — for `ls_result-amount` that is ten `cs_context-amount = …` lines standing next to each other, which reads as ten formulas rather than one. A derivation has one top by construction: the value that was asked about. A synthetic `formularoot` node now carries the selected variable and the source position of its own node, the definitions hang under it as branches, and the diagram gets the same node because it is built from the same `formulaGraph`. The root is the only branch that starts open, as `bseroot` does in FLOW; Collapse all still governs everything below it.

**A drag is not a double-click.** Selecting a variable with the mouse in a SAP source tab threw the selection away as soon as the pointer passed the last character of the name. `onDidChangeTextEditorSelection` was the whole of it: VS Code gives no click count, so the rule was "a single mouse selection whose text is exactly one identifier is a double-click", and it called `goToClassMethod`, which selects the definition and reveals it. A drag satisfies that rule in passing — it holds it for one event on its way across the word. What separates the two is the event before: a double-click is preceded by the click that put an empty cursor *inside* that word, while a drag is preceded by partial selections and starts outside it. The last selection per document is now kept, and navigation needs that predecessor to be empty, on the same line, and within the word the selection covers. The first selection event in a document has no predecessor and therefore never navigates, which is correct: a double-click's own first click supplies it. The two existing double-click tests now send that first click, as a real one does, and a new test drags across `do_it` and asserts no second document is opened.

**The bound reaches Formula.** Breakpoints became `flowBounds` only for `executionFlow`, `boundedFlow` and `fullFlow` — Code, Data and FLOW — while Formula is built in the page from `graph.nodes` and `graph.edges`, which nothing filtered. A `withinBounds` check now guards both `formulaInputs` and the definition walk, with exactly the rule the flow uses: a node of the entry program outside `from..to` is dropped, a node of any other source is kept whole. What this does not do is worth writing down, because it is the reason the question came up at all: in a slice like `ls_result-amount`, almost every formula node lives in a called class, so the editor's line pair cannot reach it and the picture barely changes. The bound that would reach it is call depth, not source lines.

**Stack depth as the regulator.** The breakpoint pair bounds the entry program's line range, and in a slice like `ls_result-amount` almost every node lives in a called class, so that bound reaches nothing. Everything here is read off the flow, and the flow knows the call stack, so the bound that matters is depth. It is not taken from `executionFlow.depth`, which is empty whenever ACE produced no execution flow; it is derived from the resolved calls themselves: `caller → target.label` gives a graph over procedure scopes, the scopes of the entry program are 0, and a breadth-first walk gives every other procedure the number of calls between it and the entry. `stackOfScope` then stamps `stack` on the FLOW nodes, on the Formula nodes and on the Code/Data rows as `data-stack`, and the Formula root and the FLOW root are 0 by construction. On the page a `Depth` slider sits beside Collapse all: it hides tree rows by their `data-stack`, drops nodes above the limit from `flowKeep` and from the diagram's node list, and re-renders both. Its maximum is the deepest procedure and that is its starting value, which means no limit — a control that hides something the moment the page opens would be the silent degradation this project keeps out. In the demo fixture the numbers are 0 for the program, 1 for `ZCL_CALC_FACADE→RUN` and 2 for what the facade calls, and the test asserts exactly that.

**Two axes, one slider.** A first cut gave every Type the same regulator, call depth, and that was wrong for Formula: its tree nests by data, not by calls, so the control cut across the tree instead of shortening it — a branch could lose its inputs while its parent stayed, which reads as "no inputs" rather than "bounded". Formula now has an axis of its own, the derivation level: the root is 0, the definitions of the selected value are 1, their inputs 2. `depthOf` picks `level` in Formula mode and `stack` everywhere else, the tree hides by `data-level` or `data-stack` accordingly, and the label under the slider says which axis is in force. A node keeps the shallowest level it is reached at, because in the diagram it is one node; a tree row keeps its own position, because after the path-based guard the same value can appear on two branches, and the slider's maximum is the deepest row the tree actually drew — in the demo fixture 6 for the derivation against 2 for the calls. Changing Type resets the slider to its maximum, so no Type ever opens with something already hidden.

**A declaration is not a step.** Full FLOW is built from the statement stream rather than from ACE's sparse slice, precisely so that calls, conditions, loops and writes stay visible when they calculate nothing. The stream also holds everything that merely declares, and those went in too: `REPORT`, `type-pool abap`, a `TYPES: BEGIN OF …` block eight lines tall, and every `PARAMETERS … RADIOBUTTON GROUP` — in the demo program that is most of what FLOW showed before the first executable line. They are dropped by their leading keyword now, the list being the program headers, the type and data declarations, the selection-screen statements, `TABLES`, `INCLUDE`, the method and interface declarations and the macro brackets. The one case that has to stay is an inline `DATA(x) = …`: it declares, but it is an assignment and it runs, so `DATA` is dropped only when it is not followed by an opening parenthesis. On the demo program FLOW goes from the whole file to four statements: `START-OF-SELECTION`, the `COND` that picks the scenario, the call into the facade and the `WRITE`.

**The event names the level.** Full FLOW put a program's statements under `GLOBAL`, which is what the procedure index calls everything outside a form or a method — the analyser's word, not ABAP's. What actually holds those statements is the event: the ones after `START-OF-SELECTION` run there, and a program that declares no event at all runs its code as `START-OF-SELECTION` anyway, which is also how `unit_boundaries` treats it on the ABAP side. The statement stream is walked in order per source and the current event is carried along, so a point outside a procedure is scoped to the event above it and to `START-OF-SELECTION` when there is none. The event statement is then dropped from the stream, exactly as `METHOD` and `ENDMETHOD` already were: it names a level and is not a step inside itself. The declaration filter also moved from the first token to the statement text, because `type-pool abap .` survived the token test in a live source while it was filtered in the fixture; matching the leading word of the text does not depend on how the tokenizer split it.

**One number for what is shown.** The depth slider was an upper bound laid over the expansion state, and the expansion state was the real gate: with Collapse all active only the top level was in the DOM as visible, the diagram takes its node set from exactly that, and so every slider value from 1 to the maximum drew the same picture. Depth is the gate now. `openToDepth` opens a `details` when its own level or stack is below the limit and closes it otherwise, FLOW rebuilds `flowExpanded` from the same comparison, and Collapse all and Expand all became the two ends of the slider - depth 1 and the maximum - rather than a separate state. Moving the slider marks whichever end it has reached, and neither when it is in between.

**A CASE with no visible branches.** BSE scope keeps what ACE marked as calculating the value, plus the ancestors that lead to it. A branch statement never calculates anything, so `WHEN 'ZCL_MOD_FUEL'.` was kept only when something under it was marked, and the assignment it selects is a constructor, not a calculation of the amount. The result was a `CASE` sitting in the chain as if it branched nowhere. The `branch` flag that the WHEN/ELSE/ELSEIF nesting already computes is now carried on the node, and after the ancestor closure a second pass keeps the branch children of every kept node. Their bodies stay out, so this restores the shape of the decision without bringing back the statements BSE deliberately left behind.

**The path is not the logic.** Keeping the ancestors of a finding keeps what leads to it, which is a chain of parents, not the statements that ran beside it inside the same branch. A `WHEN` that holds a finding therefore showed the finding and nothing else in that alternative, and everything the branch did before reaching it was gone. After the ancestor closure, every kept branch node now takes its whole subtree with it. It is deliberately branch nodes only: an `IF` or a `LOOP` around the finding contains the rest of the procedure as well, so the same rule applied to blocks would collapse BSE scope back into Full. The pass runs before the one that adds the empty alternatives beside a kept control statement, so a branch that holds a finding is filled and its neighbours stay as headings.

**Back to the one rule.** BSE scope is what ACE marked plus the ancestors that lead to it, and the two rules added while reading the request differently - the alternatives beside a kept control statement, then the whole body of a branch that holds a finding - both kept statements that are neither a finding nor on the path to one. Both are gone. What made the branching look lost is simply that in the demo none of the `WHEN` subtrees holds a finding: the assignment under each is a constructor, and ACE marks calculations of the value. A `WHEN` that does hold one is kept, because it is on the path, and it needs no rule of its own.

**Data was Code.** The Type offered FLOW, Code, Data and Formula, and Data had stopped being its own view some time ago: `dataFormula` and `codeFormula` were the same one-line call to `symbolicExpression(step, true)`, over the same `executionFlow` nodes, in the same tree. Switching to it only hid the `.flow-code` span in favour of the `.flow-data` one, which loses the call-target marks in a statement, and dropped the edge labels in the diagram. The option is gone and nothing can set `data-mode` any more. The rendering plumbing behind it stays for now, because `dataFormula` also writes the Formula captions and `dataText` still rides on the diagram nodes; stripping that is a separate pass, not a side effect of removing a menu entry.

**Two Types, and the thing that had to move first.** With BSE scope reduced to the findings and the path to them, Code was no longer a second reading of the slice - it was the same slice arranged along the call stack instead of along the code, and FLOW already shows the stack, since classes and methods are its own nodes. One thing only lived in Code: the parameter bindings, the single place where the value crosses a procedure boundary and changes its name. So that moved before Code went. ACE's `parameter` nodes carry the call's source and line, so the bindings at a call site are collected there, de-duplicated and joined into one node that sits on the call's edge: the caller's statement reaches it, and it reaches the class or method that was called. Then Code and the `<select>` went, and the Type became the shared two-position segment toggle - FLOW and Formula - which is also what the project's own rule asks for on a mutually exclusive choice. It starts on FLOW.

**Order of the toolbar.** Tree / Diagram sat at the end of the row, after the scope, the branches and the depth, although it answers the second question a reader asks: which Type, then which of its two views, and only then how much of it to show. The view toggle is moved into the Type group right after it, and the controls that narrow what is shown are appended after that, so the row reads left to right in the order the choices are made.

**The dump reaches the runs that step by themselves.** Visual, Rec and Flow drive the debugger in a loop of their own, and `sdeDebugEvent` returns early while `series` is set, so the picture that carries `ending.dumped` - the one `apply` turns into the header line and the Dump section for F5 - never reached them. Each of their step answers already carries `dumped`, because `advance` and `runTo` ask ST22 through `end(error)` when the step throws; the runs dropped it with a bare `if(r.ended)return`. A `stepEnded(r)` now stands at each of those six places and calls the same `endedNotice`/`drawDump` the F5 path uses. What this does not explain is the `Cannot read properties of undefined (reading 'some')` seen in the header of a recorded run that dumped at its fourth step: every `.some` in the page has a defined receiver on the paths that run there, and the webview's own console has to name the line. The likeliest remaining candidate is Mermaid, called from `showFlow()` in the run's tail with a chart that a run cut short may leave without a single node.

**One shape for a dump, or the button disappears.** The step answer carries the dump as the debugger keeps it - `id`, `error`, `text`, `where`, and `page`, the whole of SAP's dump page - while `picture()` sends the same dump with `hasPage` in place of that page, because the page is too big to ride in something the window polls. `drawDump` is written for the picture's shape, so a dump handed to it straight from a step had no `hasPage`: the *Whole dump* button hid itself, and the one way into the dump overlay was gone - which is what a reader notices, because that overlay is the dump window that has always worked. `stepEnded` now maps the step's dumps to the picture's shape before passing them on, and the whole page stops travelling with the step.

**Who asked for the editor.** `attachDebugger` watches the debugger and, on every picture with a stop, calls `followStoppedFrame`, which ends in `showTextDocument` - the behaviour a debugger is expected to have when the reader is debugging in the editor. The debugger is one object with many windows, though, so the same watch fires when the stop was made from the VERTEX window, where the source pane already shows the line: every step then opened a VS Code tab over the window. The picture does not say who stepped, and threading that through would mean every caller declaring itself; what the editor can see for itself is whether it is in use, and `followNow` now returns unless a `vertex-sap` editor is visible. The decoration is left alone - `showStoppedLine` only marks editors that already exist. A tab open behind the VERTEX window is not visible and is therefore not followed either, which is the same answer for the same reason. Nothing in the suite covers the stop-follow, so this is reasoned, not proven.

**The dump rows, and what Check ST22 may say.** Only *Whole dump* opened a dump page, and it took `list.filter(hasPage)[0]` - with two dumps the second had no way in. The row carries the click now; the include link inside it keeps its own, which is why the handler steps aside for a `BUTTON` target. And `collectDumps` remembers every id it has handed over, so a second *Check ST22* on the same dump answers nothing - correct, but it was reported as "No new short dump for this user since the run started" above a section that was showing one. When the ending already carries a dump, the line now says nothing is new rather than that nothing is there.

**Whoever drives the debugger owns the navigation.** The first cut gated the stop-follow on a visible `vertex-sap` editor, which is a guess at the reader's intent rather than a fact: an editor tab behind the VERTEX window would then stop being followed although the reader is debugging in it. The fact available is who is stepping. The debugger carries a `driver`, which the VERTEX window sets to `window` on every debug call it makes, the docked panel and the editor's F5-F8 set to `editor`, and the assistant does not touch - it has no window of its own, and running from it already behaved. `followNow` returns unless the driver is the editor; `showStoppedLine` is untouched, because marking an editor that already shows the line is not navigation. This reverses the 0.7.9 decision only where it was wrong: there the editor had to follow a step into a method, and from the editor it still does.

**A bare name is not a request for the VERTEX window.** `objectRequest` recognises a lone object name and answers without a model; inside a Tools window that answer set `navigation` to `action:"view"`, so typing `ZVERTEX_DEBUG_LAB` replaced the window with a read-only View source. The model, meanwhile, is told in `object-tools.js` that source opens in an ordinary editor tab and never in a Tools window. Two paths, one question, two answers; the direct one now calls `open_sap_object` like the other, and `navigation` from it is always null.

**One tab for a run.** `followNow` opened the stopped source with `preview: false`, which is right for something the reader asked for and wrong for a stop: a run that walks through a dozen classes then leaves a dozen permanent tabs. It opens in the preview tab now, so each stop takes the place of the last. A document the reader has already opened keeps its own tab, because VS Code does not demote an open editor to preview - which is the behaviour wanted on both sides.

**The run's own F8 has to see the run's own breakpoints.** A Visual, Rec or Flow run is a loop of F5 steps - that is the whole point of it - and it ended itself on `p.stopped.breakpoint`, which is SAP's answer to "did you stop the program at a breakpoint". Stepping onto the line of one is not that: SAP was asked for a step, it made a step, and `arrive` only fills `breakpoint` when `reachedBreakpoints` names it or when its fallback matches `b.adt` with the top frame. A breakpoint in the calling program, while the run steps through a called class, satisfies neither reliably, so the run walked over it and reported the program ended. `stopsHere(p)` now answers the question the run is actually asking: SAP's flag, or an active, non-log breakpoint of this window's own list on the frame the program stands in. The list was already there and already trusted - `predicted()` refuses to predict onto a line carrying a point - so this is the same knowledge used at the other end of the step. What it does not do is explain why SAP did not flag it; that is still the scope question below, and this makes the run correct whatever the answer.

**Two sets of breakpoints, one of them filled.** `sync()` sends the user's points to SAP in scope `external`, which is what makes a run stop in the first place; the program being debugged has its own set, scope `debugger`, and that one was filled only by `rescope()` - when a point was added, removed or switched - and by `runTo`, which needs it for the loop points it invents. Attach filled nothing. So a session that never touched a breakpoint and never passed a loop gave SAP a Continue with an empty set, and the program ran to its end past every point on screen. `attach` now calls `scoped(breakpoints)` right after `debuggerAttach`, which is where ADT does it. `scoped` also answers what it could not place: it returns the placed points as before with a `missing` list beside them, because a breakpoint absent from the session's set stops nothing and only the caller can say so. That message goes to the assistant as a problem and to the window as the stop's `problem`, which the header line already shows. The Visual run no longer depends on any of this - it stops at its own points by itself - but Continue given to SAP, and every step the assistant makes, do.

**What a prediction rests on.** A Visual run sends SAP a step with the line it expects and does not read the stack back; `arrive` fabricates the stop from that line. The whole mechanism rests on one check - the line changes - and a run's own log showed where that check is absent: `line 29 -> predicted 29` four times in a row, because ACE splits a chained `WRITE` into one statement per operand and they all carry line 29. Five of the last six moves were made blind, and the move that finally asked SAP was answered with an ending. `predicted()` now returns null when the next statement shares the current line, and the `leave` branch is gone altogether: the end of a unit is where the frame changes, it happens once per call rather than once per statement, and a frame the window invents is the one thing it cannot verify. `advance` keeps its `expect.leave` handling - the contract is unchanged - but the window no longer produces it. Beyond that, a `Predict` toggle holds both map-driven shortcuts - the predicted line and the loop passed in one go - and is on by default, which is what the run did before it existed. It was first called Exact and named the result rather than the act; it was also first tied to Rec, which was wrong: the three toggles are three questions and none of them is how the run steps - Rec makes Continue a run of F5 steps and keeps the stops, Visual draws or does not draw, Exact alone decides whether a step is asked about or worked out. Flow never sent `expect` and is untouched.

**The record as statements.** The flow chart had two readings, classes and routines, both built from `flow.edges` - which is a map of calls, not of execution. The record already holds what a statement-level reading needs: `flow.timeline` keeps the full stack of every stop, and the window has the statement maps and the sources it read. `stepFlow()` walks the timeline and keys a node by procedure plus include and line, so the second pass over a line finds the node that is already there and only raises its count; edges are keyed by the pair, so a loop's back edge carries the number of iterations and a method called twice has one block. The text is the source line where the window read that source, the map's keyword and target where it did not, and the place as a last resort - a run that drew nothing never asked for a source. Mermaid gets `flowchart LR` and a subgraph per procedure. The mark and the click are per statement in this mode: `markNow` takes the stop from the timeline rather than the unit it was passed, and a click opens that exact line. `shapeOf` counts the timeline only in this mode, so the other two are not re-rendered on every stop. This is the shape the shared Value Origin renderer wants - nodes and edges with a location each - so wiring that in later replaces the drawing, not the model.

**One algorithm, or two pictures that do not read alike.** The first Statements drawing was built from the timeline as a path: an edge from each stop to the next, a subgraph per routine. It is a faithful trace and it reads as spaghetti - long arcs across the whole picture - and, worse, it is not what Value Origin FLOW does. That one is a containment tree: program, class, routine, then the statements nested in their blocks, with the line on the edge and a separate edge for a call. Two algorithms for one kind of picture is the thing this project keeps out, so the drawing was rebuilt that way. The nesting comes from the statement map through `blocksOf`, which opens on IF/CASE/LOOP/DO/WHILE/TRY, lets WHEN/ELSE/ELSEIF/CATCH close the branch before them and own what follows, and pops both at END* - the reading Logic and Value Origin already share. A statement's parent is the nearest block around it that the run also stood on, and the routine itself when there is none. Calls are taken from the stack growing between two stops.

**The depth control, and the stylesheet that had never reached this window.** Every node of the Statements drawing carries a depth - 0 for the program, 1 for a class, 2 for a routine, and one below its container for a statement, keeping the shallowest where a statement is reached from two places, since it is one node. The drawing filters by it and `shapeOf` counts it, so moving the slider redraws. Collapse all is depth 2 - the routines - and Expand all is the deepest statement the record holds; both set the same number, which is why they cannot disagree with the slider. The toggle itself had a problem of its own: `vertex-controls.css` holds the two canonical toggles for every VERTEX view, and this page had never used it - it is handed to the webview as a string and cannot link a stylesheet. It now asks the host for it by name, the way it already asks for the diagram library; `asset()` in extension.js serves both from one table instead of answering only for mermaid.

**Zoom as one control.** The flow pane's minus/plus pair stepped by a factor and said the percentage between them; the diagrams elsewhere use a slider, and it is better for the same reason the depth slider is: the control shows its own state and reaches any value in one move. `zoomTo` stays the single place the zoom is set and now writes the slider as well, so Fit, Ctrl+wheel and the slider cannot disagree.

**A stadium is not a cylinder.** The Statements drawing gave a routine Mermaid's stadium shape and wrote it `([text)]`. The closing pair of a stadium is `])`; `)]` closes a cylinder, so Mermaid parsed the node open and failed on the next token - `Expecting 'STADIUMEND' ... got 'CYLINDEREND'` - and the pane showed its own error picture instead of the flow. One character. **And the player moved out of the diagram.** Its controls had been built into the flow bar because that is where the chart is, but replaying a stop moves the stack, the variables and the source too: it belongs to the window. It is now a bar above the sections, hidden until there is something to replay, and the flow bar keeps only what draws the diagram.

**The toolbar, grouped, and Predict turned off.** The header had grown into one row of twelve buttons in no order: starting the program, stepping and the run's options stood side by side, and the explain line - which is the Log's newest row - sat among them. Three groups now, split by a rule, in the order the questions are asked: the program, the step, the run. The explain line and the statistics moved to a line of their own under the toolbar. And `Predict` starts off: a worked-out line is faster and can be wrong, an asked one is neither, so the fast reading is what has to be switched on rather than what has to be noticed.

**The flow script leaves the page it grew in.** Value Origin's drawing lived in one IIFE inside the generated HTML, with six values interpolated into it by the template: the title, the BSE caption and tree, `maxStack` four times and `maxLevel`. A script written by a template cannot be a file, so those moved into `#mermaid-data`, the blob the script already reads, and the IIFE moved to `org.vertex.abap.ui/resources/vertex-flow.js` - beside the pages, where `copy-pages` already carries .js and .css into the packaged extension. The webview loads it by `asWebviewUri`; `html()` with no `flowSource` reads the same file and inlines it, which is what the tests get and what any host without a file server would. Two tests had been reading the maxima out of the script's text (`depthMax=()=>formulaAxis()?6:2`) and now read them from the graph, which is where they are stated. Everything else about the page is unchanged, and the point of the move is the next step: the debug window draws its record with this file rather than a second drawing of its own.

**The view moves with the script.** Sharing the behaviour was half of it: the markup the behaviour needs - the workspace, the three panes, the Tree / Diagram toggle and the whole diagram toolbar - still lived in the Value Origin template, so a second window drawing a flow would have had to copy it. It is built by the script now, into whatever element with `id="bse-workspace"` the host provides, and only when that element is still empty, so a host that wants its own arrangement keeps it. What belongs to the host is the content of the panes, and that stays in the host's own HTML: the analysis puts its execution flow and its formula derivation into `<template data-flow-pane="tree|formula">`, which the script lifts into the panes it builds. That keeps the fragments as HTML in the page rather than as escaped strings inside a JSON blob - better for reading, and it is what the tests read too. Seven tests that had been asserting the toolbar's markup out of the page now assert it out of the script, which is where it is written; four that bounded a pane by the next pane's div now bound it by the template. The suite is back to the seven failures it had before any of this.

**What a template was escaping.** The flow script had lived inside a JS template literal, so everything in it was written for one more round of escaping: `join('\n')` was the way to put a real newline into the generated page, and `/scale\(([^)]+)\)/` the way to write that regex. As a file, those are a literal backslash-n and a regex matching a literal backslash. Mermaid was therefore given the whole diagram on one line - `flowchart LR
bseroot["..."]` - and answered with a parse error, which is what the Value Origin pane showed instead of the drawing. Three characters. Worth saying out loud because it is the standing cost of moving code out of a template: the escaping that was right inside it is wrong outside, and nothing but running the page says so.

**The expensive half of a stop.** A recorded stop is a line and a stack, which the run already has; what costs is `snapshot()` - `scopes` plus a `children` call per group - and it ran on every routine boundary whenever Rec was on. Those are two different wishes: the shape of a run, and the values in it. `Values` now holds the second, off by default, and guards the three places a snapshot is taken: the Visual run's `snapDue`, the Flow run's, and `recordStop` for stops made by hand. The player already says `No values recorded here` where there is no snapshot, so nothing else had to change.

**Three positions, and what Visual was left with.** Recording the steps and recording the values are one question with three answers, not two switches, so they are one `vertex-segment-toggle`: No record, Rec steps, Steps & values. Putting it in showed what Rec had quietly taken from Visual: `seen()` drew a stop only when the run was *not* recording, so switching the record on turned the drawing off and the two controls were arguing about one action. They are now what their names say - `s.rec` keeps the stop, `s.draw` draws it, either one is a reason to step rather than let SAP run on, and both together is a run that is watched and kept. The window also loads `vertex-controls.css` at startup now rather than when a diagram first needs it, since the record control in the toolbar is one of the shared toggles.

**And then Visual went too.** Splitting drawing from recording made the question obvious: what is a run that steps and shows nothing for? The window is open, the source pane is there, and a step costs the same whether the line moves or not - drawing is this side of the wire. So the toggle is gone and `s.draw` is simply true; Flow draws for the same reason. Continue is now SAP's own when nothing is being recorded and a run of F5 steps when something is, which is one control for one behaviour. The user-facing strings lost the word Visual with it: a run is a run.

**The record meets the shared view.** The debug window now gives `vertex-flow.js` what the analysis gives it: an empty `#bse-workspace`, a `#mermaid-data` blob and `body.flow-mode`. The blob is built by `sharedFlowGraph()` from the same `stepFlow()` model as before - a node per statement of a procedure with its text, source, line and depth, edges for containment and for calls - renamed into the shape the view reads (`bseFlow`, `operation`, `stack`, and the first node as `bseroot`). The window's own Depth, Collapse all and zoom are hidden in that mode because the view brings its own; its source links are caught here and shown in this window's source pane. The view's CSS travelled with it: the workspace, panes, diagram viewport and fullscreen rules left the Value Origin page and are injected by the script, so a window that draws a flow needs nothing of the analysis page's stylesheet. The rough edge noted here a moment ago - a redraw re-running the whole file and re-attaching its listeners - is closed: the view exposes `window.vertexFlow.redraw(graph)`, which replaces the graph, resets the expansion to the root, re-reads the depth maximum and draws the tree and the diagram again. The file runs once per window; after that a record that has grown is new data, not a new view. The host still falls back to loading the file when nothing has built the view yet, which is what happens the first time.

**Why the computed picture read better than the real one.** With both drawn by the same view, the difference left was the graph, and it was mine. The analysis chains by calls: the program leads to the routine it started in, a routine to its statements, a statement to the routine it called; its class nodes exist but nothing points at them, so they never reach the drawing. The record instead hung every class off the root and every routine off its class, which is a fan from one point and a long arc for every call - true, and unreadable. The class level is gone from the record graph, the root leads to the entry routine alone, and a node's depth is now the call depth of the stop, counted from the shallowest stack in the record so the hidden caller frames do not shift everything down. What is drawn is the same shape the analysis draws, built from what the program did rather than from what ACE derived.

**A chain is not a tree.** Reading the principle as sequence alone, the statements of a routine were joined one to the next - and the tree drew exactly what that says: every statement a child of the one before it, the routine sinking a level per line. Sequence and nesting are two different relations and only one of them can be the edge. The edge is nesting: a statement hangs in the nearest block of its routine the run also stood on, statements of a block are siblings, and their order is the order they first ran - which is where the sequence lives, without claiming to be depth. Depth is the call stack and the blocks inside it, nothing else. Two more things went with it: the program node above the entry routine, which repeated its own name and gave the picture two tops where it needs one, and the method label without its class, which named nothing on its own.

**A tree with no indentation is not a flat tree.** The record's flow tree read as one flat list in the debug window - caller and callee on the same line - and the graph was not at fault: the nesting was in the DOM and invisible, because `.execution-children`, `.flow-toggle` and the `</>` link's rules had stayed in the analysis page's stylesheet when the view moved out. Half a view travelled. Nineteen rules - the branches, their markers, the children's indent and rule, the inputs and conditions, the source link - now travel with the script and are gone from the page, which keeps only what is its own. This is the second time the same mistake has shown up in one day: moving behaviour without the markup, then the markup without the style. What makes a view a view is all three.

**The window stops drawing.** Classes and Methods were still the window's own Mermaid, which is why the Tree toggle vanished when you left Statements: the toggle belongs to the shared view, and the shared view only drew one of the three readings. All three now build a graph in the same shape - `callGraph(byOwner)` folds the timeline by owner or by routine, `stepFlow()` by statement - and the view draws it. With that, `flowText`, the SVG marker, the zoom, the fit, the wheel handler, the click-on-node handler and `#flowsvg` itself are gone: about a hundred lines whose whole job the view already does. The one thing the view could not do was say where the program stands, which a player needs, so it gained `mark(id)`: it tags the tree row and the diagram node, repaints after each render, and the window calls it with the stop the slider is on. `darkPane()` reads the pane instead of the canvas that no longer exists.

**What the debugger does not say, and the window can work out.** ADT's stack gives a program, an include and a line; there is no position within the line, so `ULINE. lo_log->display( ).` is line 30 twice over. The window had the answer anyway - `placeOf` reads the statement map for the line and `spots` remembers which of its statements the run is standing on, moved along by each step - but the timeline kept only the line, so the record lost it and every statement of such a line folded into one node labelled with the whole line. `record()` now resolves the statement as it writes the stop and keeps its ordinal; the node key carries it, and the text is cut by `nthStatement`, which splits on periods outside literals. The inference is named as an inference in the comment, because it is one: no map, or a stop arrived at by breakpoint rather than by stepping, and the ordinal is 0 - the old behaviour, which is the right fallback.

**The last of the page's own script.** Fit did nothing in the debug window because the zoom, the fit, the full screen and the panning had stayed in the analysis page's second inline script - the view's toolbar was there, the behaviour behind it was not. It moved into the view, where the toolbar already was; the page keeps only its own business, which is initialising Mermaid and telling the view it is ready. Two readability fixes went with it: inline declarations are shown as the name they declare, since `DATA( )` around a name says only that the name is new and the statement's point is the assignment; and a routine reached a second time is marked and left closed, because repeating its whole body wherever it is called turns one routine into as many subtrees as it has callers. `renderFlowTree` clears the set of already-shown routines before each draw, so the repeat is per drawing, not per session.

**Four small ones, three of them the same mistake.** The view came to the debug window with its own styling, but the window gave it nowhere to live: the panes had `height:auto`, so the diagram's viewport grew with its content, `fit()` divided by a height that was never smaller than the drawing, and Fit did nothing while the pane itself ran past the section. The panes are a flex column filling the section now, which is what the analysis page's `calc(100vh - 125px)` was doing there. Full screen had the same shape of problem - the pane went `position:fixed` at `z-index:7`, under the window's own toolbar - and the source link had the third: the click was caught on the bubble, after the view's own handlers, so it is taken in the capturing phase now. The fourth is plain: a stop was named by the generated include, `ZCL_MOD_CUSTOMS====CM001:13`, where `unitOf` already knows it is `ZCL_MOD_CUSTOMS=>APPLY`. The statistics also dropped the window's share of a step: it was `total - sap - stack - other`, a remainder standing in for everything unmeasured, and it answered no question anyone asks.

**A breakpoint that was refused, and a tab that remembered too much.** A point set in the editor stopped working, the run reached the end of the program, and the answer came from SAP itself: `Cannot create a breakpoint at this position`. The editor had the statement on line 17, the active version on line 16 - one blank line of difference - so the point was set where no statement is. `setBreakpoint` now reads the active source on refusal and quotes that line, so the mismatch is visible rather than inferred. The deeper question was why the tab disagreed at all: `fileEntry` restores a tab from `workspaceState`, where its text was stored when it was opened, and only read SAP when that text was missing. A tab therefore survived a reload showing the source as it was, however old - and old source in a SAP tab is not a stale view, it is wrong line numbers for every breakpoint and every stop. Keys restored from a previous window are now read again the first time they are asked for; a system that cannot be reached keeps the copy and says so rather than failing to open the tab.

**The queue that was not one.** `ask()` pushed a resolver onto `waiting` and sent the request immediately; `sdeReady` shifted the first resolver and gave it whatever had arrived. That is only correct while one request is outstanding, because the host answers a debug command, a source read and an asset through different code paths and all of them come back as the same nameless `result` message. The window began asking for the record's sources and for `vertex-flow.js` at once, the replies crossed, and a source read was handed the script - hence `Unexpected token '/', "/* The Val"... is not valid JSON`, a player that no longer moved the source, and a diagram with no view. Sending one request at a time and queueing the rest makes the turn mean what it claimed to mean. The three asset loaders - Mermaid, the shared stylesheet, the flow view - stopped pushing onto `waiting` behind the queue's back and go through `ask(send, raw)` like everything else.

**Two sources, one of them hidden.** The window draws a replayed stop into its own source pane, and in the docked panel that pane is hidden by the rule that the real source lives in the standard editor - so the slider moved a view nobody sees. The editor only ever moved for a live stop, through `followStoppedFrame`, which the player never reaches. `revealFrame(frame)` now offers that same path to a caller who has a place rather than a stop: it builds a one-frame picture and goes through `followStoppedFrame`, so a replayed stop opens exactly as a live one does - the same tab, group and preview rules, and the same refusal to drag the editor when the debugging is driven from a VERTEX window, which has its own pane and needs no help.

**A caption that asserted what it had not looked at.** The stack hides the frames below the object, which is right - the depth should count from the code being read - and announced it with `N caller frames hidden (test frame, screen)`. Neither half held: the parenthesis listed two possibilities as if both were there, and a report started from SE38 has a screen below it and no test frame at all; the plural was wrong for one frame; and the row was the control, a sentence in a table that nobody would think to click. It names the frames it leaves out now - their actual programs - and it is a button in the Stack heading, present only when something was left out.

**BSE over a record, and what a record can honestly answer.** The scope is a filter over data already in the window: `valueTrail()` walks the timeline, finds the chosen value in the snapshots a `Steps & values` run kept at each routine boundary, and marks the stops where it differs from the one before. `sharedFlowGraph` marks those nodes and every routine on their stack as `bse`, which is the flag the shared view's Full / BSE toggle already reads - so switching scope is a redraw, not a request. The limits are structural and are reported rather than papered over: values exist only at routine boundaries, so the answer is the routine that changed the value and not the statement; a structure's snapshot holds its shape and no value, so nothing can be said about its fields; and a record made without values has nothing to filter by at all. Statement-level precision would need either the value read at every stop - a property of a future run, one read instead of all scopes - or ACE's origin index, which is a request to the system; neither is done here, and the message says which is missing.

**Points instead of steps.** Following a value by stepping and reading it at every stop is affordable but blunt: the run pays for every statement, and prediction - the thing that makes stepping cheap - guesses where it cannot be checked. The analysis already knows which statements can change a value; that is what it is for. So the window asks it once, before the run, and sets a breakpoint at each place it names. SAP then decides when to stop, every stop is real, and the cost is the number of places rather than the number of statements - tens instead of a hundred and thirty in the demo. `originPoints` runs the same analysis the editor command runs - the callback is named now rather than passed anonymously into the view - and returns object, line and statement for every included row of `graph.flow`; the window turns each into a breakpoint by name through a new `setAt`, because these places are in classes it never read as a source. Two honesty rules came with it: a place SAP refuses is reported with its reason rather than silently skipped, and a point of the slice where the value turns out unchanged stays in the picture, marked - `a = a + b` with `b = 0` is a fact about the data, while many such points are a fact about the slice.

**What a record cannot see about a value.** The first BSE scope over a record marked the stops where the chosen value differed from the stop before - and found two nodes where the dedicated analysis finds many. The reason is the one thing a record has no way of knowing: a value travels under other names. `lv_scenario` arrives in the callee as `IV_SCENARIO`, a calculation puts it into `cs_context-amount`, a RETURNING brings something back; at every one of those places the name differs and the recorded value of the original has not changed at all. Following that is exactly what the backward slice does, so the slice is now what BSE shows, and each of its places carries the names the analysis says belong to it - `changed` and its `dependencies` - which is what the run reads when it stops there. The recorded values keep their job: they say what the value became at each place, not which places there are.

**One algorithm for the flow.** Value origin's FLOW and the debugger's flow path had grown apart: the debugger's was built from the statements and the calls in them, Value origin's from the statements grouped by scope with calls linked afterwards, and the second read as glitchy next to the first. The builder moved out of the debugger page into `vertex-flow-graph.js`, a module both load (the page as an asset, Value origin as a required file); the debugger's `staticFlowGraph` only hands it its rows and says what it left out. Value origin hands it the same rows from `pathRows`/`siteRows` and has no builder of its own any more - a graph without them is an error, not a fallback to the old drawing. A node's link carries `origin:<source>|<OWNER->ROUTINE>` in both, so opening it is one path too.

**One analysis, three readings of it.** After the flow, the Formula and a new Expression went the same way: `value-origin-formula.js` builds the derivation (a definition once, where it is first met), `value-origin-formula-html.js` draws its panes, and the backend hands the debugger the same two panes, so Formula is no longer empty there. Expression is substitution over that tree. Two things it taught: the analysis files the same statement once per use under different ids, so a definition is known by source, line, text and what it reads; and the model already links a read to the write before it - what it cannot know is the order of definitions a loop over *data* makes (the modifiers of a pipeline), so those are ordered by the loaded `ZLOG_PIPELINE` scenario, and said to be unordered without it. A step that reads the value before it twice (`x = x + x * p`) made the substituted formula grow with every step (5,000 characters for five); writing the share as one plus the share keeps it linear, and what is still read twice stays a named step. The assistant's context follows the screen the reader has, not a fixed dump. Released as 0.8.0 (0.7.15 never was).


## 2026-10-05 — A separate client BSE command for comparison

The ACE command stays available while `vertex.valueOriginLinter` reads source through standard ADT and builds its input locally with pinned @abaplint/core 2.120.68. Parsing runs in a cancellable worker. The adapter supplies the existing model contract, including per-statement read/write facts, so the same FLOW and Formula view can compare both inputs. No origin-index request or SAP activation is needed for the client command. Source buffers may contain unsaved edits, so comparisons must use the same saved, activated source. Unknown statements are reported and aliases and dynamic dispatch remain experimental boundaries. The library is bundled, credited in Acknowledgements, and its MIT licence is included.

VS Code 0.8.1 was packaged with both abap-adt-api and @abaplint/core and their licences. The packaging gate now requires both libraries and the client-analysis worker, reads every ZIP entry, and passes the packaged Scheme navigation check before promoting the candidate to the final VSIX.


### BSE log outside the technical sections

The traversal log was hidden behind the technical-section toggle. It is now a visible Analysis log section above FLOW in both engines. The copied report includes source closure, all dependency nodes and edges, traversal, warnings, Formula and Expression diagnostics, ADT/index requests and local parser durations. The first local parse includes worker and grammar startup. This exposes evidence for comparing the reported missing Formula/Expression and slower linter path; no parity or performance fix is claimed yet.


## 2026-10-05 — Load what the client slice needs

The paired logs showed 42.968 s of ADT reads and 1.813 s of parsing versus 5.418 s of ACE closure loading. The client had fetched three empty extra includes per class through the editing API, which also read both source versions and repeated object resolution. A dedicated per-analysis reader now caches metadata and reads one active source version. The demand collector rebuilds the slice as it discovers references in reached statements and needed signatures; local definitions/implementations are fetched for unresolved local calls and macros for unsupported statements in reached routines. Normal global classes no longer fetch extras. Tests cover unused-method dependencies, interface dispatch with Formula/Expression, and deferred ADT includes. This does not claim SAP speed parity until another live log measures it.

VS Code 0.8.2 was packaged successfully with both external libraries and licences. The package gate verified archive entries and passed the packaged Scheme navigation check. The final focused test run passed all 39 tests.


VS Code: Copy log now includes the complete FLOW hierarchy and points, Formula derivation tree and graph, and Expression text, substitution steps and source bindings as JSON for both ACE and ADT + abaplint. The export uses the current analysis and loaded configuration, independently of the visual depth slider.

VS Code 0.8.1 comparison build: the FLOW script is embedded in the page; the full JSON export remains in Copy log without duplicating the dump in the visible page. This change addresses the reported empty analysis pane; live VS Code rendering still needs confirmation.


## 2026-10-05 — Move Tools analysis to ADT source

VS Code routes Metrics, class/package UML, Scheme, Calls and the debugger statement map to standard ADT source reads and bundled abaplint. The existing Value Origin command and debugger dependency/variable analysis now use the client engine. Package enumeration uses ADT node contents. Tools obtains its analysis capability information locally. Versions, selector, tables, transport review/prepare and dumps retain their VERTEX backend routes.

This is an experimental migration: local Halstead token classification may differ from ACE; Scheme shows structured syntax rather than the ACE execution diagram; Calls marks unresolved receivers and bounds source expansion to eight levels/100 objects. Unknown dynamic targets, macros and unsupported statements are not claimed resolved. Source-coordinate handling uses assembled class rows. Live SAP operation with the backend physically removed remains to be confirmed.

The 0.8.1 VSIX was rebuilt with both libraries, the frontend-analysis module and licences. JavaScript syntax checks passed; the packaging gate passed its packaged Scheme navigation check. No live SAP/backend-removal test has been performed.

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


### 2026-10-06 — ACE source comparison
Compared zcl_vx_ace_keywords and zcl_vx_ace_metrics against frontend metrics. Replaced statement-class-name classification with matcher grammar traversal; include routine header/closer. 15 focused tests passed. Calls renderer and SAP scanner equivalence remain documented gaps.

### 2026-10-06 — Calls rendering audit
Compared zcl_vx_ace_flow build_steps_flow labels/styles. Ported event/method/form/constr/enh/func palette and rounded nodes, removed HTML entity escaping and fabricated root, avoided depth recomputation on aggregated nodes. Added source-contract regression assertions.

### 2026-10-06 — Full regression audit
Fixed real FLOW parameter-transfer loss through value-origin-points and shared vertex-flow-graph. Corrected frontend empty-unit filtering and UML scope/order/requested-class filtering from ACE source. Repaired fixture codeFlow/DOM/DI contracts without suppressing production errors. Full suite 365/365; palette check 1/1. Live scanner/dispatch parity remains explicitly unverified.

### 2026-10-06 — Constructor-first Calls
Frontend traversal roots CLAS at CONSTRUCTOR unless start/unit is explicit. Metrics UI forwards METH Parts choices and initializes the constructor start; missing constructor prompts selection. Two regression scenarios cover frontend and UI contracts.

### 2026-10-06 — Context menu routing
Added tools-context command registrations with explicit object/URI precedence and source declaration fallback. Registered submenu in editor/explorer/webview menus; Tools bridge publishes current object through data-vscode-context, including nested pages. Eleven focused checks passed.

### 2026-10-06 — Calls context regression
The new menu passed action calls although VertexObjects expects flow, aborting initial Tools script before fields populated. Map command to flow and normalize using the shared model in the host; add program Calls and unsupported UML regression coverage.

### 2026-10-06 — Shared call enumeration
Export callsIn from value-origin-model and use it for all statement expressions in frontend Calls, retaining classic FORM/function/method fallbacks without duplicate calls. Regression covers NEW zcl_calc_facade()->run(), nested scenario() and assigned deeper(), with boundary-source loading checks.

### 2026-10-06 — Single call engine
Added call-graph.js with classic/functional enumeration, shared model resolver, async walker, entry ranges, depth and cancellation. Frontend uses load adapters and rebuilds index only on new objects; demand flowPath uses shared walker instead of independent name matching. Model callSites delegates to shared graph resolution. Removed frontend receiver heuristic. Shared parity tests and full suite passed 374/374; package gate requires the common engine.

### 2026-10-06 — Constructor expression regression
Shared callsIn now skips typed constructor-expression wrappers while recursing into their arguments, including qualified types. NEW emits a real CONSTRUCTOR target and prevents its class token being misread as a local method.


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

## 2026-10-06 — 0.8.1 release documentation and help

Consolidated the incremental README and website notes into the final user workflow. Visual Debug uses Classes/Methods plus a separate Logic toggle backed by the existing Tools component and message handlers. Tools follows the active editor, picks a routine by source coordinates, and switches object when selection changes. Updated diagram, debugger and Value Origin help; documented focus-driven scrolling, source history, return/end boundaries, zoom/lens rules and connection-aware Detach. Earlier four-mode and Follow code descriptions are historical and superseded. No Eclipse build was produced and no live visual/SAP verification is claimed by this documentation update.

### Eclipse 0.8.1 export preparation

Prepared 0.8.1.qualifier bundle/feature metadata, the shared FLOW dependencies and an Eclipse Visual Flow Analysis command with Calls / Logic and ADT editor selection/source navigation. Eclipse retains its existing ACE backend contract; the VS Code frontend-analysis adapter and runtime Debug are not claimed ported. See [Eclipse export guide](eclipse/README.md).

Eclipse 0.8.1 preparation build: Java 21 compilation and update-site/archive packaging completed successfully. Artifact: `target/eclipse-0.8.1.20261006202315/vertex-eclipse-0.8.1.20261006202315.zip`. The published `docs/` update-site metadata and plugin artifacts were not replaced. Live Eclipse/ADT navigation and theme checks remain pending.

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

Shared FLOW theme fix: theme overrides now outrank Mermaid SVG-scoped styles, so routine frames and labels follow the active editor theme. Theme changes retain zoom and scroll. VS Code package version 0.8.2. Live light/dark rendering pending.

FLOW diagram correction: parameter transfers remain in the analysis tree but no longer form disconnected diagram nodes; call edges bypass them and connect the call statement to its callee. ELK cluster fills use active editor theme CSS variables, overriding inline Mermaid fills; theme updates preserve zoom and scroll. Live light/dark rendering pending.

FLOW source-only correction: both tree and diagram contain source statements and nested routines, without synthetic parameter-transfer rows or repeated-routine arrow markers. Formula and Expression retain data relationships.

FLOW collapse controls use the canonical independent toggle style with compact, centered icon geometry; removed the single-button segmented wrapper.

2026-10-07 — VS Code 0.8.3: FLOW initializes Mermaid with the active editor theme’s background, container, border, label and edge colours. Removes the initial dark-theme container background; theme changes preserve zoom. Live theme verification pending.

2026-10-07 — FLOW rendering fix: shared script now defines its ABAP identifier normalizer before variable label highlighting, fixing the reported “canonical is not defined” runtime error. VS Code package remains 0.8.3. Live rendering pending.

### 2026-10-07 — Value origin FLOW reading levels

Report: Value origin showed only its heading, the analysis log and the selection-screen panel; FLOW was empty. It could not be reproduced from the repository: the page built by `html()` on an abaplint graph of a program with a radio group rendered fully in a browser, and the installed 0.8.3 matched the repository file for file. The window drew again after the reinstall that carried the `canonical` normalizer fix above. Found on the way: the Mermaid theme initialisation falls back to the CSS system colours `Canvas`, `CanvasText` and `GrayText` when a theme variable is empty, and Mermaid rejects them (`Unsupported color format`); left as is, to be decided.

Then: FLOW in Value origin gained the levels of Visual Debug. The request was one data source, so the page receives no new data: `html()` folds the same `graph.codeFlow` rows four times with the shared builder (`classes`, `methods`, `logic`, `steps`) and hands them over as `flowReadings`; `vertex-flow.js` shows a `vertex-segment-toggle` (Classes | Methods | Logic | Statements) in FLOW only and swaps `bseFlow` and the depth maximum. Statements stays the default. Visual Debug's own Logic, which opens the Tools logic diagram of one method, was not copied. The 13 failing tests of the suite fail the same way without this change. Verified in a browser on light and dark variables: tree and diagram for all four readings, no console errors.

Routine frames on a dark theme stayed light grey in the FLOW diagram. The theme code painted `g.cluster rect`, but the grouped FLOW is laid out by ELK, which draws a routine as `g.subgraph > rect.subgraph`: nothing matched, so Mermaid's fill stayed. The inline override now covers both kinds of frame and their captions; at the user's request the frame is a 12% tint of `--vscode-focusBorder` over the editor background, which reads light blue on light themes. Checked in a browser with light and dark VS Code variables.

Follow-ups from the user on the same window: Methods is the default reading; the Analysis log moved behind the bug control (`debug-only`); Depth moved beside Fit. Depth also governs the tree, which has no Fit row, so it moves with the view: by Fit for the diagram, back in the toolbar for a tree. The magnifier drew without colours because the theme rules had been rewritten as `#mermaid-graph svg[id] …` to outrank Mermaid's id-scoped styles, and the magnifier's copy of the SVG is not inside `#mermaid-graph`. They are scoped as `svg#<drawing id> …` now: the same weight against Mermaid, and the copy carries the id. Two tests that read the statements from the default reading take the Statements reading explicitly; one checks every reading against the builder.

Expand all / Collapse all went back to two buttons, at the user's request and in SAP GUI's shape: chevrons down for Expand all, chevrons up for Collapse all. An earlier stage had merged them into one switch that offered the other state each time; a pair with one in force is an exclusive choice, so it is a `vertex-segment-toggle` with `.active` (AGENTS.md), with the icon-button geometry. The test that pinned the single switch now pins the pair.

Depth in a tree moved to the root, beside the expand buttons. The root is a `<summary>`, so a click on the slider would fold it: the control swallows clicks while it stands there. The FLOW tree is rebuilt on every depth or reading change, which detaches what was in its root; the expand buttons are re-attached there and Depth follows them. Tooltips now describe each FLOW control. Seen on the way again: with a theme variable missing, the `Canvas`/`GrayText` fallbacks make Mermaid throw inside `rebuild()`, which also aborts a depth change — still waiting for the user's decision.

Show from here, agreed with the user before building: a right click on a FLOW diagram node replaces the browser's Cut / Copy / Paste with one item; the diagram is then walked from that node instead of the root (`focusPath`), a path bar above it returns to any level and Esc returns one step. Diagram only, at the user's choice; a change of reading or a new graph starts from the whole flow again, since node ids differ between readings. The page's general button rule stretched the path bar's links to full width at first; they are scoped by id now. Menu colours come from the VS Code menu variables, falling back to the widget ones.

WHEN appeared twice in the FLOW diagram: as the label of the CASE edge (`executionEdges` labels it with the branch text) and as a box that edge led to. The builder now folds each WHEN box into that edge for the diagram only — the edge goes on to the branch's first statement, keeping the label — and marks the node `diagramHidden`; the tree still nests the branch under its WHEN. A `` in the regular expression was lost to shell escaping on the first try and silently matched nothing; the test now builds a CASE and checks the edges.

A click in a Tools diagram opened the class again in a new editor group. `openToolSource` (and the analysis-link path `openOrigin`) always passed `ViewColumn.One` to `vscode.open`, so a source already open in another column got a second editor. Both go through `revealSource` now: an editor already showing the document is scrolled where it is; otherwise the document opens in the column of a visible `vertex-sap` editor, or the first one. Eclipse is not affected - ADT opens its own editor once.

The `Canvas` / `CanvasText` / `GrayText` fallbacks in the Mermaid theme initialisation are gone, by the user's decision: they were never valid for Mermaid (`Unsupported color format`), and the throw inside `rebuild()` also aborted a depth change. `themeVariable` now throws with the variable's name and the diagram area shows the message; the rest of the page keeps working. Checked with the variable missing (message, depth still works) and present (diagram drawn). Then, at the user's request, the `#ffffff` / `#111111` fallbacks of `applyDiagramTheme` went too. They never affected a theme change - VS Code changes the values, the variables stay - but a missing variable would have painted the diagram white without a word. The theme observer's repaint reports the error in the diagram area like the drawing does.

A reading change used to drop Show from here, because node ids differ between readings. Each node carries a key the builder gives it in every reading (`c|class`, `m|routine`, `o|program:line`), so the path is carried over: the same key, else the routine the node stands in, else its class; consecutive duplicates collapse and the carried nodes stay expanded. A statement shown from in Statements becomes its routine in Methods and Logic. Tree / Diagram moved to the front of the toolbar (`prepend`). The `#4f8cff` fallback of variable highlighting went the way of the others: a missing `--vscode-textLink-foreground` is reported.

The user asked whether the better direction could be computed. It can: both directions are rendered off screen and compared by the scale at which each fits the diagram viewport, taken from the SVG viewBox; the larger wins. First built without a new control (the result shown on the Top-down / Left-right buttons), then, at the user's request, as an Auto button that is the default and names its choice in the tooltip. The cost is a second Mermaid render per redraw while Auto is on. Checked in a narrow window (top-down chosen) and a wide, low one (left-right chosen). Two regular expressions lost their backslashes to shell escaping on the way and were repaired before any run.

The direction buttons were loose buttons in the diagram toolbar and wrapped badly in a narrow pane; with Auto they are an exclusive choice, so they became one `vertex-segment-toggle`. The two expand buttons went back to one switch at the user's word - it is all-or-nothing, so one control whose icon flips is enough - keeping the SAP GUI chevrons. Branch-level opening moved to the node menu: Expand / Collapse this branch walk the node's descendants in `bseFlow` and add them to or remove them from `flowExpanded` (expansion still bounded by Depth), keeping the view.

Edge labels looked struck through: ELK with `htmlLabels:false` writes a label as bare text, with no rect behind it, so the theme rule for `.edgeLabel rect` had nothing to paint and the line showed through. After drawing, each label gets a `rect.vx-label-back` sized from its text box and filled with `var(--vscode-editor-background)`. The blue patches on the toolbar and captions were a text selection left by dragging the diagram; the diagram panel is `user-select:none` now.

The BSE scope dropped ENDIF and ENDCASE: it keeps what the slice found and the ancestor path to it, and an END statement is a sibling of its block in the tree, never an ancestor. The builder now records on each END statement the block it closes (`closes`, taken from the block stack it already pops), and the BSE scope adds an END statement whose block it keeps. The ancestor-closure rule is otherwise unchanged.

At the user's word, BSE and Logic do not combine: in the BSE scope the Logic button is hidden, an active Logic reading switches to Statements, and Full brings the button back (the reading stays where it is).

Regression of the label backing: switching from Statements to Classes or Methods showed "Mermaid: Failed to execute 'insertBefore'". Those readings are laid out by dagre, not ELK, and dagre nests the label's text inside `g.label` under `.edgeLabel`; the backing was inserted into `.edgeLabel` before a node that is not its child. It goes into the text's own parent now, which is also the coordinate system its `getBBox` is in. Checked by switching through all four readings, twice.

The node menu did not open on routine frames in Statements and Logic: those are laid out by ELK, whose frames (`g.subgraph`) carry neither an id nor a node, so the browser's Cut / Copy / Paste showed. After drawing, each frame is matched to its routine node by caption (the routine's text, quoted as the diagram quotes it) and tagged like a node. Checked by right-clicking every frame and node in all four readings.

Clicking a FLOW diagram label in Value origin opened nothing. `vertex-flow.js` called `bseMermaidOpen(node.id)` with the flow builder's id (`f12`), and the window looks a node up among the analysis graph's nodes and flows, finds none, and has no source to open. The flow node already carries `origin:<source>|<location>` and its line, which the window's handler understands (the tree sends them); the click passes the node, and the page sends source and line with it. Visual Debug defines its own `bseMermaidOpen` and ignores the extra argument; Eclipse's handler reads the same message.

Hover on an inline declaration. The hover prefers the declaring line SAP's navigation points at; for `DATA(ls_result) = NEW zcl_calc_facade( )->run( ... )` that line is an assignment, sliced from the name (`ls_result) = …`), with no type. The type lives in ADT's element info (`/sap/bc/adt/abapsource/codecompletion/elementinfo`), but abap-adt-api's `codeCompletionElement` keeps only the nested element infos and drops the element's own properties. `elementDetails` in sap-code.js sends the same request and parses it whole with abap-adt-api's own XML helpers (no new dependency): the element's name, type and properties, and each nested element with its properties. The hover shows them verbatim, without naming keys it has not seen - what keys SAP uses for the type has not yet been seen on a live system, so the first live hover is the check. With no properties and no components it says SAP gave no type. Shell escaping ate backslashes twice while writing this; the inline check is a plain `endsWith` on `DATA(` / `FINAL(` now, no regular expression.

The first live hover showed the key: SAP's element info carries `abapType: TYPE ZIF_CALC_TYPES=>TY_CONTEXT` (with `visibility`). On that, Go to Type Definition: a `TypeDefinitionProvider` reads `abapType`, opens the owner through `read_sap_object` (interface first, class when SAP says it was not found), and finds the type's declaration among abaplint's statements of that source - chains already split, `TYPES BEGIN OF` nesting counted so a component of the same name inside another structure is not taken. The outline provider was not used: it reads the text with regular expressions and knows no TYPES. Dictionary types (no `=>`) are reported as not opened from here. The test mock gained `registerTypeDefinitionProvider` and `positionAt`.

The user expected plain F12 to reach the type. On the name in its own `DATA(` / `FINAL(` there is nowhere else to go - ADT answers navigation with its "definition location found" message - so the definition provider falls through to the type definition there, and only there.

The inline hover was trimmed at the user's word: SAP's element name and kind (`LS_RESULT  PROG/PD`) and `visibility: local` said nothing useful there. With the key now seen on a live system, the hover shows the declaring statement and `abapType` only, plus components when SAP lists any.

Visual Debug brought to the same controls as Value origin, at the user's request. Most of it was already shared through `vertex-flow.js` (Show from here, branch menu, Auto, the expand switch, BSE rules). What differed was the reading switch: the window put its own Classes / Methods segment and a separate Logic button (the Tools logic diagram in an iframe) into the row, and had no Statements. Now `showFlow` builds all four readings of the same source - the record when there is one, the static analysis otherwise - and hands them over as `flowReadings`; the shown reading is built last so `sharedIds`, by which the current step is marked, are its own. The view announces a reading change (`bse:reading`), and the window takes it as its `flowMode` and rebuilds the ids. The window's old buttons stay in its markup but out of the row; their code paths are unreachable from the toolbar now. Not run against a live debugger here.

Readings on demand. Building all four readings up front was the cheap way to let the shared switch work without the host, but Visual Debug redraws on every update of its record and so built three unseen readings each time. Now only the shown reading is built. The view builds another one on the first switch to it and keeps it: through the host's `vertexFlowReading(mode)` where the host keeps the source (Visual Debug's record), else itself from the builder input the page carries (`flowReadings.input`). The Value origin page therefore carries the builder and the ABAP control rules inline in VS Code; Eclipse's page lends them to its frame from the window that already loaded them. Visual Debug tracks which reading its step-marking ids belong to (`builtMode`) and rebuilds them only when that differs.

Back after a jump from a diagram said there was no previous position: Value origin opened code with `vscode.open` and Tools diagrams through `revealSource`, neither of which recorded where the reader was. Both now push the editor being left into VERTEX's navigation history first.

Diagram labels showed `IF sy-subrc &lt;&gt; 0`: Mermaid escapes `<`, `>`, `&` and quotes in a label, and with text labels (`htmlLabels:false`) writes the escape into the SVG text as it is. Mermaid's own entity codes (`#60;`) were tried first and end the same way - it turns them into HTML entities too. After drawing, the text of every label is put back to the characters, before the label backings are measured. A source line that literally contains `&lt;` would now read `<` in the diagram; ABAP code practically never does.

Tools Logic labels now keep the code as written too. `ace-scheme.js`'s `label()` used to rewrite operators to words and symbols to look-alikes (`<>` to NE, `=>` and `->` to a dot, `<` `>` to parentheses, brackets to parentheses, `;` to a space). Every Tools label is quoted, so only `"` and `|` (the edge-label delimiter) still need replacing. One more trap surfaced while checking against the real Mermaid: a `<fs>` field symbol is taken for an HTML tag and dropped. So a `<` travels as U+E000 - in Tools and in FLOW alike - and is put back after drawing together with Mermaid's own `&lt;` `&gt;` `&amp;` escapes (`plainLabels` in metrics.html). Checked in a browser with `IF a <> zcl_x=>c AND b <= 3`, `ASSIGN ... TO <fs>`, string templates and `;` in literals: all drawn as written.

Release notes tidied for the deploy: the 0.8.2 and 0.8.3 notes had been appended paragraph by paragraph at the end of README.md, vscode/README.md, eclipse/README.md and history.md (under the Eclipse Tools subsection) and as one line each in docs/index.html, and two of them had been spliced into each other. They are one 0.8.3 section now - first in history.md, above the 0.8.1 section in the READMEs, a section of its own in docs/index.html. The Eclipse README says only that the next plugin build carries the shared page's changes, since the plugin was not built.

Tools Logic now switches methods while the editor scrolls. The window already sent the scrolled-to line (a third down the visible range, debounced) as `codeCursor` with `scrollOnly`, but the page opened another method only for a cursor move. `openUnit` only redraws the diagram and does not move the editor, so allowing it on scroll cannot start a loop.

Eclipse brought level with VS Code. `node eclipse/prepare.js` changed nothing: the shared pages and bundles (Value origin, the frontend bundle, the ABAP control rules) were already current. What VS Code had gained on the host side was checked one by one. Navigation history and `revealSource` have no Eclipse counterpart to port - ADT opens one editor and keeps its own history; the inline-declaration hover and Go to Type Definition are ADT's own in Eclipse. The one real gap was Tools Logic on scroll: `ToolsView` sent only selection changes. It now tracks the active ADT editor (`IPartListener2`), listens to its viewer's viewport (`IViewportListener`, through the `ITextOperationTarget` adapter) and sends the line a third down the visible range as `codeCursor` with `scrollOnly`, debounced 100 ms, as `tools-window.js` does. Compiled against the bundle pool with `javac --release 21`; not run in Eclipse, and the plugin was not built.

A breakpoint set in the gutter on a line SAP refuses (a `DATA:` declaration in the report) kept its red dot, while the debugger's list showed only the points SAP had taken. `addNativeBreakpoint` let `setBreakpointAt`'s refusal propagate to the error message and left VS Code's point in place. It now removes that point from VS Code (`vscode.debug.removeBreakpoints`) before rethrowing, so the error is still shown. A test pins it. Eclipse uses ADT's own breakpoints and is not affected.

Predict with BSE stepped through a chained `WRITE:` (lines 54-66 of Z_CALC, inside the LOOP) one F5 per line, on every pass. abaplint splits a chain into statements that all begin with the shared keyword token, so `value-origin-linter.js` gave every element the keyword's line (54); SAP stops on the line where each element's own part starts (59). `placeOf` found no statement at 59 and fell back to F5, so `skipAhead` never ran. Each statement now also carries `stepLine` - the line of its first token after the chain's colon - and the statements map (`mode=statements`) places statements by it. Other consumers keep `line`. A test pins lines 3, 4, 5 for a three-line chain. The full suite fails the same 13 tests with and without the change. Not run against a live debugger.

Then, at the user's suggestion, the rest of a loop pass. Even with the chain recognised, every pass still ran its tail to ENDLOOP and stopped there and on the LOOP line. `loopRest` in visual-debug.html: from a statement inside a loop (the innermost LOOP / DO / WHILE above it in the routine), when no place of the slice and no breakpoint stands between it and the loop's end, Predict runs F8 to temporary points on the loop's head and on every statement the routine can reach after the loop - the same exit lines `loopExit` uses. A call that is itself a place of the slice is not run past, and the tail must spare at least MIN_RUN statements. It goes before the block and straight-run passes, which would only reach ENDLOOP. The summary counts `loop pass tails passed`. A test covers the Z_CALC shape (points 43, 70, 72 from line 51; none from before line 50, over a breakpoint, or for a short tail). Not run against a live debugger.

The user tested as "0.8.4" while the installed extension was still the 0.8.3 build from before these fixes. A version number named by the user means: bump and build after the changes. So VS Code goes to 0.8.4 - package.json and the lock - and the three fixes of this session (refused breakpoint, chain lines, loop tails) moved from the 0.8.3 notes into a 0.8.4 section. Eclipse not built.

Visual Debug Copy log now includes DEBUG HISTORY SLICE (recorded stops, selected-variable snapshots, watch reads, changes since prior reads, missing/error states) and DEBUG CONTEXT (the current assistant context). Export does not infer or carry forward values; a changed value does not identify an intervening culprit statement by itself.

Visual Debug assistant context now includes actual recorded value history (up to the context limit), with missing/error states. Watch reads always include the chosen variable alongside relevant operands; previously only the route reached chat despite recorded values being available.

Visual Debug replay slider now displays watch values read at the selected recorded stop, including missing/read-error states, rather than ignoring watch history and searching only routine scope snapshots.

The first run of 0.8.4 recorded only one pass of the loop: the point for the next pass stood on the LOOP line, and SAP runs LOOP AT once, on entry, so a point there is not hit on later passes - the F8 ran on to after the loop. The point for the next pass now stands on the first statement of the body, which every pass runs; the points after the loop stay. The test expects 45 instead of 43. Not run against a live debugger yet.


## 2026-10-07 — 0.8.3 release documentation
The user confirmed the history replay works and requested deployment as 0.8.3. Restored the VS Code package and lock version to 0.8.3, corrected current release headings, and documented watch capture, replay, BSE/Predict, Initials, log export and the 150-stop assistant history limit in the repository, Marketplace README, release notes and website. Earlier 0.8.4 preparation entries are historical. Eclipse was not rebuilt in this landing.

### Value Origin: selected assignment and Copy log

Selecting a variable on the left side of an assignment includes that assignment in its backward slice. Selecting an operand keeps the incoming-value analysis. This retains the selected calculation and its condition and dependencies in BSE. Copy log uses the VS Code host clipboard and displays success or failure instead of relying on webview clipboard permissions.
### Eclipse build 0.8.1.20261007124532

The Value origin changes above (the selected assignment in the slice and the model/view fixes) had reached only VS Code: the generated `org.vertex.abap.ui/assistant/value-origin.js` and `resources/vertex-frontend.js` were older than their sources. `eclipse/package.ps1` (which runs `prepare.js`) regenerated both and built the update-site candidate `target/eclipse-0.8.1.20261007124532`. The regenerated bundles match a fresh bundle of the current sources. Visual Debug has no Eclipse counterpart. `eclipse/value-origin.test.js` fails one check (the page has 4 scripts, the test expects 3); it already failed at HEAD and is not touched here. The build was not copied into `docs/` (not published) and not run in Eclipse.

### FLOW tree: BSE collapsed, Depth disappeared

Reported in Eclipse, seen in VS Code too: in Statements, Full showed the tree open, BSE showed it closed, and moving Depth took the slider away. The Full / BSE switch redrew the tree with `renderFlowTree()` and nothing else, so every branch came back closed; a reading change goes through `syncDepth(); applyBranchChoice();` and the scope switch does that now. The slider vanished because at depth 0 the root has no kept children, was drawn as a `div` without a `summary`, and `attachTreeSwitch` had nowhere to put Expand all and Depth - and could not bring them back. The root is always a branch now. At the user's word, Depth for calls starts at 1 (formula steps keep 0). Reproduced and verified in a browser on a page built from the Z_CALC shape (VS Code page; Eclipse uses the same `vertex-flow.js`). Eclipse rebuilt as 0.8.1.20261007124532; VS Code not packaged. `visual-debug-ui.test.js` "the chat is given what the window shows" fails on the uncommitted `visual-debug.html` (`debugHistorySlice` undefined), not on this change.

VS Code goes to 0.8.4 at the user's word (package.json and the lock), and the FLOW tree fix moved from the 0.8.3 notes into a 0.8.4 section everywhere. `vscode/package.ps1` built and verified `vertex-abap-0.8.4.vsix`; the released 0.8.3 vsix is untouched.

### Chat: found objects as links

A bare object name that finds several objects answered with a list and "Ask to open one of them by name and type", so the reader copied a name back into the chat. `direct-search.js` already handed the list over as `choices`, and `chat.js` returned it, but the panel never used it. `sidebar.js` now sends the choices with the answer; the panel turns each listed name whose type and name match a choice into a link, and a click asks the host (`openObject` → `ask.openObject` → `open_sap_object`) to open it the way a single match is opened. The closing line says "Click a name to open it." Checked in a browser on the panel's own script (link built, click sends type and name); not run in VS Code against SAP. VS Code only - the Eclipse chat is unchanged.

### Tools: Logic only outside Logic

`metrics.html` showed the Logic only switch in UML while the window loaded: the button was visible in the markup and only `setMode` hid it outside the scheme mode, which runs once the answer arrives. It starts `hidden` now; `setMode` shows it for Logic, the only mode that reads it. Seen on the way: a package UML (Z_SDE, 26 classes) fits at about 15 %, Z_VERTEX (74) smaller still - how a package diagram should be cut down waits for the user's choice.

UML loading spoke only in the small status line on the right ("checking what this system has ..."), and the diagram area stayed empty. `metrics.html` now puts a note in the diagram area at each stage: checking the system, reading the class definition or the package's classes, loading Mermaid, drawing N classes / interfaces. The drawing note is painted before Mermaid starts (a frame, then `draw`), since Mermaid does not yield. The page's scripts parse; not seen in a running window.

Chat answers had no way to be copied. `sidebar.js` puts a Copy button (`secondary`, theme colours) under each VERTEX answer, after its usage line; it sends the answer's Markdown without the "VERTEX: " prefix to the host (`copyAnswer`), which writes it with `vscode.env.clipboard.writeText` and reports back, and the button reads Copied or the error for two seconds. Checked in a browser on the panel's script. Seen on the way, not changed: an answer that starts with a heading shows "VERTEX: ## …" as text, because the prefix stands on the heading's line.

At the user's word, the answer's "VERTEX:" prefix moved to a line of its own (`"VERTEX:\n" + answer`), so the panel's Markdown sees a leading `##` or list item where it starts a line. Copy strips the prefix with any whitespace after it. Checked in a browser on the panel's script: the heading is rendered, Copy sends the answer without the prefix.

### The ACE core leaves the repository

The user asked whether the `ZCL_VX_ACE_*` classes were still needed, now that the analysis runs in the clients. Checked first: no client calls them. In VS Code `extension.js` answers `/vertex/metrics|class|package|flow` from `frontend-analysis.js` before anything reaches SAP (the statement map for Visual Debug included); Eclipse's Tools window runs the same bundle through `eclipse-frontend.js`; Value origin is ADT + abaplint in both. Only four hub resources used ACE - `ZCL_VX_ADT_RES_CLASS`, `_FLOW`, `_METRICS`, `_PACKAGE` - and only `ZCL_VX_ADT_RES_ABOUT` named them. Removed with `git rm` in the local repository, at the user's word (not in SAP): 24 ACE objects (21 classes, 3 interfaces, `Z_VX_ACE_SCHEME_TEST`) and the four resources, 56 files; their four routes left `ZCL_VX_ADT_RES_ABOUT=>SERVICES` (no BOM in that file, none added). A first attempt was refused by the permission check and repeated after the user confirmed.

On the way: Simple-Data-Explorer's local repository is already clean (hub removed 2026-09-18); ACE and AVE hold nothing made only for VERTEX. On E19 the user pulled SDE: `ZSDE_ADT_RES_APP` and `ZCL_SDE_ADT_RES_TABLE` are gone, `ZCL_SDE_ADT_RES_APP`, `_FLOW`, `_JOIN`, `_METRICS`, `_REVIEW`, `_VERSIONS` and `ZCL_SDE_ACE_SOURCE` are still there.

Left in the clients and not changed yet: `originSources` in `code-workbench.js`, `read_origin_index` in `sap-code.js` and `sourcesFromAce` in `value-origin-ace.js` (unused, they read the removed flow route); Eclipse's `MetricsView` / `MetricsHandler` (not registered in plugin.xml); and Visual Debug's notice that tells the reader to "pull ZCL_VX_ADT_RES_FLOW". The SAP side is not pulled or activated from this change.

### Review in 2 pane; the system check said in the page

The plain version diff had Inline | 2 pane, a request's review only Compact | Full. `versions.html`: the switch's choices are one constant (`SIDE_CHOICES`) used by both bars, and the review bar has it too, sharing `sideBySide`. `sideTable` takes the review's blocks like `diffTable` does and puts each block's bar and its comments above the row holding the block's first operation, spanning the four columns. Checked in a browser on the page with a made-up review: the block stands above its changed row in 2 pane and back in Inline.

The loading notes in the UML diagram area went by too fast to see; the long wait is the system check, and the diagram pane is still hidden then because no mode is chosen. `metrics.html` says "Checking what this SAP system offers ..." in the list area instead (`message`) and clears it when the answer comes, if nothing has replaced it. The first attempt at this edit was reported as rejected but had already been written.

The user: in 2 pane the old version goes on the right and the new one on the left, everywhere. Before, only a diff against the base did that (`baseOnRight`); a diff with the previous version put the old one on the left. `sideTable` is now always called with the new side left - the version diff and the review - `baseOnRight` is gone, the heading reads `new ↔ old` in 2 pane, the column rule follows the first code column instead of the `old` one, and the switch's tooltip says so. Not changed: the draft diff before applying SAP code (`vscode.diff` in `code-workbench.js`) keeps the original left, because VS Code's diff editor only edits its right side and the draft is edited there; the Code Change reviewer is one column.

### Eclipse chat: links and Copy

The chat changes of this landing had reached only VS Code's panel. Eclipse's chat (`chat.html`, `eclipse/bridge.js`, `AssistantBridge`, `ChatView`) now has them too. The direct search hands its `choices` back from the bridge; the page turns matching names into links, and a click calls the new `sdeOpenObject`, which sends the bridge a `call: "open"` request - the bridge opens the object with the same `open_sap_object` tool the single match uses and answers `{call:"open"}` (an error is said in the chat). Copy goes through a new `sdeCopyText` on `ChatView`, Eclipse's clipboard, and the button says Copied or why not. The "VERTEX:" prefix needed nothing here: Eclipse puts the speaker in a label of its own above the answer. Checked: the bridge from the prepared `assistant/` folder against a stubbed search (choices returned, the clicked object opened by its ADT URI), and the page in a browser with stubbed host functions (links, open call, Copy, an open error said). The plugin was compiled and packaged, not run in Eclipse.


### Eclipse: every function module "was not found"

Reported on ER6 in Eclipse 2025-03: VERTEX said "Function module ZHR_GET_AL1_POSITION was not found." `PageView.adtObject` finds a function module's ADT URI through the quick search, and the pattern that picks the results out was written `"<adtcore:objectReference\b[^>]*>"` - in a Java string that is a backspace character, not a word boundary, so it matched nothing and every function module was "not found" since 0.7.8. It is `\\b` now; checked with Java on a search result of that shape. No other Java string literal has a single-backslash regex class. On the way: this shell turns a doubled backslash into one even inside a quoted heredoc, so files with backslashes are written through Python with `chr(92)`.

Also from that machine: Eclipse 2024-03 showed every VERTEX window empty, 2025-03 draws them - nothing VERTEX logged; and the ABAP editor failing with `NoClassDefFoundError: com/sap/rnd/ui/wordcompletion/RndCompletionProposal` was a mixed ADT install, not VERTEX.

At the user's word, Eclipse also searches a function module the way VS Code does: when the quick search filtered to `FUGR/FF` returns no result of that exact name - which happens for standard function modules - the exact name is searched without a type and a `FUGR/...` result of that name is taken (`PageView.functionModule`). Compiled and packaged; not run against SAP.

### Logic: TRY / CATCH as a branch

Found by the user in ZCL_AVE_VERSION_LIST=>LOAD: after `TRY. ... CATCH zcx_ave. RETURN. ENDTRY.` the Logic diagram went RETURN -> ENDMETHOD and drew nothing of the rest of the method. `ace-scheme.js` drew a TRY as a frame only; a CATCH, being a branch row with no branch owner in `conds`, was treated as the next step after the TRY body, so the handler's RETURN emptied the chain and every later statement was skipped. A TRY now also opens a `conds` entry like IF / CASE: its header is the step before the TRY, each CATCH (and CLEANUP) is a node entered from that header, the body's tail and every live handler tail meet at ENDTRY, and the method goes on from there. A test pins the shape. The three ace-scheme tests that failed before still fail the same way. Shared through the frontend bundle, so Eclipse's Logic gets it too.

### 0.8.5: an exit ends its branch

With TRY / CATCH fixed, the RETURN in the handler still drew a line labelled "return" over the whole diagram to ENDMETHOD. At the user's choice the branch now ends at the exit instead, and the exit is marked. `ace-scheme.js` has one rule for leaving the routine (`exits`): RETURN, LEAVE PROGRAM, and an EXIT that no LOOP / DO / WHILE / SELECT encloses - before this, LEAVE PROGRAM and such an EXIT were drawn as ordinary steps the flow went on from. Such a node gets the class `exitnode` and no edge; Logic only keeps it like a RETURN. `metrics.html` colours `exitnode` from `--vscode-errorForeground` (fill a light mix toward the page, text and a 2px stroke in the colour), in the same rule block that tints decisions, so it follows the theme. Two tests pin it; the three ace-scheme tests that failed before still fail the same way. Seen rendered in a browser on the LOAD shape (light colours stood in for the theme there). VS Code goes to 0.8.5 at the user's word.

### F1 in a very long source

On one system F1 said "ABAP documentation is not sent to SAP for a source of 29564 lines (limit 20000)". The limit in `analyse` protects SAP and the machine from re-analysing a huge file on every hover; the documentation does not need the file. At the user's suggestion SAP is now sent one whole statement: `documentation` in `sap-code.js`, for a source over the limit, parses the 400 lines either side of the cursor with abaplint (`value-origin-linter.parseSource`), takes the statement whose lines hold the cursor - every statement of a chain, which share an offset - and sends those source lines as they are, with the line counted within them. A source under the limit is sent whole, as before; hover and Go to Definition keep the limit, since they need the declarations. Checked with a stand-in client on a 25,000-line source: a three-line SELECT, a two-line chained WRITE and a one-line statement each went out alone with the right line (first call 1.8 s, mostly loading abaplint). Not yet checked against SAP - whether its documentation answers the same for a statement alone. Eclipse is not affected: F1 there is ADT's own.

Then the user met the same limit in a hover ("Element info is not sent to SAP for a source of 29564 lines") and raised it: `MAX_ANALYSED_LINES` is 50,000. One source line count governs hover, Go to Definition and F1; F1 cuts out the statement only above it now. The 20,000-line limit on reading an object on its own in the variables view (`MAX_VARIABLE_LINES`) is a different one and stays.

"SAP is still analysing the previous request" came up as an error: one SAP analysis runs at a time, a hover is refused while one runs, and only Go to Definition waited. F1 (`documentation`) and Go to Type Definition (`elementDetails` with `{ wait: true }` from `typeDefinition`) are asked for, so they wait too now; a hover still does not.

### The chat sees the review on screen

Asked "describe the changes in the code" with a review object open, the assistant answered that it had only the active source. The Tools page tells the panel where it is (`pageState`: view `review_object`, the request, the object and its type) but no lines, by design; `withShownDiff` in `extension.js` read the lines for a version diff only. It now reads a review object too, through the same route the page uses (`SERVICES.versions.review` with the request, no remote, the object and its type), and hands the changes over as the selected fragment: changed lines with three around them, each block's header (`#n kind, count lines, line, author, verdict`) above its first line. Checked with a stand-in fetch: the route matches the page's, the fragment is as above. Not run against SAP. Eclipse's Tools chat has no such step for either a diff or a review.

### Import and test SAP systems

After a demo the question was how a new user knows what to put in `vertex.systems`. Eclipse and SAP GUI connect by RFC through SAP Logon, so the HTTP address of ADT is the one thing nobody has at hand. `system-setup.js` builds the entries from what the machine already knows: SAP Logon's `SAPUILandscape.xml` / `SAPUILandscapeGlobal.xml` give each system's ID, host and instance (`server="host:32NN"`; a message-server entry has no host and is listed as not offered), an Eclipse workspace's `com.sap.adt.destinations.ui.prefs` gives the client and user per system ID (the folder is chosen once and remembered). The port is found by asking `/sap/bc/adt/discovery` without a password on 443NN, 80NN, then - at the user's suggestion, a brute list - 44300, 8000, 50001, 50000, 443, 80, 8443, 8080, all at once; any HTTP status counts as an answer (401 is the normal one), an unverifiable certificate is tried again without the check and the entry gets `allowInsecureCertificate`. The reader picks from a list showing what was found; an address that did not answer is typed, a missing client or user is asked; nothing is written before that. Names already configured get a suffix rather than being replaced. Checked on this machine: 15 SAP Logon systems read, A4H and E19 found at https :44300 with an unverifiable certificate (401), client and user from the Eclipse workspace; A4H was down.

**VERTEX: Test SAP Systems** logs on to each configured system with its user and password, the way a read does, and says per system: OK, a missing field, 401 (the stored password is then dropped so the next attempt asks again), an ADT failure, or why it could not be reached. The password prompt stores it in SecretStorage, never in settings. Both commands are links in the `vertex.systems` description in Settings, and the "No system configured" message names the import. Not run inside VS Code yet.

Decided with the user: VS Code keeps reaching ADT over HTTP(S) to the ICM. Eclipse needs no HTTP port because ADT there tunnels its REST calls through RFC (`SADT_REST_RFC_ENDPOINT`) on SAP Logon's host and instance; doing the same here would need the SAP NW RFC SDK (S-user download) and a native `node-rfc` on every machine. So SAP Logon gives the host and instance, the import finds the port.

A SAP Logon entry that logs on through a logon group names no application server: it carries `msid`, the uuid of a `<Messageserver>` element (in the same file or the global one), and the group as `server`. The import now takes that message server's host - usually the central instance, which runs an ICM too - and the instance from a message server port `36NN` when it is written as a number; without one only the fixed ports are tried. The list says "logon group X, message server Y". An entry whose message server is not described is listed as not offered. A test pins the three shapes. No such entry exists on this machine, so it is checked on a made-up landscape only.

The push of 0.8.5 failed four times with GitHub's "Internal Server Error" after the deltas were resolved; the same commit went to a temporary branch at once, `main` then took it on the next try, and the branch was deleted. Cause not known.

The Eclipse workspace no longer has to be chosen by hand. Each Eclipse installation lists its recent workspaces in `configuration/.settings/org.eclipse.ui.ide.prefs` (`RECENT_WORKSPACES`, a Java properties value: an escaped colon, a doubled backslash for one, an escaped `n` between entries). The import looks for installations under C:\eclipse, D:\eclipse, Program Files\eclipse, the user's eclipse folder (the Eclipse Installer's default) and LOCALAPPDATA\Programs, three levels down, adds the default `eclipse-workspace`, keeps the workspaces that have ADT logon settings, and offers them with the systems, clients and users each knows; the folder dialog stays as the last choice. On this machine it found D:\Eclipse\workspace (A4H, E19) and C:\Users\Dell\eclipse-workspace (A4H, A4H) in 21 ms. A test pins the properties parsing.

A first start knew nothing of the import. When `vertex.systems` is empty at activation, VERTEX now shows a notification with Import SAP Systems and Settings; the import still writes only what the reader picks.

### 0.8.5 confirmed

The user ran 0.8.5 and confirmed everything works - the import and test of SAP systems and the start-up offer included, which until then had only been run from node. The 0.8.5 notes, appended one by one, became one section in README.md, vscode/README.md, history.md and docs/index.html, headed by what the release is about (system setup, exits in Logic, long sources); eclipse/README.md says which part Eclipse shares and that system setup is VS Code only.

The docs now say that the import leaves `webgui` - where the debugger opens WebGUI - to be added by hand: SAP Logon does not know it, and it is needed only when WebGUI is not on the system's `url`.

The user's own settings show when `webgui` is needed: A4H, on `https://...:44300`, never had it; E19 had `url` on HTTP port 8000 and WebGUI on HTTPS 44300. The docs say so, and that the import's HTTPS-first order makes it rarer.

Then, at the user's question, `webgui` is found too. The debugger opens `<webgui or url>/sap/bc/gui/sap/its/webgui`; the import asks that path without a password - 200 or 401 means WebGUI is there - first on the address it chose, then on the other addresses ADT answered on, HTTPS first; a redirect to another host is followed once and kept only if the host resolves. Served on the chosen address: no `webgui`. Elsewhere: written as `webgui`. Nowhere: the import says so. The probe now keeps every answering address for this. On this machine A4H and E19 answer WebGUI on https :44300, the address the import chooses, so neither gets `webgui` - as A4H never needed it.

The Command Palette listed all 25 VERTEX commands. `contributes.menus.commandPalette` now hides the five VERTEX Tools submenu functions and Back (`when: false`), and shows the editor commands under the conditions their keys and menus already use: the debugger steps, Go to and the SAP-tab commands in a `vertex-sap` ABAP editor, F1 in an ABAP editor of either scheme, value origin in any ABAP editor. There is no "debugging" context key, so the steps follow their key bindings rather than a new key. Eight commands stay everywhere.

At the user's word the palette change ships as VS Code 0.8.6 (package.json and the lock), with a section of its own. The docs were searched for commands now hidden from the palette: none is described as reached through it - Back is Alt+Left, and Run ABAP Unit Tests / Run ATC Check, which the docs do name in the palette, are still there in a SAP tab.

The user: the palette cleanup is not a feature to announce - it undoes an earlier choice, made without asking, to put every command in the palette. The 0.8.6 section left README.md and vscode/README.md; history.md and docs/index.html keep the version's note.

Switch System left the palette too, at the user's word: the VERTEX panel's system list is how it is used, and that list calls the same command.

Open Visual Debug needs a SAP ABAP tab (it debugs the program there, and says so otherwise), so the palette offers it only in one, as its context menu does. Six commands remain everywhere.

"Copy the MCP address for Claude Code or Codex" could be found only through the docs. The VERTEX panel's top line now has a **Connect Claude Code / Codex** link (right-aligned under LLM Providers when the panel is narrow) that runs the same command, and the command left the palette. vscode/README.md tells people to click the link instead of running the command.

The panel link was the wrong place: connecting an assistant is done once, and then the link only takes room. At the user's word it moved to Settings - a command link at the head of the `vertex.mcp.port` description (now `markdownDescription`), like the import and test links under `vertex.systems` - and the panel is back as it was. The docs point there.

"Connect Claude Code or Codex" did not say what it does. The link and the command are now "Add the VERTEX MCP server to Claude Code or Codex": they copy the registration of VERTEX's MCP server for that assistant.

### Get started

Setup was spread over Settings: import and test under `vertex.systems`, the MCP link under `vertex.mcp.port`, and VS Code sorts settings alphabetically. At the user's word there is one place now: a walkthrough (`contributes.walkthroughs`, `vscode/walkthrough/*.md`) that VS Code opens after the install and keeps under Help > Get Started. Four steps, each a button and ticked when its command runs: Import SAP Systems, Test SAP Systems, the VERTEX panel (provider and model; LLM Providers has no command of its own, so no new one was made), and the optional Add the VERTEX MCP server. The MCP command, renamed so its name says what it does, is back in the palette - typing "MCP" finds it - since it is needed again on another computer. The setting links stay. Packaged and present in the vsix; not opened in VS Code yet.

### Eclipse: VERTEX items gone from the ADT editor's menu

On ER6, ADT 3.60 in Eclipse 2025-03, the context menu of a class editor had no VERTEX item at all - not even VERTEX Tools or VERTEX: Activate, whose condition was the simplest: the editor input adapting to `com.sap.adt.tools.core.IAdtObjectReference`. That adapter is exactly what `AdtEditor` already does not rely on (ADT registers the EMF reference, so it asks for both on input, file and editor). And the analysis items were contributed to `popup:#EditorContext`, an id the ADT editor's menu need not carry. Now every editor item is decided by `EditorTester` on the active part - a new property `adtObject` (AdtEditor recognises the editor) for VERTEX Tools and Activate, `valueOriginSource` as before for the analyses - and all go to `popup:org.eclipse.ui.popup.any`; in the Project Explorer the active part is no editor, so the tester keeps them out there, and VERTEX Tools keeps its selection test. Built as 0.8.1.20261008092755; compiled only - not opened in Eclipse, which is where it has to be confirmed.

With that build the menu came back, but in a class's method code only VERTEX Tools and Activate showed, while programs and function modules had all five. The analyses test `originType(object.type)`, which knows PROG/P, CLAS/OC, INTF/OI, FUGR/FF; Tools and Activate passing means the editor was recognised, so ADT 3.60 must label the Global Class tab with another type. Not seen directly: Eclipse is not run here. `AdtEditor.kind()` keeps a known type and otherwise reads the kind from the ADT URI (`/oo/classes/<name>` -> CLAS/OC, `.../includes/<name>` -> CLAS/I, interfaces, programs, includes, function modules); the tester, the Value origin handler and `ActivateHandler.sourcePath` use it, and `sourcePath` no longer appends `/source/main` to a URI that already ends with it. Built as 0.8.1.20261008092755.

### 0.8.7: function modules in VERTEX Tools

A function module's Tools window offered only Diff - `object-tools.js` listed nothing else for FUNC, though the client-side analysis already read function modules (Calls follows CALL FUNCTION into them). Checked with a stand-in reader on a made-up FM: metrics returns its FUNCTION unit, the Logic scheme draws its IF and RETURN, Calls reaches the called FM. FUNC now offers Metrics, Logic diagram, Calls diagram and Diff, and opens on Metrics like a program. Shared by both hosts; VS Code goes to 0.8.7 at the user's word. FUGR stays Diff only. On ER6 Diff still fails: the ABAP half of VERTEX is not installed there.

### Calls: a local class's method opens in its program

Reported in Eclipse on ZYS_AVE, true in both hosts: a click on `ZCL_AVE_POPUP->BUILD_LAYOUT` in the Calls diagram opened `ZCL_AVE_POPUP` as a global class ("does not exist") - the page took the owner of `OWNER->METHOD` for a class name. The analysis knows better: each routine was read from a source with an object name, type and line. The Calls answer now carries `places` (label without spaces -> object, type, line of its METHOD / FORM / FUNCTION / event), and the page opens a routine read from a program, include or function module there; a global class's method is still found by name, since a class include's line is not a line of the class's main source. Checked with a stand-in reader: a program with a local class gives START-OF-SELECTION at 15, CONSTRUCTOR at 8, BUILD_LAYOUT at 11, all in ZYS_AVE. Not clicked in either host yet.

### Value origin: FLOW goes only where the value is computed

On a local variable of a function module FLOW went into every class the FM calls. The user's rule: with a variable chosen, go only where it is computed; the full run is wanted when breakpoints bound the flow. `value-origin-view.js` now hands the flow builder only the call sites whose callees are relevant - a routine with a statement of the slice (`included` rows, by scope), or a routine that calls one, to a fixed point - unless `flowBounds` is set. The caller's routine is taken from the rows by object and line, since a site in an event block carries no method name. The object's own statements are untouched. The demo fixture has no slice data (no ACE flow offline), so under the rule it no longer goes into calls; the BSE-scope test, which is about the tree's rule, now runs bounded over the whole program. Shared with Eclipse through the Value origin bundle. Not seen in either host yet.

Asked on the way: non-customer code is not read at all - `customerObject` keeps Z*, Y* and /namespace/ objects, and a standard callee is listed as skipped.

The class editor still showed only VERTEX Tools and Activate with the URI fallback, so the guess about the type was wrong or not enough. Instead of guessing again, `EditorTester` now writes one Error Log line per object when it recognises an editor but offers no analysis: the type, the kind, the ADT URI and the editor class. Built as 0.8.1.20261008101028 to read that line from ER6.

### Eclipse Value origin: read on demand

On ER6, Value origin on a local variable of a function module went on parsing ZCL_HR_DUTYTRAVEL, ZHR_SS_PERM_ACTOR_RELEASING and more, and showed nothing. Eclipse's page still used the eager `collectSources`: every customer object the source names, then theirs, up to 240, before any slice. VS Code had long used `value-origin-demand.collectDemandSources`, which reads only the objects the slice's statements need and repeats until nothing new is needed. The Value origin bundle now carries that module and the Eclipse page uses it; Eclipse's loader already brings a class with all its parts, so the part loader adds nothing. The progress line's separator had been saved as U+FFFD at some point and showed as a box; it is a hyphen now. Built as 0.8.1.20261008101302; not run on ER6 yet.

### One source pipeline for Value origin

Why Eclipse had kept the eager collector: the analysis is shared, but each host wrote its own driver around it - VS Code in `code-workbench.js`, Eclipse in `eclipse/value-origin.html` - and the choice of collector lived in the driver. When VS Code moved to `collectDemandSources` (0.8.1, 6 October), the Eclipse page written a day earlier stayed on `collectSources`, and its bundle did not even carry the demand module. At the user's word the choice now lives in one place: `vscode/value-origin-pipeline.js`, `collect(initial, target, { load, loadPart, cancelled, progress })`, reads on demand with the 240-source limit; each host gives only its readers. VS Code's linter analysis and the Eclipse page call it, the Eclipse bundle exports `collect` and no collector of its own, and `value-origin-pipeline.test.js` fails if either host calls a collector directly again. The unused ACE-era `originSources` in code-workbench.js still calls `collectSources`; it is not a live path.

### Leftovers of the server-side ACE and of the 0.8.1 preparation

Removed at the user's word: `originSources` in `code-workbench.js` (the ACE-era Value origin driver, unused, still calling the eager collector), the `read_origin_index` handler `originIndex` in `sap-code.js` with its test (it read the `/vertex/flow?mode=origin` route that left the ABAP side), and `sourcesFromAce` from what the Eclipse bundle exports (the page does not use it; the function stays in `value-origin-ace.js`, where the Value origin tests build their sources with it). Also `docs/release-0.8.1.md`, a release-preparation note nothing linked to, and the "Release scope" paragraph of README.md and vscode/README.md, which said "The package remains 0.8.1" - untrue since 0.8.4. `docs/ace-port-audit.md` stays; docs/index.html still mentions it.

At the user's suggestion the three analysis items are now shown wherever VERTEX Tools is - any editor the tester recognises as an ADT object (`adtObject`) - instead of hiding when the object's type is not one they know. The URI fallback had not brought them back in ADT 3.60's class editor, and no Error Log line came either; now the item is there, and Value origin on an object it cannot analyse says so and names the type, which is what is still needed to fix the class case.

The message named it: ADT 3.60 gives a class's method code as `CLAS/I`, the class's main include. All of the class case at once, at the user's word: `AdtEditor.classOfMain()` recognises `/oo/classes/NAME/includes/main` and `kind()` reports it as CLAS/OC, with the source path taken from the class; `originType` also accepts CLAS/I, so local types, local implementations and test classes are analysed - the class is loaded with its parts and the editor's text is located among them by context, as for method includes; `ownerName()` gives the class name from the URI for the analysis and the window title; the frontend's class read for `mode=origin` takes `testclasses` too (metrics and diagrams do not). The refusal now names the ADT URI as well as the type. Built; not run on ER6 yet.

### Value origin FLOW: a local variable's method, and what lies between breakpoints

Checked on A4H's ZCL_AVE_POPUP, reproduced locally from the AVE repository's copy of it (the same 5397 lines). Without breakpoints, `lv_obj_count` in REFRESH_RPT_ROW drew the whole class from its root - every method, SHOW and its callers. The user: a local variable has no history outside its method. `value-origin-view.js` finds the declaration around the selected line whose locals name the variable (`graph.declarations`), starts the flow at that routine, and goes down only into callees that compute the value; callers and the rest of the class are not drawn.

With breakpoints 5382-5396 and `lv_name`, FLOW drew only `ZCL_AVE_ACR_METRICS=>ESC`: the breakpoints bounded the target source's rows, but the 9758 rows of the other 40-odd classes read for the analysis all went to the builder, and it took the first routine nobody calls for the root. Now the model marks rows outside the breakpoints (`outside`) instead of dropping them, and the view keeps the routine the breakpoints stand in (its rows between them), plus every routine called from there, down and whole - REFRESH_PARTS, in the same class beyond the breakpoints, included. Locally: REFRESH_RPT_ROW and REFRESH_PARTS; without breakpoints REFRESH_RPT_ROW alone, for both variables. `value-origin-flow-scope.test.js` pins both rules on a small class.

### Double-click on an interface call goes to the implementation

A double-click on `lo_strategy->calculate_base(` - `lo_strategy` typed REF TO ZIF_PRICING_STRATEGY - did nothing: the call is recognised as an interface dispatch and the only answer was a hint, shown for F12 and suppressed for the double-click. The user: it must go to the implementation. `sap-code.js` gains `implementation` - abap-adt-api's `findDefinition` with its implementation flag, ADT's navigate-to-implementation (Eclipse's Ctrl+F3) - and `code-workbench.js` asks it for an interface dispatch at the call, and for a method name on an interface's METHODS line; the answer opens as the implementing class's tab (`openForeign`, split out of `adtForeignDefinition`, now reading the source itself when the target is no class, program or interface). When SAP names no implementation, F12 says so. What ADT answers for an interface with several implementing classes is not known here - not run against SAP.

### Forward Usage Analysis: the flow forward, stopped at breakpoints

Brainstormed with the user: Value origin is split by direction along the call stack. *Forward* is how a value is computed - the existing analysis, renamed **VERTEX: Forward Usage Analysis** (command id `vertex.valueOrigin` kept, so keys and menus stay). *Backward* - where a result goes in the callers, a where-used that follows the value - is the next landing, VS Code first: a variable followed up through its callers; with none, every interface parameter and attribute of the method; with none of those, plain where-used. Callers are to be found through ADT where-used. Standard SAP code is a wall in both directions; everything customer is walked.

Breakpoints change meaning. They no longer bound the flow as a pair (`flowBounds` from the editor's breakpoints around the cursor): the flow is walked in the order it runs from the routine of the selected line, and each breakpoint it meets stops it with a modal question - *Stop analysis*, *Continue to next*, *Ignore breakpoints*. On Stop the flow ends with the breakpoint's statement, a call made there is not entered, and the window says where it stopped; Escape ends the analysis there as Stop does, and the window shows what was found up to the breakpoint. One breakpoint or many makes no difference: the start is the line and the direction. `value-origin-view.js` gains `flowScope` (the rows and calls drawn, taken out of `html`) and `stopAtBreakpoints`; the loader in `code-workbench.js` answers `sourceFor(uri)`, so a breakpoint in an open VERTEX tab is placed on its analysed source.

With no variable under the cursor the command now runs instead of refusing: the flow forward from that line - the routine from there on and every customer routine it calls - with no slice (`flowPath`/`flowRange` from the cursor line, as the debugger's path from a breakpoint does).

`flowBounds` stays in the model and in `html`: Visual Debug's path from a breakpoint (`readOrigin`) uses it. `value-origin-flow-scope.test.js` covers the forward flow without a variable, the three answers at a breakpoint and the window's title. The full suite has 15 failures in ace-scheme, lens, visual-debug-ui, formula-diagram and value-origin tests that are not about this change (slider markup, `subgraph`, `focusedRoutine`). Not run in VS Code against SAP yet. Eclipse is unchanged.

### Backward Usage Analysis

The second half of the split, VS Code only (new features go there first). `vscode/backward-usage.js` holds the walk, with no VS Code in it: from the routine around the selected line it goes up a level of callers at a time. The targets are the chosen variable - a parameter or attribute itself, a local through the output parameters and attributes it reaches in its routine by assignment - or, with no variable, every parameter and every attribute the routine reads. Where a routine has neither, the answer is SAP's where-used as it is, the declarations left out. At each call the actuals are bound to the formals: named ones by name, one unnamed argument to the preferred or the only importing parameter, PERFORM's USING / CHANGING / TABLES by position against the FORM. A value given back (EXPORTING, CHANGING, RETURNING - received by RECEIVING or by the assignment the call stands in) is followed on in the caller: every later statement that reads it is listed as assigned to, condition, database, output, passed to or used, and names reached by assignment are followed too. Where it reaches an output parameter of the caller, the walk goes up from there. A value passed in (IMPORTING, USING) shows what each caller passes, and when that is a parameter of the caller's own, the walk goes up to where the caller got it. An attribute's uses come from where-used of the attribute and are listed, not followed on. A routine and parameter already followed is marked ↻.

Breakpoints work as in Forward: the lines of a level - the calls and the uses found in them - are checked against them, the breakpoints a level reaches are asked about together (*Stop analysis*, *Continue to next*, *Ignore breakpoints*, Escape as Stop), and Stop shows everything found up to that level.

`code-workbench.js` registers `vertex.backwardUsage`. Where-used runs on the name in the routine's METHOD / FORM statement (or the attribute's DATA) through `repo.api.whereUsed`. Each place goes through `sourceAddress` and `customerObject`: a customer object is opened as a VERTEX tab (`sourceDocument`) and read from its text, and anything else is named in the window as not followed. The tab must be saved, as for where-used. The window is a tree of details in theme colours, and a line button opens the source (Ctrl+Click beside, Back returns). The model now exports `declaredIn` and `formParameters` for it. The command is in the editor context menu and the palette of a `vertex-sap` ABAP tab.

On the way: finding the statement at a where-used line first took the last statement before it, so `METHOD calc.` - in no body - landed on `CLASS ... IMPLEMENTATION`; it now takes only a statement whose lines hold the line. `DATA(x) = calc( )` had been taken for a declaration and skipped.

`backward-usage.test.js` runs the walk on a small class with where-used stood in by the lines naming the routine: a RETURNING followed through RUN into START, an IMPORTING followed to RUN's own IV_BASE and START's literal, all parameters with no variable, plain where-used for a routine with none, a local reaching RETURNING, and Stop at a breakpoint in the first level. Not run in VS Code against SAP: what ADT's where-used answers from a METHOD statement in a class's main source, and the lines it gives for local class includes, are still to be seen.

Seen on A4H in ZCL_CALC_FACADE: Forward on `iv_name` in MODIFIER_FOR drew RUN as well - the flow was held to the routine only for a local, and a parameter or attribute got the whole class. The user: the class has nothing to do with it, least of all in Forward. The flow now always starts in the routine around the selected line, whatever the value. Backward also parsed what it read with the test-fixture scanner (`value-origin-tokens.js`) instead of abaplint; the command now parses every source with the abaplint parser, `backward-usage.js` refuses a source without parsed statements, and its test parses with abaplint too. The first Forward window after installing stayed empty; it drew on the next run.

Backward is now drawn by Forward's page and its one flow builder - Tree / Diagram, Classes / Methods / Logic / Statements, Depth, the lens - turned inside out at the user's word: the routine at the cursor is the root, and an edge goes from a routine to the one that calls it, so its nearest edges are its callers. `backward-usage.js` collects the rows (the routine's statements, each caller's call and the uses found after it, marked as the slice) and an edge per callee and caller, set on the callee's first row drawn with what the call passes (`ls_step-name → IV_NAME`, as written in the source rather than tokens joined by spaces); `page(result)` hands the Value origin page a graph with that flow and no slice, and the page takes a title of its own (`originTitle`). The tree page of the first Backward landing is gone. A test builds the methods reading: CALC, RUN under it, START under RUN.

On the METHOD, FORM or FUNCTION line the word under the cursor is the routine's name, and both directions took it for a variable: Forward drew RUN alone (an empty slice of a value RUN), Backward found no statement. Now the parsed statement at the cursor decides: there it is the routine with no variable - Forward reads the sources again for the full flow, Backward follows every parameter.

The flow toolbar now wraps when the window is narrow: `.bse-view-toggle` and its tablist in `vertex-flow.js` have `flex-wrap`, so the Classes / Methods / Logic / Statements group goes to the next line instead of off the edge. The Expand all / Collapse all button showed a scroll bar: the Value origin page styled every `button` with `width:100%`, `max-height` and `overflow:auto`, the shared `vertex-toggle` included; the rule now leaves the shared toggles alone. Seen in the browser at a narrow width; the vsix is rebuilt.

With the cursor on `get_shipment` in `lo_data_provider->get_shipment( … )` Forward drew RUN without entering any call: `variableAt` gives the call path `LO_DATA_PROVIDER->GET_SHIPMENT`, taken for a value with an empty slice, so no callee was relevant. A method called at the cursor is now a step of the flow, as the METHOD line is: when the variable equals a call of the parsed statement (`callsIn`), Forward runs with no variable from that line. `variableAt` gives the same path with the cursor on `lo_data_provider`, so that too now draws the flow rather than the object's slice.

The cursor had stayed on line 29 - a click in the gutter to set the breakpoint on line 30 does not move it - and the window only said `LO_DATA_PROVIDER->GET_SHIPMENT Origin`, which did not explain itself. At the user's word the Forward title now says where the cursor was and how the name there was read: `Forward flow — line 29, col 34: LO_DATA_PROVIDER->GET_SHIPMENT is a method call, not a value`; `… RUN is the routine itself`; `… LV_X — slice of this value`; `… no name under the cursor`.

That fix broke the flow's design: the four `:not()` raised the button rule's specificity above the flow's own node styles, and routine nodes went full width with a frame. The exceptions are now in one `:where()`, which weighs nothing, so the rule weighs what it did and only leaves the shared toggles alone.

Z_BACKWARD (A4H, $TMP) is the test bed for Backward: three levels of local classes - LCL_PRICE->NET, LCL_ORDER->TOTAL, LCL_INVOICE->AMOUNT - and START-OF-SELECTION. Forward from line 77 drew START-OF-SELECTION alone: in a program the flow's rows named a local class's routine by the program (`Z_BACKWARD→AMOUNT`) and the calls by the class (`LCL_INVOICE→AMOUNT`), so no call reached its routine. A global class never showed it - its class and object names are one. The model's full flow now takes the routine's owner for the scope; the program's copy in Eclipse's bundle (`vertex-frontend.js`) is not changed. Still seen: a local class's section lines (PUBLIC SECTION) stand in the flow under START-OF-SELECTION.

With the cursor on DATA in `DATA(go_invoice) = …` Forward took the keyword for a value - `DATA — slice of this value`, an empty slice, so no call was entered and Depth had nothing to open. A name the parsed statement does not read as a variable (`variablePaths`) is now no value: the title says `DATA is not a value` and the flow runs with no variable. The full flow also leaves out a class's or interface's DEFINITION … ENDCLASS / ENDINTERFACE: in Z_BACKWARD its PUBLIC SECTION lines stood under START-OF-SELECTION.

A click on a node of the flow opened nothing - in every Value origin window, and already in the committed 0.8.6. The page inlines `vertex-abap-control.js`, whose last line declared a top-level `const api`; the page's own script then declared `const api = acquireVsCodeApi()`, failed with "Identifier 'api' has already been declared" and never ran - and with it went opening the source, Copy log and the scenario switches. Seen earlier in the browser and taken for harmless, wrongly. `vertex-abap-control.js` is now wrapped in a function, as `vertex-flow-graph.js` already was, and leaves no global names; `require` still gets the same module. In the browser a click on a routine now posts its source and place. Eclipse inlines the same file and gets the fix with its next build.

A double-click on `lcl_invoice` in `NEW lcl_invoice( )` (Z_BACKWARD) said "CLAS LCL_INVOICE was not found": `externalCallTarget` opened every class of a NEW, a static call or an instance call as a global class. A class the source declares itself is now left to SAP's own definition, which finds local classes. Whether it is declared there comes from the model's index of the source (its CLASS statements, read by the model's scanner, not abaplint - the navigation around it is still text patterns). Not clicked in VS Code yet.

Clicks still did nothing anywhere after that build. The fix had not shipped: the last line of `copy-pages.js` overwrites `resources/vertex-abap-control.js` with `vscode/abap-control.js`, the backend's copy of the same rules, still unwrapped. My earlier browser check had read the repository's file, not the packaged one. `vscode/abap-control.js` is now the same wrapped file; the vsix carries it, and a page built from the packaged resources loads with an empty console and posts a click on a routine.

### Expression conditions, and why the page broke

Expression gave `GV_AMOUNT = {(…) * mv_rate | ((…) * mv_rate) - 50}` with no word of when; the analysis knows - the second definition has an `execution condition` edge from `IF lv_gross > 1000`. The formula tree's nodes now carry their conditions, and `oneFormula` writes each alternative with `when <condition>`, the one it overrides with `otherwise`; `conditionText` reads IF / ELSEIF / ELSE / CASE-WHEN from the tokens. `formula-conditions.test.js` covers the three.

The user asked why things keep breaking. Four weaknesses together: the page is classic scripts in one global scope, so a top-level name in one shared file kills another; the statement rules were kept twice and packaging overwrote one with the other unchecked; no test runs the page as shipped, and the suite has been red (15 failures) long enough to say nothing; and a failing page script or a node with no source failed silently - and the browser check read the repository's file, not the packaged one. Agreed and done: (2) `vscode/abap-control.js` is no copy any more, only a finder of `org.vertex.abap.ui/resources/vertex-abap-control.js` (the original from a checkout, the packaged copy from a vsix), `copy-pages.js` no longer overwrites it, and the page asset comes from the same file; (3) `page-scripts.test.js` runs `copy-pages.js` as packaging does, builds the page, and loads all its inline scripts in order in one shared `vm` context - a SyntaxError, a clash of global names included, fails it; a planted second `const api` made it fail with exactly the old error; (5) the page's first script takes the host link once (`window.vertexHost`) and posts every `error` event, both windows show it, and a node click with no source is an error message instead of a silent return. Left as its own task: (4) bring the 15 failing tests to green.

### Run Select

The user asked for a context-menu command that runs any SELECT in the code, ignoring WHERE values that are not known. The first idea was ADT's freestyle data preview; then SelecTor, whose `applyPlan` already takes a whole query - but its join resource accepts only tables the dictionary offers around the base table (a 400 otherwise) and its filters are ranges joined by AND, so many real SELECTs would not open there. Asked whether ADT runs any SELECT: yes, `/sap/bc/adt/datapreview/freestyle`, which `abap-adt-api` already wraps as `runQuery`. The user wanted everything on the front end for now, so no ABAP: freestyle it is. Joins and pivots in SelecTor stay on SAP; only the parsing is on the front end.

`select-query.js` parses the source with abaplint and takes the statement at the cursor. INTO and FOR ALL ENTRIES go, UP TO n ROWS becomes the row limit (100 otherwise, SINGLE one), an old-style field list gets commas. abaplint's `SQLCond` is flat - operands and AND / OR / NOT tokens - so it is rebuilt as a tree with the usual precedence; a comparison holding a `FieldChain` (a program value) becomes TRUE: under AND it is dropped, an OR holding one is dropped whole, under NOT the SELECT is refused (dropping it would narrow the result). A program value outside WHERE, and any `Dynamic`, refuse it too. Everything dropped is listed above the rows. `vertex.runSelect` (editor context menu and palette of a VERTEX ABAP tab) runs it through `repo.api.query` and shows the rows in a theme-coloured webview beside the code. `select-query.test.js` covers the cases; the rest of the suite fails in the same 15 diagram tests as before. Not yet run against a system, and not in Eclipse: its browser bundle has abaplint, but the host has no freestyle call yet.

### SelecTor's table on the front end

The user's direction after Run Select: reuse SelecTor and take its backend away step by step, all on the front end. The pattern already exists - metrics, class, package and flow are answered by `frontend-analysis.js` instead of their ABAP resources, and `extension.js` marks them active in its answer to `/vertex/about`. The table service is the first SelecTor step: `selector-table.js` answers `/sap/bc/adt/vertex/table/<TAB>` with the JSON of `ZCL_VX_ADT_RES_TABLE` - table, count, fields, rows - built from four freestyle reads: T002 for the one-letter language of the session's ISO language, DD02L (transparent and cluster tables only, as before), DD03L with DD04T / DD03T texts in one join (DD03L already lists the fields of includes: 307 for MARA on A4H), and `SELECT * … ORDER BY PRIMARY KEY` under the same select-option WHERE (one field's lines ORed, excluding ones AND NOT, fields ANDed; `*`/`+` become `%`/`_`). Values are shaped as `/ui2/cl_json` wrote them: numbers as numbers, dates `YYYY-MM-DD` (an initial date empty), times `HH:MM:SS`. The ABAP resource caught SQL errors and answered an empty table; here SAP's refusal is the answer. `repo.api.query` now returns raw strings (`decode` off) and the session language. Every SQL shape was run on A4H through freestyle; `selector-table.test.js` checks the SQL and the JSON against a recorded session. Not yet run from the VS Code window against a system. Eclipse still reads the ABAP resource: its host has no freestyle call. Joins and the pivot (`ZCL_VX_TOOLS`, `ZCL_VX_PIVOT`) are the next steps.

### Run Select opens SelecTor

On the plain window the user asked "no choice here?", and then: do it as SelecTor does, with the SELECT's conditions simply filled in. For a SELECT SelecTor cannot say, the user chose both: the plain window, saying why. `select-query.js` now also turns the parsed SELECT into SelecTor's state (`toSelector`): one database table, no join, grouping, aggregate, DISTINCT or UNION, and a WHERE of select-option lines - `field op value`, BETWEEN, LIKE (`%`/`_` to `*`/`+`), IN lists, NOT making a line excluding. A program value becomes a line with no value, which restricts nothing until filled. SelecTor ORs a field's including lines, so two including conditions on one field under AND (`ersda >= … AND ersda <= …`), an OR across fields, an excluding line inside an OR, and an OR holding a program value (an empty line would narrow it to the known values) stay out, each with its reason; so does a view, found in DD02L, since SelecTor's table reads tables. The field list and ORDER BY are not carried over - SelecTor shows every field by primary key, as agreed. An unknown value under NOT, which the plain run refuses, is just an empty excluding line in SelecTor. The command opens VERTEX Tools on the table with `selectorPlan`; `tools.html` hands that plan to `table.html` instead of the bare name, and the page starts from it through `applyPlan`, as the assistant's plans do. Tests: the plan's lines and the reasons in `select-query.test.js`, and a page started on a plan in `table.test.js`. Not yet run in VS Code against a system.

The first real run, through ADT from VS Code, failed: `A Boolean expression was expected in "INTO"` - every SQL shape had been checked through ARC, which rewrites the statement (upper case, its own INTO) before ADT sees it, so those checks proved nothing; the user pointed out that only ADT counts. The freestyle error now carries the statement (`SQL: …`), and it named the field catalog. ADT's `CL_ADT_DP_OPEN_SQL_HANDLER`, with no INTO or UP TO of the caller's, removes the first full stop it finds after FROM - here the one inside `NOT LIKE '.%'`. The `.INCLUDE` / `.APPEND` rows are now dropped in JavaScript, and the test checks that no generated statement carries a full stop. Still open: a value the reader types with a full stop in it (`443.29`) meets the same cut.

The table reads worked from VS Code once the field catalog was plain single-table reads: `SELECT *` from DD03L (sorted in JavaScript), texts from DD04T by data element in chunks of a hundred and from DD03T, no joins - ADT's data preview had refused the join of DD03L with its text tables, for a reason not found.

### Run Select into SelecTor's Join

The user pointed at ZCL_VX_ADT_RES_REQUESTS=>GET (`e070 AS t INNER JOIN e070 AS r ON r~trkorr = t~strkorr`), which went to the plain window, and said SelecTor does joins. It does, through the VERTEX join resource, which takes only tables the dictionary offers around the base but accepts a join type and an ON of the caller's (`jT1=`, `onT1=`). Asked whether ADT cannot run a join: it can - the plain window had just run this one through freestyle; the dictionary limit belongs to SelecTor's builder. `toSelector` now maps a join: the first table is t0, each joined one t1, t2… in the order written, as the resource hands its aliases out; INNER / LEFT OUTER come along (RIGHT and CROSS are refused); the ON is rebuilt from abaplint's tokens with the SELECT's aliases renamed (`t1~trkorr = t0~strkorr`) and refused when it reads a program value; the SELECT list becomes the picked field keys (`t1~trkorr`), a star leaving the builder's own list; WHERE lines are named as the join's columns (`as4user`, `T1_TRSTATUS`), and a field without its table's alias in a join is refused. Before a window opens, the command asks the join resource for the statement alone (rows=0) with those tables, types and ONs; if it refuses - a table the dictionary does not offer - the plain window runs the SELECT and says what the resource answered. `table.html` keeps the plan's ON per alias and sends it as `on<alias>`; taking or dropping a table by hand forgets it, back to the builder's proposal. As the user asked earlier, a window started from Run Select's plan starts with the selection folded. Tests cover the mapping, the refusals and the ON in the page's request. Not yet run in VS Code against a system.

The user, on the E070 self-join going to the plain window because A4H has no join resource ("Resource /sap/bc/adt/vertex/join/E070 does not exist"): rework SelecTor rather than give the plain window inputs - the window is already there - and rework it in parts, so what fails shows.

### SelecTor's join on the front end

`selector-join.js` answers `/sap/bc/adt/vertex/join/<TAB>` without pivot parameters with the JSON of `ZCL_VX_ADT_RES_JOIN`: table, sql, pivot false, rows, candidates, tables, fields (with the aggregates `ZCL_VX_PIVOT` would allow, so the pivot panel can still lay fields out). The canvas is read as `ZCL_VX_TOOLS=>DISCOVER_FOR` reads it: DD08L out of a table and into it (FRKART TEXT marks the text table), the field pairs from DD05S in two reads per table rather than DD_FORKEY_GET per key, real tables only (DD02L), DD02T texts; each taken table adds its own neighbours. Aliases T1, T2… in the order taken; the proposed ON from the pairs with the table it was found from, else the key fields shared by name; `jT1` / `onT1` overrule; base fields all selected, a joined table's keys unless already in the list; `pick`/`sf` as the resource has them; filters on `MATNR` / `T1_MATNR`; a multi-table list as `t1~f AS t1_f`. Left out: ZCL_VX_TOOLS drops offered tables that hold no rows (a read per table); here every offered table stays. Changed on purpose, as the user wanted joins beyond the dictionary: a table nobody offers is taken by hand (direction M), as the builder's "add table" does, instead of a 400 - which lets E070 join itself. Run Select now checks a join with this module (rows=0) instead of asking the ABAP resource. A request with r/c/v still goes to the ABAP resource; on A4H that is where the pivot will fail. `selector-join.test.js` runs the module against a small dictionary. Not yet run in VS Code.

First run from VS Code: "Unknown column name CHECKTABLE" - DD05S has no check-table columns. It holds, per foreign key field, the foreign table's field (FORTABLE / FORKEY) at each position of the check table's key (PRIMPOS); the check table's field is its key field at that position, which is what DD_FORKEY_GET resolves. The pairs are now read that way: DD05S for the table and the tables pointing at it in one IN read, the check tables' keys from DD03L in another. The test's dictionary now has DD05S in its real shape.

Next run: "Literals across more than one line are not allowed". `CL_ADT_DP_OPEN_SQL_HANDLER=>SPLIT_QUERY_STRING` cuts a statement of 255 characters or more into lines of a generated subroutine at token boundaries, and an IN list of a hundred quoted names was cut through a literal. Lists of names (`inLists`) now go in as many statements as keep each under 240 characters; a test checks the lengths and that every name is asked once. The join statement itself can still pass 255 with a long SELECT list - not seen failing yet. The plain window now shows the join's whole refusal, the SQL with it; it showed only the first line. The reload notice the user also saw - "CLAS ZCL_VX_ADT_RES_REQUESTS was not found" - is A4H's answer: the class is not on that system.

The E070 self-join from ZCL_VX_ADT_RES_REQUESTS=>GET opened in SelecTor's Join on A4H, rows and the tables around E070 from the dictionary, after a while of dictionary reads. At the user's word a window started from Run Select's plan now opens on Full view, the builder one press away.
Run Select's SelecTor now opens beside the code (ViewColumn.Beside), as the plain window does, at the user's word.

Next run: a timeout on one of the DD05S reads, where the same join had opened before. Too much was read: Run Select first ran the whole join (rows=0, with all its dictionary reads) as a check, and SelecTor then ran it again; and the field pairs were read for every offered table - E070 has dozens. Now: no check - the front-end join takes any table with the ON it is given, and what fails shows in SelecTor; field pairs only for a joined table without an ON of the caller's (one DD05S read and its check table's keys); neighbours around the base only, not around each joined table. The user: show only what is needed - a reader rarely starts remodelling a SELECT from Run Select. So `cand=0` leaves the tables around the base out entirely; a window started from Run Select's join sends it, and switching to Settings asks for them.

A plain SELECT of one field (`SELECT trkorr FROM e070 …`) opened SelecTor's table with every column of E070. The table view never hid fields - the SELECT list was only SelecTor's in a join. Now a one-table plan carries its list as `columns`; the page sends them with the load as `pick=X&sf1=…` (the same parameters the join takes), loading a different table drops them, and `selector-table.js` reads only those columns, in that order, ordered by the key fields named (ORDER BY PRIMARY KEY wants every column). The ABAP table resource ignores the parameters, so Eclipse, which still reads it, is unchanged.

The user pointed at SAP GUI's SelecTor selection screen, which lists every field: show them all, with a new Shown checkbox cleared for the fields a SELECT did not ask for - an ordinary checkbox in the list, the user said, when I reached for the shared toggle. So the server-side `pick` for a table, added just before, is gone again; the page hides. In a table the selection panel is now a list of every field (`fieldList`): Shown, the field (keys bold), in/not, option, From, To, one empty line for a field without criteria that becomes a criterion as soon as something is typed, several lines for a field with several. Unticking hides the column at once, without a read. A plan's `columns` settle the hidden fields once the fields are known; another table starts with all shown. A join keeps its criteria cards. Tested in `table.test.js`; not yet seen in VS Code.

Then the user, once the removed `pick` was explained: better to read only what the SELECT asks for at first, with a button to show the hidden fields - only then read the whole list, the fields not asked for unticked. So `pick=X&sf…` is back in `selector-table.js` (only those columns read, ordered by the key fields), the page sends it while it has Run Select's `columns`, and the field list ends with "Show hidden", which drops the columns, keeps them as the ones to leave ticked, and reads again. A condition on a field outside the SELECT list keeps its line in the list, its checkbox off until the field is read.

The user showed SAP GUI's "Define Selection Options" dialog. In the field list the in/not and option selects are now one sign per line, the sign the ABAP code writes (`≥` for GE - ABAP SQL takes both spellings, and Run Select maps both to the same line), green when the line selects and red when it excludes; a click opens the options with their descriptions and Select / Exclude on the shared segment toggle. Not yet seen in VS Code, light or dark.

The join still had the old criteria cards. Its selection is now the same field list: every field of the join's tables under the names its columns have (`as4user`, `t1_trstatus`; the text prefixed `T1 ·` for a joined table), with Shown standing for the SELECT list - ticking or unticking changes the picked fields and runs the join again; Enter in a value runs the join, not the base table. The pivot keeps its cards for now.

### SelecTor's pivot on the front end, and Run Select into it

The aggregate SELECT in Z_SELECTOR (created at the user's word in $TMP on A4H, a test bed of four SELECTs; Z_SELECT there was somebody's dynamic-join test and was left alone) ran through ADT as written: GROUP BY with COUNT(*) and MAX works over freestyle. The user then asked why it said SelecTor does not aggregate - its pivot does. The pivot is now in `selector-join.js` as `ZCL_VX_PIVOT` / `EXECUTE_PIVOT` build it: one statement grouped by the row and column dimensions, columns named ALIAS_FIELD and AGG_ALIAS_FIELD (CNT_ROWS when no measure; `*` as a measure is COUNT( * ), named COUNT_ALL), an aggregate the field's type cannot carry falling back as `normalize_aggs` does; the result sorted by the dimensions and the column values spread into MEASURE_VALUE columns (at most 50, sanitized as `sanitize` does) in JavaScript. Domain texts for values (`value_label`, `field_label`) are not read yet. Every SelecTor request now stays on the front end; Versions and Code Explorer are what the ABAP backend is still for. `toSelector` maps GROUP BY or an aggregate to a pivot plan - GROUP BY fields as rows, COUNT/SUM/MIN/MAX/AVG of a field or COUNT(*) as measures - and keeps HAVING, UNION, DISTINCT, grouping by an expression, an aggregated expression and a field neither grouped nor aggregated for the plain window, each with its own reason. The command opens Tools on action pivot; the page takes the plan's pivot. The pivot keeps its criteria cards. Not yet run in VS Code.

The pivot opened from Z_SELECTOR on A4H: D 658, R 3200 - as the plain window had them. The user then asked for everything next in one go.

- Pivot as the ABAP one shows it: MIN and MAX of a non-numeric field keep its type (MAX of AS4DATE was a number, 20261009); a row dimension shows its domain's fixed-value texts (one DD07T read per domain, an X without a text named by the field) when any of its values has one, as EXECUTE_PIVOT decides; spread columns are headed by the column values' texts. The answer now carries `headers` - field texts for dimensions, "Count", "MAX <field>" - and the page's result table uses them, the technical name in the tooltip. The ABAP pivot never sent headers to the page; the VS Code window showed component names.
- The pivot's selection is the field list too, without Shown.
- A value with a full stop: Z_SELECTOR has a fifth SELECT, `price = '443.29'` on SFLIGHT, for the user to run; reading `CL_ADT_DP_OPEN_SQL_HANDLER` again, only a trailing full stop is cut when the caller gives no INTO, so it should pass - not yet seen.
- Eclipse: `PageView` answers `query:<rows>:<SELECT>` with a POST to the data preview (Content-Type text/plain) and `language:` with the project's destination language; `eclipse-frontend.js` gives the worker `query` and `language` and reads the data preview's XML into rows; `frontend-analysis.js` hands table and join paths to the SelecTor modules, which brings them into Eclipse's bundle; the Tools window sends table and join paths to the worker. `language()` takes a one-letter SAP code or an ISO code, now or later. Compiled with javac against the bundle pool and run from the built bundle in Node; not run in Eclipse. Eclipse's own SelecTor view (`SelectorView`, opened by DataHandler) still reads the ABAP resources.
- Found on the way, and caused by this session: `eclipse/prepare.js` copied `vscode/abap-control.js` over `org.vertex.abap.ui/resources/vertex-abap-control.js`. Since the earlier stage made the latter the one original and the former a finder, running prepare.js put the finder in place of the rules. Restored from the copy the vsix carried (`vscode/resources/`, the wrapped rules of that stage); the copy line is gone from prepare.js, and both Eclipse bundlers now take the rules file itself instead of the finder, which needs fs. Two Eclipse Value origin tests still fail (the page has four scripts, the test expects three) - the uncommitted Value origin work, not touched here.

### SelecTor's ABAP is gone

The user corrected me: `ZCL_VX_TOOLS`, `ZCL_VX_PIVOT` and the rest are not a SAP GUI application but the Simple Data Explorer core carried into VERTEX for SelecTor's ADT resources - SDE's GUI stayed in its frozen repository - and VERTEX's ABAP had been deleted from SAP entirely without anything missing. A reference walk in `src/` confirmed it: the nine objects are reached only from `/vertex/table` and `/vertex/join`, and `ZCL_VX_COMMON` from nothing. Removed with `git rm`: `ZCL_VX_ADT_RES_TABLE`, `ZCL_VX_ADT_RES_JOIN`, `ZCL_VX_TOOLS`, `ZCL_VX_PIVOT`, `ZIF_VX_PIVOT_TYPES`, `ZCL_VX_APPL`, `ZCL_VX_SQL`, `ZCL_VX_DDIC`, `ZCL_VX_COMMON`; the `table` and `join` routes out of `ZCL_VX_ADT_RES_ABOUT=>SERVICES`, which `ZCL_VX_ADT_RES_APP` registers from. Eclipse's `SelectorView` and `DataHandler` were already dead - neither is in plugin.xml - and went too, with their two references. The first attempt was refused by Claude Code's auto-mode classifier as an irreversible deletion; the user switched the permission mode and said to go on. The plugin compiles; ADT_TECH.md no longer lists the SDE core. Where the objects are installed on a system, a pull will not remove them - abapGit or by hand.

At the user's word the documentation now says plainly that VERTEX depends on none of the projects it grew out of. The tool tables in README.md, vscode/README.md and docs/index.html had gone stale: Value Origin, Code Explorer and SelecTor were marked as needing the backend, Visual Debug as using ACE's statement map - since the ACE core went, all of them work from ADT alone, and now SelecTor too. Each table now marks only Versions / Reviewer as needing `src/`, and a paragraph under it says that "Grew out of" is where the ideas were worked out first: nothing from Simple Data Explorer, ACE, AVE, Smart Debugger or ABAP-AI-Code is installed or called. vscode/README.md's backend section and first-run step, and the site's "one thing to pull" paragraph, say the same.

The join SFLIGHT + SBOOK from SelecTor failed with "Internal Server Error". Reading `GENERATE_SUBROUTINE` of `CL_ADT_DP_OPEN_SQL_HANDLER` settled all three failures on long statements: in freestyle mode the data preview splits the caller's own text at CR LF and refuses any line over 255 characters; past that check it cuts a long line into source lines itself (`GET_FORMATED_QUERY`), which is where the literal was cut. Every statement here went as one line - the DD03L join of the first catalog, the IN lists, this join - while ARC sends short lines, which is why the same statements passed through it. Both hosts now send the statement in lines of at most 200 characters, broken at blanks outside literals (`dataPreviewLines` in sap-code.js, the same in eclipse-frontend.js); a test checks the widths and that literals stay whole. The earlier explanations - the full stop in `'.%'`, the join of the text tables - were wrong; the catalog's single-table reads stay as they are. Also found: two `'\n'` in eclipse-frontend.js and sap-code.js had been written by a Python edit as real line breaks, a syntax error in Eclipse's adapter since the Eclipse step; fixed, and every vscode/*.js and the page scripts now pass a syntax check.

In the pivot every field of the joined tables was offered (SFLIGHT + SBOOK on A4H). ZCL_VX_TOOLS's pivot_src_fields took only what the join selected; the page now hands the pivot panel the selected fields alone.

The user read 'nothing from AVE has to be installed' as wrong for the review. The code says otherwise - the review runs on ZCL_VX_ADT_RES_REVIEW, _PREPARE and ZCL_VX_REVIEW_STORE, and the one ZCL_AVE_ACR_WORKFLOW in src/ is a comment - but the AVE name on the ZAVE_REVIEW table invites the reading. The independence paragraph now says it in all four docs: Versions / Reviewer needs VERTEX's src/, which carries ZAVE_REVIEW; the AVE repository itself is not needed.
The user: AVE was never moved to the front end, not even analysed. True - Versions / Reviewer is AVE's logic carried into src/ as ZCL_VX_VERSION*, ZCL_VX_DIFF*, ZCL_VX_REVIEW_* with ZAVE_REVIEW, and the docs now say that in those words rather than only that the AVE repository is not needed.

### Versions on the front end, part 1: programs and includes

Asked what of Versions / Reviewer ADT could carry, I first said version sources were out of reach (compressed in a cluster) and the diff was the kernel's (`RS_CMP_COMPUTE_DELTA` -> `SVRS_COMPUTE_DELTA_REPS` -> `C_MAKE_TEXT_DELTA`, checked on A4H) plus AVE's own pairing of class declarations. The user pointed at Eclipse, which has it all: ADT's revision feed, read on A4H, gives /ALLOY/FIAA_REPORT_IMPL's 48 versions with number, author, time, transport, its description and each version's source address, and /ALLOY/CL_FIAA_CNT's 34 versions of the whole class - not per method, as VRSD keeps them (DEPRECIATIONAREAVALS has 17 there); Eclipse computes the diff itself. No Z object on A4H has more than two versions - versions come from released transports, and the Z objects there sit in $TMP. Decided with the user: getting free of the backend matters now; compatibility of reviews with AVE through the shared ZAVE_REVIEW (block keys are TYPE~NAME~ordinal, so a rebuild by the other tool can renumber them) comes later; prepare can move to the front end too, later.

`versions-front.js` answers `/vertex/versions/<name>` for PROG and INCL with the JSON of ZCL_VX_ADT_RES_VERSIONS: the parts list (the object itself, REPS), the versions of the part, the diff of two versions, the current source (now=X). The feed is read and parsed in the host (`revisions` in sap-code.js - in Eclipse the worker has no DOMParser), sources by their address. The active version (00000 in the feed) keeps AVE's 99998. Times are shown in the reader's zone. Transports of copies are dropped unless toc=X, by E070 TRFUNCTION 'T'; dups=X drops a version whose source equals the next older one, by fetching them all; ic=X compares trimmed, upper-cased lines. User names come from USR21 + ADRP through the data preview. The diff is Myers' line diff. Not carried: the task under a request (VRSD knew it, the feed does not). Other types still go to the ABAP resource; the about answer now marks versions as served without the backend so the window opens on a system without VERTEX's ABAP. Tested against a recorded feed; not yet run in VS Code.

First look in VS Code: the Versions page took the front-end answer (the part REPS /ALLOY/FIAA_REPORT_IMPL), but VERTEX Tools said "The parts could not be read: Supported object_type values: PROG, CLAS, FUNC, INTF" - the Tools parts list is built by the linter analysis, whose source reader did not know includes. INCL (ADT PROG/I) is now one of the repository's types; creating an include stays refused, and the create-draft picker does not offer it. At the user's word builds are 0.8.8 from here: the version is bumped in package.json and package-lock.json, and the day's items - Run Select, SelecTor's table, join and pivot, Versions for programs and includes - moved from the 0.8.7 notes into a 0.8.8 section in history.md, both READMEs and the site.

Versions on a program or an include worked from ADT on A4H (46 -> 47 diffed, names from ADRP). The page's line 'Not on this system: the saved review ...; finding requests ...' then stood over every object, though both belong to a transport request; at the user's word it now shows only when the object is a request.

### Versions on the front end, part 2: classes

The page and the Tools parts list want a class in AVE's terms - CPUB / CPRO / CPRI heads, METH per method with its section, CINC per local include - so parts 2 and 3 of the plan went together. ADT versions a class only whole (the main include) and its local includes apart. `classLayout` cuts a class source with abaplint statements: each section from its SECTION statement to the next one or ENDCLASS (with a count of its declarations, so an empty section is left out as AVE does), each implemented method from METHOD to ENDMETHOD, a method's section from its METHODS. A section's or a method's history is the main feed's versions where its cut text differs from the next older one, and none before it existed - what VRSD would have recorded; its diff is of the cut text alone. Local includes (CCDEF, CCIMP, CCMAC, CCAU) are their own feeds; one ADT answers 404 for is not offered. Sources of revisions are cached per session, since a method's history reads every version of its class once. Keys stay AVE's: a method's part name is the class padded to thirty with blanks and the method, a local include's the class padded with = and the suffix. Tested on a three-version class; not yet run in VS Code (/ALLOY/CL_FIAA_CNT on A4H is the case to try).

### Versions on the front end, part 3: interfaces, function groups and modules, CDS

AVE's parts again: an interface is its section include (the name padded with = and IU), a function module is one FUNC part, a CDS view one DDLS part, and each reads its own ADT feed (`/oo/interfaces/…`, `/functions/groups/<group>/fmodules/…`, `/ddic/ddl/sources/…`). A function group is its main program, a FUNC per module (TFDIR by PNAME, the include number naming the U-include) and the other includes under its prefix from TRDIR with SQLX set - AVE's own filter, checked on A4H against /ALLOY/FIAA_VIEW: SQLX is set on the F, I and U includes and not on TOP or the $ includes, so the TOP include does not appear, as it does not in AVE; that looks like a gap in AVE kept for now. A namespace is handled (/NS/SAPLFG, /NS/LFG), which AVE's `|SAPL{ name }|` was not. A module's group comes from TFDIR. LIKE escapes with '#'. Tested against a recorded dictionary; not yet run in VS Code.

### Versions on the front end, part 4: dictionary, packages, requests, finding requests

Dictionary objects are one part each, as VRSD names them (TABD, DOMD, DTED), and read the feeds of `/ddic/tables`, `/ddic/structures` (a TABL whose DD02L class is INTTAB), `/ddic/domains` and `/ddic/dataelements`; ARC could not show those feeds, so whether ADT keeps one for each is first seen in VS Code - where it does not, the answer says "SAP keeps no version feed". A package is what TADIR keeps under its DEVCLASS, a request what E071 holds for it and its tasks (`TRINT_READ_REQUEST` read the same rows); a class, an interface or a function group is listed as one object to open, a LIMU METH as the method part of its class, a program or REPS as a REPS part, dictionary objects as their parts. A part opened inside a scope finds its feed by its own type: a REPS by TRDIR SUBC (program, include, or a function group's main program), a FUNC by its group, a class part by its class. `/vertex/requests` moved too: the user's own open requests and those where they hold a task (E070 joined to itself), released ones when asked, the description from E07T in the session's language, the owner's name from ADRP, newest first; an empty user is the session's. Only the review - its build and its writes - is left on the ABAP side. The docs now say so: the backend column marks Versions / Reviewer as needed for the review (and, in Eclipse, which has not moved yet, for the history too).

### Review on the front end, part 1: reading

The review is stored in ZAVE_REVIEW, one row per request and remote system, its PAYLOAD the whole review as /ui2/cl_json wrote it - so the front end can read it, and the data preview cannot write it: saving approvals, comments and a built review will need an ABAP writer on the system in any case. A4H has no ZAVE_REVIEW (neither VERTEX's ABAP nor AVE is there); E19 has the table, VERTEX's old backend and AVE, and no saved review yet - the place to try this.

`review-front.js` answers GET `/vertex/review/<request>` as ZCL_VX_ADT_RES_REVIEW does: whether the table (with REMOTE and PAYLOAD, DD03L) is there, whether a review is saved, the summary in AVE's order and grouping (ZCL_VX_REVIEW_REPORT: class parts under their class, the rest in sections by kind, unchanged objects left out) with approvals and declines counted from the block actions, the reviewers and the save history; with part and ptype, the part's blocks with their verdicts, notes and threads, the stored diff of the pair they were cut from (not a retrofit row), and where each block sits in it. That last needs AVE's walk exactly - ZCL_VX_REVIEW_HUNKS=>HUNK_RANGES with ZCL_VX_REVIEW_PREPARE=>UPDATE_STMT_OPEN, a block taking the context up to the full stop that closes an open statement, at most a hundred lines, and a blank line when more changes follow - because the block keys are numbered by it. TIMESTAMPL stamps are 21 digits, more than a double holds, and the page writes the stamp back to say which state it built on; the payload's numbers with a fraction or more than fifteen digits are kept as their text. POST (approve, decline, comment) and prepare still go to the ABAP resources. Tested against a recorded payload.

### Review on the front end, part 2: a review built live

Weighing the build of a review on the front end: ZCL_VX_REVIEW_BUILD's PRECOMPUTE_PART alone is about 1400 lines (blame, block authors, change-comment checks, request verdicts, the remote comparison, DDIC html), and whatever is built would still need an ABAP writer to reach ZAVE_REVIEW, which only ABAP writes (ZCL_VX_ADT_RES_REVIEW for verdicts, ZCL_VX_ADT_RES_PREPARE for the build). I asked about files as storage; the user first answered that the table, which every IDE reaches, is what matters, then put the point: most people do not approve anything, they want to look at a request's change conveniently - so the front-end build matters, a review kept locally may follow, and with it the backend could go entirely. A review that is only looked at need not match AVE's blocks bit for bit; that only matters once it is written to the shared table.

`review-live.js` builds the review of a request from ADT when none is saved (and when the system has no ZAVE_REVIEW at all): the request and its tasks from E070, their objects from E071, each expanded into the parts Versions knows (a LIMU METH to its method, a class part to itself); for each part the pair is the version before the request's first and the request's newest - the active one while the request is modifiable - and none before means the request created it; the diff is the Versions diff, the blocks AVE's walk (moved to `review-hunks.js`, shared with the saved review), the block's author the new version's, MOD / INS / DEL by what the block holds. It comes out in the payload's own shape, so the summary and the part view are the reading code already there, and it is kept five minutes per session because the page asks for the summary and then each part. The page heads it "Built from ADT now - not saved" and shows no approve / decline / comment buttons. Not carried from AVE: blame (each line's author), change-comment checks, request verdicts, the remote comparison, DDIC html. Tested on recorded feeds; not yet run in VS Code.

First live review on E19 (E19K907280) stopped at ZCL_VX_ADT_RES_VERSIONS: for its test class include, which the class never had, ADT answered 'ZCL_VX_ADT_RES_VERSIONS=======CCAU does not have any inactive version' rather than 404, and only 404 / not found / does not exist counted as an absent local include. That answer counts too now; the class test feeds it.

### Versions on the front end: VERTEX's own line differ

Part 1 above says the diff is Myers' line diff; it was not - `diff` in versions-front.js called AVE's JS port (`ave-diff.js` computeDiff), a full LCS table of N x M cells (a 5000-line include against itself is 25 million cells) that also paired a deleted line with its commented-out twin. Asked how Eclipse's standard Text Compare builds its diff: ADT only serves the sources of the two revisions, and Eclipse compares them itself with its compare framework (`RangeDifferencer`, an LCS over whole lines, tokens highlighted inside a changed range), with no ABAP knowledge and no passes on top. The user wanted that reused and fast; anything that differs from SAP's own compare but is more correct is fine. Reusing Eclipse's code was ruled out: it is under the EPL and VERTEX is MIT, and VS Code has no Java anyway. ABAP was ruled out too - the diff is computed on the front end, from ADT's sources, not by `ZCL_VX_*`.

`line-diff.js` is Myers' O(ND) algorithm in its linear-space form (middle snake, split, recurse), written from the 1986 paper: common head and tail stripped, lines interned to integers, '-' before '+' in each run of changes. Nothing is done on top of it, so a commented-out line no longer pairs with its original as in AVE. IC compares trimmed, upper-cased lines through the differ's key. Tested against the textbook LCS table on 3000 random pairs (both sides rebuilt exactly, the number of kept lines the longest possible) and a 20000-line source with 200 changes in about 30 ms. The Eclipse plugin still reads its versions and diff from `src/`; token highlighting inside a changed range is not done yet.

### Review on the front end: AVE's pair rule

On E19K907280 (released 23.09) AVE's report lists ZCL_VX_ADT_RES_VERSIONS with GET and a new PART_INCLUDE dated 07.10; the live review showed GET only. ADT's feed of the class: 00001 E19K907274, 00002 E19K907280, active E19K907282 ("vertex +", 07.10) - and 00002 has no PART_INCLUDE; it came with the later request. VRSD still names E19K907280 on the class's 00000 row, and AVE reads whose the active state is from there; PART_INCLUDE has no VRSD row at all, and AVE's builder then probes the active source and reviews it as a new object. I first dropped the active state from the live review, then made it count only while the request is open; the user wanted AVE 1:1 and a historical request kept apart from today's active state. `pairOf` now ports ZCL_VX_VERSION_LIST=>LOAD's request-scope rule: NEW is the request's newest numbered version when another request's version sits above it, else the active state when it belongs to the request, else that newest version, else the active state; OLD is the first version below NEW that is not the request's, else the oldest unless it is NEW or the request's own. The one deliberate difference: whose the active state is comes from ADT's feed, not VRSD - with that, AVE's own "foreign work above" reasoning keeps E19K907282's work out of E19K907280. AVE's skipping of the request's own transports of copies for OLD is not carried. Not yet run in VS Code.

### Review on the front end, part 3: progress, saving, storage

The live review worked on E19; what it lacked was a sign of work while it read every part's versions. The Versions page now has a progress channel: the host posts `progress` messages to the webview (extension.js), the page shows them in its status line (`vertexProgress` - first named `sdeProgress`; the user asked for a name without the old host's prefix, and left the other `sde*` bridges as they are), and review-live reports the request, each part in turn and the authors' names.

Saving. A review written by the front end needs an ABAP writer - ADT's data preview reads ZAVE_REVIEW but cannot write it. Options were a thin writer in `src/`, writing through AVE, or local files; the user took the writer and files both, with a setting for where, and the rule that a system without VERTEX's ABAP keeps reviews in files only. I first argued for a VERTEX-only format because our Myers diff cuts blocks differently from AVE's; the user asked what difference it makes who computed a diff that every side reads from the payload - none: DIFF_DATA and HUNKS are stored, and a recalculation remaps verdicts by content (REMAP_REVIEW_STATE). So the payload stays AVE's.

`ZCL_VX_ADT_RES_STORE` (route `/vertex/store/{request}`, listed by ZCL_VX_ADT_RES_ABOUT) stores a payload as it is given, after checking the stamp the writer read against the stored LAST_SAVED_AT - a moved review is refused, not merged - and refuses a ZAVE_REVIEW without REMOTE. `review-state.js` carries ZCL_VX_REVIEW_STATE's APPLY_SAVED_PAYLOAD (with IV_IGNORE_GENERATED off, as ZCL_VX_ADT_RES_REVIEW calls it), APPLY_REVIEWER_ACTION and BUILD_SAVE_PAYLOAD over line for line. /ui2/cl_json writes TIMESTAMPL as a 21-digit number; a payload read for writing marks such numbers (first with U+0001, which JSON refuses inside a string, then with a printable mark) and they go back as numbers. `review-front.write` handles A, D, C, U and S (save the live build): it loads the stored review (files first in file mode, the table first otherwise), checks the page's stamp, applies the action, builds the payload and stores it - through the store resource and/or `vertex.review.folder/<system>/<request>.json`. Settings `vertex.review.storage` (table/file/both) and `vertex.review.folder`; `canStore` asks the about answer whether `store` is active. The page shows where reviews are kept and a Save button on a live review. Tests: payload round trip, stamps, AVE's action rules, and a file-only save, approve, refused stale write and refused second save. Not yet run in VS Code or on SAP.

At the same time the user removed the per-release sections from the Marketplace page (vscode/README.md): it describes the extension as it is, release notes stay in history.md. The GitHub README and eclipse/README still carry such sections; asked whether to remove them too. The docs on diff and review were rewritten in present tense in README.md, vscode/README.md and docs/index.html; eclipse/README.md is unchanged because the Eclipse plugin still reads Versions and the review from `src/` and was not rebuilt.

Plan agreed: progress, writer and saving (done); then Eclipse on the front-end modules, its diff through Eclipse's own RangeDifferencer; then `src/` reduced to the store, ZAVE_REVIEW, ZCL_VX_ADT_RES_ABOUT and the registration it needs (ZCL_VX_ADT_RES_APP and the BAdI implementation).

The user then settled the docs: the GitHub README keeps its per-version sections; the Marketplace page and docs/index.html must not be loaded with them - release notes are a separate file, history.md, and both pages link to it ("not everyone needs it"). docs/index.html lost its release-08x sections, the loose notes after its footer and the version comments after `</html>`; its "What 0.7.8 adds" and "What 0.7.0 added" became one "What it does" list, and the remarks on which version added what in its VS Code section went. The new 0.8.8 items were added to the GitHub README's 0.8.8 section.

`docs/ace-port-audit.md` - the ACE parity audit of 2026-10-06 - moved to the repository root as `ace-port-audit.md`, at the user's word: docs/ is the GitHub Pages site, so the working notes were published there, and the only link to them, an HTML comment at the end of docs/index.html, went with the version comments today. The entry in history.md that names its old path is left as it was written.

### Eclipse on the front-end modules: Versions, review, its own diff, saving

Eclipse's VERTEX Tools already ran the VS Code analysis in a page worker (`vertex-frontend.js`, bundled by eclipse/frontend-bundle.js from frontend-analysis.js). The standalone VersionsView is not registered in plugin.xml; Versions in Eclipse is the page inside Tools, whose requests tools.html splits between the worker and Java. Now frontend-analysis routes `/vertex/versions/`, `/vertex/review/` and `/vertex/requests` to versions-front and review-front, and exports `write` for review writes; tools.html sends those reads and review writes to the worker, and passes build progress to the Versions page (`vertexProgress`) - which also fixed VS Code, where Versions inside Tools never got the progress.

The worker's api gained what the modules ask for: `revisions` (the page reads the object's metadata, finds the versions link of the object or of the class include, reads the Atom feed - with `Accept: application/atom+xml;type=feed` set in ToolsView and a text handler for `application/atom+xml` - and parses it with DOMParser, which the worker lacks), `revisionSource` and `currentSource` through the existing read, `user` (`user:`, the destination's user), `diffLines`, `storeReview` and `reviewIo`. review-front awaits `api.user()` because Eclipse answers it asynchronously.

The diff: `versions.diff` became async and takes an optional host comparer, `api.diffLines`. Eclipse passes one: the page hands the lines to Java (`sdeAnalysisDiff`), `LineDiff` compares them with `RangeDifferencer` and answers one character per result line, and the page puts the texts back and refuses an answer that does not cover both versions. `org.eclipse.compare.core` is in Require-Bundle and in the feature's requires. VS Code keeps line-diff.js.

Saving: `ReviewPreferences` (Window → Preferences → VERTEX Code Review: table / files / both, and a folder; default `.vertex/reviews` in the workspace, `<project>/<request>.json`), `reviewio:` and `reviewfile:` reads and a new `sdeAnalysisWrite` (kind `file` writes the review file, kind `store` posts to `/vertex/store/`). `canStore` reads the about answer. Twice a regex lost a backslash on its way through Python into Java (`"\?"`, `"[^\w.-]+"`), and once inside the worker's template literal (`\/` becomes `/` there) - the last replaced by split/join. Smoke tests of the built bundle in Node with a fake ADT: versions diff, live review with progress, save to a file with no store, approve, the diff taken from the host's comparer. Not run in Eclipse; javac not run against the target platform.

At the user's word the Eclipse plugin and feature went to 0.8.8.qualifier, the VS Code number; only the sentences that state the current source version changed. The export the user made before was 0.8.1 and predates all of this. Also removed from docs/index.html: "Available in the rebuilt VS Code 0.8.8 package; Eclipse requires a plugin rebuild" in a feature line added by a parallel session.

Meanwhile vscode/test/table.test.js began to fail (document.querySelectorAll is not a function): table.html was changed at 17:58 by the parallel work on SelecTor's Technical names / Text toggle; not touched here.

### VERTEX's ABAP reduced to the review store

Asked why the classes were still needed, the honest list was short: the standalone MCP server (`mcp/sap.js` read `/vertex/review/` over HTTP from ZCL_VX_ADT_RES_REVIEW), Prepare (building a review into the table on the ABAP side) and the review against another system (remote) - neither of the last two moved to the front end - and a safety net until Eclipse is checked, which git provides anyway. The user chose to move the MCP server and drop Prepare and remote; "the logic is in AVE anyway".

`mcp/sap.js` now builds an ADTClient (abap-adt-api from vscode/node_modules, sap-http for the certificate switch), wraps it in sap-code's createRepository and answers `/vertex/review/` with review-front - the saved review through the data preview, or the review built from ADT; its tests run against a stand-in for the data preview instead of a fake SAP HTTP server. The page lost Prepare (offerPrepare and the object-by-object walk); a host that does not build from ADT is told so instead. `prepare` left the VS Code shim, WRITES, the routes of tools-window.js, tool-routes.js and ToolsView.java. The page decides what is usable from the about answer, and the ABAP answer no longer lists versions, review or requests; VS Code already merged its local services in, Eclipse did not - tools.html now does the same for Eclipse (`localAbout`), so Versions does not report "the hub is older than this window" on a system with the reduced `src/` or none.

`src/` keeps package.devc.xml, ZAVE_REVIEW, ZCL_VX_ADT_RES_STORE, ZCL_VX_ADT_RES_ABOUT (its list is store and about), ZCL_VX_ADT_RES_APP and the BAdI implementation ZVX_ADT_RES_APP; 75 files went, Z_VX_DEBUGGER_TEST among them as the user chose - though vscode/README.md still uses it as the example program of the debugger, and the Versions assistant's sample questions name ZCL_VX_DIFF and ZCL_VX_ADT_RES_VERSIONS; asked. The standalone VersionsView/VersionsHandler in the Eclipse plugin still name the removed routes; they are not registered in plugin.xml. abapGit does not delete objects from a system when they leave the repository.

At the user's word the deleted example program left the docs: vscode/README.md no longer sends the debugger's quick start to `Z_VX_DEBUGGER_TEST` (the step asks about a report of your own) and its "A program to try it on" section is gone; the Versions assistant's sample questions name `ZCL_MY_CLASS` and `CALCULATE` instead of `ZCL_VX_DIFF`, `COMPUTE_DIFF` and `ZCL_VX_ADT_RES_VERSIONS`.

`VersionsView.java` and `VersionsHandler.java` deleted from the Eclipse plugin at the user's word: not registered in plugin.xml, and they read the removed `/vertex/versions`, `/review`, `/prepare` and `/requests` routes. PageView attached the assistant bridge to that view; it now does so for ChatView alone - Versions in Eclipse is the page inside VERTEX Tools.

Eclipse 0.8.8.20261009204653 built with eclipse/package.ps1 (javac of the JustJ JRE in ~/.p2/pool, against that pool): the Java - LineDiff, ReviewPreferences, PageView's new bridges - compiles; the jar carries Bundle-Version 0.8.8.20261009204653 and requires org.eclipse.compare.core; no VersionsView. The script had its version written in (`$baseVersion = '0.8.1'`), which the bump would have left on the old number with the manifest's qualifier unreplaced; it now reads the version from META-INF/MANIFEST.MF. Archive: target/eclipse-0.8.8.20261009204653/vertex-eclipse-0.8.8.20261009204653.zip. Not installed or run.

The user's own PDE export into docs/ is the update site: build 0.8.8.202610092043, checked to carry LineDiff, ReviewPreferences, org.eclipse.compare.core in Require-Bundle and the new tools.html, and no VersionsView. The sentences saying the site still held 0.8.0.202610051511 were brought up to it in docs/index.html ("Latest build"), README.md, eclipse/README.md and BUILD.md, whose export example also still named 0.8.1.qualifier. The archive in target/ from package.ps1 is the same code under another timestamp and is not needed for the site.

Eclipse, after installing 0.8.8.202610092043: VERTEX Tools opened from the include /ALLOY/FIAA_REPORT_IMPL said "Resource PROGRAM /ALLOY/FIAA_REPORT_IMPL does not exist". object-tools.js (shared by both hosts) cut the type at the slash, and Eclipse passes ADT's own type, PROG/I, which became PROG; VS Code passes its own name, INCL, so the include support added for VS Code on 0.8.8 never reached Eclipse - the code is one, what each host feeds it is not. PROG/I now maps to INCL. Needs a new Eclipse export.

Asked to go through the shared code for the same kind of gap - a host-specific type cut at its slash: object-tools.js was the one place it bit. The pages and front-end modules (frontend-analysis, versions-front, metrics.html, versions.html) get the type after object-tools has normalised it, and sap-code's packageObjects keeps only CLAS and INTF. But the same cut turned Eclipse's function module (FUGR/FF, from AdtEditor.kind) into FUGR, the whole group; it now maps to FUNC. Left open: FUGR/I, an include of a function group, still becomes FUGR - whether ADT reads such an include under /programs/includes/ was not checked. Eclipse archive rebuilt.

### Eclipse: Forward and Backward Usage Analysis

The user found Eclipse on the old Value origin - only "Analyze Variable Value Origin", a variable required, a pair of breakpoints as bounds - while VS Code has had Forward and Backward Usage Analysis since 2026-10-08 (the memory note said Eclipse gets them once VS Code proves them; the user now asked for it, "just as in VS Code at this moment").

Forward: eclipse/value-origin.html now does what value-origin-view.js's command does - no variable, or the name of the routine, a called method or a keyword under the cursor, gives the flow from the line (`flowPath`/`flowRange` on the mapped target, which collectDemandSources already honours), the title says what stood under the cursor; the breakpoints are placed in the analysed include and passed to `stopAtBreakpoints(flowScope(graph))` with a Stop / Continue to next / Ignore dialog (`sdeOriginAsk`, a MessageDialog); `boundsOf` and `flowBounds` are gone from the page. The origin bundle exports callsIn, variablePaths, flowScope, stopAtBreakpoints and backward-usage.

Backward: frontend-analysis.js gained `/vertex/backward/` - the start source and every caller's source parsed by value-origin-linter's parseSource, addressed by their ADT source URL so a line is ADT's line, and backward-usage.analyze run over them, with where-used and the breakpoint question from the host (`api.whereUsed`, `api.askBreakpoint`) - and a `sourceAddress` that maps a where-used place to its object and source. The Eclipse adapter does where-used as abap-adt-api does: POST usageReferences, POST usageSnippets (Java's `sdeAnalysisWrite` kind `adtpost`, limited to those two paths), GET urifragmentmappings for a place inside a method; the page parses the XML. The page runs Backward when the target's direction says so and opens its nodes by their ADT address. `ValueOriginView.Target` carries the direction; `BackwardUsageHandler` and the command `org.vertex.abap.ui.command.backwardUsage` are in plugin.xml and the editor menu. Checked in Node: the Backward route on a stand-in ADT (a class method and a report calling it) finds the method, asks where-used at it and reads the caller; the pages parse; the plugin compiles (target/eclipse-0.8.8.20261010000730). Not run in Eclipse. Limits: only the start editor's breakpoints stop Backward - Eclipse hands over the breakpoints of that editor alone.

Eclipse, the review of ALCK900744: "GET /sap/bc/adt/ddic/tables/zlog_base_tariff/zlog_base_tariff/source/main/versions failed: 404". The page resolved a version link as a browser resolves it, against the object's address with a slash added; a table's metadata names its feed `./<name>/source/main/versions`, which abap-adt-api's followUrl reads as beside the object (the last segment dropped), any other link as inside it. eclipse-frontend.js now follows followUrl exactly; checked against it for a table's and an include's link. VS Code was not affected - it uses abap-adt-api itself. Archive rebuilt.

Eclipse Forward on START-OF-SELECTION (ZVERTEX_DEBUG_LAB): "slice of this value", and the flow did not go into `NEW zcl_calc_facade( )->run( )`. The shared reader takes the event for a name - variableAt returns START-OF-SELECTION and variablePaths lists it - so a slice of it was drawn, and a slice goes into a call only where the value is computed. The same happened in VS Code: its check for "the routine itself" knew METHOD, FORM and FUNCTION only. Both hosts now also count a report event (abap-control's classifyStatement(...).event) as the routine itself, which gives the flow from the event with its calls. The variablePaths reading itself is unchanged - it feeds the slice, and an event never reaches it now. Eclipse archive and the vsix rebuilt. The one failing test in value-origin.test.js fails the same without this change.

### Eclipse: Visual Debug replaces Debug Monitor

The read-only Debug Monitor became Visual Debug, option B of eclipse/VISUAL_DEBUG_ASSESSMENT.md: DebugMonitorView now extends ToolsView, keeps its view ID and loads the shared vscode/pages/visual-debug.html (copied by prepare.js with eclipse/visual-debug-host.js, the bridge from the page's contract to `sdeNativeDebug`). VisualDebugSession.java answers the page's commands from the ADT debug model - IAbapThread, IAbapStackFrame, IAbapVariable, IAbapLineBreakpoint - and debug events only wake a pending step; no SAP request is made from an event callback. Run calls prepareRun (needs an enabled breakpoint, switches ADT debugging on, synchronises breakpoints) and opens the object in the embedded SAP GUI (com.sap.adt.sapgui.ui). `settle` is a no-op: there is no prediction. The analysis worker gained a `debug` request (vertexDebugAnalysis) for the page's flow. package.ps1 now adds Require-Bundle and Import-Package entries missing from the docs/ p2 template, or p2 would not resolve the new gson and sapgui dependencies.

Checked: six Node checks of the adapter and analysis pass; Java compiles with --release 21 against the ADT 3.60 pool; target/eclipse-0.8.8.20261010095715 is packaged and its jar carries VisualDebugSession and both page files. The first packaging run failed in prepare.js with a bare `node:fs` error; prepare.js alone and the rerun passed - likely a passing file lock, not established. Not checked: the browser preview (a background Edge was not allowed), a live ADT session (stack and values updating on steps), light and dark in Eclipse.

Docs: eclipse/README.md lost its contradiction - the 0.8.1 note said the ACE endpoints were kept while a later section recorded the move to ADT + abaplint; it is now past tense with a pointer. VISUAL_DEBUG_ASSESSMENT.md opened with "not built, not prototyped" while its end described the monitor; its status now says option B is built.

First live look (ZVERTEX_DEBUG_LAB stopped at line 15 in ADT): Visual Debug showed nothing - no stack, no variables - where the old Debug Monitor at least showed the stack. The old monitor found ADT threads through the launch manager's debug targets; VisualDebugSession asked `AbapDebuggerPlugin.getAllThreads(project)`, which was never checked live and is the likely empty list. Threads are now found the old monitor's way and kept to the view's project; a session of another ABAP project is reported by name instead of an empty page. Rebuilt as target/eclipse-0.8.8.20261010101657; not yet seen live. Also seen: the title said "Visual Debug" without the object, so the view got no object from the editor - not yet explained.

Still empty after that, and the breakpoint pane would not even toggle. The host now prints script errors and unhandled rejections on the page, and Eclipse showed: "Failed to execute 'write' on 'Document': missing ) after argument list (line 1791)" and "INITIAL is not defined" - the page's main script never ran. Cause: DebugMonitorView put the theme, the controls CSS, the docked class and the bridge in with Java's String.replace, which replaces every occurrence; visual-debug.html builds a frame with "</head>" and "<body>" inside JS strings (line 2045), so a style block with double quotes landed inside a string literal. A Node rebuild of the page used JS replace, which replaces the first occurrence only, and so passed - the reason the browser check could not see it. Each tag is now replaced once, at its first occurrence, and a missing tag fails loudly. The same trap held for PageView's PLACEHOLDER, replaced everywhere: visual-debug-host.js carried it literally for the Logic frame's template, so that frame would have got the page's own initial object; the literal is now split. The getAllThreads change before this was a guess and stays: the launch-manager way is the one the old monitor proved. Rebuilt as target/eclipse-0.8.8.20261010103956.
# 2026-10-17 — Configured system removal

Added a multi-select Remove SAP Systems command that updates the effective configuration scope and repairs `vertex.active` when its system is deleted. Import remains explicit; removal does not change SAP Logon or ADT source entries. Added focused tests for removal and cancellation.

The user's direct SNC use case exposed a stale exclusion in the SAP Logon importer. Direct entries now preserve `sncname` and `sncop` and create `authType: snc` with the RFC application server and instance from `server`. SNC logon groups without an application server remain skipped with an explicit reason; guessing the message server as `rfc.ashost` would be wrong. Added parser tests. At the user's request rebuilt the universal VSIX as 0.9.10 without a version bump; the package verifier passed.

The user still saw the ADT destination after selecting an import candidate. The importer added systems but did not change `vertex.active`, so the sidebar stayed on the old destination. It now selects the newly added SNC system and names that selection in the completion message. The importer also writes to the effective `vertex.systems` scope instead of always writing globally, which a workspace setting could mask. These changes are in source pending a new package. The local SAP GUI landscape inspected on the development host contains no ER6 entry, so the user's ER6 import result from their VS Code environment still needs confirmation.

### VS Code 0.9.19 — Command Palette cleanup

The Command Palette now exposes only Open Transpiler Run..., Open Panel, VERTEX Tools, Add the VERTEX MCP server to Claude Code or Codex, and Get Started. All other contributed commands are explicitly hidden there; editor and panel entry points remain registered.
