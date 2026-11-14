# VERTEX demo — speaker script

Slide numbers follow the Session 1 deck (v3). For each slide: intro, then the clip with times from the start of that clip, then a wrap-up.

## Slide 21. VERTEX: AI-Powered ABAP Plugins for VS Code & Eclipse

**Intro:** Hi, I'm Yurii Sychov, ABAP developer, and I love building tools for ABAP. For about seven years I built them as open-source tools for SAP GUI: a data explorer, a code explorer, a version explorer, Smart Debugger and an AI assistant. Now all of them are collected in one place — VERTEX Tools.

**Transition:** Let me introduce most of them in a short guided demo with video. Here is what we'll see.

## Slide 22. Overview

**Intro:** First I'll show how to install VERTEX and connect it to SAP and to an LLM. Then a few use cases: an alternative to classic debugging, code insight on a big real class, and a transport review with AI.

## Slide 23. Install and set up VERTEX

**Intro:** There is also a version for Eclipse ADT, with its own update site — the link is on the slide. It is out of scope today, but about ninety percent of the features are the same. Today we use VS Code.

*Clip: 01_install_setup.mp4 — 2:00.*

### Installing VERTEX from the Marketplace
| Time | Topic | Text |
|---|---|---|
| 0:00–0:11 | Prepare the editor | I recommend using VERTEX together with ABAP Syntax Highlighting, which makes ABAP source easier to read. |
| 0:11–0:18 | Optional assistants | The Claude Code and Codex extensions are optional: VERTEX can also use their own command-line tools. |
| 0:18–0:32 | Install VERTEX | In Extensions, I search for SAP ABAP VERTEX and install it. |

### VERTEX setup after installation
| Time | Topic | Text |
|---|---|---|
| 0:32–0:42 | Open VERTEX SAP Tools | After installation, VERTEX appears in the activity bar. I open VERTEX SAP Tools to make the initial configuration. |
| 0:42–1:00 | Import an SAP system | With the SAP Systems icon, I import the systems already configured in SAP Logon or Eclipse. I choose No Eclipse workspace, so VERTEX finds the systems automatically. I select E19 and enter the client and user. |
| 1:00–1:07 | Check the system | E19 is added with its client and user. It uses a password, so SNC stays off. |
| 1:07–1:22 | Save the password and connect | I save the password, so VERTEX can use it from now on. It checks the connection, and we see that it is working. |
| 1:22–1:51 | Connect an AI assistant | In LLM Providers, I choose the assistants to use. Claude Code and Codex can run through their VS Code extension or their own command-line tool. I pick the route available on this machine, select the models, and save. |
| 1:51–2:00 | Select the provider | The active provider and model can be switched in the VERTEX panel at any time. |

**Wrap-up (after the clip):** VERTEX is installed, connected to SAP and to an AI model. Now let's use it on a real problem.

## Slide 24. An alternative to classic debugging

**Intro:** Next, an alternative to classic debugging. We take a small test program, run its scenarios, and find out what goes wrong — with VERTEX views and the AI, without stepping through the debugger line by line.

*Clip: 02_debugging_v4.mp4 — 15:29.*

### Introduction to the test program
| Time | Topic | Text |
|---|---|---|
| 0:00–0:28 | Find objects with VERTEX Tools | There are two ways to find SAP objects. The VERTEX Tools button opens an object search: choose the object type, such as a class, program or package, and enter a name or a mask. Here we look for the Z_DEBUGGER_TEST package. |
| 0:28–0:40 | Or ask in the chat | Or type a name, or part of one, in the VERTEX chat. It searches the system directly, without tokens, and opens what it finds. |
| 0:40–1:09 | Open the test program | Let’s look inside the package: we have twelve classes and other objects. We’ll test this program, ZVERTEX_DEBUG_LAB, so I open it. |
| 1:09–1:23 | The entry program | Here is ZVERTEX_DEBUG_LAB. Its code is short: it offers five test scenarios, passes the selected one to a calculation class, and writes the returned amount and currency. |
| 1:23–1:40 | Run it in SAP | What happens inside, we don’t know yet. So we open VERTEX Smart Debugger from the context menu and run the program in SAP. The selection screen lists the five scenarios. |
| 1:40–1:54 | CLEAN | We start with CLEAN, the baseline: about eleven thousand three hundred euros. |
| 1:54–2:02 | PRECISION | PRECISION returns zero. |
| 2:02–2:11 | STATE | STATE returns zero too. That looks like an error somewhere in the calculation. |
| 2:11–2:21 | PIPELINE | PIPELINE returns an amount, but it differs somehow. |
| 2:21–2:29 | MULTI | MULTI differs too. |
| 2:29–2:40 | What to investigate | Zero in two scenarios, different amounts in two others. These are the questions we’ll investigate. |

### Calls diagram and selects
| Time | Topic | Text |
|---|---|---|
| 2:40–3:16 | A feature for analysing code | Now a feature for checking table data while you browse the code: you can run a SELECT right from the source. Let’s find one in the calculation classes. |
| 3:16–3:41 | Run Select | Run Select shows the result next to the code: the selected columns and the fields from its conditions. No need to leave the editor. |
| 3:41–3:58 | Open the Calls diagram | Another feature is the Calls diagram: a map of the program’s calls, built from the source without running it. We open it for the entry program. |
| 3:58–4:14 | The first calls | Depth sets how many levels of calls we see. At depth two, the program’s start event calls RUN in the calculation facade. |
| 4:14–4:40 | Add depth, change direction | At depth three, RUN calls a data provider, a pricing factory, a configuration repository, a log and a modifier interface. We also switch the layout from top-down to left-right. |
| 4:40–5:03 | The whole map | At depth four, behind the modifier interface we find five modifiers: fuel, customs, hazard, discount and tax. The map shows what the code can call; what actually runs, we’ll see later in the debugger. |
| 5:03–5:18 | Navigate from the diagram | Click a method, and its code opens next to the map: here the customs modifier, then the log. |
| 5:18–5:30 | A map before running | So this view can help us understand the program better. |

### Code Flow Analysis before running
| Time | Topic | Text |
|---|---|---|
| 5:30–5:46 | Open the debugger | Now a different question: where does the final amount come from? We open VERTEX Smart Debugger. |
| 5:46–6:02 | Choose the value | Even before the program runs, Variables shows the declared fields. We follow LS_RESULT-AMOUNT; breakpoints mark the start and the end of the calculation. |
| 6:02–6:58 | Code Flow Analysis | Code Flow Analysis follows the value through the code without running it: classes, then methods, then every statement. Click an item, and its code opens next to the tree. The classic debugger shows only the line you are on; here, before you even press Run, you see every place in the code that can change the value. No more stepping through fifty methods to find the few that matter. |
| 6:58–7:14 | Diagram and BSE | The same flow as a diagram. BSE, Backward Symbolic Execution, keeps only the code that really affects our amount. |
| 7:14–7:50 | Derivation | Derivation looks at the amount from the data side: all the pieces of the puzzle — which fields and tables it comes from, and through which assignments. Click a branch, and its source opens on the left. |
| 7:50–8:14 | Formula | Formula writes the whole calculation out, and below, where each input comes from. All of this is from the source only — which branches really run, we'll see after a run in SAP. |

### SAP recording
| Time | Topic | Text |
|---|---|---|
| 8:14–8:30 | Run in SAP | We run the program in SAP with the baseline scenario, CLEAN. It stops at the first breakpoint; we switch on Steps & values and continue. |
| 8:30–9:12 | Follow the recording | The run is being recorded step by step, with its values. As you can see, it is not fast: debugging SAP over the web from VS Code is quite slow. In Eclipse the same recording is noticeably faster. And the fastest option is the ABAP transpiler, which runs the code locally — I'll show it a bit later. |

### Formula with recorded values
| Time | Topic | Text |
|---|---|---|
| 9:12–9:40 | Formula with values | Now every input of the formula has its value from this run. Optimized shows only what can define the amount. |
| 9:40–10:00 | Something odd | Recorded shows the path this run really took: the result is eleven thousand three hundred and two, as expected for CLEAN. But one value is red: the discount uses the tax amount, zero, before the tax step has set it. |

### AI-assisted diagnosis
| Time | Topic | Text |
|---|---|---|
| 10:00–10:24 | Ask the AI | Let's ask the AI: please find a bug using the debug history. It gets the recording itself — steps and values — not just the source. |
| 10:24–10:54 | The diagnosis | The answer: this run calculated the amount correctly, but the history shows one real defect. The discount step reads the tax amount before the tax step has set it. The AI checked every red value in the formula: the others are false alarms, this one is the bug. |
| 10:54–11:20 | Check the evidence | Every claim links to a recorded step. One click, and the player jumps there: the discount class, step 113, with the tax amount still zero. |
| 11:20–11:56 | Check the other scenarios | Now the other four scenarios. Recording each one in SAP would take a while, so I ask the AI to run them in the transpiler and briefly describe the bugs. |
| 11:56–12:50 | The transpiler at work | Here is the transpiler I promised. The AI runs all four scenarios locally, with no SAP round trips, and then reads their recorded histories. Four runs take less time than one recording in SAP. |
| 12:50–13:18 | Four scenarios, four stories | PRECISION and STATE return zero: the shipment is not found, and nobody checks it. PIPELINE charges VAT before the discount — about one hundred thirty-six euros too much. MULTI has two bugs together, about a thousand euros too much. |
| 13:18–14:10 | Check the evidence | Each finding links to a step of its run. One click, and the replay opens there: the pricing class, the discount, the fuel rate, the tax step — with the values. So we can check the AI instead of just trusting it. |
| 14:10–14:26 | Fixes | And at the end, a short list of fixes: check sy-subrc, round money and not rates, and calculate VAT from the discounted amount. |

### Logs
| Time | Topic | Text |
|---|---|---|
| 14:26–14:56 | Debug recordings | Everything is logged. Every debug run is saved — open it later, look at it yourself or ask the assistant. |
| 14:56–15:29 | Assistant logs | And so is the assistant: every conversation, what it got and which tools it called. |

**Wrap-up (after the clip):** So we found the cause from the calls, the formula and the recorded run, without stepping through the debugger once.

## Slide 25. Metrics, logic and path to line

**Intro:** Beyond one program, VERTEX helps to assess and refactor large code. Metrics show where the complexity is, the logic diagram shows a method's branches, and Path to line shows which conditions lead to a given line.

*Clip: 03_path_metrics_logic.mp4 — 2:55.*

### Metrics, logic diagram and Path to line
| Time | Topic | Text |
|---|---|---|
| 0:00–0:15 | Open a big class | Now a real class from Version Explorer: ZCL_AVE_POPUP. I type its name in the chat, and VERTEX opens it. |
| 0:15–0:30 | Metrics | From VERTEX Tools I open Metrics. In seconds: ninety-one methods, about four thousand six hundred lines, and for each method its complexity and other metrics. |
| 0:30–0:45 | What the numbers mean | If a metric is unfamiliar, the question mark explains each one: what it counts and how to read it. |
| 0:45–1:00 | Find the hot spot | I sort by complexity and switch to the visual view: the bigger and redder the tile, the more complex the method. One stands out: ON_TOOLBAR_CLICK — two hundred sixty-four lines, complexity fifty-three. |
| 1:00–1:30 | Logic view | Let's look inside. From the context menu I open the Logic view. It keeps only the control flow — CASE, IF, LOOP, RETURN — and hides the rest. Depth opens it level by level. |
| 1:30–2:00 | The diagram | Now as a diagram. Depth two… six. What a wonderful spaghetti of AI-generated code — and that is just one method. Here we see all its branches at once. |
| 2:00–2:10 | Path to line | Now a concrete question: how can we get to this line — to catch a breakpoint, for example? On line 2648 I choose Path to line. |
| 2:10–2:30 | Read the path | VERTEX shows every condition on the way: which WHEN branch must be taken, which IFs must be true or false, and which RETURNs must not be reached before it. |
| 2:30–2:55 | Other lines | Another line, another path. For any line we see what must happen to get there — which scenario to prepare to hit a breakpoint, or why a line never runs. |

**Wrap-up (after the clip):** One program is easy. Metrics, the logic diagram and Path to line help when the code is big and someone else wrote it — or an AI did.

## Slide 26. Review a transport

**Intro:** Finally, the review. We open a transport, see what it changes, ask the AI what the changes are for and whether they contain bugs, and give each changed block a verdict.

*Clip: 04_review_new.mp4 — 2:28.*

### Code review with AI
| Time | Topic | Text |
|---|---|---|
| 0:00–0:12 | Open the transport | In the object search I choose Transport request, enter its number and switch to Review. |
| 0:12–0:24 | What the request changes | We see who changed what: one developer, four classes, nine changed blocks. The review is saved in SAP. |
| 0:24–0:36 | Look at the diffs | Click a method, and we see its diff: the old version against the active one. |
| 0:36–0:44 | Review by developer | Or click the developer: all their blocks in one list, with filters. |
| 0:44–1:16 | Ask about the purpose | Now the AI. In the chat I ask: what is the business purpose of these changes, briefly? The answer: interfaces now show up correctly in the transport review, with their own author, tasks and dates. |
| 1:16–2:00 | Ask about bugs | Next question: do we have bugs here? This code was generated by Codex; now Claude Opus reviews it — and finds a real bug: interface names of thirty characters are not recognised. Plus two risks: the same logic is copied four times, and one path was not checked. It even suggests a fix. |
| 2:00–2:20 | Give a verdict | Now the reviewer decides. Each block can be approved, declined or just commented; a decline always needs a comment. I decline the first block and write why. |
| 2:20–2:28 | Close | The verdict and the comment are saved, and the developer sees them. |

**Wrap-up (after the clip):** So the review adds the last step: understand the code, investigate its execution, and check the changes before they go further.

## Slide 27. Key Takeaways

**Intro:** To sum up, five things to take away. *(The cards appear one by one — one line per click.)*

| Click | Card | Text |
|---|---|---|
| 1 | UNDERSTAND | First, understand before you debug. Calls, FLOW and Formula show how a value is built, without stepping through the code line by line. |
| 2 | EVIDENCE | Second, evidence instead of guesses. The AI reads the recorded SAP run, so its answer is based on real values from the system. |
| 3 | BIG PICTURE | Third, the big picture. Metrics show where the complexity is, the logic diagram shows the branches, and Path to line shows how you reach a specific line — even in a wonderful spaghetti. |
| 4 | REVIEW | Fourth, review before release. You see what a transport changes, ask the AI about its purpose and possible bugs, and approve or decline each block with a comment. |
| 5 | Banner | And the most important one: don't be afraid to build the plugins you really need. Use AI to vibe-code them — VERTEX itself was built this way. |

## Questions & Answers

**Intro:** Thank you. I'm happy to take your questions.

## Slide 28. Thank you!

**Intro:** All links are on the slide: the repository, the Marketplace page, the Eclipse update site and the demo source. Thank you!
