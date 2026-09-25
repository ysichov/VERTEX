# Visual Debug in Eclipse: an assessment

Status as of 2026-09-25: **not built, not prototyped.** This note records what the VS Code
Visual Debug depends on, what the Eclipse plugin offers today, and the ways to bring the
feature over. The Eclipse side has not been checked in a running Eclipse, and every
statement about the ADT debugger's Java API below is an assumption until someone looks.

## What Visual Debug needs from its host

The page (`vscode/pages/visual-debug.html`) does no SAP work itself. It calls one host
capability, `sdeDebug(command, args)`, and receives debugger events through
`sdeDebugEvent`. In VS Code, `tools-window.js` (`debugCommand`) routes these calls to
`vscode/debugger.js`:

| Command | What it does | ADT underneath |
|---|---|---|
| `picture` | state: listening, stopped frames, breakpoints | cached from the last stop |
| `set` / `clear` | user breakpoints | `debuggerSetBreakpoints` (external scope) |
| `step` | F5 / F6 / F7 / F8, with `quick` and a predicted line | `debuggerStep`, `debuggerStackTrace` skipped when predicted |
| `runTo` | temporary points in the stopped session, then continue | `debuggerSetBreakpoints` (**debugger** scope) + `stepContinue` |
| `settle` | read the real stack after predicted steps | `debuggerStackTrace` |
| `scopes` / `children` / `vars` / `rows` | variables and table rows | `debuggerVariables`, `debuggerChildVariables` |
| `frame` | switch the stack level | `debuggerGoToStack` |
| `source` / `methods` | source of a frame, class method lines | ADT GET, `classComponents` |
| `run` | start the program in WebGUI | browser |
| `stop` / `terminate` | let go / end the program | `debuggerStep(terminateDebuggee)`, listener removed |
| `statements` | ACE statement map | GET `/sap/bc/adt/vertex/flow/<prog>?mode=statements` |

`debugger.js` runs its own stateful ADT session through `abap-adt-api`. It registers a
listener for the user, attaches to the debuggee and sends POST requests. The session is
shared with the assistant's `debug_*` tools, and it lives as long as VS Code does.

## What the Eclipse plugin offers today

- **`eclipse/bridge.js` is one-shot.** `AssistantBridge.java` starts Node for one request.
  The process exits after writing its `RESULT`, and nothing in it lives across stops.
- **SAP credentials never enter Node.** Node asks Eclipse for resources (`READ`, `OPEN`),
  and Eclipse serves them over its own ADT connection. That is a stated rule of the
  bridge ("SAP credentials never enter this process"), and it covers GETs only.
- **Host functions are SWT `BrowserFunction`s** registered by the views (`sdeTake`,
  `sdeLoad`, `sdeFlow`, …). `tools.html` already hides Visual Debug when `sdeDebug` is
  missing, so today Eclipse simply does not show it.
- **No debug bundles.** `MANIFEST.MF` requires `org.eclipse.ui`, `com.sap.adt.communication`,
  `com.sap.adt.project`, `com.sap.adt.tools.core.*` and others, but not
  `org.eclipse.debug.core` or any `com.sap.adt.debugger*` bundle.
- **One debugger per user.** SAP gives each stop to a single listener. The VS Code
  README already tells users to close an Eclipse debug session before the assistant
  debugs. A second listener in Eclipse would compete with the ADT debugger, the one users
  actually work in there.

## Options

### A. Port the engine as it is (Node `debugger.js` behind the bridge)

This needs three changes:
- a long-lived bridge process instead of one-shot;
- the debugger's POSTs and stateful session carried through Eclipse's ADT connection
  (`com.sap.adt.communication`), or credentials handed to Node, which breaks the bridge's
  rule;
- coexistence with Eclipse's own ADT debugger.

**Not recommended.** It fights the platform twice, over credentials and over the one
listener per user. It would also give Eclipse users a second debugger beside the one they
already use.

### B. Drive Eclipse's own ADT debugger through the platform debug API

A Java `sdeDebug` in `ToolsView` answers the page's commands from the Eclipse debug model,
which ADT's debugger is expected to implement:

| Page command | Eclipse API (to be confirmed against ADT's implementation) |
|---|---|
| events, `picture` | `DebugPlugin.addDebugEventListener` (SUSPEND / RESUME / TERMINATE), `IThread.getStackFrames()` |
| `step` into/over/return/continue | `IStep.stepInto/stepOver/stepReturn`, `ISuspendResume.resume` |
| `runTo` | `IRunToLine`, or temporary line breakpoints through `IBreakpointManager` |
| `scopes` / `children` | `IStackFrame.getVariables()`, `IVariable.getValue().getVariables()` |
| `set` / `clear` | ADT line breakpoints through `IBreakpointManager` |
| `terminate` / `stop` | `ITerminate.terminate`, `IDisconnect` |
| `source`, `statements` | existing ADT GETs, as `READ` does now |

What carries over unchanged: the page, the statement map (`statements` is a GET), Flow's
call-to-call logic, the chart, Rec, the player, the stack table and the values at a
routine's start and end.

What does not carry over, or is unknown:
- **Prediction (`quick` steps, no stack read).** Eclipse's debugger reads the stack and
  refreshes its own views at every suspend. The VS Code saving of about 190 ms a step
  probably does not exist there, and a step may be slower. Measure before promising
  anything.
- **Frame fields.** The page wants program, include, event type, event and an ADT URI per
  frame. `IStackFrame` gives a name and a line number. Whether ADT's frame class or an
  adapter exposes the rest has to be looked up in the `com.sap.adt.debugger*` bundles.
  Parsing it out of the frame's label would be text parsing, and project rules rule that
  out.
- **Temporary points.** VS Code sets them in the debugger scope of the stopped session.
  Whether `IRunToLine` or ADT's breakpoints can do the same for several lines at once is
  unknown.
- **Variable reads.** `IVariable` values are lazy and may be cached by Eclipse's views.
  Their cost per read is unknown.
- **Z only / stepping out of standard code** depends on the frame's program name, the
  same open question as the frame fields.

Rough size (unverified): a Java host class of several hundred lines, the debug bundles in
`MANIFEST.MF`, and small page changes. The page needs a host flag for "no prediction", and
buttons the host cannot back have to be hidden.

### C. Flow only, on top of the Eclipse debugger

The user debugs in Eclipse as usual. VERTEX only listens:
- on each SUSPEND it records the stack, the line and, at a routine's start or end, the
  parameters and locals;
- the chart, Rec and the player run from that record.

Eclipse already shows the source, variables and stack, so the page would show only the
chart and the player. Continue-as-a-run (Flow's own stepping) could come later, from the
same stepping API as in B.

This is the smallest piece that is useful, and it does not compete with the Eclipse
debugger because it is the Eclipse debugger. It has the same unknown about frame fields
as B.

## Recommended next step

A spike before any decision, in a running Eclipse with ADT:

1. List the `com.sap.adt.debugger*` bundles and their exported packages. Find the stack
   frame class and whether it carries program, include, event and URI.
2. A throwaway listener that logs each SUSPEND's frames and the time from `stepInto` to
   SUSPEND. That gives the real step cost against VS Code's roughly 190 ms SAP step plus
   260 ms stack read.
3. Try `IRunToLine` or temporary breakpoints on two lines at once.

The spike's results decide between B and C. A stays off the table unless the credential
rule changes.
