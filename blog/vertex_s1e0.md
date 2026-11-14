# VERTEX, episode 0: everything in one tour

*Season 1, episode 0. A short overview of what VERTEX does. Each feature gets its own short story in the episodes that follow.*

For about seven years I built open-source tools for SAP GUI: data and code explorers, a Smart Debugger, an AI assistant. They now live in one place, **VERTEX**, a set of plugins for **VS Code** and **Eclipse ADT**. About ninety percent of the features are the same in both. Most of this series uses VS Code.

This episode is a map: one or two sentences and a screenshot per feature. The full story of each one comes later.

---

## 1. Getting started

- **Install and connect.** Install VERTEX from the Marketplace in VS Code, or from its update site in Eclipse. Import your systems from SAP Logon, enter the client, user and password, and VERTEX checks the connection. Systems with SNC single sign-on and message servers are supported too.

  ![SAP Systems: systems imported from SAP Logon and a successful connection test](img/s1e0/01-sap-systems.png)

- **Choose your AI.** In **LLM Providers**, pick the assistant you already have: a Claude or ChatGPT subscription, GitHub Copilot, EPAM CodeMie, an API key (Anthropic, OpenAI, Gemini, Mistral, OpenRouter, Vercel AI Gateway, OpenCode and others), or a free local model in LM Studio or Ollama. **Check models** tests every model with one short request and switches off those that do not work.

  ![LLM Providers: providers, model lists with prices and Check models](img/s1e0/02-llm-providers.png)

- **No server installation required.** Everything works over the standard ADT connection. A small optional ABAP part is only needed to save transport reviews in SAP.

## 2. SAP at your fingertips

- **Find anything.** The **VERTEX Tools** window searches classes, programs, packages, transports and other objects. You can also just type a name in the chat: VERTEX searches the system without spending tokens and opens what it finds.

  ![VERTEX Tools: object search, and the same object found from the chat](img/s1e0/03-find.png)

- **Data without SAP GUI.** **SelecTor** shows tables, views and CDS with select-options, joins built from foreign keys, and pivots. **Run Select** runs a SELECT right from the source and shows the result next to the code. You can also set SelecTor up with a sentence: *show the flights of LH in SFLIGHT*.

  ![SelecTor with a join and a pivot; Run Select next to the source](img/s1e0/04-selector.png)

- **A better ABAP editor.** Hover, Go to, Outline, folding by code structure, ABAP Unit in the Test Explorer, ATC in Problems, where-used and F1 documentation.

  ![ABAP editor: hover, Outline and ATC findings in Problems](img/s1e0/05-editor.png)

- **Review before activation.** **Review & Activate** shows your edits against SAP block by block; you approve them before they reach the system.

  ![Code Change: edits as blocks with Approve and Decline](img/s1e0/06-review-activate.png)

- **Chat over any system.** The assistant reads, explains and changes code, runs ABAP Unit and ATC on an object, and can copy an object from one system to another. Its change lands unsaved in the tab: nothing is written to SAP until you save it.

  ![Chat explaining a method; the change waiting unsaved in the tab](img/s1e0/07-sap-chat.png)

## 3. Understanding big code

- **Metrics.** For every method: lines, complexity, maintainability. A visual map where the biggest and reddest tile is the method to look at first.

  ![Metrics: the method table and the visual map](img/s1e0/08-metrics.png)

- **Diagrams.** UML for classes, a **Calls** diagram of what calls what, and a **Logic** diagram that keeps only the branches of one method.

  ![UML, Calls and Logic diagrams of one class](img/s1e0/09-diagrams.png)

- **Path to This Line.** Which conditions must be true, and which branches must not be taken, for a given line to run. Useful for preparing a breakpoint or finding out why a line never runs.

  ![Path to This Line: the conditions and Reachability on the diagram](img/s1e0/10-path-to-line.png)

- **Where a value goes.** **Forward Usage Analysis** shows how a value is calculated down through the calls; **Backward Usage Analysis** shows where it goes in the callers.

  ![Forward Usage Analysis as a tree and a diagram](img/s1e0/11-usage-analysis.png)

- **Versions and diff.** An object's history, who changed it and when, and the difference between any two versions.

  ![Version history and the diff of two versions](img/s1e0/12-versions.png)

- **Local ABAP too.** Metrics, UML and diagrams also work on a folder of `.abap` files, without an SAP system.

## 4. Reviewing transports

- **A transport at a glance.** Who changed what, by object and by developer, with each changed block as a diff. **Blame** shows who wrote each line.

  ![Transport review: objects, developers and blocks with Blame](img/s1e0/13-transport-review.png)

- **A verdict for each block.** Approve, decline or comment. A decline always needs a comment. The review is saved, and VERTEX warns you if the code has changed since.

  ![Block verdicts with comments, and the warning about changed code](img/s1e0/14-verdicts.png)

- **Ask the AI.** Ready prompts for a technical review, a business review against your requirements, documentation, a test plan or release notes. Answers link straight to the code.

  ![AI answer on a transport with links to the code](img/s1e0/15-review-ai.png)

## 5. Debugging without stepping

- **Before running.** **Code Flow Analysis**, **Derivation** and **Formula** show where a value comes from and how it is calculated, using only the source.

  ![Formula of a value built from the source](img/s1e0/16-formula.png)

- **An AI-driven debugger.** Tell the assistant what you are looking for: it sets breakpoints with conditions that SAP evaluates, starts the run and names the line and the values that explain the result.

  ![Chat verdict naming the line and the values](img/s1e0/17-ai-debugger.png)

- **VERTEX Smart Debugger.** Records a run in SAP with all its steps and values. You can replay it later, jump to any step, and see the formula filled in with real values.

  ![Smart Debugger: source, variables, flow chart and the replay player](img/s1e0/18-smart-debugger.png)

- **AI with evidence.** The assistant reads the recorded run, not just the code, and every claim links to a step you can check.

  ![AI answer with links to recorded steps](img/s1e0/19-ai-evidence.png)

- **ABAP on your own machine.** The **ABAP transpiler** runs a report, method or function module locally. Only SELECTs go to SAP. It is fast enough to try "what if this value were different?" in seconds.

  ![A report run with the ABAP transpiler: selection screen and output](img/s1e0/20-transpiler.png)

## 6. MCP: VERTEX for your own assistant

- **Your assistant, SAP's tools.** VERTEX includes an MCP server, so Claude Code, Codex or Copilot can read code, review transports and drive the debugger in SAP.
- **Several MCP servers in one window.** Connect, check and update them, see every tool and whether it may change SAP, and choose the SAP tools the chat should use.

  ![MCP Servers window: servers, versions and tool tables](img/s1e0/21-mcp-servers.png)

- **Run any MCP tool by hand.** Fill in a form and get a readable result.

  ![An MCP tool as a form in VERTEX Tools, with its result](img/s1e0/22-mcp-tool.png)

- **VERTEX Orchestrator.** Pick it in the MCP list and the chat chooses the tools for the task itself.

## 7. An AI assistant for any folder

- **Not only SAP.** VERTEX works as a code agent for any local Git project in Python, Java, TypeScript, C#, ABAP or another language.
- **Nothing changes without you.** The agent works in a separate copy. You review its edits file by file, apply the ones you approve, and send the rest back with a reason. After Apply it can run the project's build and tests and fix what fails.

  ![Assistant changes: file-by-file review with Apply and Decline](img/s1e0/23-agent-review.png)

- **AI Review.** A second opinion on the proposed changes, in its own tab and its own conversation.

  ![AI Review of the assistant's changes](img/s1e0/24-ai-review.png)

- **Git made easy.** Commit history, review of any commit, a commit message and pull request drafted by AI, and Push with a preview.

  ![Git History, a commit review and the AI-drafted commit message](img/s1e0/25-git.png)

- **Screenshots in the chat.** Attach a screenshot, even without text: the assistant sees the problem on it and helps.
- **Web search.** With Vercel AI Gateway, ask the assistant to search the web; the answer comes with source links.
- **Know what it costs.** **Usage & Cost** shows tokens and money by day, provider and model.

  ![Usage & Cost by day, provider and model](img/s1e0/26-usage-cost.png)

- **Session Logs.** Every conversation is in one table, grouped by folder or system. You can search it, go through it again, or continue where you left off.

  ![Session Logs: conversations, steps and Continue](img/s1e0/27-session-logs.png)

- **Secrets stay yours.** Passwords, keys and tokens are masked before anything goes to the AI or into a log.

## 8. Jev, the quick advisor

Jev is a different class of model. It doesn't generate text at all: no sentences, no explanations, no chat. It only decides. It is named after the Jevons paradox: when something becomes cheap, people use far more of it. A decision that costs almost nothing can be asked everywhere, and that is exactly the idea behind Jev.

You give it some text and ask a question with fixed answers, for example "Is this change risky? Yes or No", "Which kind of change is this?" or "How urgent is this, from 1 to 5?". Jev picks one of the answers and tells you how sure it is. That makes it fast and very cheap, so VERTEX can use it in many places.

- **Try every question type in the chat.** Choose a Jev model in the chat's model list and the panel turns into a form. Paste your text, add questions of any type (*Yes / No*, *Choose an option*, *Rate on a scale*) and press **Run Jev**. Each answer shows how confident Jev is and how likely every other option was. You don't need to write any JSON.

  ![Jev form: context, question cards and results with probabilities](img/s1e0/28-jev-form.png)

- **ASK Jev on a diff block.** Next to ASK AI in transport review, Git review, Review & Activate and AI Review: what kind of change this is, how urgent the review is, whether the context is enough, and a recommendation. Advice only: Jev never approves or applies anything.

  ![ASK Jev assessment above a diff block](img/s1e0/29-ask-jev.png)

- **Sort blocks with Jev.** In Git review, Jev puts the most important blocks first, and for a business review points at the blocks that likely implement each requirement.

  ![Git review blocks sorted by Jev, with requirement hints](img/s1e0/30-jev-sort.png)

- **Auto (Jev): only the relevant history.** In a long chat, Jev splits the conversation into topics and sends the model only the topic of your question, so answers are faster and cheaper. A screenshot gets its own topic.

  ![Chat in Auto (Jev) mode with topic badges](img/s1e0/31-auto-jev.png)

- **Tag topics in old conversations.** In Session Logs, **Tag topics (Jev)** sorts the questions of an older conversation into topics, so you can continue any of them.

  ![Session Logs: Tag topics (Jev) and topic continuation](img/s1e0/32-jev-tag-topics.png)

- **Jev picks the tools.** With **VERTEX Orchestrator**, Jev chooses which SAP tools the task needs and whether to do it in one go or step by step. The main assistant gets only those tools.
- **Every answer on record.** In Session Logs each Jev answer is a readable table with confidence and odds, and **Continue** reopens a Jev step to edit and run it again.

  ![Jev answer as a table in Session Logs](img/s1e0/33-jev-log.png)

- **Your choice of decision model.** TypeSafe Jev or Gemini Decision 1, chosen once beside **Auto (Jev)** and shared by all these features. VERTEX keeps within your plan's rate limits instead of failing.

---

## Coming next

In the next episodes, each of these points gets its own short story: one task, what you do in VERTEX, and what you see as a result. We start with installation and your first system, then move on to search, data, big code, transport review, debugging, MCP, the folder assistant and Jev.

And one last thought before we begin: don't be afraid to build the tools you really need. VERTEX itself was vibe-coded with AI.
