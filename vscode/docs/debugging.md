# Debug with an assistant

An assistant can run the ABAP debugger by itself: set breakpoints, start the program,
look at what the program held where it stopped, decide where to look next, and end with a
verdict that names the line and the values that prove it. You describe the problem; you do
not step through the code.

> *Z_CALC computes the wrong discount. Find out why with the debugger.*

The debugger sets breakpoints and holds a listener. It never changes a variable, never jumps
over code and never writes source or data.
At a stopped SAP session, `debug_watchpoint` adds a real ADT watchpoint for a variable;
Continue stops when SAP reports a change. The agent can list and remove watchpoints.
In VERTEX Smart Debugger 0.9.15, enter a name beside Variables or right-click a variable and choose Watch.
Without a condition, the same control stops SAP or a live transpiler run on any change;
a recorded transpiler run can also continue to its next recorded change. The optional
**When** field accepts a comparison of the new value such as `>= 10` or `= 'DONE'`.
The program stops only when that comparison holds. **Watch Follow** uses the
existing value analysis to watch the names it follows through assignments and calls,
including renamed parameters such as `LS_VAR-COUNT` and `CS_VAR-COUNT` when the analysis
connects them. The same When comparison is applied to every name. Each watchpoint is
listed separately and can be removed. The local transpiler supports numeric and quoted
text comparisons; SAP evaluates the corresponding ABAP condition through ADT.

## Before you start

- **VERTEX for VS Code 0.7.3 or newer**, with the SAP system in `vertex.systems`.
- **Nothing on the ABAP side.** The debugger uses only SAP's standard ADT services; VERTEX's
  ABAP (`src/`) is not needed for it.
- **In SAP**, for your user: the authorisation to debug (the standard object `S_DEVELOP` with
  object type `DEBUG`), and the WebGUI service active in SICF
  (`/sap/bc/gui/sap/its/webgui`) - the debugger starts reports there.
- **For the VERTEX chat**: a provider set up in **LLM Providers**. For Claude Code or Codex:
  the client installed and signed in.
- **A strong model.** Debugging is a loop of many steps - set, run, wait, read, decide - and a
  small model gives up early or "fixes" the wrong line. In the pilot Claude Haiku once answered
  from reading the code instead of debugging, and once proposed a fix that did not fix anything;
  Claude Opus found the cause with the values that prove it, and the right fix.

## Quick start

1. Install VERTEX 0.7.3 or newer and reload the window.
2. Choose the system in the panel's **SAP system** list (or **VERTEX: Switch System**) and
   for basic, enter the password once; SNC uses Secure Login Client without a prompt.
3. Close any other debugger for your SAP user - an Eclipse debug session, ABAP FS - or tell the
   assistant it may take over.
4. For Claude Code or Codex only: register `vertex-debug` once, as described below, and start a
   new conversation.
5. Ask about a report of yours: *Z_MY_REPORT prints the wrong invoice total. Find out why with the debugger.*
6. When the browser opens WebGUI, log on if asked. The assistant waits for the program.
7. Read the verdict. Ask it to fix the code if you agree: the change lands in the program's
   tab, unsaved; save it with **VERTEX: Save & Activate** or **VERTEX: Review & Activate**.

## Where it runs

| Assistant | How it gets the debugger | Setup |
|---|---|---|
| The **VERTEX chat** in the panel | on its own `/chat` address, beside the source tools | none |
| **Claude Code** or **Codex** | a second MCP server of the extension, `/debug`, registered as `vertex-debug` | once, below |

The debugger runs on the **active** system - the one chosen with **VERTEX: Switch System** or in
the panel's system list - with its configured authentication. Naming another system in a chat
question does not move the debugger there; switch first. Switching while breakpoints or a
stopped program are still on the old system is refused until `debug_stop` has removed them.
A VS Code window with VERTEX has to stay open while it works.
The standalone MCP server in `mcp/server.js` does not have it.

**Claude Code or Codex**: click **Add the VERTEX MCP server to Claude Code or Codex** under `vertex.mcp.port` in Settings and
choose **Claude Code** or **Codex**. Both review and debugger registrations are copied together.

- Claude Code: paste the copied command into a terminal and run it. `claude mcp list` then
  shows `vertex-debug: http://127.0.0.1:37777/debug (HTTP) - Connected`. Start a **new**
  conversation - one already open does not see a server added after it began.
- Codex: paste the copied `[mcp_servers.vertex-debug]` section into `~/.codex/config.toml`,
  restart the Codex extension and start a new conversation.

`vertex-debug` sits beside the review's `vertex`; neither changes the other.

The VERTEX chat and `vertex-debug` agents can run eligible ABAP with `run_abap_transpiler`.
When no run mode is specified, the agent tries the local transpiler first and reports that its
result is a simulation. `screen_only` returns the selection screen or method arguments; the
agent can then pass radio choices, parameters and ranges in `selection`. Missing required
values are reported before execution. Names are matched without regard to case, as in ABAP:
a radio group is given as `{"SC": "P_PREC"}`. A key the selection screen does not have, or a
choice its radio group does not offer, stops the call with an error naming what the screen
accepts, instead of running the defaults. A completed run returns its output and a GUID
`session_id` (also returned as `run_id` for compatibility).
`read_abap_transpiler_history` pages through every recorded step and its variable changes;
by default each step contains only changed variables. Pass `include_state: true` to read
the full state at each step. `run_abap_transpiler` also accepts local scalar
`interventions` with object, line, variable, value and optional occurrence. A rerun applies
each replacement before that executable line and records its before and after values in
the history, so the agent can test a hypothesis against the original run.
`find_abap_transpiler_stops` finds source lines or changes to a variable, including a
structure field such as `LS_RESULT-AMOUNT`. These are virtual watchpoints over the recorded
run. To compare runs, explain a result or find a cause, the agent must query that history
before answering and back every statement about values, control flow or a cause with a
`run_id` and the step, line and value; if the history cannot be read, it reports the run
outputs and marks the rest as not verified. When a question covers several scenarios and a run of one of them is missing, the agent runs it rather than asking; a kept run open in VERTEX Smart Debugger is reported to the agent as such and counts only for the selection it ran with. If the transpiler cannot run the code, the agent asks before switching to a SAP run.

You can ask for the full comparison in one request, for example: *Run all scenarios for Z_PRICING,
compare their results, and explain the differences.* The assistant runs the available scenarios,
reads each run's history, and cites the steps behind its comparison. A run already open in Visual
Debug counts only for the selection it used.

Runs are numbered within a chat conversation from 1, and **New conversation** starts again at 1.
The agent cites its evidence as `[run d6c436b8 step 13]`; the chat shows such a citation as
**run 2, step 13**, a link when it names exactly one known run (a run from another conversation
keeps its id). The link opens that run in VERTEX Smart Debugger at the cited step, with its record, variables, SQL and output, without running the program again. A kept
run is looked at, not executed; Run in that panel says so.

A run started with **Run with ABAP Transpiler** in VERTEX Smart Debugger is also registered in this history. Its `run_id` is included in the debug context sent to chat, so the assistant can cite its steps as `[run <first 8 characters of run_id> step <n>]`; the link opens that run's recorded trace.

The chat’s transpiler runs are kept on disk in VERTEX extension storage. Set
`vertex.transpiler.runPath` to use another folder. Each run has its own folder
(`vertex-run.json` and copies of the sources it stepped through), so citations still open
after a restart. A folder copied elsewhere or sent to someone else opens with
**VERTEX: Open Transpiler Run...**. Deleting a recording makes its old citations unavailable.

## How a run is caught

1. The assistant sets breakpoints. Setting the first one starts a **listener** for your SAP
   user - without a listener, SAP lets every breakpoint pass.
2. It starts the program with `debug_run`: WebGUI opens in your browser on
   `…/sap/bc/gui/sap/its/webgui` and runs the report at once. Log on there if the browser
   asks.
3. The program reaches a breakpoint, the listener catches it, and the assistant reads the stop.

**Runs from the standalone SAP GUI are never caught.** SAP does not apply ADT breakpoints to a
session opened through SAP Logon - not for VERTEX, not for Eclipse, not for any ADT client
([SAP's documentation](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/breakpoints-characteristics)).
They do apply to WebGUI, to the SAP GUI embedded in Eclipse, and to any HTTP or RFC request
made under your user. A class or a function module is started by you, through whatever calls
it over HTTP or RFC; the assistant asks.

WebGUI opens at the system's `url`. Two things can get in the way:

- **A certificate that names a host.** Use the host name the server's certificate names (for
  example `https://s4.example.com:44300` rather than an IP address), or the browser warns.
- **A redirect to a host this computer does not know.** Many systems send WebGUI from their HTTP
  port to HTTPS on their own full host name - `https://sap-host.corp.example:44300/...` - and the
  browser answers "cannot find the server". Two ways round it:
  - Give the system a **`webgui`** address that works from here, and the debugger opens WebGUI
    there directly:
    ```json
    { "name": "DEV", "url": "http://10.0.0.5:8000", "webgui": "https://10.0.0.5:44300",
      "client": "100", "user": "DEVELOPER" }
    ```
  - Or teach this computer the name: one line in `C:\Windows\System32\drivers\etc\hosts`
    (administrator rights needed), with the address and the name from the failed redirect:
    `10.0.0.5  sap-host.corp.example`. Then the redirect works as it is.

**One debugger per user.** SAP gives each stop to one listener. If Eclipse or ABAP FS is
already debugging for your user, the assistant is told so and does not take over unless you
agree - otherwise the other debugger would silently lose its stops. Close the other debug
session, or tell the assistant it may take over.

## If it does not work

| What you see | Why | What to do |
|---|---|---|
| The browser says it cannot find the server | SAP redirected WebGUI to a host name this computer does not resolve | Give the system a `webgui` address, or add the name to `hosts` - see above |
| The browser warns about the certificate | WebGUI opened at an IP address or another name than the certificate's | Use the certificate's host name in `url` or `webgui` |
| The program ran and nothing stopped | It was started from SAP Logon; or another debugger took the stop; or it started after the assistant gave up waiting | Start it through `debug_run` (WebGUI); close the other debugger; ask the assistant to wait again |
| *SAP did not accept the breakpoint* | The line holds no executable statement, or the object is not active | Pick an executable line; activate the object |
| *Another debugger already listens for …* | Eclipse or ABAP FS debugs for the same user | Close it, or let the assistant take over |
| *Debugging is still going on …* | The system was switched while breakpoints were set on the old one | Ask for `debug_stop`, then start again |
| A verdict that does not match what the program does | A small model guessed | Ask again with a stronger model, and ask what the debugger showed |

## Breakpoints: conditions and modes

A breakpoint goes on a line of a program (`PROG`), an include (`INCL`) or a class (`CLAS`,
counted in its main source, as the VERTEX class tab shows it). The assistant cannot yet set one
in a function module; [VERTEX Smart Debugger](#vertex-smart-debugger-the-debugger-on-screen-pilot) can. The line
has to hold an executable statement; SAP refuses anything else, and the refusal is reported.

A **condition** is checked by SAP each time the line is reached; the program stops only when
it is true, so a thousand passes cost nothing. It is written like the condition of an ABAP `IF`
([syntax](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/syntax-for-breakpoint-conditions)):

| Condition | Stops |
|---|---|
| `lv_total > 1000` | once the total passes 1000 |
| `ls_order-customer = 'CUST_B'` | on that customer's rows |
| `sy-tabix = 3` | on the third pass of a loop |
| `LINES( lt_items ) > 0` | once the table has rows |
| `sy-subrc <> 0` | after a failed call |
| `oref IS BOUND AND oref->attr = 'X'` | the second part is checked only if the first holds |

The built-in functions are `LINES( )`, `STRLEN( )`, `XSTRLEN( )` and `INEXACT_DF( )`, with a
blank inside each bracket. At most 255 characters. A name that does not exist is found only
when the line runs: the program then stops there with SAP's message, rather than passing.

Each breakpoint has a **mode**:

- **stop** (default) hands the stop to the assistant, which reads, steps and continues.
- **log** records the variables that changed and lets the program run on at once - a
  watchpoint. A loop of a hundred passes costs the assistant no turn; it reads the record
  afterwards.

Setting the same line again replaces its condition and mode.

## Where the editor goes when the program stops

A stop in a method opens that method's class in the standard VS Code editor and puts the
cursor on the line - the class whole, the way a click on a method opens it, because the
generated CM include a method frame names is not an object an editor tab can hold. Only the
frame the program stands in is opened: a stop deep in a callee does not drag every class
below it into the editor. It opens in the group the ABAP sources are already in rather than
whichever group happened to be active, and **Alt+Left** returns to where you were.

This is where the debugging was started from. The F5-F8 keys, the docked Debug panel and the
assistant all step from the editor, so the editor follows them. A VERTEX window that drives the
debugger shows the source in its own pane, and a step there opens no editor at all.

It is one tab, not one per class: the stopped source opens in the preview tab and the next stop
takes its place, so a run through many classes leaves nothing to close. A source you opened
yourself keeps its own tab.

The breakpoints are sent twice: to SAP's external set, which is what catches a run, and to the
stopped program's own set as soon as the debugger attaches - without the second, a Continue runs
past them. A point SAP will not place is named in the header above the source rather than left
on screen as a point that stops nothing.

## When the program dumps instead of stopping

SAP tells a debugger the same thing whether the program finished or died of a short dump:
the step simply throws. So a run that dumped used to end in silence — F5 into a class whose
load fails, and the session was over with no reason given — and a program that dumped
before reaching any breakpoint left the debugger listening for a stop that would never come.

The debugger now reads SAP's dump feed (`/sap/bc/adt/runtime/dumps`). Whatever is already
in ST22 when the run starts is this user's history; only what appears afterwards, and only
under this user, belongs to the run. A step that kills the run asks once, immediately, and
answers with `dumped` — the runtime error, its text and the address of the full dump on SAP
— so a program that merely finished never waits for an answer that is not coming. While
`debug_wait` waits, the feed is read every ten seconds, which is what catches the run that
died before any breakpoint. If the feed cannot be read at all, that is reported as its own
problem rather than as "no dumps": a missing dump is exactly what this exists to catch.

The section also names the include and the line the program died on, and clicking it opens
that source there. The feed carries no place, so it comes from ST22's own table `SNAP`
through VERTEX's table resource - which means this one part needs the ABAP backend. Without
it the dump is still reported and the section says why it cannot point anywhere.

**Detach** continues the program and stops listening, so nothing of VERTEX's will hear how it
ended. It takes one look at ST22 a moment after letting go, and **Check ST22** in the Dump
section asks again whenever you want; the chat asks the same question with `debug_dumps`.
Nothing polls in the background for a program that is no longer being debugged.

In VERTEX Smart Debugger the dump has a section of its own, beside Stack, Breakpoints and Variables.
It opens by itself when a run dies, names the runtime error and what SAP said about it, and
**Open ST22** takes you to SAP where that dump is the first entry. The header line above the
source says the run did not finish and points at the section.

The player shows the record as **Classes** or **Methods**. A separate **Logic** toggle opens the same Diagram as Tools, embedded in VERTEX Smart Debugger and linked to the active source editor. Turning it off restores the call graph, including its zoom and scroll position.

The **Depth** slider governs how deep it is drawn: the program is 0,
a class 1, a routine 2, a statement one below the block that holds it. The maximum is the deepest
statement in the record. *Collapse all* / *Expand all* are one button beside the slider, not its ends: it offers the other each time and says
whether the levels that are shown are open (the start: all of them; collapsed: the top only), and moving the slider
keeps the switch.

The record is one control with three positions: **No record**, **Rec steps**, or **Steps &
values**. The third also reads the parameters and locals at every stop - in an event of a report,
outside every routine, the program's globals - and keeps them with the stop, for the player and for
Formula and Expression. That is the expensive half of a stop, and a run is often recorded for its
shape alone.

Recording is also what makes Continue a run of F5 steps rather than SAP's own: with it off,
Continue is Continue. A run always draws where the program is as it goes. Every step reads where the program now is:
the stack comes back with the step in one request to SAP.

**One magnifier.** Every diagram - Tools (UML, Calls, Logic), the flow of Value origin and the
debugger's diagram - has the same magnifier, a magnifier icon in the toolbar. It follows the pointer
over any point of a flowchart and over a node of a class diagram, whatever the zoom; Shift with the
wheel sets how strong it is.

**The panes follow the program.** Before the program stops there is no stack and there are no
variables: those sections stay closed and the breakpoints are shown as soon as there are any. When
the program stops, the stack and the variables open. A pane you closed stays closed until the next
change (a stop, or the end of a run).

**Variables before the run.** Before the program stops, Variables lists what the analysis declares, for the
place you are in: the cursor's line in the VERTEX source in front, else a breakpoint's, else the program. In a
method or a FORM that is its parameters and locals (the globals are read when you turn *Globals* on); outside
every routine - a program's events, a class's own text - the globals. Names and types, no values, which come
when the program stops. A right-click follows a value, so its slice can be asked for before the program runs.
A variable declared by a call has the type that method returns, and a variable of a structure type opens to its
components, each of which can be followed by its path (`LS_RESULT-AMOUNT`). A structure that cannot be read is
marked `?` with the reason. An object above 20,000 lines is not read on its own: use Analyze flow path.

**Analyze flow path.** The Breakpoints panel groups the points by object. A point carries *Analyze flow
path*: it runs the analysis Value origin runs, from this point to the next checked point the flow meets - in
the same object, or below it on the stack in a routine the flow calls - and draws the flow in the diagram: the
program, its classes and routines, the statements of ACE's stream under them with each IF, CASE and LOOP the
parent of its body, a called routine's statements under the statement that calls it, in the order of execution.
The start may be in a program, an include or a class; the end statement is the last one drawn. Classes,
Methods and Statements, Full or BSE, as the record is drawn. With a value chosen in Variables the statements its
slice reaches are marked; without one the flow is drawn alone. A recorded run does not replace it: the analysed path stays whole, with every dependency of the chosen value, however
far the run has gone; with no path analysed the diagram is drawn from the record. With no other checked
point on the way - none set, or none the flow meets - the path runs to the end of the flow. While the analysis
runs, the VERTEX logo turns at the start of its progress line.

**Where used.** Beside *Analyze flow path* (forward), a point carries *Where used* (backward): it opens the point's line
and runs **VERTEX: Backward Usage Analysis** there for the value chosen in Variables - wherever it is named in the
routine - or, with none chosen, for the routine at the point, so where its values go in the callers is shown from the
debugger.

**Several values.** *Follow* in a variable's menu adds it to the values followed. *Follow* on a structure follows the
structure itself, as one value: its places are every statement that writes any of its fields, also under another
name in a method it is passed to (`ls_result` passed as `cs_context`, then `cs_context-amount = ...`). Its fields
are offered beside it - after a run those the run changed, before it all of them - and a field is analysed when it
is chosen. With more than one value, a list on the chip in Variables and at the left of the diagram's toolbar
chooses the one Formula, Expression and the places are about; what was analysed for each is kept, so switching
back asks nothing again. *Follow* again on a value drops it, a structure with its fields; the chip's × drops them
all. The variable trees start closed.

**Formula and Expression with the run's values.** With a value chosen in Variables and a path analysed, after a run
Formula and Expression are the analysis's formula as the run took it: only the definitions whose line the run
executed take part - once the run is over; until then the formula stays whole - so the alternatives for other paths (`otherwise`, `when sy-subrc = 0 ...`) fall away, and
definitions that all ran - every modifier of a pipeline - stand as steps in the order the run executed them, each
reading what the one before left. One calculation is left. **With values** - shown whenever a value is chosen, on by default - puts
after each of their names, in brackets, the value the record holds for it: in the routine the analysis places it in,
at its last stop there up to the stop shown, so at the end of the record the final values, and it follows the player;
the value on the left, the one the formula comes to, is given the same way. Expression has two readings,
**Analyze** (the default: the analysis's complete formula without recorded values, whatever value the run produced)
and **Recorded** (how the run computed the value), and the **Optimized** toggle for both. Off, the derivation is
written out: Analyze puts every value into one formula, Recorded writes the run's derivation as one line. On, the
formula reads its values by their names, numbered where one name holds several (`CS_CONTEXT-AMOUNT₁`,
`CS_CONTEXT-AMOUNT₂`), and under **where** each is given by its statement, the values it reads one level down under
an arrow; for Recorded, the last step, its where and the rule. In Analyze optimized, a name the analysis found no
assignment for keeps its source spelling, with no number. Recorded Expression colours ABAP keywords, numbers
and string literals in the active theme; variable names remain links to their source statements. An assignment
that computes zero still counts as a calculation.
Formula shows that formula above the tree of the run: each value, the statement that last changed it with its stop,
line and the value before, and what that statement read, back through the record - a node that would open the
same code as the node under it or above it, such as the parameter a call passed, is left out. Every name of the
formula and of the tree, and each formula of the analysis's tree, is itself the link to the statement that set it; a value the record never saw
change is a leaf, *not changed in the record*. With no path analysed, Expression comes from the record instead:
the statement that made the value, each name with the value it read. Right under it, after *where*, each value the
formula reads that was itself computed from several terms is given by its own statement, side by side in the
formula's order. A line that reads computed values of its own has an arrow: it unfolds the next level, those values
by their statements, and so on. Each value is opened on the first level that reads it and once, a literal not at all,
and a name links to the statement that set it. When the value was built up in one variable step after step
(`amount = amount + amount * x`), a line after the where, captioned *the same as one rule: the first value and the rates,
the sums in between folded in*, writes it as one product, `amount₁ × ( 1 + x ) × ...`, with what a step adds besides the value as a term of its own, and a *where* of
its own under it - the first value, a percent computed on the way - so the two formulas can be set side by side; a
step that is no sum or product of the value says so instead. The result closes the pane. A component read with several values is numbered
by the order they were made (`amount₁`, `amount₂`, ...); a plain name of two routines - two modifiers' own
`lv_percent` - is two variables and is not. Values show four decimals at most, the whole value on hover. That
formula is the one the whole record gives, and it follows the player: an assignment
that has run by the stop shown has a green `=` and its value, one still to run has a red `=` and no value; decimal
values are shown without trailing zeros. Values come from Steps & values (a transpiler run always has them); from Rec steps alone the
tree comes from the statements that ran - the last one that wrote each value - without values. In a SAP record a
structure's components are read one level down for this.

**A new window starts clean.** Opening VERTEX Smart Debugger again, or **Clear** in its title bar, drops the record, a paused transpiler run, the analysed
path and the values of an earlier local debug session; a live SAP debug session and the breakpoints stay.

**Show from here.** Right-click a node or a routine frame of the diagram for *Show from here*, *Expand this
branch* and *Collapse this branch*. Show from here draws the diagram from that node down; the path bar above
it returns to a wider view, and Escape steps back. In Tools Diagram, click a folded *n operations* block to
expand its statements; clicking a source-linked statement such as **ENDIF** opens that line in the source.

A Visual or Rec run is F8 made of F5 steps, and it ends at a breakpoint it steps onto -
including one in the program that called the class being stepped through, where SAP reports a
step rather than a breakpoint. A deactivated point and a log point do not stop it.

A Visual or Rec run reports it too. Those runs step on their own and take no
events while they step, so a dump used to end them with nothing said; the answer to the
step that killed the run carries it, and the section opens from there as it does for F5.

A click on a dump row shows that dump as SAP wrote it, over the window; **Whole dump** in the
heading does the same for the first one. **Check ST22** asks again at any time - with a dump
already reported it says nothing is new, not that there is none.

A section is shown or hidden by its button in the row above it - *Stack*, *Breakpoints*,
*Variables*, *Diagram*, *Dump*, *Log* - and its height goes to the others. That is the only
control over it: the heading used to fold the same section as well, which is two controls for
one state.

## What a stop shows

- where the program stands and the top of the stack;
- five source lines around the statement;
- the variables that changed since the previous stop - all of them at the first stop;
- for a table that changed, its row count and first five rows.

That is deliberately little. Everything else is read on purpose with `debug_read`: a field, a
structure's fields, or rows *from*..*to* of a table (up to 200 at once), by name as ABAP writes
it - `LS_ORDER`, `GS_INVOICE-ITEMS`, `ME->MV_RATE`.

## VERTEX Smart Debugger: the debugger on screen (pilot)

**VERTEX Smart Debugger** is the right-hand panel beside the source tab (programs, classes and function modules); it shows the same
debugger the assistant drives - one session, not a second one:

**Save log** on the replay bar keeps a SAP recording as a local file. The bug icon in the panel's title opens **SAP & Transpiler Logs**: open a recording for offline replay, rename or delete it. The assistant can cite a recording's steps as evidence, and a citation opens that step. Recordings are kept in extension storage, or in `vertex.debug.runPath`.

- **The source stays in the editor.** The panel opens beside the source tab and draws no copy
  of it; the lines are those of the active version, which is what the program runs. Breakpoints the assistant set appear
  here, and those set here are the assistant's too.
- **Where the program stands.** At a stop the editor marks the current line and follows it,
  also into another include. **Single Step** (F5), **Execute** (F6),
  **Return** (F7) and **Continue** (F8) step, named and drawn as in the classic debugger; a click on a stack level shows that level and its
  variables.
- **Every variable at once**, grouped as SAP groups them; parameters and locals are headed by
  the form, method or event they belong to. Structures and objects unfold in place (object
  attributes marked public, protected or private); **Initials** shows the variables with an
  initial value and **SYST** the system fields `SY`, both hidden by default; **Filter** narrows
  by name. A value that changed since the previous stop is marked. **Right-click** a variable and
  choose **Follow … in the analysis** to make it the value that BSE and **Points** are about; a plain click
  only selects or unfolds, so a value is never followed by accident. At a stop of a recorded run - the player moved
  to it, in SAP or in the transpiler - the values recorded there are right-clicked the same way, and the menu adds
  **Flow of … from stop N** (Analyze flow path forward from that stop's line) and **Backward of … from stop N**
  (Where used, back from it): the value is followed, Formula is built from the record at that stop, and nothing is
  run again. Choose another value and ask again as often as needed. A type SAP names only
  `\TYPE=%_T...` is shown as the source declares it - `p LENGTH 8 DECIMALS 2` - or, with no
  declaration, as SAP's technical type.
- **What is read, and when.** **Globals**, **Locals** and **Params** switch a group's reading
  on or off: a group switched off is not asked of SAP at all. ADT does not say what a step
  changed, so after a step over a plain statement only the variables it names are read again
  (the header says which); after a call, a step out of the routine or a Continue, every group
  switched on is read.
- **Visual.** With **Visual** on, Continue (F8) runs as a string of F5 steps: the current line
  moves through the source as the program goes (switch Visual off during the run and the editor stays put until it stops; on again, it follows from the next step), no variable is read on the way, and it stops at a
  stop breakpoint, on **Pause**, or when the programs it began in are no longer on the stack -
  the program is over and F5 would go on into SAP's own code. Each step gets the stack after it
  in the same request to SAP (ADT's debugger batch), and with a value followed, that value too.
  Loops are stepped through. With **Z only** on (the default), a step that goes from Z/Y code
  into SAP's own is followed by F7 at once: the call runs to its end and the run goes on in your
  code - as F6 on that call, Z code called from inside it (a BAdI, an exit) passed with it. The
  statistics show the steps, the time per step, and
  SAP's step and stack requests apart. Beside it: the steps, the time, and the time per
  step - of the whole step and of SAP's step request alone. At its end, *ms per step* splits a
  step's time: SAP's step (with the stack after it, when the step reads it), the rest of the
  host's work on the stop, the wait for the debugger's queue, the host's own handling, the page-host round trip, the picture, drawing,
  values, and the rest. A click on the statistics copies
  them. The variables are read once, when it
  stops. A log breakpoint met on the way is still recorded.
- **Diagram.** A run records which routine calls which - the program's real flow. When the run
  stops, **Diagram** shows it as a Mermaid chart: **Classes** (classes and
  programs, with the number of calls between them) or **Methods** (every routine, grouped by
  its class) - kept across Continue until the program ends or Detach or Exit program is pressed -
  zoomed with −, +, Fit or Ctrl + wheel, and shown on the whole window with ⤢ (Esc
  goes back). SAP's own code appears as one node for what was called. The chart runs top-down,
  the caller above its callees; SAP standard is dashed grey, and the number on an arrow is how
  many times that call was made. The chart sits in the right column under Variables; with Visual
  on it is redrawn during the run, each time the stack changes. The block running now is filled
  green, dark green once it has been called more than once; the mark moves on the drawn chart,
  which is drawn again only when a new block or arrow appears. SAP standard is dashed blue.
  In **Methods** each routine is one block, class above and method below, coloured by its class
  with no frame around a class, so the levels follow the stack depth.
  ⏮ ◀ ▶ ⏭ and a slider move through the recorded stops and ⏵ replays them: the source line and the green block
  move together with the Stack as it was at that stop (marked recorded), from the record alone,
  at 1, 2, 3, 5 or 10 stops a second or as fast as the window draws (max), with the
  milliseconds each stop took on screen (kept after the replay). Rec reads a routine's
  Parameters and Locals where it starts and where it ends; the player shows them in Variables,
  and at the stops between, the values last read in that routine. The first recorded SAP stop
  also captures Globals, including selection-screen values, so they can be inspected at that step.
  A click on a block moves the player to the next time the run entered that routine, its source
  shown here; a SAP standard block the run stepped over shows its source (class, function module
  or program). **Stack** is a table as in SAP's debugger: depth number, event type, event,
  program, include and line, the deepest level on top. The frames below the object - SE37's or
  SE24's test frame, the screen - are folded into one line, and are not on the chart; a function
  module's block carries its name.
- **Rec.** Beside Visual. While it is on, every stop goes into the record, whoever made it:
  F5-F8 in this window, the assistant's steps, a breakpoint - and into the step log, with the key
  and the time of a step made here. Continue (F8) then takes the same F5
  steps as Visual but draws nothing until the run ends. The player replays the record statement by
  statement. Each drawing fits the pane, never above 100 %, until the zoom is set
  by hand with −, + or Ctrl + wheel; Fit returns to fitting.
After VS Code Reload Window, VERTEX Smart Debugger reconnects to its last source and SAP system and restores the manually entered Program field without starting the program. In-memory execution state is not resumed; saved recordings remain available from SAP & Transpiler Logs.

Changing a diagram’s direction between Top-down and Left-right automatically fits the new drawing after rendering.

- **Sections.** The switches at the very top of the window show or hide Main (Clear, help, diagnostics and the run controls:
  Run in SAP, the steps, Visual, Z only and the record) and the right column's Stack, Breakpoints,
  Variables, Code Flow Analysis, Dump, Output and Log; the name of the program being debugged stands beside them.
  The line between two visible sections drags to resize them. Breakpoints is as tall as its list, at most 40% of the
  column, until its line is dragged. Code Flow Analysis opens by itself when a run has recorded something. The **?**
  in Main explains the window: analysis without running, the ABAP transpiler and debugging in SAP, then each section. Variables and Code Flow Analysis each have a button
  (&#10530;) that takes the whole window; Esc gives it back.
- **Log.** A section of its own; it lists every step of the Visual runs:
  what was done (F5, F6, F7, F8 and to which points), from where, to where, and
  how long it took, SAP's share apart. A filter narrows it, **Copy** takes it as text. It is kept
  like the flow, the last 5000 steps. A line under the buttons says, at each step, what the run
  knew and decided - the map, the statement, the step.
- **Values in the source.** At a stop, the mouse on a name in the source shows its value - a
  field, a component such as `ls_new-price`, a structure's fields, or a table's row count and
  first rows.
- **Tables in grids.** A click on a table opens its rows below the source, a hundred at a time,
  in a tab of its own - as many tables as you like, read again at every stop.
- **Run in SAP** (first in the header, with the SAP execute clock) starts the program in WebGUI, as `debug_run` does. A program runs itself. For a class
  or a function module, name the program that calls it in the field - or leave it empty for the
  object's test screen, SE24 or SE37 with the name filled in, and start the test there with F8.
- **Run SAP in web GUI** in a SAP program, class or function module editor's context menu opens the program or the object's test screen directly. No breakpoint is needed; a class or function module test starts with F8 in WebGUI.
- **Run with ABAP Transpiler** (beside Run in SAP, for a program, a class or a function module) runs the SAP program on
  your machine instead - or, for a class, the method the cursor stands in, in the tab of the class's source; or the
  function module: the panel asks the parameters, with their DEFAULTs, as for a local one (see
  [Local ABAP execution](https://github.com/ysichov/VERTEX/blob/main/vscode/docs/local-execution.md)). A customer function module the code calls brings its whole function
  group - main program, includes and every module - and a step goes into the module's VERTEX tab; the group's other
  includes open as copies, having no tab of their own. It reads
  selection texts and text symbols for a SAP program's selection screen from ADT, so its controls carry the labels maintained in SAP.
  the program's active version, its includes and the customer classes and interfaces the run can reach from where it
  starts - those the reached methods and routines name, and the attributes they use, with their local definitions and
  implementations, not their test classes - into a temporary folder. A class nothing reached names is not read, and a
  method nothing reaches keeps its lines but not its body: its first line fails if the run gets there after all (a
  dynamic call, say), naming it as not transpiled. Through SAP's ADT extension only the system's own namespaces - those
  with a root package - are customer code; the rest, like standard SAP, is left to the transpiler. The panel then turns
  to VERTEX Smart Debugger (transpiler) on them (see [Local ABAP execution](https://github.com/ysichov/VERTEX/blob/main/vscode/docs/local-execution.md)); SELECTs still read SAP. The dictionary types the code
  uses - tables and structures, data elements, domains and table types, and what they are built of - are read from
  SAP's DD tables too. A step into an include stands in the include, as in SAP, and a breakpoint can be set there. An
  open tab of the program with changes not activated stops it. So does anything that cannot be read, a dictionary type
  whose definition names one the dictionary does not have, an `INCLUDE` sharing its line with another statement, and a
  function module parameter whose DEFAULT is no literal: the reason names the object. Standalone one-line `FORMAT`
  statements are omitted from the transpiler copy because they only style classic list output; their SAP source and
  line numbers remain intact. Other statements the transpiler cannot run stop at their line. A name the dictionary does not have
  either is left to the transpiler, which names what it cannot resolve.
  SAP's own classes the code uses - `CX_SY_*`, `CL_ABAP_CHAR_UTILITIES`, RTTI and the rest of open-abap-core,
  bundled with VERTEX - run with it; they are not recorded and a step does not go into them.
  As SAP runs a program's load and not its text, a run takes the last build of the object - what was read and
  transpiled - without asking SAP again; **Recompile** beside the Run button reads the object and what it uses again
  and transpiles it, and its tooltip says when the current build was read. A method or a function module is
  transpiled again at each run, as the program that calls it carries the values given, but is not read again.
  The run works on those copies, but you stay in the SAP tabs: a step opens and marks the program, include or class
  in its VERTEX tab, F5-F8 there step the run, and a breakpoint set in a tab stops the run - the same breakpoint is
  set in SAP for Run in SAP too.
- **Detach** lets the program go and stops listening, but keeps the breakpoints in the list:
  **Run in SAP** sets them in SAP again and listens before it starts the next run.
- **Exit program** ends the stopped program where it stands, as the debugger's Exit does; the
  breakpoints stay and the next run is caught again.
- A breakpoint can be switched off without losing it: Ctrl+click on its dot, **Deactivate** in its
  right-click box, its checkbox in Breakpoints, or **Deactivate all**. It keeps its line,
  condition and mode, shows as a grey ring, and is not in SAP until it is activated again.
- **Clear all**, in the Breakpoints bar, removes every breakpoint - the assistant's as well, since
  they are the same. The assistant's `debug_stop` still lets go and removes them all at once.

Because the session is shared, a step or `debug_stop` by the assistant moves this window too, and the
other way round. The assistant still finds each stop through `debug_wait`, whoever stepped. Like
the assistant, the window never changes a variable or the code.

This is a pilot: Smart Debugger's history (stepping back), coverage and diagrams are not part of
it. The Eclipse plugin shows the same page over ADT's own debug session; it is in testing there.

## The tools

| Tool | Does |
|---|---|
| `debug_set_breakpoint` | object type, name, line, optional condition, mode `stop` or `log`; starts the listener |
| `debug_clear_breakpoints` | removes one breakpoint by id, or all |
| `debug_run` | opens a report in WebGUI in your browser |
| `debug_wait` | waits up to 280 s (60 by default) for a stop or the end of the run; returns the stop, what log breakpoints recorded, and runs that ended |
| `debug_read` | reads one variable at the current stop |
| `debug_step` | `over`, `into`, `out`, or `continue` to the next stop breakpoint |
| `debug_status` | system, listener, current stop, breakpoints with ids, and what the answers have cost |
| `debug_log` | everything log breakpoints recorded in this session |
| `debug_stop` | lets a stopped program run on, stops listening, removes every breakpoint |

Closing the VS Code window does what `debug_stop` does, so no breakpoint and no listener is
left behind on SAP.

## What it costs

Every tool answer stays in the assistant's context for the rest of the conversation, so the
answers are kept short: changes rather than the whole state, tables as a count and a few rows,
one answer cut at 60,000 characters with a note saying so. A condition instead of stepping is
the largest saving: on Z_CALC, two conditional stops took a dozen SAP requests and under a
second, where stepping through every line took 451 requests and 26 seconds. `debug_status`
reports how many characters the debugger has returned so far, and about how many tokens that
is; the assistant's own total is shown by the assistant (in the VERTEX chat, under each
answer).

A chat request that may use SAP tools waits up to ten minutes for its answer, so that a
debugging run has time for a WebGUI logon and the program's way to its breakpoints.

## A session, as it goes

1. You: *Z_CALC computes the wrong discount. Find out why with the debugger.*
2. The assistant reads Z_CALC, sets a log breakpoint in the loop and a stop breakpoint with a
   condition where the discount is computed, and calls `debug_run`.
3. You log on in the browser if asked; the report runs.
4. `debug_wait` brings back the logged passes and the stop: the running total goes 600, 900,
   1600 while the customer changes from CUST_A to CUST_B.
5. The assistant reads what it needs, calls `debug_stop`, and answers: the total is never reset
   when the customer changes (the line), so CUST_B's discount is computed from 1600 instead
   of 700 (the values).
