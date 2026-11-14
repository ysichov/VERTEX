# VERTEX demo — speaker text

## Slide 21. VERTEX: AI-Powered ABAP Plugins for VS Code & Eclipse

Hi, I'm Yurii Sychov, an ABAP developer, and my hobby is building tools for ABAP.

For about seven years, I've been developing open-source tools for SAP GUI: code and data explorers, Smart Debugger, and an AI assistant.

Now, all these tools are brought together in one place — VERTEX Tools.

Let me introduce most of them in a short guided demo with video. 

## Slide 22. Overview

First I'll show how to install VERTEX and connect it to SAP and to an AI provider. Then a few use cases: an alternative to classic debugging, code insight on a big real class, and a transport review with AI assistant.

## Slide 23. Install and set up VERTEX

There is also a version for Eclipse ADT, with its own update site — the link is on the slide. It is out of scope today as about ninety percent of the features are the same. Today we use VS Code.

I recommend using VERTEX together with ABAP Syntax Highlighting, which makes ABAP source easier to read.

The Claude Code and Codex extensions are optional: VERTEX can also use their own command-line tools.

In Extensions, Lets find VERTEX and install it.

After installation, VERTEX appears in the activity bar. I open VERTEX panel to complete the initial configuration.

With the SAP icon, I import the systems already configured in SAP Logon or Eclipse. I choose No Eclipse workspace, so VERTEX finds the systems automatically. I select E19 and enter the client and user.

E19 is added with its client and user. It uses a password, so SNC stays off.

I save the password, so VERTEX can use it from now on. It checks the connection, and we see that it is working.

In AI Providers, I choose the assistants to use. Claude Code and Codex can run through their VS Code extension or their own command-line tool. I pick the route available on this machine, select the models, and save.

The active provider and model can be switched in the VERTEX panel at any time.

VERTEX is installed, connected to SAP and to an AI models. Now let's use it on a real problem.

## Slide 24. An alternative to classic debugging

Next, an alternative to classic debugging. We take a small test program, run its scenarios, and use VERTEX views and AI to understand the problem — without stepping through the debugger line by line.

### Introduction to the test program

There are two ways to find SAP objects. The VERTEX Tools button opens an object search: choose the object type, such as a class, program or package, and enter a name or a mask. Here we look for the Z_DEBUGGER_TEST package.

Or type a name in the VERTEX chat. It searches inside the system, without tokens, and opens what it finds.

Let’s look inside the package: we have twelve classes and other objects. We’ll test this program, ZVERTEX_DEBUG_LAB, so I open it.

Here is ZVERTEX_DEBUG_LAB. Its code is short: it offers five test scenarios, passes the selected one to a calculation class, and writes the returned amount and currency.

What happens inside, we don’t know yet. So we open VERTEX Smart Debugger from the context menu and run the program in SAP. The selection screen lists the five scenarios.

We start with the first scenario - CLEAN: We got about eleven thousand three hundred euros.

PRECISION returns zero.

STATE returns zero too. That looks like an error somewhere in the calculation.

PIPELINE returns an amount, but it differs somehow.

MULTI differs too.

Zero in two scenarios, different amounts in two others. These are the questions we’ll investigate.

### Calls diagram and selects

Now a feature for checking table data while you browse the code: you can run a SELECT right from the source. Let’s find one in the calculation classes.

Run Select shows the result next to the code: the selected columns and the fields from its conditions. No need to leave the editor.

Another feature is the Calls diagram: a map of the program’s calls, built from the source without running it. We open it for the entry program.

Depth sets how many levels of calls we see. At depth two, the program’s start event calls RUN in the calculation facade.

At depth three, RUN calls a data provider, a pricing factory, a configuration repository, a log and a modifier interface. We also can switch the layout. 

At depth four, behind the modifier interface we find five modifiers: fuel, customs, hazard, discount and tax. The map shows what the code can call; what actually runs, we’ll see later in the debugger.

Click a method, and its code opens next to the map: here the customs modifier, then the log.

So this view can help us understand the program better.

### Code Flow Analysis before running

Now a different question: where does the final amount come from? Lets open VERTEX Smart Debugger again.

Before the program runs, lets mark a variable LS_RESULT-AMOUNT to automatically analyze everything involved in its calculation. Breakpoints mark the start and the end of the calculation.

Code Flow Analysis shows how the value changes in the code without running the program. We see classes, methods, and statements. Click any item to see its code next to the tree.

In the classic debugger, we see one line at a time. Here, we can see all places that may change the value, even before running the program.

No need to go through fifty methods to find the important ones.

The same flow as a diagram. BSE, Backward Symbolic Execution, keeps only the code that really affects our amount.

Derivation looks at the amount from the data side: all the pieces of the puzzle — which fields and tables it comes from, and through which assignments. Click a branch, and its source opens on the left.

Formula writes the whole calculation out, and below, where each input comes from. All of this is from the source only — which branches really run, we'll see after a run in SAP.

### SAP recording

We run the program in SAP with the baseline scenario, CLEAN. It stops at the first breakpoint; we switch on Steps & values and continue.

The run is being recorded step by step, with its values. As you can see, it is not fast: debugging SAP over the web from VS Code is quite slow. In Eclipse the same recording is faster. And the fastest option is the ABAP transpiler, which runs the code locally — I'll show it a bit later.

### Formula with recorded values

Now every input of the formula has its value from this run. Optimized shows only what can define the amount.

Recorded shows the path this run really took: the result is eleven thousand three hundred and two, as expected for CLEAN. But one value is red: the discount uses the tax amount, zero, before the tax step has set it.

### AI-assisted diagnosis

Let's ask the AI: please find a bug using the debug history. It gets the recording itself — steps and values — not just the source.

The answer: this run calculated the amount correctly, but the history shows one real defect. The discount step reads the tax amount before the tax step has set it. The AI checked every red value in the formula: the others are false alarms, this one is the bug.

Every claim links to a recorded step. One click, and the player jumps there: the discount class, step 113, with the tax amount still zero.

Now the other four scenarios. Recording each one in SAP would take a while, so I ask the AI to run them in the transpiler and briefly describe the bugs.

Here is the transpiler I promised. The AI runs all four scenarios locally, with no SAP round trips, and then reads their recorded histories. Four runs take less time than one recording in SAP.

PRECISION and STATE return zero: the shipment is not found, and nobody checks it. PIPELINE charges VAT before the discount — about one hundred thirty-six euros too much. MULTI has two bugs together, about a thousand euros too much.

Each finding links to a step of its run. One click, and the replay opens there: the pricing class, the discount, the fuel rate, the tax step — with the values. So we can check the AI instead of just trusting it.

And at the end, a short list of fixes: check sy-subrc, round money and not rates, and calculate VAT from the discounted amount.

### Logs

Everything is logged. Every debug run is saved — open it later, look at it yourself or ask the assistant.

And so is the assistant: every conversation, what it got and which tools it called.

So we found the cause from the calls, the formula and the recorded run, without stepping through the debugger once.

## Slide 25. Metrics, logic and path to line

Beyond one program, VERTEX helps to assess and refactor large code. Metrics show where the complexity is, the logic diagram shows a method's branches, and Path to line shows which conditions lead to a given line.

Now a real class from Version Explorer: ZCL_AVE_POPUP. I type its name in the chat, and VERTEX opens it.

From VERTEX Tools I open Metrics. In seconds: ninety-one methods, about four thousand six hundred lines, and for each method its complexity and other metrics.

If a metric is unfamiliar, the question mark explains each one: what it counts and how to read it.

I sort by complexity and switch to the visual view: the bigger and redder the tile, the more complex the method. One stands out: ON_TOOLBAR_CLICK — two hundred sixty-four lines, complexity fifty-three.

Let's look inside. From the context menu I open the Logic view. It keeps only the control flow — CASE, IF, LOOP, RETURN — and hides the rest. Depth opens it level by level.

Now as a diagram. Depth two… six. What a wonderful spaghetti of AI-generated code — and that is just one method. Here we see all its branches at once.

Now a concrete question: how can we get to this line — to catch a breakpoint, for example? On line 2648 I choose Path to line.

VERTEX shows every condition on the way: which WHEN branch must be taken, which IFs must be true or false, and which RETURNs must not be reached before it.

Another line, another path. For any line we see what must happen to get there — which scenario to prepare to hit a breakpoint, or why a line never runs.

One program is easy. Metrics, the logic diagram and Path to line help when the code is big and someone else wrote it — or an AI did.

## Slide 26. Review a transport

Finally, the review. We open a transport, see what it changes, ask the AI what the changes are for and whether they contain bugs, and give each changed block a verdict.

In the object search I choose Transport request, enter its number and switch to Review.

We see who changed what: one developer, four classes, nine changed blocks. The review is saved in SAP.

Click a method, and we see its diff: the old version against the active one.

Or click the developer: all their blocks in one list, with filters.

Now the AI. In the chat I ask: what is the business purpose of these changes, briefly? The answer: interfaces now show up correctly in the transport review, with their own author, tasks and dates.

Next question: do we have bugs here? This code was generated by Codex; now Claude Opus reviews it — and finds a real bug: interface names of thirty characters are not recognised. Plus two risks: the same logic is copied four times, and one path was not checked. It even suggests a fix.

Now the reviewer decides. Each block can be approved, declined or just commented; a decline always needs a comment. I decline the first block and write why.

The verdict and the comment are saved, and the developer sees them.

So the review adds the last step: understand the code, investigate its execution, and check the changes before they go further.

## Slide 27. Key Takeaways

To sum up, five things to take away.

First, understand before you debug. Calls, FLOW and Formula show how a value is built, without stepping through the code line by line.

Second, evidence instead of guesses. The AI reads the recorded SAP run, so its answer is based on real values from the system.

Third, the big picture. Metrics show where the complexity is, the logic diagram shows the branches, and Path to line shows how you reach a specific line — even in a wonderful spaghetti.

Fourth, review before release. You see what a transport changes, ask the AI about its purpose and possible bugs, and approve or decline each block with a comment.

And the most important one: don't be afraid to build the plugins you really need. Use AI to vibe-code them — VERTEX itself was built this way.

## Questions & Answers

Thank you. I'm happy to take your questions.

## Slide 28. Thank you!

All links are on the slide: the repository, the Marketplace page, the Eclipse update site and the demo source. Thank you!
