# Local ABAP execution

Open an ordinary `.abap` file containing `REPORT` or `PROGRAM`; without a custom transpiler configuration, VERTEX supplies the required abapGit program suffix in a temporary copy and keeps trace links on your original file. **Run with ABAP Transpiler** from the local analysis panel opens the separate program window with its selection screen and output.

For calculation code that can run without SAP services, use the transpiler and
runtime bundled with VERTEX. Open a saved local `.abap` file and choose
**VERTEX Smart Debugger** in the editor's context menu; its **Run with ABAP Transpiler** runs it - the selection
screen first, then to the first breakpoint, or to the end with the output when there is none. From the Command
Palette, **VERTEX: Run with ABAP Transpiler** runs a local file at once. An SAP program, or the method of an SAP
class the cursor stands in, runs the same way from **Run with ABAP Transpiler** beside Run in SAP in its VERTEX
Smart Debugger panel, which reads it, its includes and the classes and interfaces it uses from SAP first. The panel is shared with SAP runs;
for local files its title is **VERTEX Smart Debugger (transpiler)** and its Run button is **Run with ABAP Transpiler**. Run
asks the selection screen in a window of its own, laid out as SAP lays out screen 1000: blocks with their frame and
title, lines of several elements, comments, SKIP and ULINE; radio buttons, checkboxes and value fields with their
DEFAULT (a value is upper-cased as SAP does unless LOWER CASE, and its LENGTH holds); SELECT-OPTIONS as rows of sign,
option, low and high, with + row unless NO-EXTENSION and without high under NO INTERVALS. Each element is named by
its selection text - from the abapGit text pool beside a local file, from SAP for an SAP program; if SAP's texts cannot
be read the window says so and shows the technical names. A field marked OBLIGATORY must be filled before Execute (F8)
runs. A pushbutton, a tabbed block or a function key is named in the window as not drawn, and another screen
(BEGIN OF SCREEN) is not asked.

**A program runs in a window of its own, as SAP GUI shows a report.** VERTEX: Run with ABAP Transpiler on a program
opens it in an editor tab, in the colours of the VS Code theme: a title bar, a toolbar, the selection screen, and a
status bar. **Execute (F8)** runs it and shows the list it wrote; **Back (F3)** returns to the screen with the values
given, to run again. A program without a selection screen runs at once. A local file is transpiled again only when a
source of its folder changed - an edit, a new file, a removed one; otherwise the last build runs at once. Each run is recorded, and VERTEX Smart Debugger always shows the latest one -
without an Output of its own, as the list is in the window: **See flow history**
brings it to the front - its steps, values and flow - and a run that reaches a breakpoint opens it there by
itself, to step on - the source it follows opens beside the window, which stays in sight; Run in that VERTEX Smart Debugger
brings the window to the front again. A transpiler run has no session
to leave, so its panel has no Detach: Exit program ends a stopped run. For an SAP program the toolbar has **Recompile** too. A method or a function module opens the same window on the
screen of its parameters, with its variants; its results follow the list - a value as a line, a structure as a tree
and a table as a grid, both opening and closing (in VERTEX Smart Debugger's Output, as indented text). The panel counts the breakpoints of its own object and the sources it uses - a point in another object's file
neither shows nor stops it, and Clear all leaves it; **All BP** in the Breakpoints header counts every ABAP breakpoint
in VS Code instead. Opened by Run with ABAP Transpiler and with none of those set, the panel is a run: the Run button and the
Output, nothing else; set a breakpoint and it is the debugger, and back when the last one is removed. A transpiler run
always records every step with its values: it is fast enough that there is no record switch. Beside the routine's
variables a step shows **SY** - the fields the run has set (SY-SUBRC, SY-TABIX, SY-INDEX, SY-DBCNT, SY-FDPOS) - and
**SQL**, each SELECT the statement before it ran with the rows it brought or why it failed. A run that fails says
where in the ABAP: the error, then the object and line it happened on and each call that led there; Node's own text
is in the VERTEX Local ABAP channel. A run stays alive while
the panel is closed: opened again, the panel shows it as it stands - the steps, where it stopped, the output - and
**Clear** starts a new one.

For an SAP object, the saved build includes the source and the SAP Dictionary definitions it used. Opening the same successful build can reuse that snapshot. **Recompile** reads the sources and dictionary again, including changes made in SAP by someone else; a failed build also requires a fresh read before the next attempt. When the snapshot format changes, each older build is refreshed when its object is next opened. Other saved objects are not compiled in advance.

**A method or a function module runs too.** With the cursor inside a method of a local class
(`zcl_x.clas.abap`) or inside a function module of a local function group (`zfg.fugr.z_fm.abap`, abapGit
layout), the panel's screen is the call's: the constructor's importing parameters for an instance method, then
the importing, changing and tables parameters - a field for a simple type (its DEFAULT shown), the fields of a
structure, and a grid for a table with **+ row** and × per row. An optional parameter left empty is not passed.
**Variant** keeps named sets of the values in VS Code, per method or module: Save, pick, Delete. Execute writes a
small ABAP program that sets the values and calls the method (`NEW zcl_x( ... )->m( ... )`, `zcl_x=>m( ... )`)
or the module (`CALL FUNCTION`), and runs it as any program: breakpoints, steps, the record. That program lives in a
temporary folder, is written again for every run, and is not recorded - the run starts in the method or module
itself. The exporting, changing and returning results are written to Output: a simple value, a structure field by
field, a table as a table - a heading of its columns and a line per row, each column as wide as its type. A function module's file is recognised by its abapGit name, `<group>.fugr.<module>.abap`.
Any method runs, whatever its visibility: the transpiler does not check it, so a private or protected method is
called as a public one would be (SAP itself would refuse that call). A method of an interface the class
implements (`METHOD zif_x~m`) is called through the interface. A `TYPE REF TO` parameter has a
class-variables button in place of a text field; it opens a read-only view of the class's declared
variables. A required class reference is initialized for the standalone call, and its values appear
in Variables. A parameter of a type with no name or one not among the local sources, a table inside a structure, and a project with its own `abap_transpile.json` are refused with the
reason; nothing else is run in their place. Opened by Visual
Analysis / Debug it is always the whole panel, for analysis with no run at all. A SELECT that fails says why in the
Output and the VERTEX Local ABAP channel instead of reading as an empty result. VERTEX
instruments generated program and class modules: the program pauses before each
mapped statement, and its line and changed variables are recorded. Run stops at the
first breakpoint; Single Step, Execute, Return and Continue (F5-F8, in the panel or
the editor) run the program on to the next stop, and the history slider replays what
was recorded so far. The **Output** section shows what the program wrote with `WRITE` up to where it stands. Some
ABAP constructs still need broader instrumentation.
Breakpoints on standalone declarations such as `DATA x TYPE i` are removed because
they are not calculation steps; an inline declaration such as `DATA(x) = ...` is a
statement and stops.

VERTEX creates a temporary transpiler config for the selected ABAP file, its
statically referenced global classes and interfaces, classes reached by VERTEX's
call graph, and matching table XML metadata. Standard DDIC data elements and domains
come from the bundled `open-abap-core` subset. The resolved class list appears in the
VERTEX Local ABAP output channel before transpilation.
Unrelated files in a large `src` folder do not block a simple report. For
dynamically named classes or additional DDIC types, provide an
`abap_transpile.json` in the project; it takes precedence. A custom configuration
can look like this:

```json
{"input_folder":"src","input_filter":[],"output_folder":"output","write_unit_tests":true,"write_source_map":true}
```

Put report sources under `src/`, for example `zcalc.prog.abap`. For ABAP Unit,
the project must have test classes that the transpiler can discover. The separate
**VERTEX: Run Local ABAP** and **VERTEX: Debug Local ABAP** Command Palette entries
also work; the Debug command opens VERTEX Smart Debugger (transpiler). Both use a temporary
configuration when the project has none.
The VERTEX Local ABAP output channel shows transpiler diagnostics. Automatic projects
send Open SQL SELECT to the configured SAP system through the same ADT data preview
used by SelecTor; data remains in SAP. Load test data in SAP if a calculation
depends on table rows. SQL writes and SAP service dependencies
still need local implementations or an SAP system. Projects
that install their own transpiler CLI use that version; VERTEX supplies its runtime
to generated output when the project has none. No project npm install is required
for basic local runs.

**Run SELECT** also works manually in a local `.abap` editor: put the cursor on
the SELECT and invoke the command from the editor menu or Command Palette. It
runs directly in the selected SAP system without transpiling or running the
report. The result window shows any conditions omitted because they depend on
program variables. A small standalone calculation example is
[`examples/zvertex_fibonacci.prog.abap`](https://github.com/ysichov/VERTEX/blob/main/vscode/examples/zvertex_fibonacci.prog.abap).

**Idea for use: ABAP Unit in CI.** A GitHub Actions workflow can run the same
transpiler pipeline on every push for tests independent of SAP: `npm ci`,
`abap_transpile`, then `node output/index.mjs`. Unlike interactive VERTEX, the
CI runner needs its own npm dependencies and `abap_transpile.json`; see
[open-abap-core's test scripts](https://github.com/open-abap/open-abap-core/blob/main/package.json).
Tests requiring SAP services need local substitutes or a SAP-backed job.

For the built-in VERTEX Assistant, choose Claude Code, Codex, GitHub Copilot,
EPAM CodeMie or an API provider in **LLM Providers**. Copilot uses the models
available from a signed-in GitHub Copilot extension through VS Code; it can call
the same SAP tools as the other providers. EPAM CodeMie runs Claude Code through
the CodeMie CLI's `codemie-claude`, with the models of your CodeMie profile. API providers are Anthropic, OpenAI, Mistral,
Gemini, Groq, Cerebras, OpenRouter, NVIDIA and Vercel AI Gateway. Local models run through
LM Studio or Ollama on this computer, with no key and nothing sent off it. This is separate from Copilot
Chat's MCP setup.

**Screenshots in the chat.** Paste an image (Ctrl+V) into the VERTEX panel's message field: it
appears as a thumbnail above the field (× removes it) and goes with the next question, inside the
message. PNG, JPEG, GIF and WebP up to 5 MB each. Screenshots are sent to Claude Code, Codex (ChatGPT subscription), EPAM CodeMie and compatible API models with image input. For Vercel, the Vision capability comes from its catalog; an explicitly text-only model is blocked before inference.

**VERTEX Code Agent (alpha): local projects in any programming language.**

Claude Code uses its own file and shell tools; every other provider uses VERTEX's local tools. Working-copy review, builds after Apply and logging work with all providers. The model must support tool calls.

VERTEX's file tools stay inside the selected folder; shell commands run in PowerShell on Windows and `sh` elsewhere and ask for approval unless the working-copy setting below allows them.

When the active editor holds a file of an open workspace folder -
or no editor is open and the workspace has one folder - the assistant answers in that folder.

*A folder in git:* the assistant works in its own git working copy of the folder, made from the folder
as it is (uncommitted changes and new files included, files ignored by git left out), and your folder
is not changed while it works. When the answer is done, one VERTEX review page, **Review assistant
changes**, shows every file it changed, all of a file's edits together, laid out as a transport
review: the totals (rows +/~/-, blocks), a group per folder with a row per file (type, rows, blocks,
decision; **Expand all · Collapse all**), then each file's blocks - a row opens its file. Approve or
decline each file, then **Apply**: approved files are copied into your folder. A declined file takes
an optional reason; with one, the reasons are sent to the assistant as your next message and it reworks
the file in its copy, and the next review shows it again; without one, its change is dropped. If you
changed a file yourself meanwhile, git merges the two changes line by line (`git merge-file`) when
they do not overlap: the review then shows your file with the assistant's change merged in, marked
as merged, for you to approve - a clean merge is not a check that the result is right. When the
changes overlap the file can only be declined, so your change is never overwritten; declined with a
reason, the assistant gets your version in its copy and redoes its change on top of it. Approve and
Decline only mark a file - the status line counts what is left until **Apply** - and closing the page
with marks but without Apply asks whether to apply them; files not decided stay for the next review. Closing the
page decides nothing: the files come up again after the next answer. What you change in your folder
yourself reaches the copy before the assistant's next turn: a file it has not changed takes your version,
one whose change still waits for review gets your change merged in, and when the two overlap the request
stops and asks you to decide that review first. The copy lasts for the
conversation; **New conversation** removes it, with any change not yet applied. Builds and tests in
the copy lack ignored files (`node_modules`, build output) and can fail there.

*Building after the review.* the assistant does not build in its copy - ignored files such as `node_modules` are not there. It names the command the project builds or tests with, taken from the project's rules and build files, and after **Apply** has copied something into your folder the review offers it: **Run** runs it once, **Run & remember for this folder** stores it as `vertex.ai.buildCommand` in the folder's settings, and from then on it runs by itself after each **Apply**. VERTEX runs it in your folder (in PowerShell on Windows), shows the output in the **VERTEX Build** output channel, and when it fails sends the end of the output to the assistant as your next message, to fix in its copy.

*A folder outside git:* every file edit or write waits in the same review page before it is written;
**Allow** writes the approved files, **Deny** or closing the page refuses them all.

In both, the assistant is told to read files with its read and search tools and to change them only
with its edit tools, never through the shell. A shell command (a build, a test run) asks in a VS Code
dialog showing the command; **Allow** runs it, closing the dialog refuses it. In a git working copy
the setting `vertex.ai.shellWithoutAsking` (off by default) runs the commands without asking: file
changes they make still come to the review, but a command can reach outside the copy - an absolute
path into your folder, git commands on the shared repository, the network. While the assistant has a folder, the VERTEX panel shows it as **Folder** beside
**SAP system** (the full path on hover); the SAP system stays the one its SAP tools use. Project rules in `AGENTS.md` and `CLAUDE.md` apply. Claude Code can additionally load its personal instructions according to its settings. A SAP tab, or a file outside the workspace, works as
before, through VERTEX's SAP tools: a change goes into its editor tab unsaved, and you review it
and use Save & Activate or Review & Activate.

Every Get Started step has an **ⓘ Info** button opening its explanation: SAP
system import, connection testing, assistant choice and MCP capabilities.

The **Effort** list beside the model in the VERTEX panel sets how much the model thinks before it answers (`vertex.ai.effort`): low to max for Claude Code and EPAM CodeMie (`--effort`), minimal to high for Codex (`model_reasoning_effort`); **Effort: default** leaves the assistant's own level. API providers and GitHub Copilot have no such list.

Claude Code uses the executable bundled with its installed VS Code extension
or the native CLI from `PATH` or `~/.local/bin`. When both are found, VERTEX
asks which to use once. Change `vertex.ai.claudeSource` in Settings to switch
between them or set it to `ask` to choose again.
**LLM Providers** shows the installation in use and offers a selector when
both are available.
Restart VS Code after installing the CLI so it inherits the updated environment.
LLM Providers checks Claude availability before showing its model list, so a
missing executable is reported on opening settings, as it is for Codex.
Codex also accepts a standalone native CLI, the executable inside ChatGPT.app
on macOS, or the native executable in its global npm package through PATH.
When the CLI and `openai.chatgpt` extension are both present, VERTEX asks
which to use once. Change `vertex.ai.codexSource` in Settings to switch or
set it to `ask` to choose again. Restart VS Code after installing a CLI;
the selected installation is also shown and changeable in **LLM Providers**;
npm command wrappers are resolved to the native executable.
Windows detection also checks `%APPDATA%/npm` independently of PATH.
