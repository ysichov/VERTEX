"use strict";

// The sidebar is deliberately one free-prompt surface. Tools remain internal to
// the orchestrator; it decides which SAP operation is needed.
const ACTIONS = Object.freeze({
  tools: "vertex.tools",
  selector: "vertex.open",
  metrics: "vertex.metrics",
  versions: "vertex.versions",
  logs: "vertex.showLogs",
  executionLogs: "vertex.openSapDebugRuns",
  system: "vertex.switchSystem"
});

function register(vscode, context, active, ask, systems, toolContext, clients = { set: async () => {}, onChange: () => ({ dispose() {} }) }, chatMcp = null) {
  let currentView, ready = false, nextRequest = 0, pendingChat = null, continuing = false;
  let reviewSurface = null;
  // ASK AI of a review: the blocks on the chip above the input, attached to the next question only when it is sent.
  let reviewAsk = null;
  const review = require("./code-review");
  const showReview = () => currentView && ready ? currentView.webview.postMessage({ review: reviewAsk ? review.askLabel(reviewAsk) : "", reviewResult: reviewAsk?.review_result ? { ...reviewAsk.review_result, files: reviewAsk.files } : null, draft: reviewAsk && reviewAsk.question || "" }) : undefined;
  // AI Review lives in the main chat: closing it ends its review conversation; its steps stay in the chat.
  const closeReview = async () => {
    if (!reviewSurface) return;
    const id = reviewSurface.embedding.id;
    await reviewSurface.dispose(); reviewSurface = null;
    if (currentView) await currentView.webview.postMessage({ aiReviewClosed: id });
  };
  // Beside the gear in the panel's title: LLM providers (the SAP Systems table is extension.js's).
  context.subscriptions.push(vscode.commands.registerCommand("vertex.openModelSettings", () => ask.configModels()));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.configureOrchestrator", async () => {try{const planner=await ask.configOrchestrator();if(currentView)await currentView.webview.postMessage({planner});return planner;}catch(error){vscode.window.showErrorMessage("VERTEX orchestrator: "+error.message);}}));
  if (chatMcp) context.subscriptions.push(vscode.commands.registerCommand("vertex.mcpServers", () => require("./mcp-window").open(vscode, chatMcp)));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.generateCommitMessage", async (snapshot,draft) => {try{return await ask.generateCommitMessage(snapshot,draft);}catch(error){return {error:error.message,generation:error.generation};}}));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.generatePullRequest", async (snapshot,draft) => {try{return await ask.generateCommitMessage(snapshot,draft,"pr");}catch(error){return {error:error.message,generation:error.generation};}}));
  // Continue a conversation from Session Logs: a new conversation in the panel whose history is the logged questions
  // and answers; it keeps logging under the same conversation id, so its files stay together.
  context.subscriptions.push(vscode.commands.registerCommand("vertex.continueConversation", async found => {
    if (pendingChat || continuing || reviewSurface?.running) throw new Error("Stop or finish the current request before continuing another conversation.");
    if (!found || !Array.isArray(found.turns) || !found.turns.length) throw new Error("No questions to continue from.");
    if (!await ask.confirmDiscardChanges()) return;
    continuing = true;
    try {
    if (!currentView || !ready) {
      await vscode.commands.executeCommand("vertex.launcher.focus");
      for (let waited = 0; (!currentView || !ready) && waited < 5000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
      if (!currentView || !ready) throw new Error("The VERTEX panel did not open; open it and try again.");
    }
    require("./session-log").reset(found.conversation || undefined, found.branch);
    await vscode.commands.executeCommand("vertex.resetTranspilerRunNumbers");
    const selectedTopic=found.topicId
         ? found.turns.find(turn=>turn.topic?.id===found.topicId)?.topic
         : found.turns.at(-1)?.topic;
    const count = ask.restoreConversation(found.turns,{topic:selectedTopic});
    if(selectedTopic)await vscode.workspace.getConfiguration("vertex.ai").update("context.routeTopics",true,vscode.ConfigurationTarget.Global);
    const restoredTopics=ask.topics?.()||[],restoredLabels=new Map(restoredTopics.map(topic=>[topic.id,topic.label]));
    reviewAsk = null;
    await closeReview();
    const view = currentView;
    await view.webview.postMessage({ cleared: true });
    const localDateKey=time=>{const date=new Date(time);return Number.isFinite(date.getTime())?date.getFullYear()+"-"+String(date.getMonth()+1).padStart(2,"0")+"-"+String(date.getDate()).padStart(2,"0"):"";};
    const questionTime=time=>{const date=new Date(time);if(!Number.isFinite(date.getTime()))return "";const hhmm=String(date.getHours()).padStart(2,"0")+":"+String(date.getMinutes()).padStart(2,"0");if(localDateKey(time)===localDateKey(Date.now()))return hhmm;return String(date.getDate()).padStart(2,"0")+"."+String(date.getMonth()+1).padStart(2,"0")+"."+String(date.getFullYear()).slice(-2)+" "+hhmm;};
    const first = found.turns.find(turn => turn.time), when = first ? questionTime(first.time) : "";

    for (const turn of found.turns) {
      await view.webview.postMessage({ ...(turn.topic?{topic:{...turn.topic,label:restoredLabels.get(turn.topic.id)||turn.topic.label}}:{}), chat: "You: " + turn.question
        + (turn.images?.length ? "  [" + turn.images.length + " screenshot(s) restored]" : "")
        + (turn.missingScreenshots ? "  [" + turn.missingScreenshots + " screenshot(s) unavailable]" : ""),questionTime:questionTime(turn.time) });
      await view.webview.postMessage({ ...(turn.topic?{topic:{...turn.topic,label:restoredLabels.get(turn.topic.id)||turn.topic.label}}:{}), chat: "VERTEX: " + (turn.answer || (turn.failed
        ? "(request did not complete; your question and available screenshots were restored for the next request)" : "(no answer was logged)")),logPromptKey:turn.key,logSessionId:turn.logId,logConversationId:turn.conversation,questionDate:localDateKey(turn.time) });
    }
    // Continue on a topic's last question: the whole conversation comes back, and the next question continues that topic.
    await view.webview.postMessage({ historyContinued: true, viewTopic: selectedTopic?.id || "all",...(selectedTopic?{routeTopics:true}:{}),topicList:restoredTopics });
    await showReview();
    view.show(true);
    return count;
    } finally { continuing = false; }
  }));
  let jevPanel, jevReady=false, pendingJevDraft;
  const refreshJevModels = async panel => {
    try { await panel.webview.postMessage({decisionModels:await ask.decisionModels()}); }
    catch(error) { await panel.webview.postMessage({decisionStatus:error.message}); }
  };
  const receiveJevMessage = async (view,message) => {
    if (!message || typeof message !== "object") return;
    if (message.action === "ready") {
      jevReady=true;
      if(pendingJevDraft){await view.webview.postMessage({decisionDraft:pendingJevDraft});pendingJevDraft=null;}
      await refreshJevModels(view);
      return;
    }
    if (message.action === "stopChat") {
      if(pendingChat?.kind==="decision"&&!pendingChat.cancelled){
        pendingChat.cancelled=true;ask.stop();
        await view.webview.postMessage({decisionStatus:"Stopping…"});
      }
      return;
    }
    if (message.action === "jevHistory" || message.action === "continueJevHistory") {
      const requestId = Number(message.requestId) || 0;
      try {
        if (message.action === "continueJevHistory" && pendingChat) throw new Error("Stop or finish the current request first.");
        const date = value => /^\d{4}-\d\d-\d\d$/.test(value || "") ? value : "";
        const from = date(message.from), to = date(message.to);
        if (from && to && from > to) throw new Error("The start date must be on or before the end date.");
        const start = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
        const end = to ? new Date(to + "T23:59:59.999").getTime() : Infinity;
        const report = require("./log-report").readSessions(vscode.workspace.getConfiguration("vertex.ai").get("logPath", ""), {from,to});
        const entries = report.sessions.flatMap(session => session.prompts.filter(prompt =>
          prompt.decision && prompt.time >= start && prompt.time <= end
        ).flatMap(prompt => prompt.skillDecisions?.length
          ? prompt.skillDecisions.map((decision,index)=>({id:JSON.stringify([session.id,prompt.key,index]),prompt,decision}))
          : [{id:JSON.stringify([session.id,prompt.key]),prompt,decision:prompt.decision}]));
        if (message.action === "continueJevHistory") {
          const entry = entries.find(item => item.id === message.id);
          if (!entry) throw new Error("That Jev request is no longer in the log.");
          await vscode.commands.executeCommand("vertex.continueDecision",entry.decision);
          await view.webview.postMessage({historyContinued:true});
          return;
        }
        const items = entries.map(({id,prompt,decision}) => ({
          id, time:prompt.time,
          decisionType: decision.questions?.vsix_version || /^Skill match/i.test(prompt.operation) ? "Skill match"
            : /^Review\b/i.test(prompt.operation) ? "Review"
            : /^Topic\b/i.test(prompt.operation) ? "Topic"
            : (prompt.operation || "Jev request").replace(/ with Jev$/i,""), title:decision.questions?.vsix_version ? "VSIX version decision" : prompt.text || prompt.operation || "Jev request",
          lastQuestion:Object.values(decision.questions || {}).map(question=>question.instructions).join(" "),
          count:Object.keys(decision.questions || {}).length,
          providers:[decision.provider,decision.model].filter(Boolean).join(" · ")
        })).sort((a,b)=>b.time-a.time);
        await view.webview.postMessage({conversationHistory:{requestId,items,message:items.length ? "" : "No saved Jev requests for this period."}});
      } catch(error) {
        await view.webview.postMessage(message.action === "jevHistory"
          ? {conversationHistory:{requestId,items:[],message:error.message}} : {historyError:error.message});
      }
      return;
    }
    if(message.action === "decision") {
      if(pendingChat||reviewSurface?.running||continuing){
        await view.webview.postMessage({decisionStatus:"Wait for the current request to finish.",decisionRunning:false});
        return;
      }
      const pending=pendingChat={id:++nextRequest,cancelled:false,kind:"decision"};
      try{
        const result=await ask.evaluate({provider:message.provider,model:message.model,state:message.state,questions:message.questions});
        await view.webview.postMessage(pending.cancelled||result.stopped?{decisionStatus:"Stopped."}:{decisionResult:result});
      }catch(error){await view.webview.postMessage({decisionStatus:pending.cancelled?"Stopped.":"Request failed: "+error.message});}
      finally{if(pendingChat===pending)pendingChat=null;await view.webview.postMessage({decisionRunning:false});}
      return;
    }
  };
  function openJev(input){
    if(input)pendingJevDraft=input;
    if(jevPanel){
      jevPanel.reveal();
      if(jevReady&&pendingJevDraft){void jevPanel.webview.postMessage({decisionDraft:pendingJevDraft});pendingJevDraft=null;}
      return;
    }
    const panel = vscode.window.createWebviewPanel("vertex.jev", "VERTEX Jev", vscode.ViewColumn.Active,
      {enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[]});
    jevPanel=panel;
    const messages=panel.webview.onDidReceiveMessage(message=>receiveJevMessage(panel,message));
    const settings=vscode.workspace.onDidChangeConfiguration(event=>{
      if(jevReady&&event.affectsConfiguration("vertex"))void refreshJevModels(panel);
    });
    panel.onDidDispose(()=>{
      messages.dispose();settings.dispose();jevPanel=undefined;jevReady=false;pendingJevDraft=null;
      if(pendingChat?.kind==="decision"){pendingChat.cancelled=true;ask.stop();}
    });
    panel.webview.html=html(require("crypto").randomBytes(16).toString("hex"),true);
  }
  context.subscriptions.push({dispose:()=>jevPanel?.dispose()});
  context.subscriptions.push(vscode.commands.registerCommand("vertex.openJev",()=>openJev()));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.continueDecision",input=>{
    if(pendingChat?.kind==="decision")throw new Error("Wait for the active Jev request to finish before restoring a step.");
    require("./jev").validate(input?.state,input?.questions);
    if(!["typesafe-api","opencode-api","gemini-api"].includes(input.provider)||typeof input.model!=="string")throw new Error("Invalid Jev provider or model in this step.");
    openJev(input);
  }));
  // Copy Link in the context menu of a link in a chat answer: the address, not the selected text.
  context.subscriptions.push(vscode.commands.registerCommand("vertex.copyLink", async target => {
    let url;
    try { url = new URL(String(target && target.url || "")); } catch (_) { throw new Error("This is not a link VERTEX can copy."); }
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Only web links are copied.");
    await vscode.env.clipboard.writeText(url.href);
  }));
  // The working copy goes when VS Code closes.
  context.subscriptions.push({ dispose: () => { if (typeof ask.dispose === "function") return ask.dispose(); } });
  // A message to the assistant that VERTEX sends itself - the reasons from a review - asked as the user's would be.
  context.subscriptions.push(vscode.commands.registerCommand("vertex.chatSend", async text => {
    if (!currentView || !ready || typeof text !== "string" || !text.trim()) {
      vscode.window.showWarningMessage("VERTEX: open the VERTEX panel to send the review's reasons to the assistant.");
      return;
    }
    await vscode.commands.executeCommand("vertex.launcher.focus");
    await currentView.webview.postMessage({ send: text });
  }));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.askReviewBlock", async blocks => {
    reviewAsk = review.mergeAsk(reviewAsk, blocks);
    // One attachment above the input at a time: an open AI Review would take the next question instead.
    if (!reviewSurface?.running) await closeReview();
    await vscode.commands.executeCommand("vertex.launcher.focus");
    await showReview();
  }));
  // Discuss in chat: the review closes and its chosen result goes, with its changes, to the next chat question.
  context.subscriptions.push(vscode.commands.registerCommand("vertex.discussAiReview", async attachment => {
    if (!currentView || !ready || !attachment?.review_result || !Array.isArray(attachment.blocks)) return;
    if (reviewSurface?.running) return;
    reviewAsk = attachment;
    await closeReview();
    await showReview();
    currentView.show(true);
  }));
  /* ASK AI on assistant changes: the review opens in the main chat. Its settings (review type, requirements, prompt
     files, Copy prompt, Check again) sit above the chat input; each question and answer is a step of the chat. The
     review keeps its own conversation: no main-chat history, no tools (ai-review.js / chat.js reviewChanges). */
  context.subscriptions.push(vscode.commands.registerCommand("vertex.openAiReview", async reviewContext => {
    await vscode.commands.executeCommand("vertex.launcher.focus");
    for (let waited = 0; (!currentView || !ready) && waited < 5000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
    if (!currentView || !ready) throw new Error("Open the VERTEX chat and try ASK AI again.");
    if (pendingChat || continuing || reviewSurface?.running) { vscode.window.showWarningMessage("VERTEX: stop or finish the current request, then select ASK AI again."); return; }
    await closeReview();
    reviewAsk = null; await showReview();
    const receive = new Set(), dispose = new Set();
    const id = require("crypto").randomBytes(12).toString("hex");
    let active = true, round = null;
    const post = message => active && currentView ? currentView.webview.postMessage(message) : undefined;
    let label = "AI Review";
    const surface = {
      embedding: { id },
      get running() { return !!round; },
      render(shown) {
        label = "AI Review · " + shown.object;
        return post({ aiReviewOpen: { id, object: String(shown.object || ""), files: [...(shown.files || [])], blocks: (shown.blocks || []).length } });
      },
      webview: {
        onDidReceiveMessage(fn) { receive.add(fn); return { dispose: () => receive.delete(fn) }; },
        // What the review reports becomes the chat's own progress of the round being asked.
        async postMessage(message) {
          if (!active || !message) return;
          if (message.draftPrompt) return post({ draftPrompt: message.draftPrompt });
          if (message.promptFile) return post({ promptFile: message.promptFile });
          if (typeof message.stale === "boolean") await post({ aiReviewStale: { id, stale: message.stale } });
          if (!round) {
            if (message.status) await post({ aiReviewStatus: { id, text: message.status, error: !!message.error } });
            if (message.done) await post({ aiReviewDone: id });
            return;
          }
          if (message.turn) await post({ progress: { id: round.id, step: "review", kind: "review", user: "You: " + message.turn + "  [" + label + "]", status: message.status || "Reviewing changes…" } });
          else if (message.reply) { round.answered = true; await post({ progress: { id: round.id, step: "review", answer: message.reply, done: true,
            usage: "AI Review · " + (message.model || "model") + " · without the main chat history and tools", discuss: message.handoffId ? { review: id, id: message.handoffId } : null } }); }
          else if (message.status && message.error) { round.answered = true; await post({ progress: { id: round.id, step: "review", answer: "Review failed: " + message.status, done: true } }); }
          else if (message.status) await post({ progress: { id: round.id, status: message.status } });
          if (message.done) { const finished = round; round = null; if (!finished.answered) await post({ progress: { id: finished.id, step: "review", stopped: true, done: true } }); await post({ aiReviewDone: id }); }
        }
      },
      onDidDispose(fn) { dispose.add(fn); },
      async receive(message) {
        if (!active || !message || typeof message !== "object") return;
        let asked = null;
        if (message.action === "send") {
          if (pendingChat || continuing || round) return;
          const requestId = Number.isInteger(message.requestId) ? message.requestId : ++nextRequest;
          if (requestId > nextRequest) nextRequest = requestId;
          asked = round = { id: requestId, answered: false };
        }
        for (const fn of receive) await fn(message);
        // Not taken (the review was busy refreshing): the waiting step goes.
        if (asked && round === asked) { round = null; await post({ progress: { id: asked.id, remove: true } }); await post({ aiReviewDone: id }); }
      },
      stop() { if (round) { void post({ progress: { id: round.id, status: "Stopping…" } }); for (const fn of receive) void fn({ action: "stop" }); } },
      async dispose() {
        const open = round; round = null;
        if (open) await post({ progress: { id: open.id, step: "review", stopped: true, done: true } });
        active = false; for (const fn of dispose) fn();
      }
    };
    reviewSurface = surface;
    require("./ai-review").open(vscode, reviewContext, (prompt, options) => ask.reviewChanges(prompt, options), surface);
  }));
  context.subscriptions.push({ dispose: () => reviewSurface?.dispose() });
  const provider = {
    resolveWebviewView(view) {
      currentView = view;
      ready = false;
      const nonce = require("crypto").randomBytes(24).toString("hex");
      view.webview.options = { enableScripts: true, localResourceRoots: [] };
      view.webview.html = html(nonce);
      let refreshSerial = 0;
      const refresh = async (fresh = false) => {
        const chosen = active();
        const serial = ++refreshSerial;
        const ai = ask.state();
        require("./ai-availability").set(ai.providers.length > 0);
        await view.webview.postMessage({
          system: chosen.error ? "" : chosen.system.name,
          // The active system's clients, when it lists more than one, and the one in use.
          client: chosen.error ? "" : chosen.system.client, clients: chosen.error ? [] : chosen.system.clients || [],
          systems: systems().map(item => item.name),
          // What the list shows: a system reached through SAP's extension says so beside its name.
          labels: systems().map(item => item.name),
          ai,
          // Where the chat's SAP tools come from: VERTEX itself or an MCP server of vertex.chat.mcpServers.
          mcp: chatMcp ? { servers: chatMcp.choices(), selected: chatMcp.selected(),
            updates: chatMcp.overview().filter(s => Array.isArray(s.update) && s.update.length).map(s => s.name) } : null,
          planner: ask.plannerState(),
          effort: String(vscode.workspace.getConfiguration("vertex.ai").get("effort", "") || "")
        });
        // Provider/model controls must not wait for Jev's separate decision-model catalogs.
        // In particular, a slow or unavailable Jev endpoint must never leave the provider list blank.
        const loadModels = (async () => {
          try {
            const models = await ask.listModels(fresh);
            if (serial === refreshSerial && currentView === view) await view.webview.postMessage({ models });
          } catch (error) {
            if (serial === refreshSerial && currentView === view) await view.webview.postMessage({ models: { error: error.message } });
          }
        })();
        const loadDecisions = (async () => {
          try {
            const decisions = ask.decisionModels ? await ask.decisionModels(fresh) : {models:[],selected:require("./review-jev").selection(vscode)};
            if (serial === refreshSerial && currentView === view) await view.webview.postMessage({jevOn:decisions.models.length>0,decisionModels:decisions});
          } catch (_) {
            if (serial === refreshSerial && currentView === view) await view.webview.postMessage({jevOn:false,decisionModels:{models:[],selected:require("./review-jev").selection(vscode)}});
          }
        })();
        // Keep the ready/configuration handler free even if either catalog endpoint stalls.
        void Promise.allSettled([loadModels, loadDecisions]);
      };
      // The folder Claude works in, under the SAP system, so the panel does not read as SAP-only.
      let fileLinksUpdated=0;
      const updateFileLinks=async(force=false)=>{if(!ready||!force&&Date.now()-fileLinksUpdated<3000)return;fileLinksUpdated=Date.now();try{await view.webview.postMessage({localFiles:await require("./file-links").catalog(vscode)});}catch(_){};};
      const showFolder = async () => {if(!ready)return;await view.webview.postMessage({folder:ask.state().contextFolder??require("./chat").currentWorkingFolder(vscode),contextMode:ask.state().contextMode});await updateFileLinks();};
      const clearConversation = async () => {
        await closeReview();
        const conversationId = require("./session-log").reset();
        require("./log-report").resetLiveConversation(conversationId);
        await vscode.commands.executeCommand("vertex.resetTranspilerRunNumbers");
        ask.newConversation();
        reviewAsk = null;
        await view.webview.postMessage({ cleared: true });
        await showReview();
      };
      const messages = view.webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== "object") { return; }
        if (message.action === "closeAiReview") {
          if (message.id === reviewSurface?.embedding.id) await closeReview();
          return;
        }
        if (message.action === "aiReviewMessage") {
          if (message.id === reviewSurface?.embedding.id && message.message && typeof message.message === "object") await reviewSurface.receive(message.message);
          return;
        }
        if (message.action === "ready") {
          ready = true;
          await view.webview.postMessage({topicList:ask.topics?.()||[],routeTopics:vscode.workspace.getConfiguration("vertex.ai").get("context.routeTopics",false)});
          const folderUpdate = showFolder();
          await refresh();
          await folderUpdate;
          await showReview();
          await view.webview.postMessage({chatRunning:!!pendingChat});
          /* A server picked earlier starts with the window, without anyone pressing Start. Show that start the
             same way the manual one is shown, so the wait is visible rather than silent - but only while it is
             actually coming up: a server already serving gets no scene. In folder context the chat may never ask
             SAP anything, so neither the start nor its scene is wanted here; the first SAP question starts it. */
          if (chatMcp && ["sap","both"].includes(ask.state?.().contextMode)) {
            const name = chatMcp.selected();
            if (name && name !== chatMcp.VERTEX && name !== chatMcp.ORCHESTRATOR && !chatMcp.isRunning(name)
                && chatMcp.servers().some(server => server.name === name)) {
              await view.webview.postMessage({ mcpStart: { name, running: false, installing: chatMcp.needsInstall(name),
                scene: require("./task-visual").html(chatMcp.needsInstall(name) ? "install" : "start", false, name) } });
              try {
                const started = await chatMcp.prepare();
                await view.webview.postMessage({ mcpDone: { name, tools: started ? started.tools.length : 0 } });
              } catch (error) {
                await view.webview.postMessage({ mcpDone: { name, error: error.message, nodeMissing: !!error.nodeMissing } });
              }
            }
          }
          return;
        }
        if(message.action==="chooseDecisionModel"){
          await vscode.commands.executeCommand("vertex.configureOrchestrator");
          await view.webview.postMessage({decisionModels:await ask.decisionModels()});return;
        }
        if(message.action==="setDecisionModel"){
          const choices=await ask.decisionModels();
          if(!choices.models.some(m=>m.provider===message.provider && m.model===message.model))return;
          await vscode.workspace.getConfiguration("vertex.ai").update("decisionModel",{provider:message.provider,model:message.model},vscode.ConfigurationTarget.Global);
          await view.webview.postMessage({decisionModels:await ask.decisionModels()});return;
        }
        if(message.action==="setRouteTopics"){await vscode.workspace.getConfiguration("vertex.ai").update("context.routeTopics",!!message.value,vscode.ConfigurationTarget.Global);return;}
        if (message.action === "openJev") { openJev(); return; }
        if (message.action === "conversationHistory") {
          const requestId = Number(message.requestId) || 0;
          try {
            const logs = require("./log-report"), place = logs.currentPlace(vscode);
            const validDate = value => /^\d{4}-\d\d-\d\d$/.test(value || "") ? value : "";
            const from = validDate(message.from), to = validDate(message.to);
            if (from && to && from > to) throw new Error("The start date must be on or before the end date.");
            const report = logs.readSessions(vscode.workspace.getConfiguration("vertex.ai").get("logPath", ""), { place, listOnly: true, from, to });
            const items = logs.conversationList(report, place);
            await view.webview.postMessage({ conversationHistory: { requestId, items,
              message: report.configured ? (items.length ? "" : "No conversations for this period.")
                : "Choose a log folder in Session Logs to save and continue conversations." } });
          } catch (error) { await view.webview.postMessage({ conversationHistory: { requestId, items: [], message: error.message } }); }
          return;
        }
        if (message.action === "continueHistory") {
          try {
            if (pendingChat) throw new Error("Stop or finish the current request first.");
            const logs = require("./log-report");
            const report = logs.readSessions(vscode.workspace.getConfiguration("vertex.ai").get("logPath", ""));
            await vscode.commands.executeCommand("vertex.continueConversation", logs.conversationTurns(report, String(message.id || "")));
          } catch (error) { await view.webview.postMessage({ historyError: error.message }); }
          return;
        }
        if (message.action === "previewRequestContext") {
          if (!["host","code","build","agent","history","workspace","rules","logs","tabs"].includes(message.key)) return;
          try {
            const state = message.key === "workspace" ? await toolContext() : {};
            await view.webview.postMessage({requestContextPreview:{key:message.key,text:ask.previewRequestContext(message.key,state)}});
          } catch (error) {
            await view.webview.postMessage({requestContextPreview:{key:message.key,error:error.message}});
          }
          return;
        }
        if(message.action==="setContextMode"){try{await view.webview.postMessage({ai:await ask.setContextMode(message.mode)});await showFolder();}catch(error){vscode.window.showWarningMessage("VERTEX: "+error.message);await view.webview.postMessage({ai:ask.state()});}return;}
        if(message.action==="manageContextFolder"){
          if(pendingChat||continuing||reviewSurface?.running)return;
          try {
            const previous=ask.state().contextFolder;
            const state=await ask.manageContextFolder(message.operation,message.folder);
            if(previous!==state.contextFolder)await clearConversation();
            await view.webview.postMessage({ai:state});await showFolder();
          } catch(error){vscode.window.showWarningMessage("VERTEX: "+error.message);}
          return;
        }
        if(message.action==="chooseContextFolder"){
          if(pendingChat||continuing||reviewSurface?.running)return;
          try{
            const previous=require("./chat").currentWorkingFolder(vscode);
            const state=await ask.chooseContextFolder();
            const current=require("./chat").currentWorkingFolder(vscode);
            if(previous!==current&&!require("./chat").sameProjectFolder(previous,current))await clearConversation();
            await view.webview.postMessage({ai:state});await showFolder();
          }catch(error){vscode.window.showWarningMessage("VERTEX: "+error.message);}
          return;
        }
        if (message.action === "configModels") { ask.configModels(); return; }
        if (message.action === "clearReview") {
          reviewAsk = null;
          await showReview();
          return;
        }
        if (message.action === "provider" || message.action === "model") {
          try { const state = await ask[message.action === "provider" ? "selectProvider" : "selectModel"](); await view.webview.postMessage({ ai: state }); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "setProvider") {
          try {
            await view.webview.postMessage({ ai: await ask.setProvider(message.provider) });
            await showFolder();
            // Load the newly selected provider's catalog immediately; do not depend on
            // the configuration-change event racing the picker update.
            await refresh();
          }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "setEffort") {
          const level = String(message.effort || "");
          if (["", "none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level)) {
            await vscode.workspace.getConfiguration("vertex.ai").update("effort", level, vscode.ConfigurationTarget.Global);
          }
          return;
        }
        if (message.action === "setModel") {
          try { await ask.setModel(message.model); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        // Git History of the folder shown in the header, in the same window the Tools window opens.
        if (message.action === "gitHistory") {
          try { const folder=require("./chat").currentWorkingFolder(vscode);await require("./git-history").open(vscode,folder); }
          catch (error) { vscode.window.showErrorMessage("VERTEX Git History: " + error.message); }
          return;
        }
        if (message.action === "newConversation") {
          if (pendingChat || continuing || reviewSurface?.running) return;
          if (!await ask.confirmDiscardChanges()) return;
          await clearConversation();
          return;
        }
        if (message.action === "showCurrentLog") {
          if (!pendingChat || pendingChat.kind !== "chat") return;
          const sessionId=message.sessionId||pendingChat.logSessionId;
          if (!sessionId) { pendingChat.openLogWhenReady = true; return; }
          pendingChat.openLogWhenReady=false;
          const now=new Date(),date=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
          await vscode.commands.executeCommand("vertex.showLogs",{sessionId:String(sessionId),conversationId:String(message.conversationId||pendingChat.logConversationId||""),fullScreen:true,mode:"flow",live:true,date});
          return;
        }
        if (message.action === "openLogConversation") {
          const date=String(message.date||"");
          await vscode.commands.executeCommand("vertex.showLogs",{sessionId:String(message.sessionId||""),conversationId:String(message.conversationId||""),fullScreen:false,mode:"logs",date:/^\d{4}-\d\d-\d\d$/.test(date)?date:""});
          return;
        }
        if (message.action === "showHistoricalLog") {
          const date=String(message.date||"");
          await vscode.commands.executeCommand("vertex.showLogs",{sessionId:String(message.sessionId||""),conversationId:String(message.conversationId||""),fullScreen:true,mode:"flow",promptKey:String(message.promptKey||""),date:/^\d{4}-\d\d-\d\d$/.test(date)?date:""});
          return;
        }
        if(message.action==="openProjectFile"){try{await require("./file-links").open(vscode,message.reference);}catch(error){vscode.window.showWarningMessage("VERTEX: "+error.message);}return;}
        if (message.action === "openWebLink") {
          try { const url=new URL(String(message.url||""));if(["https:","http:"].includes(url.protocol)&&!url.username&&!url.password)await vscode.env.openExternal(vscode.Uri.parse(url.href)); }catch(_){}
          return;
        }
        if (message.action === "copyAnswer") {
          // The host's clipboard: a webview's own clipboard access depends on permissions VS Code may not give it.
          try { await vscode.env.clipboard.writeText(String(message.text || "")); await view.webview.postMessage({ copied: true }); }
          catch (error) { await view.webview.postMessage({ copied: false, error: error.message }); }
          return;
        }
        if (message.action === "openRun") {
          await vscode.commands.executeCommand("vertex.openTranspilerRun", { run_id: String(message.run_id), step: Number(message.step) });
          return;
        }
        if (message.action === "openSession") {
          await vscode.commands.executeCommand("vertex.openDebugSession", { session_id: String(message.session_id), step: Number(message.step) });
          return;
        }
        if (message.action === "openObject") {
          try { await ask.openObject({ object_type: String(message.object_type||""), object_name: String(message.object_name) }); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "interjectChat") {
          const pending = pendingChat, text = String(message.text || "").trim();
          const images = (Array.isArray(message.images) ? message.images : []).filter(image => image
            && /^image\/(png|jpeg|gif|webp)$/.test(image.media_type) && typeof image.data === "string" && image.data);
          if (!pending || pending.cancelled || pending.kind === "decision" || (!text && !images.length)) return;
          const timestamp = typeof message.timestamp === "string" && Number.isFinite(Date.parse(message.timestamp)) ? message.timestamp : new Date().toISOString();
          const recognitionId = "recognize-" + (++nextRequest);
          const progress = update => { if (update.remove || !pending.cancelled) Promise.resolve(view.webview.postMessage({progress:{id:recognitionId,auxiliary:true,images,...update}})).catch(() => {}); };
          if (!ask.interject?.(text, timestamp, images, progress)) {
            if(pending.started || images.length){await view.webview.postMessage({progress:{id:pending.id,userAdditionRejected:text,rejectedImages:images}});return;}
            pending.interjections ||= [];
            pending.interjections.push({ text, images, time: timestamp });
          }
          await view.webview.postMessage({ progress: { id: pending.id, userAddition: text + (images.length ? " [" + images.length + " screenshot(s)]" : "") } });
          return;
        }
        if (message.action === "stopChat") {
          if (reviewSurface?.running) { reviewSurface.stop(); return; }
          if (pendingChat && pendingChat.kind !== "decision" && !pendingChat.cancelled) {
            pendingChat.cancelled = true;
            ask.stop();
            await view.webview.postMessage(pendingChat.kind === "decision" ? {decisionStatus:"Stopping…"} : { progress: { id: pendingChat.id, status: "Stopping…" } });
          }
          return;
        }
        if (message.action === "chat") {
          if (continuing) return;
          if (pendingChat?.kind === "decision") {
            await view.webview.postMessage({progress:{id:message.requestId,remove:true,done:true}});
            await vscode.window.showWarningMessage("Wait for the Jev request to finish before sending a chat message.");
            return;
          }
          if (pendingChat || reviewSurface?.running) return;
          const requestId = Number.isInteger(message.requestId) ? message.requestId : ++nextRequest;
          if (requestId > nextRequest) nextRequest = requestId;
          // The window shows the question as written; the review's blocks go to the model with it, unseen.
          const zero = ask.state().contextMode === "zero";
          const webDecision=await ask.decideWeb(message.text),web=webDecision.web;
          const asked = web || zero ? null : reviewAsk;
          if (asked) { reviewAsk = null; await showReview(); }
          const images = (Array.isArray(message.images) ? message.images : []).filter(image => image
            && /^image\/(png|jpeg|gif|webp)$/.test(image.media_type) && typeof image.data === "string" && image.data);
          const shown = String(message.text || "").trim() || (asked ? (asked.review_result ? "Check the attached review findings against the code and explain which are valid." : asked.prompt_label ? asked.prompt_label + " (VERTEX prompt)" : "What does this change do, and is there a real problem with it?")
            : images.length ? "Inspect the screenshot and identify the likely problem or task from visible evidence. If unclear, ask a specific clarifying question." : "");
          if (!shown) { return; }
          const pending = pendingChat = { id: requestId, cancelled: false, kind: "chat", started:false, interjections: [] };
          try {
          const userMessage = "You: " + shown + (asked ? "  [" + review.askLabel(asked) + "]" : "")
            + (images.length ? "  [" + images.length + " screenshot" + (images.length > 1 ? "s" : "") + "]" : "");
          let taskKind=asked?"review":"thinking";
          const initialProgress={progress:{id:requestId,kind:taskKind,user:userMessage,status:taskKind==="review"?"Reviewing changes…":taskKind==="commit"?"Preparing commit message…":"Working…"}};
          await view.webview.postMessage(initialProgress);
          // Let the webview paint the question and the initial task animation before
          // tool-context collection starts doing synchronous work.
          await new Promise(resolve => setTimeout(resolve, 0));
            const scope = asked ? { review_ask: { object: asked.object, all: asked.all, blocks: asked.blocks.map(block => block.block) } } : undefined;
            const state = web || zero ? {} : (await toolContext(scope)) || {};
            if (pending.cancelled) { await view.webview.postMessage({progress:{id:requestId,stopped:true,done:true}}); return; }
            if (asked) {
              state.review_ask = { object: asked.object, all: asked.all, blocks: asked.blocks.map(block => block.block) };
              delete state.review_source;
              delete state.selected_fragment;
            }
            pending.started=true;
            const reply = await ask(asked ? review.askRequest(asked.review_result ? shown : message.text, asked) : shown, {model: message.model, state, web,webDecision,requestContext:message.requestContext,requestContextEdits:message.requestContextEdits,routeTopics:!!message.routeTopics,contextMode:asked?.system==="local"?"folder":asked?"sap":ask.state().contextMode,
              interjections: pending.interjections,
              ...(images.length ? { images } : {}),
              onProgress: update => {
                if(pending.cancelled)return;
                if(update.logSessionId){pending.logSessionId=update.logSessionId;pending.logConversationId=update.logConversationId||"";}
                if(pending.openLogWhenReady && update.logSessionId){
                  pending.openLogWhenReady=false;
                  const now=new Date(),date=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");
                  Promise.resolve(vscode.commands.executeCommand("vertex.showLogs",{sessionId:update.logSessionId,conversationId:update.logConversationId||"",fullScreen:true,mode:"flow",live:true,date})).catch(()=>{});
                }
                Promise.resolve(view.webview.postMessage({ progress: { id: requestId, ...update } })).catch(() => {});
              } });
            if (pending.cancelled || reply.stopped) { await view.webview.postMessage({progress:{id:requestId,stopped:true,done:true}}); return; }
            if (reply.superseded) { await view.webview.postMessage({ progress: { id: requestId, remove: true } }); return; }
            await view.webview.postMessage({ progress: { id: requestId,
              answer: reply.answer + (reply.navigationError ? "\n\nVERTEX could not open the object: " + reply.navigationError : ""),
              done: true, ...(reply.topic?{topic:reply.topic}:{}), model: reply.model, usage: usageLine(reply)+(reply.planner?" · Jev tools: "+usageLine(reply.planner):""), choices: reply.choices || [],
              runs: (await vscode.commands.executeCommand("vertex.knownEvidenceSessions")) || [] } });
            await view.webview.postMessage({topicList:ask.topics?.()||[]});
            // The answer names a VERTEX function to run - a table's data, a
            // class's diff - and the panel has no view of its own for it, so
            // a Tools window opens on it, on the panel's system.
            await updateFileLinks(true);
            if (reply.navigation) { await vscode.commands.executeCommand("vertex.tools", reply.navigation); }
          }
          catch (error) { await view.webview.postMessage({ progress: { id: requestId,
            ...(pending.cancelled ? {stopped:true} : {answer: "Request failed: " + error.message}), done: true } }); }
          finally { if(pendingChat===pending)pendingChat=null; }
          return;
        }
        // The gear beside the MCP list: the settings of the server picked there, where they live - VERTEX's own, or,
        // for SAP ADT, those of SAP's ABAP Development Tools, which decide what that server may do.
        if (message.action === "mcpServers") { await vscode.commands.executeCommand("vertex.mcpServers"); return; }
        if (message.action === "mcpSettings") {
          if (!chatMcp) return;
          if(String(message.name)===chatMcp.ORCHESTRATOR){await vscode.commands.executeCommand("vertex.configureOrchestrator");return;}
          await vscode.commands.executeCommand("workbench.action.openSettings", chatMcp.settingsQuery(String(message.name || "")));
          return;
        }
        if (message.action === "mcp") {
          if (!chatMcp) return;
          const names = chatMcp.choices();
          if (!names.includes(String(message.name))) { vscode.window.showErrorMessage("VERTEX: " + String(message.name) + " is not in vertex.chat.mcpServers."); void refresh(); return; }
          // Picked again while already selected: that is the way back to the write question.
          const reselected = chatMcp.selected() === String(message.name);
          await chatMcp.select(String(message.name));
          if (String(message.name) === chatMcp.VERTEX || String(message.name) === chatMcp.ORCHESTRATOR) return;
          /* Its write settings are asked first, in the same window; the server starts when the user presses Start.
             Asked once per system and client: when this one has already answered, the server starts straight away
             and only the start scene is shown. Picking the server that is already selected asks again, which is
             how the answer is changed. */
          const options = chatMcp.writeOptions(String(message.name));
          const asked = options.length && (reselected || !chatMcp.accessRemembered(String(message.name)));
          if (asked) { await view.webview.postMessage({ mcpOptions: { name: String(message.name), options } }); return; }
          message = { action: "mcpStart", name: String(message.name), values: {} };
        }
        if (message.action === "mcpStart") {
          if (!chatMcp || String(message.name) !== chatMcp.selected()) return;
          try {
            for (const [setting, value] of Object.entries(message.values || {})) await chatMcp.setWriteOption(setting, String(value));
          } catch (error) {
            await view.webview.postMessage({ mcpDone: { name: String(message.name), error: error.message } });
            return;
          }
          // Installing when npx does not have the package yet; starting (the orbiter with the name on its hull) otherwise.
          const installing = chatMcp.needsInstall(String(message.name));
          await view.webview.postMessage({ mcpStart: { name: String(message.name), running: !!(chatMcp.servers().find(item => item.name === String(message.name)) || {}).url,
            installing, scene: require("./task-visual").html(installing ? "install" : "start", false, String(message.name)) } });
          try {
            const started = await chatMcp.prepare();
            await view.webview.postMessage({ mcpDone: { name: String(message.name), tools: started ? started.tools.length : 0 } });
          } catch (error) {
            await view.webview.postMessage({ mcpDone: { name: String(message.name), error: error.message, nodeMissing: !!error.nodeMissing } });
          }
          return;
        }
        if (message.action === "client") {
          // Only a client of the active system's own list; the panel and the SAP Systems table show the same one.
          const chosen = active();
          if (chosen.error || chosen.system.name !== message.name || !(chosen.system.clients || []).includes(String(message.client))) {
            vscode.window.showErrorMessage("VERTEX: " + String(message.client) + " is not a client of " + message.name + "."); void refresh(); return;
          }
          await clients.set(message.name, String(message.client));
          return;
        }
        if (!Object.hasOwn(ACTIONS, message.action)) { return; }
        try {
          await vscode.commands.executeCommand(ACTIONS[message.action],
            ...(message.action === "system" ? [message.name] : []));
        } catch (error) {
          vscode.window.showErrorMessage("VERTEX: " + error.message);
        }
      });
      const changes = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("vertex")) { void refresh(); void showFolder(); }
      });
      const folderWatch = [vscode.window.onDidChangeActiveTextEditor(() => { void showFolder(); }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => { void showFolder(); })];
      const clientSwitch = clients.onChange(() => { void refresh(); });
      const mcpUpdates = chatMcp ? chatMcp.onUpdates(() => { void refresh(); }) : { dispose() {} };
      view.onDidDispose(() => { void reviewSurface?.dispose(); reviewSurface=null; currentView = undefined; ready = false; messages.dispose(); changes.dispose(); folderWatch.forEach(watch => watch.dispose()); clientSwitch.dispose(); mcpUpdates.dispose(); });
    }
  };
  // The panel holds the chat: switching to Explorer and back must not wipe the conversation on screen.
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("vertex.launcher", provider,
    { webviewOptions: { retainContextWhenHidden: true } }));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.showPanel", () =>
    vscode.commands.executeCommand("vertex.launcher.focus")));
}

/* One line under an answer: the model and what it cost in tokens. */
// CodeMie's estimated cost keeps the precision of the reported number.
function costText(cost) {
  if (typeof cost !== "number" || !isFinite(cost)) { return ""; }
  return " · ≈ $" + cost.toLocaleString("en-US", { maximumSignificantDigits: 21, useGrouping: false });
}
function usageLine(reply) {
  const line = usageText(reply), limits = require("./openai-compatible").limitsText(reply.limits);
  return limits ? (line ? line + "\n" : "") + limits : line;
}
function usageText(reply) {
  const usage = reply.usage;
  const actual = usage && usage.cost_usd;
  const cost = typeof actual === "number" && Number.isFinite(actual) && actual >= 0
    ? " · $" + actual.toLocaleString("en-US", { maximumSignificantDigits: 21, useGrouping: false }) + (usage.cost_missing ? " (partial)" : "")
    : costText(reply.cost) || " · cost not reported";
  if (reply.direct) { return "searched the system directly · no tokens"; }
  if (!usage) { return reply.model ? reply.model + " · token usage not reported" + cost : ""; }
  const k = n => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n || 0);
  const input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  return (reply.model ? reply.model + " · " : "") + k(input) + " in (" + k(usage.cache_read_input_tokens) + " from cache) · "
    + k(usage.output_tokens) + " out" + cost;
}

// The extension's own mark, inline: the view loads nothing from disk.
const LOGO = "data:image/png;base64,"
  + require("fs").readFileSync(require("path").join(__dirname, "images", "logo.png")).toString("base64");

function historyScript(jev) { return `
let historyItems=[],historyLoading=false,historyOpening=false,historyRequest=0,historyIsJev=${jev};
const historyBox=document.getElementById('conversation-history'),historyStatus=document.getElementById('history-status');
function historyTime(value){const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';const pad=n=>String(n).padStart(2,'0'),clock=pad(date.getHours())+':'+pad(date.getMinutes());const now=new Date();return date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth()&&date.getDate()===now.getDate()?clock:pad(date.getDate())+'.'+pad(date.getMonth()+1)+'.'+pad(date.getFullYear()%100)+' '+clock;}
 function renderHistory(){
 const newChat=document.getElementById('new-conversation');if(newChat)newChat.disabled=historyOpening;
 const list=document.getElementById('history-list');list.replaceChildren();
 const query=document.getElementById('history-search').value.trim().toLocaleLowerCase();
 const typePicker=document.getElementById('jev-history-type');
 const type=historyIsJev?typePicker.value:'';
 const matches=historyItems.filter(item=>(!type||item.decisionType===type)&&(item.title+' '+item.lastQuestion+' '+item.providers).toLocaleLowerCase().includes(query));
 for(const item of matches){const button=document.createElement('button');button.type='button';button.className='secondary history-item';button.disabled=(historyIsJev?decisionRunning:chatRunning)||historyOpening;button.title=item.lastQuestion;
 const title=document.createElement('span');title.className='history-title';title.textContent=item.title||'(no prompt text)';
 const meta=document.createElement('span');meta.className='history-meta';meta.textContent=(item.time?historyTime(item.time)+' · ':'')+item.count+' questions · '+item.providers;
 button.append(title,meta);button.onclick=()=>{if((historyIsJev?decisionRunning:chatRunning)||historyOpening)return;historyOpening=true;historyStatus.textContent=historyIsJev?'Loading Jev request…':'Restoring conversation…';renderHistory();api.postMessage({action:historyIsJev?'continueJevHistory':'continueHistory',id:item.id});};list.appendChild(button);}
 if(!historyLoading&&!historyOpening)historyStatus.textContent=matches.length?'':query||type?'No matches.':historyIsJev?'No saved Jev requests.':'No saved conversations.';
}
const historyDateRange=document.getElementById('history-date-range');
const historyFrom=historyDateRange.querySelector('[data-date="from"]'),historyTo=historyDateRange.querySelector('[data-date="to"]');
function loadHistory(){if(historyOpening)return;historyLoading=true;if(!historyItems.length)historyStatus.textContent=historyIsJev?'Loading Jev requests…':'Loading conversations…';api.postMessage({action:historyIsJev?'jevHistory':'conversationHistory',from:historyFrom.value,to:historyTo.value,requestId:++historyRequest});}
window.vertexDateRange(historyDateRange,()=>{historyItems=[];renderHistory();if(historyBox.open)loadHistory();});
historyBox.ontoggle=()=>{if(historyBox.open){renderHistory();loadHistory();}};
document.getElementById('history-search').oninput=renderHistory;
const jevTypePicker=document.getElementById('jev-history-type');if(jevTypePicker)jevTypePicker.onchange=renderHistory;
window.addEventListener('message',event=>{const data=event.data||{};
 if(data.conversationHistory){if(data.conversationHistory.requestId!==historyRequest)return;historyLoading=!!data.conversationHistory.partial;historyItems=data.conversationHistory.items||[];
 if(historyIsJev){
   const picker=document.getElementById('jev-history-type'),selected=picker.value;
   const types=[...new Set(historyItems.map(item=>item.decisionType).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
   if(selected&&!types.includes(selected))types.push(selected);
   picker.replaceChildren(new Option('All Jev types',''),...types.map(type=>new Option(type,type)));
   picker.value=selected;
 }
 renderHistory();if(data.conversationHistory.message)historyStatus.textContent=data.conversationHistory.message;}
 if(data.historyContinued){historyOpening=false;historyBox.open=false;renderHistory();}
 if(data.historyError){historyOpening=false;renderHistory();historyStatus.textContent=data.historyError;}
});
`; }

function html(nonce, jev = false) {
  const shared = require("fs").readFileSync(require("path").join(__dirname, "resources", "log-report.html"), "utf8");
  const dateMarkup = shared.slice(shared.indexOf('<div id="date-range"'), shared.indexOf('<div class="vertex-segment-toggle"', shared.indexOf('<div id="date-range"')))
    .replace('id="date-range"', 'id="history-date-range"').replace(/ id="(?:from|to)"/g, "");
  const dateScript = shared.match(/<script id="vertex-date-range"[^>]*>([\s\S]*?)<\/script>/)[1];
  const historyMarkup = isJev => `<details id="conversation-history"><summary><span id="history-caption">${isJev?"Previous Jev requests":"Previous conversations · Continue a chat"}</span>${isJev?"":'<span id="topic-now"></span>'}</summary><div class="history-controls"><input type="search" id="history-search" aria-label="${isJev?"Search Jev requests":"Search conversations"}" placeholder="${isJev?"Search Jev requests…":"Search conversations…"}">${dateMarkup}${isJev?'<select id="jev-history-type" aria-label="Jev request type"><option value="">All Jev types</option></select>':""}</div><p id="history-status" role="status" aria-live="polite"></p><div id="history-list"></div></details>`;
  const head = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
html, body { height: 100%; margin: 0; }
/* Native checkboxes follow the theme: a dark scheme in dark and high-contrast themes, the focus colour when ticked (as in SAP Systems). */
body.vscode-dark, body.vscode-high-contrast { color-scheme: dark; }
input[type=checkbox] { accent-color: var(--vscode-focusBorder); }
body { background:var(--vscode-editor-background); box-sizing: border-box; display: flex; flex-direction: column; padding: 16px 16px 8px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h2 { font-size: 12px; text-transform: uppercase; margin: 8px 0 12px; }
p { line-height: 1.5; color: var(--vscode-descriptionForeground); }
#system { overflow-wrap: anywhere; margin-bottom: 16px; }
#messages { flex: 1 1 auto; min-height: 80px; overflow-y: auto; white-space: pre-wrap; }
/* Reuse the review view's offscreen containment: old answers need no layout on every resize. */
#messages > .vertex, #messages > .you { content-visibility: auto; contain-intrinsic-size: auto 180px; }
/* The question box and VERTEX Tools stay at the bottom; the answers scroll. */
.dock { flex: none; }
/* The attached review context: a quiet tag above the input, its name cut with an ellipsis, × to drop it. */
#review-chip { display: flex; align-items: center; gap: 6px; box-sizing: border-box; max-width: 100%; width: fit-content; margin-bottom: 6px;
  padding: 2px 2px 2px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent)); border-left: 3px solid var(--vscode-focusBorder);
  border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-input-background)); color: var(--vscode-foreground); font-size: 12px; }
#review-chip[hidden] { display: none; }
#review-result-preview{max-height:220px;overflow:auto;margin:4px 0 8px;padding:6px 8px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editorWidget-background)}
#review-result-preview[hidden]{display:none!important}
#review-result-preview>summary{cursor:pointer}
/* Pasted screenshots: the review chip's tag, one per image, a thumbnail and × to drop it. */
#image-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
#image-chips[hidden] { display: none; }
.image-chip { display: flex; align-items: center; gap: 4px; padding: 2px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
  border-left: 3px solid var(--vscode-focusBorder); border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-input-background)); }
.image-chip img { display: block; height: 48px; max-width: 96px; object-fit: cover; border-radius: 2px; }
#chat .image-chip button { flex: none; width: auto; margin: 0; padding: 0 6px; line-height: 18px; border-radius: 3px; background: transparent; color: var(--vscode-foreground); opacity: .7; }
#chat .image-chip button:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); box-shadow: none; }
#review-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#chat #review-chip button { flex: none; width: auto; margin: 0; padding: 0 6px; line-height: 18px; border-radius: 3px; background: transparent; color: var(--vscode-foreground); opacity: .7; }
#chat #review-chip button:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground)); box-shadow: none; }
#messages .copy-answer { margin: -0.6em 0 1em; padding: 2px 8px; font-size: 11px; }
#messages .review-discuss { margin-left: 6px; }
#messages p.usage { font-size: 11px; opacity: .7; margin: -0.6em 0 1em; white-space: pre-line; }
#messages p.tool-status { font-size: 11px; opacity: .8; }
#messages p.you { color: var(--vscode-charts-blue); }
#messages .you .message-time { display: block; text-align: right; color: var(--vscode-descriptionForeground); font-size: .8em; white-space: nowrap; }
#messages .vertex { color: var(--vscode-charts-green); white-space: normal; line-height: 1.5; margin: 1em 0; }
/* Fixed logo slot: the existing VERTEX mark rotates slowly only while this request is active. */
#messages .vertex.task { position: relative; min-height:36px; padding-left: 42px; }
/* Active status and its 32px logo must be laid out before scrolling to the bottom. */
#messages > .vertex.task.working { content-visibility:visible; }
#messages .md-table { overflow-x: auto; margin: 6px 0; }
#messages .md-table table { border-collapse: collapse; font-size: inherit; }
#messages .md-table th, #messages .md-table td { border: 1px solid var(--vscode-panel-border); padding: 3px 8px; text-align: left; vertical-align: top; }
#messages .md-table th { background: var(--vscode-editorWidget-background,var(--vscode-sideBar-background)); font-weight: 600; }
#messages .vertex.task::before { content: ""; position: absolute; left: 0; top: 2px; width: 32px; height: 32px; background: url("${LOGO}") center/contain no-repeat; transform-origin: center; }
#messages .vertex.task:not(.working)::before { visibility: hidden; }
#messages .vertex.task.working::before { animation: vertex-task-turn 6s linear infinite; }
@keyframes vertex-task-turn { to { transform: rotate(360deg); } }
/* Without motion - vertex.animations off, or auto when Windows or VS Code ask for reduced motion - the turning logo
   and the waiting scenes are not shown at all: a still one says nothing. */
body.vscode-reduce-motion:not(.vertex-motion-on) #messages .vertex.task::before { display: none; }
body.vscode-reduce-motion:not(.vertex-motion-on) #messages .vertex.task { padding-left: 0; }
@media (prefers-reduced-motion: reduce) { body:not(.vertex-motion-on) #messages .vertex.task::before { display: none; } body:not(.vertex-motion-on) #messages .vertex.task { padding-left: 0; } }
body.vertex-motion-off #messages .vertex.task::before { display: none; }
body.vertex-motion-off #messages .vertex.task { padding-left: 0; }
body.vertex-motion-off *, body.vertex-motion-off *::before, body.vertex-motion-off *::after { animation: none !important; }
${require(require("path").join(__dirname,"task-visual")).css}
#messages .vertex.task[data-task-kind]::before{display:none}
#messages .vertex.task .task-scene{display:block;width:100%;margin-top:6px;cursor:pointer}
#messages .vertex.task:is([data-task-kind="thinking"],[data-task-kind="search"],[data-task-kind="tooling"]) .task-scene{position:absolute;left:0;top:0;width:36px;height:36px;margin:0}
#messages .vertex.task[data-task-kind="thinking"] .stream-part.thinking{position:relative;padding-left:42px}
#messages .vertex.task[data-task-kind="thinking"] .stream-part.thinking .task-scene{left:0;right:auto;top:auto;bottom:0}
#messages .vertex.task:is([data-task-kind="thinking"],[data-task-kind="search"],[data-task-kind="tooling"]) .task-timed{width:36px;height:36px}
#messages .vertex.task:is([data-task-kind="thinking"],[data-task-kind="search"],[data-task-kind="tooling"]) .task-timed>.vertex-task-visual{flex:none}
#messages .vertex.task .task-scene .task-timer{display:none}
#messages .request-timer{display:inline-flex;align-items:center;gap:8px;margin-top:6px;color:var(--vscode-foreground);font:600 12px/1 var(--vscode-editor-font-family,monospace);font-variant-numeric:tabular-nums;letter-spacing:.08em}
#messages .request-timer::before{content:"";flex:none;width:6px;height:6px;border:1px solid var(--vscode-focusBorder);transform:rotate(45deg);box-shadow:0 0 5px var(--vscode-focusBorder);animation:vertex-timer-signal 2s ease-in-out infinite}
@keyframes vertex-timer-signal{50%{opacity:.35;box-shadow:none}}
@media (prefers-reduced-motion:reduce){body:not(.vertex-motion-on) #messages .request-timer::before{animation:none}}
body.vscode-reduce-motion:not(.vertex-motion-on) #messages .request-timer::before{animation:none}
#vercel-row-break { display:none; }
body[data-provider="vercel-api"] #vercel-row-break, body[data-provider="opencode-api"] #vercel-row-break, body[data-provider="openrouter-api"] #vercel-row-break { display:block; flex-basis:100%; height:0; }
#subprovider-select[hidden] { display:none; }
/* No provider offered (none ticked in LLM Providers): there is nothing to choose, so the choice is not shown. */
body.no-providers #provider-select, body.no-providers #vercel-row-break, body.no-providers #subprovider-select, body.no-providers .model-picker, body.no-providers #effort-select, body.no-providers #model-status { display:none !important; }
/* Hide model controls while the catalog is pending or unavailable. Keep provider switching available. */
body.models-loading #vercel-row-break, body.models-loading #subprovider-select, body.models-loading .model-picker, body.models-loading #effort-select { display:none !important; }
body.no-choice #vercel-row-break, body.no-choice #subprovider-select, body.no-choice .model-picker, body.no-choice #effort-select, body.no-choice #model-status { display:none !important; }
body.model-list-pending #vercel-row-break, body.model-list-pending #subprovider-select, body.model-list-pending .model-picker, body.model-list-pending #effort-select { display:none !important; }
body[data-provider="vercel-api"] #subprovider-select, body[data-provider="opencode-api"] #subprovider-select, body[data-provider="openrouter-api"] #subprovider-select { flex:0 1 150px; max-width:45%; }
body[data-provider="vercel-api"] .model-picker, body[data-provider="opencode-api"] .model-picker, body[data-provider="openrouter-api"] .model-picker { flex:1 1 170px; }
.model-picker { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }
.model-picker #model-select { flex: 1 1 auto; min-width: 0; }
.line #model-details-button[hidden], .line #mcp-settings[hidden], .line #mcp-servers[hidden], .line #mcp-update[hidden] { display: none; }
.line #model-details-button, .line #mcp-settings, .line #mcp-servers, .line #mcp-update { flex: none; margin: 0; padding: 3px 8px; }
#request-context-dialog,#model-details-dialog { box-sizing: border-box; width: calc(100% - 24px); max-width: 560px; max-height: 80vh; overflow: auto; padding: 14px 18px; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background,var(--vscode-editor-background)); border: 1px solid var(--vscode-widget-border,var(--vscode-contrastBorder,var(--vscode-panel-border))); box-shadow: 0 4px 18px var(--vscode-widget-shadow,transparent); }
#request-context-dialog::backdrop,#model-details-dialog::backdrop { background: var(--vscode-widget-shadow,transparent); }
#mcp-start-dialog { box-sizing: border-box; width: calc(100% - 24px); max-width: 560px; padding: 14px 18px; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background,var(--vscode-editor-background)); border: 1px solid var(--vscode-widget-border,var(--vscode-contrastBorder,var(--vscode-panel-border))); box-shadow: 0 4px 18px var(--vscode-widget-shadow,transparent); }
#mcp-start-dialog::backdrop { background: var(--vscode-widget-shadow,transparent); }
#mcp-start-dialog .mcp-start-scene { display: block; margin: 10px 0; }
#mcp-start-dialog .mcp-start-scene .vertex-task-visual { min-height: 48px; }
#mcp-start-status { margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
#mcp-start-dialog form { display: flex; gap: 8px; margin-top: 12px; }
#mcp-start-options fieldset { margin: 10px 0 0; padding: 6px 10px; border: 1px solid var(--vscode-panel-border); }
#mcp-start-options label { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
#mcp-start-options .mcp-start-hint { margin-top: 8px; color: var(--vscode-descriptionForeground); }
#model-details-dialog .model-detail { margin: 8px 0; white-space: normal; overflow-wrap: anywhere; }
#model-details-dialog form { margin-top: 12px; }
#messages .streaming-answer { white-space: pre-wrap; overflow-wrap: anywhere; }
#messages .vertex p, #messages .vertex ul, #messages .vertex ol { margin: .4em 0; color: inherit; }
#messages .vertex ul, #messages .vertex ol { padding-left: 1.4em; }
#messages .vertex code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
#messages .vertex pre { white-space: pre; overflow-x: auto; background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 3px; }
#messages .vertex pre code { background: none; padding: 0; }
#messages .stream-part { white-space: pre-wrap; overflow-wrap: anywhere; }
#messages .stream-part + .stream-part { margin-top: .55em; }
#messages .stream-part.thinking { color: var(--vscode-charts-purple, var(--vscode-descriptionForeground)); }
#messages .stream-part.answer { color: var(--vscode-charts-green, var(--vscode-editor-foreground)); }
textarea, select { box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, ButtonBorder)); border-radius: 4px; font: inherit; }
textarea { width: 100%; resize: vertical; padding: 8px; }
#prompt { min-height: 5.5em; max-height: 14em; overflow-y: auto; padding-right: 30px; }
#prompt.expanded { min-height: 60vh; max-height: 70vh; }
.prompt-box { position: relative; }
.chat-actions{display:flex;justify-content:flex-end;gap:6px;padding-top:6px}
#chat #new-conversation,#chat #chat-stop{display:inline-flex;align-items:center;width:auto;margin:0}
#chat #chat-stop{gap:6px}
#chat #chat-stop[hidden],#chat #new-conversation[hidden]{display:none}
.chat-actions #topic-picker-label{margin-right:auto}
#messages .task-flow { position:absolute;left:0;top:2px;width:32px;height:32px;padding:0;margin:0;background:transparent;border:0;cursor:pointer; }
body.vscode-reduce-motion:not(.vertex-motion-on) #messages .task-flow,body.vertex-motion-off #messages .task-flow { position:static;width:auto;height:auto;padding:2px 6px;color:var(--vscode-button-foreground);background:var(--vscode-button-background); }
body.vscode-reduce-motion:not(.vertex-motion-on) #messages .task-flow::after,body.vertex-motion-off #messages .task-flow::after { content:'Flow'; }
@media (prefers-reduced-motion: reduce) { body:not(.vertex-motion-on) #messages .task-flow { position:static;width:auto;height:auto;padding:2px 6px;color:var(--vscode-button-foreground);background:var(--vscode-button-background); } body:not(.vertex-motion-on) #messages .task-flow::after { content:'Flow'; } }
#messages .task:not(.working) .task-flow { display:none; }
#chat #expand-prompt { position: absolute; top: 4px; right: 4px; width: auto; margin: 0; padding: 0 6px; font-size: 14px; line-height: 20px; opacity: .75; }
#chat #expand-prompt:hover { opacity: 1; }
button { margin: 8px 0; padding: 8px 12px; border: 0; border-radius: 4px; cursor: pointer; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button:hover { background: var(--vscode-button-hoverBackground); }
#chat button { width: 100%; }
/* The outline of vertex-controls.css's plain button and the toggles: a secondary button stays a button on a background like its own. */
.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, ButtonBorder));
  border-bottom: 2px solid var(--vscode-input-border, var(--vscode-panel-border, ButtonBorder)); }
.secondary:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground)); box-shadow: inset 0 0 0 1px var(--vscode-focusBorder); }
.link { color: var(--vscode-textLink-foreground); text-decoration: none; cursor: pointer; }
.link:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
/* The AI and SAP logs are the view's title actions, beside the settings (the user's choice, for the space); the
   working folder stands in the SAP system line. */
#folder-line { margin-left: 6px; overflow-wrap: anywhere; }
.context-check { display:inline-flex; align-items:center; gap:3px; white-space:nowrap; }
.context-check input { margin:0; accent-color:var(--vscode-focusBorder); }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.line button { margin: 4px 0; padding: 4px 10px; }
.line select { padding: 3px 4px; }
/* EPAM CodeMie, while it is the chosen provider: its indigo-violet-magenta on the provider list and on
   VERTEX Tools, darkened for white text (4.7:1 at
   least) in light and dark themes; a high-contrast theme keeps its own colours. The open list stays the theme's. */
body.vscode-dark[data-provider="codemie"] #provider-select, body.vscode-light[data-provider="codemie"] #provider-select,
body[data-provider="codemie"] #provider-select option { color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); background: var(--vscode-dropdown-background, var(--vscode-input-background)); }
.chat-head { margin-bottom: 4px; }

#system-context summary{cursor:pointer;list-style:none;width:max-content;gap:4px;border-radius:4px}
#request-context-text{display:block;width:100%;resize:vertical}
.context-block{display:flex;align-items:baseline;gap:4px}
#system-context .system-context-actions{justify-content:flex-end}
#request-context-blocks{display:grid;gap:4px;border:1px solid var(--vscode-panel-border)}
.context-tooltip{position:relative}
.context-tooltip:is(:hover,:focus-visible)::after{content:attr(data-tooltip);position:absolute;z-index:10;inset-inline-end:0;top:100%;width:max-content;max-width:min(260px,80vw);white-space:normal;text-align:start;padding:5px 8px;color:var(--vscode-editorHoverWidget-foreground,var(--vscode-foreground));background:var(--vscode-editorHoverWidget-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-editorHoverWidget-border,var(--vscode-panel-border));pointer-events:none}
#system-context summary.context-tooltip::after{inset-inline-end:auto;inset-inline-start:0}
#system-context select{max-width:100%}
#reference-folders label{overflow-wrap:anywhere}
#chat-header{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.folder-context-controls,#sap-context-controls{min-width:0}
.sap-launcher-row{margin-inline-start:auto;min-width:0;flex-wrap:nowrap}
#context-controls{flex:1;min-width:0}
.sap-launcher-row:has(#sap-context-controls[hidden]){display:none}
#chat-header:has(#sap-context-controls:not([hidden])) .sap-launcher-row{flex:1 1 100%}
#sap-context-controls{flex:1;flex-wrap:nowrap}
#sap-context-controls select{min-width:0;text-overflow:ellipsis}
#sap-context-controls #mcp-select{width:108px;flex:0 1 108px}
#sap-context-controls[hidden]{display:none}
.window-launchers{margin-inline-start:auto;flex:none}
#jev-mode{flex:none;margin-inline-start:auto;padding:2px 8px;white-space:nowrap}
/* AI Review in the main chat: its settings above the input, its questions and answers as chat steps. */
#ai-review-box,.prompt-overlay{--bg:var(--vscode-sideBar-background,var(--vscode-editor-background));--fg:var(--vscode-foreground);--border:var(--vscode-panel-border);--muted:var(--vscode-descriptionForeground)}
#ai-review-box{margin:0 0 6px;padding:6px 8px;border:1px solid var(--vscode-panel-border);border-left:3px solid var(--vscode-focusBorder);border-radius:4px;background:var(--vscode-editorWidget-background,var(--vscode-sideBar-background))}
#ai-review-box[hidden]{display:none}
.ai-review-head{display:flex;align-items:center;gap:6px;min-width:0}
#ai-review-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ai-review-scope{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#chat #ai-review-box button{width:auto;margin:0}
#chat #ai-review-close{flex:none;width:28px;height:28px;padding:0;line-height:24px;font-size:20px;font-weight:700;color:var(--vscode-errorForeground,var(--vscode-foreground));background:var(--vscode-inputValidation-errorBackground,var(--vscode-editorWidget-background));border:1px solid var(--vscode-errorForeground,var(--vscode-focusBorder));border-radius:4px}
#chat #ai-review-close:hover{color:var(--vscode-button-foreground);background:var(--vscode-errorForeground,var(--vscode-button-background))}
#ai-review-stale{margin:6px 0 0;padding:4px 8px;border-left:3px solid var(--vscode-editorWarning-foreground)}
#ai-review-stale[hidden]{display:none}
#ai-review-settings{margin:6px 0 0}#ai-review-settings>summary{cursor:pointer;color:var(--vscode-descriptionForeground)}
#ai-review-settings .prompt-bar{margin:6px 0}#ai-review-settings .vertex-segment-toggle{max-width:100%;flex-wrap:wrap}
.ai-review-task{display:flex;flex-direction:column;gap:4px;margin:6px 0;font-size:12px}
#ai-review-task{max-height:160px}
#ai-review-status{margin:4px 0 0;white-space:pre-wrap;color:var(--vscode-descriptionForeground)}#ai-review-status:empty{display:none}
#ai-review-status[data-state="error"]{color:var(--vscode-errorForeground)}
#messages .review-step{border-left:3px solid var(--vscode-focusBorder);padding-left:8px}
#topic-view{flex:none}#topic-view[hidden]{display:none}#topic-view-select{flex:1;min-width:0;max-width:100%}
#topic-now{color:var(--vscode-descriptionForeground,var(--vscode-foreground));font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#topic-picker{max-width:100%}#topic-picker-label{display:inline-flex;align-items:center;gap:6px;margin:4px 14px 4px 0;vertical-align:middle}#topic-picker-label[hidden]{display:none}
#conversation-history{flex:none;margin:6px 0;border-bottom:1px solid var(--vscode-panel-border)}
#conversation-history>summary{cursor:pointer;padding:6px 0;color:var(--vscode-foreground)}
.history-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:4px 0}
#history-date-range{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
#history-date-range label[hidden],#history-date-range [hidden]{display:none}
#history-date-range .log-context{font:inherit;padding:3px 6px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border))}
#history-search{flex:1 0 100%;box-sizing:border-box;min-width:0;font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-panel-border));padding:5px}
#history-list{max-height:30vh;overflow:auto;margin:4px 0}
button.history-item{display:block;width:100%;text-align:left;margin:3px 0;padding:7px 9px}
.history-title,.history-meta{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history-title{font-weight:600}.history-meta,#history-status{font-size:.9em;color:var(--vscode-descriptionForeground)}
#tools { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; font-size: 1em; }
#tools[hidden] { display: none; }
#tools .tools-logo { position: relative; flex: none; width: 18px; height: 18px; }
#tools .tools-logo::before { content: ""; position: absolute; inset: 0; background: url("${LOGO}") center/contain no-repeat; transform-origin: center; animation: vertex-task-turn 18s linear infinite; }
body.vscode-reduce-motion #tools .tools-logo::before { animation: none; }
@media (prefers-reduced-motion: reduce) { #tools .tools-logo::before { animation: none; } }
${require(require("path").join(__dirname,"git-prompt-bar")).CSS}
${require(require("path").join(__dirname,"code-review")).controlsCss}
${require(require("path").join(__dirname,"jev-panel")).css}
</style></head>`;
  if (jev) {
    const decision = require(require("path").join(__dirname,"jev-panel"));
    return head+`<body class="jev-window">
${historyMarkup(true)}
${decision.html}
<script nonce="${nonce}">
const api = acquireVsCodeApi();
${dateScript}
${historyScript(true)}
${decision.script}
api.postMessage({action:'ready'});
</script></body></html>`;
  }
  return head+`<body class="model-list-pending ${require(require("path").join(__dirname,"motion")).mode()==="auto"?"":"vertex-motion-"+require(require("path").join(__dirname,"motion")).mode()}">
<dialog id="mcp-start-dialog" aria-labelledby="mcp-start-title"><strong id="mcp-start-title">MCP server</strong><span class="mcp-start-scene" id="mcp-start-scene"></span><div id="mcp-start-status" role="status" aria-live="polite"></div><div id="mcp-start-options"></div><form method="dialog"><button type="button" class="secondary" id="mcp-start-go" hidden>Start</button><button type="button" class="secondary" id="mcp-start-node" hidden>Get Node.js</button><button class="secondary" id="mcp-start-close">Close</button></form></dialog>
<dialog id="request-context-dialog" aria-labelledby="request-context-title"><form method="dialog"><strong id="request-context-title"></strong><p class="note">Preview for the next request. Save replaces this block until you reset it or reload the panel.</p><textarea id="request-context-text" rows="14" aria-label="Context block text"></textarea><p id="request-context-error" class="note" role="status"></p><div class="line"><button type="button" class="secondary" id="request-context-save">Save</button><button type="button" class="secondary" id="request-context-reset">Reset</button><button class="secondary">Close</button></div></form></dialog>
<dialog id="model-details-dialog" aria-labelledby="model-details-title"><strong id="model-details-title">Model details</strong><div id="model-capabilities"></div><form method="dialog"><button class="secondary">Close</button></form></dialog>
<div id="chat-header"><div class="line" id="context-controls"><label class="context-check"><input type="checkbox" data-context="sap"><span>SAP</span></label><div class="line folder-context-controls"><label class="context-check" title="Right-click or press Shift+F10 to add folders for reading"><input type="checkbox" data-context="folder" checked><span>Folder</span></label><span class="context-controls-spacer"></span><span id="folder-line" hidden><a href="#" class="link" id="folder-name" title="Choose a project folder for VERTEX without changing the VS Code workspace"></a> <button class="secondary" data-action="gitHistory" id="git-history" title="GitHub operations">GIT</button></span></div></div><button type="button" id="jev-mode" class="secondary context-tooltip" data-tooltip="Open VERTEX Jev in an editor tab"><span aria-hidden="true">◇</span> Jev Decisions</button><div class="line sap-launcher-row"><div class="line" id="sap-context-controls" hidden><select id="system-select" aria-label="SAP system" title="Select SAP system"><option>Loading…</option></select>
<select id="client-select" aria-label="SAP client" title="SAP client" hidden></select>
<select id="mcp-select" aria-label="Chat MCP server" title="Select the MCP server for SAP tools" hidden></select><button type="button" class="secondary" id="mcp-settings" title="Settings of the selected MCP server" aria-label="Settings of the selected MCP server" hidden>⚙</button><button type="button" class="secondary" id="mcp-servers" title="MCP servers: descriptions, versions, toolsets and tools" aria-label="MCP servers: descriptions, versions, toolsets and tools" hidden>ⓘ</button><button type="button" class="secondary" id="mcp-update" hidden>Update</button></div><div class="line window-launchers"><button class="secondary" data-action="tools" id="tools" hidden title="Open VERTEX Tool for SAP"><span class="tools-logo" aria-hidden="true"></span>SAP Tools</button></div></div></div>
${historyMarkup(false)}
<div id="topic-view" class="line" hidden><label for="topic-view-select">Show conversation</label><select id="topic-view-select" aria-label="Visible conversation topic"><option value="current">Current topic</option><option value="all">All topics</option></select></div>
<main id="messages" aria-live="polite"><p class="chat-empty">Ask anything — about SAP or any project in your folder. You can paste screenshots here too.</p></main>
<div class="dock">
<div class="line chat-head"><select id="provider-select" aria-label="AI provider" title="AI provider"></select><span id="vercel-row-break" aria-hidden="true"></span><select id="subprovider-select" aria-label="Model provider" title="Model provider (model ID prefix)" hidden disabled></select><span class="model-picker"><select id="model-select" aria-label="Model" title="Model · Ctrl+C / Cmd+C copies the model ID"><option value="">Loading…</option></select><button type="button" class="secondary" id="model-details-button" title="Model capabilities, context and prices" aria-label="Model capabilities, context and prices" aria-haspopup="dialog" hidden disabled>$</button></span><select id="effort-select" aria-label="Effort" title="Effort: how much the model thinks before it answers" hidden></select><details id="system-context"><summary class="secondary vertex-icon-button context-tooltip" aria-label="System context: Full" data-tooltip="System context: all blocks enabled"><span aria-hidden="true">⚙</span> <span id="context-level">Full</span></summary><div class="line system-context-actions"><button type="button" class="secondary" id="close-system-context">Close</button></div><fieldset id="request-context-blocks"><legend>Request context</legend><div class="context-block"><input type="checkbox" data-request-context="host" aria-label="Include Environment and host rules" checked><a class="link" href="#" data-edit-context="host">Environment and host rules</a></div><div class="context-block"><input type="checkbox" data-request-context="code" aria-label="Include Code Agent" checked><a class="link" href="#" data-edit-context="code">Code Agent</a></div><div class="context-block"><input type="checkbox" data-request-context="build" aria-label="Include Build rules" checked><a class="link" href="#" data-edit-context="build">Build rules</a></div><div class="context-block"><input type="checkbox" data-request-context="agent" aria-label="Include VERTEX agent" checked><a class="link" href="#" data-edit-context="agent">VERTEX agent</a></div><div class="context-block"><input type="checkbox" data-request-context="history" aria-label="Include Previous conversation" checked><a class="link" href="#" data-edit-context="history">Previous conversation</a></div><div class="context-block"><input type="checkbox" data-request-context="workspace" aria-label="Include Current workspace" checked><a class="link" href="#" data-edit-context="workspace">Current workspace</a></div><div class="context-block"><input type="checkbox" data-request-context="rules" aria-label="Include Project rules" checked><a class="link" href="#" data-edit-context="rules">Project rules</a></div><div class="context-block"><input type="checkbox" data-request-context="logs" aria-label="Include Current VERTEX log context" checked><a class="link" href="#" data-edit-context="logs">Current VERTEX log context</a></div><div class="context-block"><input type="checkbox" data-request-context="tabs" aria-label="Include Open editor tabs" checked><a class="link" href="#" data-edit-context="tabs">Open editor tabs</a></div></fieldset><label>Primary folder <select id="primary-context-folder" aria-label="Primary folder for editing"></select></label><div id="reference-folders"></div><button type="button" class="secondary" id="toggle-system-context">Disable all</button></details></div><div class="note" id="model-status" role="status" aria-live="polite"></div>
<div id="work-composer">
<form id="chat"><span id="context-optimization-status" class="note" role="status"></span><section id="ai-review-box" aria-label="AI Review" hidden><div class="ai-review-head"><strong id="ai-review-title">AI Review</strong><span id="ai-review-scope" class="note"></span><button type="button" class="secondary" id="ai-review-restart" title="Start a new review of the current changes">Check again</button><button type="button" class="secondary" id="ai-review-close" title="Close AI Review and continue with the ordinary chat, its history and tools" aria-label="Close AI Review and continue in chat">×</button></div><p id="ai-review-stale" hidden>Changes have updated. This review checks the earlier snapshot. Select Check again to start a new review.</p><details id="ai-review-settings" open><summary id="ai-review-settings-label">Review settings · Technical review</summary><label class="ai-review-task">Requirements for this review (optional)<textarea id="ai-review-task" rows="3" placeholder="Enter requirements relevant to these changes"></textarea></label>${require(require("path").join(__dirname,"git-prompt-bar")).html(require(require("path").join(__dirname,"html-escape")).escapeHtml)}</details><p id="ai-review-status" role="status" aria-live="polite"></p></section><div id="review-chip" hidden><span id="review-label"></span><button type="button" id="review-clear" class="secondary" title="Ask without the review's blocks" aria-label="Remove the review context">×</button></div><details id="review-result-preview" hidden><summary>Attached review result</summary><div id="review-result-body"></div></details><div id="image-chips" hidden></div><div class="prompt-box"><button type="button" id="expand-prompt" class="secondary" title="Expand the message field" aria-label="Expand the message field" aria-pressed="false">⤢</button><textarea id="prompt" rows="4" placeholder="Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)" aria-label="Message"></textarea></div><div class="chat-actions"><span id="topic-picker-label" title="Jev assigns a topic to each request whenever the selected decision model is available. Choose whether chat history includes everything or only the topic Jev selects. Right-click Auto to choose the decision model (or press Shift+F10)." hidden><span class="vertex-segment-toggle" id="history-mode" role="group" aria-label="History"><button type="button" data-history="full" class="active" aria-pressed="true">Full history</button><button type="button" data-history="auto" aria-pressed="false" title="Right-click or press Shift+F10 to choose the decision model">Auto (Jev)</button></span><select id="topic-picker" hidden aria-hidden="true"><option value="full">Full history</option><option value="auto">Auto (Jev)</option></select><select id="decision-provider" aria-label="Decision model for Auto" title="Decision model for Auto, topic tagging and ASK Jev" hidden></select></span><button type="button" id="chat-stop" class="secondary" title="Stop AI response" aria-label="Stop AI response" hidden><span aria-hidden="true">■</span> Stop</button><button type="button" class="secondary" data-action="newConversation" id="new-conversation">New conversation</button></div></form>
</div>
</div>
<script nonce="${nonce}">
${dateScript}
const api = acquireVsCodeApi();

/* Full history or Auto (Jev) is kept as the setting; a topic is a choice for the next questions only. */
let routeMode='full';
function drawTopicPicker(wanted){const picker=document.getElementById('topic-picker'),chosen=wanted||picker.value||routeMode;picker.replaceChildren();for(const t of [{id:'full',label:'Full history'},{id:'auto',label:'Auto (Jev)'}]){const option=document.createElement('option');option.value=t.id;option.textContent=/^topic_/.test(t.id)?t.id+' · '+t.label:t.label;picker.append(option);}picker.value=Array.from(picker.options).some(x=>x.value===chosen)?chosen:routeMode;paintHistory();}
/* The toggle shows the choice the hidden list holds: Full history, Auto (Jev), or the topic chosen by hand. */
function paintHistory(){const value=document.getElementById('topic-picker').value;document.querySelectorAll('[data-history]').forEach(button=>{const on=button.dataset.history===value;button.classList.toggle('active',on);button.setAttribute('aria-pressed',String(on));});}
document.querySelectorAll('[data-history="full"],[data-history="auto"]').forEach(button=>button.addEventListener('click',()=>{const picker=document.getElementById('topic-picker');picker.value=button.dataset.history;picker.onchange({target:picker});paintHistory();}));
document.querySelector('[data-history="auto"]').addEventListener('contextmenu',event=>{event.preventDefault();if(document.getElementById('topic-picker').value==='auto')api.postMessage({action:'chooseDecisionModel'});});
document.getElementById('topic-picker').onchange=event=>{const value=event.target.value;if(value==='full'||value==='auto'){routeMode=value;api.postMessage({action:'setRouteTopics',value:value==='auto'});}};
let topicCatalog=[];
let topicViewMode='current';
function refreshTopicView(){
 const box=document.getElementById('messages'),control=document.getElementById('topic-view'),select=document.getElementById('topic-view-select');
 /* AI Review steps have no topic of their own: they stay visible and do not decide the current topic. */
 const messages=[...box.children].filter(item=>(item.classList.contains('you')||item.classList.contains('vertex'))&&!item.classList.contains('review-step'));
 const topics=new Map();for(const item of messages){const id=item.dataset.topicId;if(!id)continue;const text=(topicCatalog.find(t=>t.id===id)?.label||(item.classList.contains('you')?item.textContent.replace(/^You:\\s*/,''):'')).replace(/\\s+/g,' ').trim();if(/^Build VSIX$/i.test(text))continue;if(!topics.has(id)||(!topics.get(id)&&text))topics.set(id,text);}
 control.hidden=!topics.size;
 select.replaceChildren();for(const [value,label] of [['current','Current topic'],['all','All topics'],['unassigned','Without a topic'],...Array.from(topics,([id,label])=>[id,'T'+Number(id.slice(6))+' · '+(label||'Untitled topic').slice(0,65)])]){const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);}
 if(!['current','all','unassigned'].includes(topicViewMode)&&!topics.has(topicViewMode))topicViewMode='current';select.value=topicViewMode;
 const selected=topicViewMode==='current'?(messages.at(-1)?.dataset.topicId||''):topicViewMode==='unassigned'?'':topicViewMode;
 const visibleTopics=new Set([selected]);
 if(topicViewMode==='current'&&selected){
   const pending=[selected];
   while(pending.length){
     const id=pending.pop();
     const topic=topicCatalog.find(item=>item.id===id);
     for(const dependency of topic?.dependencies||[]){
       if(visibleTopics.has(dependency))continue;
       visibleTopics.add(dependency);
       pending.push(dependency);
     }
   }
 }
 for(const item of messages)item.hidden=topicViewMode!=='all'&&!visibleTopics.has(item.dataset.topicId||'');
}
document.getElementById('topic-view-select').onchange=e=>{topicViewMode=e.target.value;refreshTopicView();};
window.addEventListener('message',e=>{const d=e.data||{};if(d.historyContinued)topicViewMode=d.viewTopic||'all';/* A pinned topic from Continue a chat must not hide the exchange that just arrived under a new topic. */if(d.progress?.topic&&topicViewMode.startsWith('topic_')&&topicViewMode!==d.progress.topic.id)topicViewMode='current';if(d.chat||d.cleared||d.topicList||d.historyContinued||d.progress?.topic||d.progress?.done)queueMicrotask(refreshTopicView);});
function setTopic(item,topic){if(!topic||!/^topic_\\d{4,8}$/.test(topic.id))return;const canonical=typeof topicCatalog!=='undefined'&&topicCatalog.find(t=>t.id===topic.id);if(canonical)topic={...topic,label:canonical.label};item.dataset.topicId=topic.id;const colors=['blue','green','orange','purple','red','yellow'];const color='var(--vscode-charts-'+colors[Number(topic.id.slice(6))%colors.length]+',var(--vscode-focusBorder))';item.style.borderLeft='3px solid '+color;/* The topic is named once, in the Conversations header. A badge on every message said it twice per exchange and the
   working status said it a third time, all repeating the question standing right there; the coloured stripe on the
   left still groups the pair. */
const now=document.getElementById('topic-now');if(now){const words=topic.label.split(/\\s+/).filter(Boolean).slice(0,6).join(' ');now.textContent=words?' · '+words+(words.length<topic.label.trim().length?'…':''):'';now.title=topic.label+(topic.dependencies?.length?' · Dependencies: '+topic.dependencies.join(', '):'');}}
window.addEventListener('message',event=>{const d=event.data||{};if(d.decisionModels){const decision=document.getElementById('decision-provider');if(decision){decision.replaceChildren();const groups=new Map();for(const m of d.decisionModels.models){let group=groups.get(m.provider);if(!group){group=document.createElement('optgroup');group.label=m.providerLabel;groups.set(m.provider,group);decision.appendChild(group);}const option=document.createElement('option');option.value=JSON.stringify([m.provider,m.model]);option.textContent=m.label;group.appendChild(option);}const selected=d.decisionModels.selected;decision.value=JSON.stringify([selected.provider,selected.model]);decision.disabled=!decision.options.length;const model=Array.from(decision.options).find(option=>option.value===decision.value);const auto=document.querySelector('[data-history="auto"]');auto.textContent=model?'Auto (Jev) · '+selected.model:'Auto (Jev)';auto.title='Decision model: '+(model?model.parentElement.label+' · '+model.textContent:'none')+' · Right-click or press Shift+F10 to choose';}}if(d.progress?.topic&&!topicCatalog.some(t=>t.id===d.progress.topic.id)){topicCatalog=[...topicCatalog,d.progress.topic];drawTopicPicker();}if(typeof d.routeTopics==='boolean'){const picker=document.getElementById('topic-picker');routeMode=d.routeTopics?'auto':'full';drawTopicPicker(routeMode);}if(typeof d.jevOn==='boolean'){/* Jev switched off in LLM Providers: no history choice, the whole history goes. */document.getElementById('topic-picker-label').hidden=!d.jevOn;if(!d.jevOn)drawTopicPicker('full');}if(Array.isArray(d.topicList)){topicCatalog=d.topicList;drawTopicPicker();for(const item of document.querySelectorAll('[data-topic-id]')){const topic=topicCatalog.find(t=>t.id===item.dataset.topicId);if(topic)setTopic(item,topic);}} if(d.progress?.topicRouting){const r=d.progress.topicRouting;document.getElementById('context-optimization-status').textContent=r.topic?'T'+Number(r.topic.id.slice(6))+(r.basis==='manual'?' · manual':' · Jev')+(r.exchangesTotal?' · '+r.exchangesKept+' of '+r.exchangesTotal+' exchanges'+(r.savedPercent>=1?' · history '+Math.round(r.savedPercent)+'% shorter':''):''):'Full history: '+r.reason;}});
/* AI Review in the main chat. While a review is open, the input asks the review (its own conversation, no main-chat
   history, no tools); the review's settings - type, requirements, prompt files, Copy prompt - sit above the input, and
   each question and answer is a step of the chat. × closes the review; the next question goes to the chat again. */
const reviewHost=api;let reviewPageId='',reviewObject='',reviewBusy=false,reviewDrafting=false,reviewDraftSequence=0,reviewMainDraft=null;
const reviewBox=document.getElementById('ai-review-box');
const reviewSend=message=>{if(reviewPageId)reviewHost.postMessage({action:'aiReviewMessage',id:reviewPageId,message});};
function reviewStatus(text,state){const node=document.getElementById('ai-review-status');node.textContent=text||'';node.dataset.state=state||'info';}
function reviewKind(){return document.querySelector('#prompt-bar [data-kind].active')?.textContent||'Technical review';}
function reviewIdle(){reviewBusy=false;document.getElementById('ai-review-restart').disabled=false;document.getElementById('ai-review-settings').inert=false;}
{const api={postMessage:reviewSend,getState:()=>reviewHost.getState?.()||{},setState:value=>reviewHost.setState?.(value)};const operationStatus=(node,text,state)=>reviewStatus(text,state);
${require(require("path").join(__dirname,"git-prompt-bar")).SCRIPT}}
function loadReviewPrompt(){
 document.getElementById('ai-review-settings-label').textContent='Review settings · '+reviewKind();
 const id=++reviewDraftSequence,field=document.getElementById('prompt'),previous=field.value;reviewDrafting=true;
 const receive=e=>{const m=e.data||{};if(m.draftPrompt?.id!==id)return;window.removeEventListener('message',receive);if(id!==reviewDraftSequence)return;reviewDrafting=false;
  if(field.value===previous&&typeof m.draftPrompt.text==='string'){field.value=m.draftPrompt.text;fitPrompt();}if(m.draftPrompt.error)reviewStatus(m.draftPrompt.error,'error');};
 window.addEventListener('message',receive);reviewSend({action:'draftPrompt',kind:window.promptOptions().kind,id});
}
document.getElementById('prompt-bar').addEventListener('click',e=>{if(e.target.closest('[data-kind]'))loadReviewPrompt();});
document.getElementById('prompt-copy').onclick=()=>reviewSend({action:'copyPrompt',text:document.getElementById('prompt').value,task:document.getElementById('ai-review-task').value,...window.promptOptions()});
document.getElementById('ai-review-restart').onclick=()=>{if(reviewBusy||chatRunning)return;reviewBusy=true;document.getElementById('ai-review-restart').disabled=true;reviewStatus('Reading the current changes…');reviewSend({action:'restart'});};
document.getElementById('ai-review-close').onclick=()=>{if(reviewPageId)reviewHost.postMessage({action:'closeAiReview',id:reviewPageId});};
/* Registered before the chat's own submit handler: with a review open, the question goes to the review. */
document.getElementById('chat').addEventListener('submit',event=>{
 if(!reviewPageId)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(chatRunning||historyOpening||reviewBusy||reviewDrafting)return;
 const field=document.getElementById('prompt'),text=field.value.trim(),requestId=++nextRequest;
 setChatRunning(true);reviewBusy=true;document.getElementById('ai-review-restart').disabled=true;document.getElementById('ai-review-settings').inert=true;reviewStatus('');
 document.querySelector('#messages .chat-empty')?.remove();
 const you=document.createElement('p');you.className='you review-step';you.textContent='You: '+(text||reviewKind())+'  [AI Review · '+reviewObject+']';
 const step=document.createElement('div');step.className='vertex task working review-step';addTaskFlow(step);
 const body=document.createElement('div');body.className='progress-body streaming-answer';body.textContent='VERTEX: Reviewing changes…';step.appendChild(body);
 document.getElementById('messages').append(you,step);progressItems.set(requestId,step);
 reviewSend({action:'send',requestId,text,task:document.getElementById('ai-review-task').value,...window.promptOptions()});
 document.getElementById('ai-review-settings').open=false;field.value='';fitPrompt();
 field.placeholder='Ask a follow-up question about this review… (Enter to send)';
 const box=document.getElementById('messages');box.scrollTop=box.scrollHeight;
});
window.addEventListener('message',event=>{const data=event.data||{};
 if(data.aiReviewOpen){const open=data.aiReviewOpen,field=document.getElementById('prompt');
  document.querySelectorAll('.review-discuss').forEach(button=>{button.disabled=true;button.title='This review was restarted or closed.';});
  if(reviewMainDraft===null){reviewMainDraft=field.value;field.value='';}
  reviewPageId=open.id;reviewObject=open.object;reviewIdle();
  document.getElementById('ai-review-title').textContent='AI Review · '+open.object;
  const scope=document.getElementById('ai-review-scope');scope.textContent=open.files.length+' file'+(open.files.length===1?'':'s')+' · '+open.blocks+' block'+(open.blocks===1?'':'s');scope.title=open.files.join('\\n');
  document.getElementById('ai-review-stale').hidden=true;document.getElementById('ai-review-settings').open=true;reviewStatus('');
  field.placeholder='Edit the selected review prompt or write your own question (Enter to send)';
  reviewBox.hidden=false;reviewSend({action:'ready'});loadReviewPrompt();field.focus();}
 if(data.aiReviewStale?.id===reviewPageId)document.getElementById('ai-review-stale').hidden=!data.aiReviewStale.stale;
 if(data.aiReviewStatus?.id===reviewPageId)reviewStatus(data.aiReviewStatus.text,data.aiReviewStatus.error?'error':'info');
 if(data.aiReviewDone&&data.aiReviewDone===reviewPageId)reviewIdle();
 if(data.aiReviewClosed&&data.aiReviewClosed===reviewPageId){const field=document.getElementById('prompt');
  document.querySelectorAll('.review-discuss').forEach(button=>{button.disabled=true;button.title='This review was closed.';});
  reviewPageId='';reviewObject='';reviewDrafting=false;reviewDraftSequence++;reviewIdle();reviewBox.hidden=true;
  field.value=reviewMainDraft||'';reviewMainDraft=null;fitPrompt();
  field.placeholder='Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)';}
});
let contextMode="folder";
const requestContextChecks = Array.from(document.querySelectorAll('[data-request-context]'));
const requestContextEdits = {};
const contextDialog = document.getElementById('request-context-dialog');
const contextText = document.getElementById('request-context-text');
const contextError = document.getElementById('request-context-error');
let editingContext = '';
for(const link of document.querySelectorAll('[data-edit-context]')){
 link.addEventListener('click',event=>{
   event.preventDefault();
   editingContext=link.dataset.editContext;
   document.getElementById('request-context-title').textContent=link.textContent;
   contextError.textContent='';
   contextDialog.showModal();
   if(Object.hasOwn(requestContextEdits,editingContext)){
     contextText.value=requestContextEdits[editingContext];contextText.disabled=false;
   }else{
     contextText.value='';contextText.disabled=true;
     api.postMessage({action:'previewRequestContext',key:editingContext});
   }
 });
}
document.getElementById('request-context-save').onclick=()=>{
 if(contextText.disabled)return;
 if(editingContext==='rules'){
   try{
     const rules=JSON.parse(contextText.value);
     if(!Array.isArray(rules)||rules.some(rule=>typeof rule?.path!=='string'||typeof rule?.text!=='string'))throw new Error();
   }catch(_){contextError.textContent='Enter a JSON array of project rules with path and text fields.';return;}
 }
 requestContextEdits[editingContext]=contextText.value;
 drawContextLevel();contextDialog.close();
};
document.getElementById('request-context-reset').onclick=()=>{
 delete requestContextEdits[editingContext];
 drawContextLevel();contextDialog.close();
};
window.addEventListener('message',event=>{
 const preview=event.data?.requestContextPreview;
 if(!contextDialog.open||!preview||preview.key!==editingContext||!contextText.disabled)return;
 contextError.textContent=preview.error||'';
 if(!preview.error){contextText.value=preview.text;contextText.disabled=false;}
});
function drawContextLevel(){
 const summary=document.querySelector('#system-context > summary');
 const referenceDisabled=Array.from(document.querySelectorAll('[data-reference-context]')).some(input=>!input.checked);
 const level=contextMode==='zero'?'Void':requestContextChecks.some(input=>!input.checked)||referenceDisabled||Object.keys(requestContextEdits).length?'Partial':'Full';
 document.getElementById('context-level').textContent=level;
 summary.dataset.tooltip=level==='Void'?'Empty system context':level==='Partial'?'System context: custom selection or edited blocks':'System context: all request blocks are enabled';
 summary.setAttribute('aria-label','System context: '+level);
}
requestContextChecks.forEach(input=>input.addEventListener('change',drawContextLevel));
let savedRequestContextChecks = [];
function applyContextMode(mode){
 const enteringVoid=mode==="zero"&&contextMode!=="zero";
 const leavingVoid=mode!=="zero"&&contextMode==="zero";
 if(enteringVoid)savedRequestContextChecks=requestContextChecks.map(input=>input.checked);
 requestContextChecks.forEach((input,index)=>{
   if(mode==="zero")input.checked=false;
   else if(leavingVoid)input.checked=savedRequestContextChecks[index]??true;
   input.disabled=mode==="zero";
 });
 if(mode!=="zero")previousContextMode=mode;
 contextMode=mode;
 syncReferenceContextChecks();
 document.getElementById("toggle-system-context").textContent=mode==="zero"?"Restore selection":"Disable all";
 drawContextLevel();
 document.querySelectorAll('[data-context]').forEach(input=>{const selected=mode==="both"?(input.dataset.context==="sap"||input.dataset.context==="folder"):input.dataset.context===mode;input.checked=selected;});
 const sap=mode==="sap"||mode==="both",folder=mode==="folder"||mode==="both";
 document.getElementById('sap-context-controls').hidden=!sap;
 document.getElementById('tools').hidden=!sap;
 document.getElementById('folder-line').hidden=!folder;
}
${historyScript(false)}
let projectFileAliases=new Set(),previousContextMode='folder';
const systemContextMenu=document.getElementById('system-context');
function closeSystemContext(){
 systemContextMenu.open=false;
 systemContextMenu.querySelector('summary').focus();
}
document.getElementById('close-system-context').onclick=closeSystemContext;
systemContextMenu.addEventListener('keydown',event=>{
 if(event.key!=='Escape'||!systemContextMenu.open)return;
 event.preventDefault();event.stopPropagation();closeSystemContext();
});
document.getElementById('toggle-system-context').onclick=()=>{
 const mode=contextMode==='zero'?previousContextMode:'zero';
 applyContextMode(mode);api.postMessage({action:'setContextMode',mode});
};
document.querySelectorAll('[data-context]').forEach(input=>input.addEventListener('change',()=>{
 const sap=document.querySelector('[data-context="sap"]').checked;
 const folder=document.querySelector('[data-context="folder"]').checked;
 const mode=sap?(folder?"both":"sap"):(folder?"folder":"zero");
 applyContextMode(mode);api.postMessage({action:'setContextMode',mode});
}));
const manageFolder=(operation,folder)=>api.postMessage({action:'manageContextFolder',operation,folder});
const folderContextInput=document.querySelector('[data-context="folder"]');
folderContextInput.closest('label').addEventListener('contextmenu',event=>{
 event.preventDefault();manageFolder('add');
});
folderContextInput.addEventListener('keydown',event=>{
 if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){
   event.preventDefault();manageFolder('add');
 }
});
function drawReferenceFolders(state){
 const root=document.getElementById('reference-folders'),picker=document.getElementById('primary-context-folder');
 const entries=(state.referenceFolders||[]).filter(entry=>entry.path!==state.contextFolder);
 picker.replaceChildren(new Option(state.contextFolder||'Select a folder',state.contextFolder||''),...entries.map(entry=>new Option(entry.path,entry.path)));
 picker.onchange=()=>manageFolder('primary',picker.value);
 root.replaceChildren();
 for(const entry of entries){
   const row=document.createElement('div');row.className='line';
   const label=document.createElement('label'),enabled=document.createElement('input');
   enabled.type='checkbox';enabled.dataset.referenceContext=String(entry.enabled);enabled.onchange=()=>manageFolder('toggle',entry.path);
   label.append(enabled,entry.path+' · Read only');
   const remove=document.createElement('button');
   remove.type='button';remove.className='secondary';
   remove.textContent='Remove';remove.onclick=()=>manageFolder('remove',entry.path);
   row.append(label,remove);root.appendChild(row);
 }
 syncReferenceContextChecks();drawContextLevel();
}
function syncReferenceContextChecks(){
 for(const input of document.querySelectorAll('[data-reference-context]')){
   input.checked=contextMode!=='zero'&&input.dataset.referenceContext==='true';
   input.disabled=contextMode==='zero';
 }
}
document.getElementById('folder-name').onclick=event=>{event.preventDefault();api.postMessage({action:'chooseContextFolder'});};
const findFileReferences=${require(require("path").join(__dirname,"file-links")).references.toString()};
// The effort levels of the chosen assistant; hidden for one that takes none (API providers, Copilot).
const EFFORTS = { 'claude-subscription': ['low', 'medium', 'high', 'xhigh', 'max'], codemie: ['low', 'medium', 'high', 'xhigh', 'max'],
  'codex-subscription': ['minimal', 'low', 'medium', 'high'] };
let effort = '';
const capabilityDefinitions = ${JSON.stringify(require(require("path").join(__dirname, "model-capabilities")).definitions)};
const priceInfo = ${require(require("path").join(__dirname, "model-capabilities")).priceInfo.toString()};
const detailLines = ${require(require("path").join(__dirname,"model-capabilities")).detailLines.toString()};
const sortModels = ${require(require("path").join(__dirname,"model-capabilities")).sortModels.toString()};
const groupModels = ${require(require("path").join(__dirname,"model-capabilities")).groupModels.toString()};
let modelCatalog = [];
const lastVercelModels=new Map();
function vercelGroups(models){
  // Stable two-pass order: input price first, output price as the tie breaker; unknown prices last.
  return groupModels(sortModels(sortModels(models,'outputPrice',false),'inputPrice',false),undefined,false,false);
}
function drawModelPickers(selected) {
  const model=document.getElementById('model-select'),sub=document.getElementById('subprovider-select');
  // MF0 is disabled as a chat provider until its API supports tool calls.
  const vercel=['vercel-api','openrouter-api','opencode-api'].includes(document.getElementById('provider-select').value);sub.hidden=!vercel;
  const offered=modelCatalog.slice();
  if(selected&&!offered.some(m=>m.id===selected))offered.push({id:selected,label:selected+' (off)'});
  model.disabled=!offered.length;
  if(!offered.length){model.replaceChildren(new Option('Loading…',''));sub.replaceChildren(new Option('Loading…',''));sub.disabled=true;return;}
  document.body.classList.remove('models-loading');
  const chosen=selected||offered[0].id;
  if(vercel){
    const groups=vercelGroups(offered),group=groups.find(g=>g.models.some(m=>m.id===chosen))||groups[0];
    sub.replaceChildren(...groups.map(g=>new Option(g.label,g.id)));sub.value=group.id;sub.disabled=false;
    model.replaceChildren(...group.models.map(m=>new Option(m.label,m.id)));model.value=chosen;
    lastVercelModels.set(document.getElementById('provider-select').value+':'+group.id,chosen);
  }else{
    sub.replaceChildren();sub.disabled=true;model.replaceChildren(...offered.map(m=>new Option(m.label,m.id)));model.value=chosen;
  }
}
function chooseVercelProvider(){
  const sub=document.getElementById('subprovider-select');
  const group=vercelGroups(modelCatalog).find(g=>g.id===sub.value);if(!group)return;
  const saved=lastVercelModels.get(document.getElementById('provider-select').value+':'+group.id),selected=group.models.some(m=>m.id===saved)?saved:group.models[0].id;
  drawModelPickers(selected);drawModelCapabilities();document.getElementById('model-status').textContent='';
  api.postMessage({action:'setModel',model:selected});
}
document.getElementById('subprovider-select').addEventListener('change',chooseVercelProvider);
function drawModelCapabilities() {
  const target = document.getElementById('model-capabilities'); target.replaceChildren();
  const dialog = document.getElementById('model-details-dialog'); if (dialog.open) dialog.close();
  const model = modelCatalog.find(m => m.id === document.getElementById('model-select').value);
  const button = document.getElementById('model-details-button');
  button.hidden = document.getElementById('provider-select').value !== 'vercel-api';
  button.disabled = button.hidden || !model;
  if (button.hidden || !model) return;
  const line = text => { const row = document.createElement('p'); row.className = 'model-detail'; row.textContent = text; target.appendChild(row); };
  document.getElementById('model-details-title').textContent = model.label || model.id;
  detailLines(model,capabilityDefinitions,priceInfo).forEach(line);
}
document.getElementById('model-details-button').addEventListener('click', () => document.getElementById('model-details-dialog').showModal());
function drawEffort(provider) {
  const select = document.getElementById('effort-select');
  const modernCodex=provider==='codex-subscription'&&/^gpt-6(?:[.-]|$)/i.test(document.getElementById('model-select').value);
  const levels = modernCodex?['none','low','medium','high','xhigh','max']:EFFORTS[provider] || [];
  select.hidden = !levels.length;
  select.replaceChildren(new Option('default', ''), ...levels.map(level => new Option(level, level)));
  select.value = modernCodex&&effort==='minimal'?'none':levels.includes(effort) ? effort : '';
}
document.getElementById('effort-select').addEventListener('change', event => {
  effort = event.target.value;
  api.postMessage({ action: 'setEffort', effort });
});
document.getElementById('provider-select').addEventListener('change', event => {
  document.body.dataset.provider = event.target.value;
  document.body.classList.add('model-list-pending');
  drawEffort(event.target.value);
  modelCatalog = []; drawModelPickers('');drawModelCapabilities();
  api.postMessage({ action: 'setProvider', provider: event.target.value });
});
document.getElementById('model-select').addEventListener('change', event => {
  if(['vercel-api','openrouter-api','opencode-api'].includes(document.getElementById('provider-select').value))lastVercelModels.set(document.getElementById('provider-select').value+':'+document.getElementById('subprovider-select').value,event.target.value);
  drawModelCapabilities(); drawEffort(document.getElementById('provider-select').value); document.getElementById('model-status').textContent = '';
  api.postMessage({ action: 'setModel', model: event.target.value });
});
function openCurrentFlow(){const date=new Date(),key=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');api.postMessage({action:'showCurrentLog',sessionId:activeLogSessionId,conversationId:activeLogConversationId,date:key});}
function addTaskFlow(item){const button=document.createElement('button');button.type='button';button.className='task-flow';button.title=button.ariaLabel='Open live Flow';button.addEventListener('click',openCurrentFlow);item.appendChild(button);
  const clock=document.createElement('span'),started=Date.now();clock.className='request-timer';clock.setAttribute('aria-label','Elapsed request time');item.appendChild(clock);
  const stop=()=>{clearInterval(timer);clock.remove();};
  const tick=()=>{if(!item.isConnected||!item.classList.contains('working')){stop();return;}const seconds=Math.floor((Date.now()-started)/1000);clock.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
  clock.textContent='00:00';const timer=setInterval(tick,1000);item.stopRequestTimer=stop;
}
document.querySelectorAll('button[data-action]').forEach(button => {
  button.addEventListener('click', () => {
    if(button.dataset.action==='showCurrentLog'){
      const date=new Date(),key=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
      api.postMessage({action:'showCurrentLog',sessionId:activeLogSessionId,conversationId:activeLogConversationId,date:key});
    }else api.postMessage({ action: button.dataset.action });
  });
});
document.getElementById('client-select').addEventListener('change', event => {
  api.postMessage({ action: 'client', name: document.getElementById('system-select').value, client: event.target.value });
});
document.getElementById('mcp-start-go').addEventListener('click', () => {
  const box = document.getElementById('mcp-start-options'), values = {};
  for (const input of box.querySelectorAll('input[type=radio]:checked')) values[input.name] = input.value;
  api.postMessage({ action: 'mcpStart', name: box.dataset.server, values });
});
document.getElementById('mcp-start-node').addEventListener('click', () => api.postMessage({ action: 'openWebLink', url: 'https://nodejs.org' }));
document.getElementById('mcp-settings').addEventListener('click', () => api.postMessage({ action: 'mcpSettings', name: document.getElementById('mcp-select').value }));
document.getElementById('mcp-servers').addEventListener('click', () => api.postMessage({ action: 'mcpServers' }));
document.getElementById('mcp-update').addEventListener('click', () => api.postMessage({ action: 'mcpServers' }));
document.getElementById('mcp-select').addEventListener('change', event => {
  api.postMessage({ action: 'mcp', name: event.target.value });
});
document.getElementById('system-select').addEventListener('change', event => {
  api.postMessage({ action: 'system', name: event.target.value });
});
function formatQuestionTime(value) {
  const date = new Date(value), now = new Date();
  if (!Number.isFinite(date.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const clock = pad(date.getHours()) + ':' + pad(date.getMinutes());
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
    ? clock : pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + pad(date.getFullYear() % 100) + ' ' + clock;
}
function showUserMessage(item, text, time) {
  item.textContent = text;
  if (time) {
    const stamp = document.createElement('time');
    stamp.className = 'message-time'; stamp.textContent = time;
    item.appendChild(stamp);
  }
}
let nextRequest = 0;
document.getElementById('chat').addEventListener('submit', event => {
  event.preventDefault();
  if(historyOpening)return;
  const field = document.getElementById('prompt');
  const text = field.value.trim();
  if(chatRunning){
    if(!text&&!images.length)return;
    api.postMessage({action:'interjectChat',text,images:images.map(image=>({media_type:image.media_type,data:image.data})),timestamp:new Date().toISOString()});
    images=[];drawImages();field.value='';fitPrompt();
    return;
  }
  // With a review's blocks on the chip an empty question asks the default one.
  if (!text && document.getElementById('review-chip').hidden && !images.length) return;
  const selected = modelCatalog.find(m => m.id === document.getElementById('model-select').value);
  if (images.length && selected?.capabilities?.vision === false) { document.getElementById('model-status').textContent = 'This model does not accept screenshots. Choose a Vision model or remove the images.'; return; }
  topicViewMode='current';
  refreshTopicView();
  setChatRunning(true);
  const requestId = ++nextRequest;
  const optimisticUser = document.createElement('p');
  optimisticUser.className = 'you'; showUserMessage(optimisticUser, 'You: ' + text, formatQuestionTime(Date.now()));
  document.querySelector('#messages .chat-empty')?.remove();
  document.getElementById('messages').appendChild(optimisticUser);
  const optimisticTask = document.createElement('div');
  optimisticTask.className = 'vertex task working';
  const optimisticBody = document.createElement('div');
  optimisticBody.className = 'progress-body streaming-answer';
  optimisticBody.textContent = 'VERTEX: Working…';
  optimisticTask.appendChild(optimisticBody); addTaskFlow(optimisticTask);
  document.getElementById('messages').appendChild(optimisticTask);
  progressItems.set(requestId, optimisticTask);
  if(images.length)requestScreenshots.set(requestId,images.map(image=>({media_type:image.media_type,data:image.data})));
  api.postMessage({ action: 'chat', requestId, text, requestContextEdits, requestContext:Object.fromEntries(requestContextChecks.map(input=>[input.dataset.requestContext,input.checked])), model: document.getElementById('model-select').value,
    routeTopics:!document.getElementById('topic-picker-label').hidden&&document.getElementById('topic-picker').value==='auto',
    images: images.map(image => ({ media_type: image.media_type, data: image.data })) });
  field.value = '';
  images = []; drawImages();
  fitPrompt();
});
// Screenshots pasted from the clipboard go with the next question, as images in the message.
const IMAGE_LIMIT = 5 * 1024 * 1024;
let images = [];
function drawImages() {
  const box = document.getElementById('image-chips');
  box.replaceChildren(...images.map((image, index) => {
    const chip = document.createElement('div'); chip.className = 'image-chip';
    const img = document.createElement('img'); img.src = 'data:' + image.media_type + ';base64,' + image.data; img.alt = 'Screenshot ' + (index + 1);
    const drop = document.createElement('button'); drop.type = 'button'; drop.className = 'secondary'; drop.textContent = '×';
    drop.title = drop.ariaLabel = 'Remove screenshot ' + (index + 1);
    drop.addEventListener('click', () => { images.splice(index, 1); drawImages(); });
    chip.append(img, drop); return chip;
  }));
  box.hidden = !images.length;
}
document.getElementById('prompt').addEventListener('paste', event => {
  const files = [...(event.clipboardData ? event.clipboardData.items : [])]
    .filter(item => item.kind === 'file' && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(item.type)).map(item => item.getAsFile()).filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  files.forEach(file => {
    if (file.size > IMAGE_LIMIT) { document.getElementById('model-status').textContent = 'Screenshot not added: it is over 5 MB.'; return; }
    const reader = new FileReader();
    reader.onload = () => { const url = String(reader.result), comma = url.indexOf(',');
      images.push({ media_type: file.type, data: url.slice(comma + 1) }); drawImages(); };
    reader.onerror = () => { document.getElementById('model-status').textContent = 'Screenshot not added: it could not be read.'; };
    reader.readAsDataURL(file);
  });
});
// The message field grows with what is typed or pasted, up to a few lines; ⤢ lets it take most of the panel.
let chatRunning = false, chatStopping = false, activeLogSessionId = '', activeLogConversationId = '';
const stopChat = document.getElementById('chat-stop');
function setChatRunning(value) { chatRunning=value;if(!value){chatStopping=false;activeLogSessionId='';activeLogConversationId='';}stopChat.hidden=!value;stopChat.disabled=chatStopping;document.getElementById('new-conversation').hidden=value;document.getElementById('prompt').title=value?'Send this as an addition to the active conversation; it will be included at the next model step.':'Enter sends a new message.';renderHistory(); }
stopChat.addEventListener('click',()=>{chatStopping=true;stopChat.disabled=true;api.postMessage({action:'stopChat'});});
const promptField = document.getElementById('prompt'), expandPrompt = document.getElementById('expand-prompt');
function fitPrompt() { promptField.style.height = 'auto'; promptField.style.height = promptField.scrollHeight + 2 + 'px'; }
promptField.addEventListener('input', fitPrompt);
expandPrompt.addEventListener('click', () => {
  const open = promptField.classList.toggle('expanded');
  expandPrompt.setAttribute('aria-pressed', String(open));
  expandPrompt.textContent = open ? '⤡' : '⤢';
  expandPrompt.title = expandPrompt.ariaLabel = open ? 'Shrink the message field' : 'Expand the message field';
  fitPrompt(); promptField.focus();
});
document.getElementById('review-clear').addEventListener('click', () => api.postMessage({ action: 'clearReview' }));
document.getElementById('prompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.ctrlKey) {
    event.preventDefault();
    document.getElementById('chat').requestSubmit();
  }
});
let lastCopy = null;
function copySelectedText(event) {
  const field = document.activeElement;
  const text = field && field.id === 'model-select'
    ? String(field.value || '')
    : field && typeof field.selectionStart === 'number' && field.selectionEnd > field.selectionStart
    ? String(field.value).slice(field.selectionStart, field.selectionEnd)
    : String(window.getSelection ? window.getSelection() || '' : '');
  if (!text) return;
  event.preventDefault(); event.stopPropagation();
  lastCopy = null;
  api.postMessage({ action: 'copyAnswer', text });
}
document.addEventListener('copy', copySelectedText);
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'c') copySelectedText(event);
});
const progressItems = new Map();
const requestScreenshots = new Map();
const taskVisuals=${JSON.stringify(["review", "commit", "search", "thinking", "tooling", "mcp", "start", "install", "edit", "recognize"].reduce((all, kind) =>
  Object.assign(all, { [kind]: require(require("path").join(__dirname, "task-visual")).html(kind, true) }), {}))};
function paintTaskScene(item,update){
      const reasoning=typeof update.thinking==='string'&&update.thinking&&!update.kind&&item.dataset.taskKind!=='edit';
      if(update.kind===null||reasoning){item.dataset.taskKind='thinking';delete item.dataset.taskSubject;}
      if(['review','commit','search','thinking','tooling','mcp','start','install','edit','recognize'].includes(update.kind))item.dataset.taskKind=update.kind;
      // What a search is looking for travels with the step, so its band can spell the pattern out.
      if(typeof update.subject==='string')item.dataset.taskSubject=update.subject;
      let scene=item.querySelector('.task-scene');
      if(scene&&item.dataset.taskKind==='edit'&&scene.parentElement!==item)item.appendChild(scene);
      if(update.done){if(scene)scene.remove();}
      else if(taskVisuals[item.dataset.taskKind]){if(!scene){scene=document.createElement('span');scene.className='task-scene';scene.setAttribute('role','button');scene.setAttribute('tabindex','0');scene.setAttribute('aria-label','Open live Flow');scene.title='Open live Flow';scene.addEventListener('click',openCurrentFlow);scene.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openCurrentFlow();}});item.appendChild(scene);}const want=item.dataset.taskKind,said=item.dataset.taskSubject||'';
        if(scene.dataset.kind!==want||scene.dataset.said!==said||(want==='recognize'&&scene.dataset.imageIndex!==String(update.imageIndex||0))){scene.dataset.kind=want;scene.dataset.said=said;scene.dataset.imageIndex=String(update.imageIndex||0);
        scene.innerHTML=want==='start'&&window.vertexTaskVisual?window.vertexTaskVisual.html('start',true,said):taskVisuals[want];
        if(want==='recognize'){
          const pictures=requestScreenshots.get(update.id),index=Math.max(0,Math.min((pictures?.length||1)-1,Number(update.imageIndex)||0));
          const picture=pictures?.[index],svg=scene.querySelector('svg'),image=scene.querySelector('.kw-screen-image');
          if(svg&&image&&picture&&/^image\\\/(?:png|jpeg|gif|webp)$/.test(picture.media_type)&&typeof picture.data==='string'){
            const source='data:'+picture.media_type+';base64,'+picture.data;
            image.setAttribute('href',source);svg.classList.add('has-screenshot');
          }
        }
        // The edit and MCP scenes change at random, which CSS cannot do: they need their driver on the node drawn.
        if(window.vertexTaskVisual)window.vertexTaskVisual.drive(scene);}}
      item.setAttribute('aria-busy',String(!update.done));
}
let orchestratorSelected=false;
document.getElementById('jev-mode').addEventListener('click',()=>api.postMessage({action:'openJev'}));
window.addEventListener('message', event => {
  if(event.data.ai?.referenceFolders)drawReferenceFolders(event.data.ai);
  if(typeof event.data.chatRunning==='boolean')setChatRunning(event.data.chatRunning);
  const selectedContext=event.data.contextMode||event.data.ai?.contextMode;if(selectedContext)applyContextMode(selectedContext);
  if(event.data.localFiles){projectFileAliases=new Set(event.data.localFiles);document.querySelectorAll('.vertex').forEach(linkProjectFiles);}
  if (event.data && typeof event.data.send === 'string') {
    // VERTEX's own message - a review's reasons - goes as a question the user can read in the chat.
    document.getElementById('prompt').value = event.data.send; fitPrompt();
    document.getElementById('chat').requestSubmit();
  }
  if (event.data && event.data.draft && !document.getElementById('prompt').value) { document.getElementById('prompt').value = event.data.draft; fitPrompt(); }
  if (event.data && typeof event.data.copied === 'boolean' && lastCopy) {
    lastCopy.textContent = event.data.copied ? 'Copied' : 'Copy failed: ' + event.data.error;
    const button = lastCopy; setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  }
  if (event.data && typeof event.data.review === 'string') {
    const chip = document.getElementById('review-chip');
    chip.hidden = !event.data.review;
    document.getElementById('review-label').textContent = event.data.review;
    chip.title = event.data.review;
    const preview=document.getElementById('review-result-preview'),body=document.getElementById('review-result-body');body.replaceChildren();preview.hidden=!event.data.reviewResult;
    if(event.data.reviewResult){const result=event.data.reviewResult;const files=document.createElement('p');files.textContent=(result.files||[]).join(', ');body.appendChild(files);markdown(result.answer,body);if(result.requirements){const requirements=document.createElement('p');requirements.textContent='Review requirements: '+result.requirements;body.appendChild(requirements);}}
    const field = document.getElementById('prompt');
    field.placeholder = event.data.reviewResult ? 'Ask about the attached review… (Enter to send)' : event.data.review ? 'Ask about this change… (Enter with nothing typed: what it does and any real problem)' : 'Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)';
    if (event.data.review) field.focus();
  }
  if (event.data && event.data.cleared) {
    historyRequest++;historyItems=[];historyLoading=false;historyOpening=false;historyStatus.textContent='';historyBox.open=false;renderHistory();
    topicCatalog=[];topicViewMode='current';drawTopicPicker(routeMode);document.getElementById('context-optimization-status').textContent='';
    const box = document.getElementById('messages');
    box.textContent = '';
    const hint = document.createElement('p');
    hint.className = 'chat-empty';
    hint.textContent = 'Ask anything — about SAP or any project in your folder. You can paste screenshots here too.';
    box.appendChild(hint);
    progressItems.clear();
    setChatRunning(false);
  }
  if (event.data && event.data.progress) {
    const update = event.data.progress;
    if(typeof update.logSessionId==='string')activeLogSessionId=update.logSessionId;
    if(typeof update.logConversationId==='string')activeLogConversationId=update.logConversationId;
    if(!update.auxiliary)setChatRunning(!update.done&&!update.remove);
    if(Array.isArray(update.images))requestScreenshots.set(update.id,update.images);
    if (update.toolSupport && document.getElementById('provider-select').value === update.toolSupport.provider) {
      const model = modelCatalog.find(m => m.id === update.toolSupport.model);
      if (model) { model.capabilities = { ...model.capabilities, tools:false }; model.toolSupportEvidence = update.toolSupport.evidence; drawModelCapabilities(); }
    }
    if(typeof update.userAdditionRejected==='string'){
      if(Array.isArray(update.rejectedImages)){images.push(...update.rejectedImages);drawImages();}
      const field=document.getElementById('prompt');
      field.value=[update.userAdditionRejected,field.value].filter(Boolean).join('\\n');fitPrompt();field.focus();
    }
    let item = progressItems.get(update.id);
    if(typeof update.userAddition==='string'){
      document.querySelector('#messages .chat-empty')?.remove();
      const userItem=document.createElement('p');userItem.className='you';userItem.textContent='You · added to this conversation: '+update.userAddition;
      document.getElementById('messages').insertBefore(userItem,item||null);
    }
    if (typeof update.user === 'string' && !item) {
      document.querySelector('#messages .chat-empty')?.remove();
      const userItem = document.createElement('p');
      userItem.className = update.step === 'review' ? 'you review-step' : 'you'; userItem.textContent = update.user;
      document.getElementById('messages').appendChild(userItem);
    }
    if (!item && !update.remove) {
      item = document.createElement('div'); item.className = update.step === 'review' ? 'vertex task working review-step' : 'vertex task working'; addTaskFlow(item);
      document.getElementById('messages').appendChild(item);
      progressItems.set(update.id, item);
    }
    if (item && update.remove) { item.stopRequestTimer?.(); item.remove(); progressItems.delete(update.id);requestScreenshots.delete(update.id); }
    else if (item) {
      if(update.topic){setTopic(item,update.topic);let prior=item.previousElementSibling;if(prior?.classList.contains('you'))setTopic(prior,update.topic);}
      // The text first, the waiting scene right under it.
      let body = item.querySelector('.progress-body');
      if (!body) { body = document.createElement('div'); body.className = 'progress-body streaming-answer'; item.appendChild(body); }
      paintTaskScene(item,update);
      const requestTimer = item.querySelector('.request-timer');
      if (requestTimer) item.appendChild(requestTimer);
      function appendPart(kind, text) {
        if (!text) return;
        let part = body.lastElementChild;
        if (!part?.classList.contains(kind)) {
          if (!body.querySelector('.stream-part')) body.replaceChildren();
          else body.querySelector('.stream-placeholder')?.remove();
          part = document.createElement('div'); part.className = 'stream-part ' + kind;
          part.textContent = kind === 'thinking' ? (item.dataset.thinkingLabel || 'Thinking') + ':\\n' : 'VERTEX:\\n';
          body.appendChild(part);
        }
        part.insertBefore(document.createTextNode(text), part.querySelector('.task-scene'));
         if(kind==='thinking'&&item.dataset.taskKind==='thinking'){
           const scene=item.querySelector('.task-scene');
           if(scene)part.appendChild(scene);
         }
      }
      if (typeof update.thinking === 'string' && update.thinking) {
        if (update.thinkingLabel) item.dataset.thinkingLabel = update.thinkingLabel;
        const prior = item.dataset.thinking || '';
        appendPart('thinking', update.thinking.startsWith(prior) ? update.thinking.slice(prior.length) : update.thinking);
        item.dataset.thinking = update.thinking;
      }
      const previous = item.dataset.answer || '';
      if(update.stopped)update.answer=previous+(previous?'\\n\\n':'')+'Stopped.';
      if (typeof update.answer === 'string' && (update.answer || !previous)) {
        const answer = update.answer;
        if (!answer.startsWith(previous) && previous) body.querySelectorAll('.stream-part.answer').forEach(part => part.remove());
        appendPart('answer', answer.startsWith(previous) ? answer.slice(previous.length) : answer);
        item.dataset.answer = answer;
        item.dataset.status = '';
      }
      if (typeof update.status === 'string') item.dataset.status = update.status;
      // Before the first streamed part, the status shares the VERTEX line.
      if (!body.querySelector('.stream-part')) {
        let placeholder = body.querySelector('.stream-placeholder');
        if (!placeholder) { placeholder = document.createElement('div'); placeholder.className = 'stream-placeholder'; body.replaceChildren(placeholder); }
        placeholder.textContent = 'VERTEX: ' + (item.dataset.status || 'Working…');
      }
      let status = item.querySelector('.tool-status');
      if (item.dataset.answer && item.dataset.status && !update.done) {
        if (!status) { status = document.createElement('p'); status.className = 'tool-status'; item.appendChild(status); }
        status.textContent = item.dataset.status;
      } else if (status) status.remove();
      let limitsLine = item.querySelector('.limits');
      if (typeof update.limits === 'string') {
        if (!limitsLine) { limitsLine = document.createElement('p'); limitsLine.className = 'usage limits'; item.appendChild(limitsLine); }
        limitsLine.textContent = update.limits;
      }
      if (update.done && update.usage && limitsLine) limitsLine.remove();
      if (update.done) {
        requestScreenshots.delete(update.id);
        item.classList.remove('working');
        item.stopRequestTimer?.();
        const answer = item.dataset.answer || '';
        if (!body.querySelector('.stream-part.answer')) appendPart('answer', answer || 'No answer returned.');
        body.classList.remove('streaming-answer');
        body.querySelectorAll('.stream-part.answer').forEach(part => {
          const plain = part.textContent.slice('VERTEX:\\n'.length);
          part.replaceChildren(); markdown('VERTEX:\\n' + plain, part);
        });
        if (status) status.remove();
        links(item, update.choices || []);linkProjectFiles(item);linkSapNames(item);
        runLinks(item, update.runs || []);
        const copy = document.createElement('button');
        copy.className = 'secondary copy-answer'; copy.textContent = 'Copy'; copy.title = 'Copy this answer to the clipboard';
        copy.addEventListener('click', () => { lastCopy = copy; api.postMessage({ action: 'copyAnswer', text: answer }); });
        item.appendChild(copy);
        // An AI Review answer: Discuss in chat closes the review and attaches this result to the next chat question.
        if (update.discuss && update.discuss.review && update.discuss.id) {
          const discuss = document.createElement('button');
          discuss.type = 'button'; discuss.className = 'secondary copy-answer review-discuss'; discuss.textContent = 'Discuss in chat';
          discuss.title = 'Close the review and attach this result and its changes to your next chat question';
          const owner = update.discuss.review, handoff = update.discuss.id;
          discuss.addEventListener('click', () => api.postMessage({ action: 'aiReviewMessage', id: owner, message: { action: 'discuss', id: handoff } }));
          item.appendChild(discuss);
        }
        if (update.usage) {
          const line = document.createElement('p'); line.className = 'usage'; line.textContent = update.usage;
          item.appendChild(line);
        }
        progressItems.delete(update.id);
      }
      const box = document.getElementById('messages'); box.scrollTop = box.scrollHeight;
    }
  }
  if (event.data && typeof event.data.folder === 'string') {
    const folder = event.data.folder, name = document.getElementById('folder-name');
    document.getElementById('folder-line').hidden = contextMode!=='folder'&&contextMode!=='both';document.getElementById('git-history').hidden=!folder;
    name.textContent = folder.split(/[\\\\/]/).filter(Boolean).pop() || 'Choose a folder';
    name.title = folder;
  }
  if (event.data && Array.isArray(event.data.systems)) {
    const select = document.getElementById('system-select');
    const selected = event.data.system || '';
    select.replaceChildren(...event.data.systems.map((name, i) => {
      const option = new Option((event.data.labels || [])[i] || name, name);
      option.selected = name === selected;
      return option;
    }));
    if (!event.data.systems.length) select.add(new Option('No SAP systems configured', ''));
    const clientSelect = document.getElementById('client-select'), clients = event.data.clients || [];
    clientSelect.hidden = clients.length < 2;
    clientSelect.replaceChildren(...clients.map(client => { const option = new Option(client, client); option.selected = client === event.data.client; return option; }));
  }
  if (event.data && event.data.mcpOptions) {
    const dialog = document.getElementById('mcp-start-dialog'), name = event.data.mcpOptions.name, box = document.getElementById('mcp-start-options');
    document.getElementById('mcp-start-title').textContent = name + ': write access';
    document.getElementById('mcp-start-scene').innerHTML = '';
    document.getElementById('mcp-start-status').textContent = 'Choose what ' + name + ' may change in SAP, or keep the default, then press Start.';
    box.dataset.server = name;
    box.replaceChildren(...event.data.mcpOptions.options.map(option => {
      const set = document.createElement('fieldset'), legend = document.createElement('legend');
      legend.textContent = option.label; set.append(legend);
      for (const choice of option.choices) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'radio'; input.name = option.setting; input.value = choice.value; input.checked = choice.value === option.value;
        label.append(input, document.createTextNode(choice.label)); set.append(label);
      }
      return set;
    }));
    const hint = document.createElement('div'); hint.className = 'mcp-start-hint';
    hint.textContent = 'Later: Settings > Extensions > VERTEX > Chat (' + event.data.mcpOptions.options.map(o => 'vertex.chat.' + o.setting).join(', ') + ').';
    box.append(hint);
    document.getElementById('mcp-start-go').hidden = false;
    document.getElementById('mcp-start-node').hidden = true;
    if (!dialog.open) dialog.showModal();
  }
  if (event.data && event.data.mcpStart) {
    document.getElementById('mcp-start-options').replaceChildren();
    document.getElementById('mcp-start-go').hidden = true;
    const dialog = document.getElementById('mcp-start-dialog'), name = event.data.mcpStart.name;
    // Installing when npx does not have the package yet, starting otherwise; the scene comes from the extension.
    const installing = !!event.data.mcpStart.installing, scene = document.getElementById('mcp-start-scene');
    document.getElementById('mcp-start-title').textContent = (installing ? 'Installing ' : 'Starting ') + name;
    scene.innerHTML = event.data.mcpStart.scene || '';
    scene.dataset.kind = installing ? 'install' : 'start';
    document.getElementById('mcp-start-status').textContent = event.data.mcpStart.running ? 'Connecting to ' + name + '…'
      : installing ? 'Installing ' + name + ' through npx: the first start downloads the package and can take a few minutes.' : 'Starting ' + name + '…';
    document.getElementById('mcp-start-node').hidden = true;
    if (!dialog.open) dialog.showModal();
  }
  if (event.data && event.data.mcpDone) {
    const done = event.data.mcpDone, dialog = document.getElementById('mcp-start-dialog'), scene = document.getElementById('mcp-start-scene');
    document.getElementById('mcp-start-options').replaceChildren();
    document.getElementById('mcp-start-go').hidden = true;
    const result = () => {
      scene.innerHTML = '';
      document.getElementById('mcp-start-title').textContent = done.error ? done.name + ' did not start' : done.name + ' is ready';
      document.getElementById('mcp-start-status').textContent = done.error || (done.name + ' now supplies the SAP tools of the chat: ' + done.tools + ' tools.');
      document.getElementById('mcp-start-node').hidden = !done.nodeMissing;
      if (!dialog.open) dialog.showModal();
    };
    // A start that worked plays its end - the lid closes, or the orbiter takes off - with the check, then the result.
    const visual = !done.error && dialog.open && scene.firstElementChild;
    if (visual) { visual.classList.add('scene-done'); setTimeout(result, scene.dataset.kind === 'install' ? 2000 : 3600); }
    else result();
  }
  if (event.data && event.data.mcp) {
    orchestratorSelected=event.data.mcp.selected==='VERTEX Orchestrator';
    const mcpSelect = document.getElementById('mcp-select');
    mcpSelect.replaceChildren(...event.data.mcp.servers.map(name => { const option = new Option(name, name); option.selected = name === event.data.mcp.selected; return option; }));
    mcpSelect.title = mcpSelect.value || "Select the MCP server for SAP tools";
    mcpSelect.hidden = document.getElementById('mcp-settings').hidden = document.getElementById('mcp-servers').hidden = false;
    document.getElementById('mcp-settings').title=document.getElementById('mcp-settings').ariaLabel=orchestratorSelected?'Configure orchestrator Jev model':'Settings of the selected MCP server';
    const waiting = event.data.mcp.updates || [], update = document.getElementById('mcp-update');
    const selectedUpdate = waiting.includes(event.data.mcp.selected);
    update.hidden = !selectedUpdate; update.title = selectedUpdate ? 'A newer version is out for ' + event.data.mcp.selected + '. Opens MCP Servers, where you update it.' : '';
  }
  if (event.data && event.data.ai) {
    const select = document.getElementById('provider-select');
    if (!Array.isArray(event.data.ai.providers) || !event.data.ai.providers.length) {
      document.body.classList.add('no-providers');
      document.body.classList.remove('models-loading', 'no-choice', 'model-list-pending');
    } else {
      document.body.classList.remove('no-providers');
      if (event.data.ai.provider !== select.value) document.body.classList.add('models-loading');
      document.body.classList.remove('model-list-pending');
    }
    const previousProvider=select.value;
    select.replaceChildren(...(event.data.ai.providers || []).map(p => new Option(p.short, p.setting)));
    document.body.classList.toggle('no-providers', !select.options.length);
    select.value = event.data.ai.provider;
    document.body.dataset.provider = select.value;
    if(previousProvider!==select.value){modelCatalog=[];document.body.classList.add('models-loading');drawModelPickers('');drawModelCapabilities();}
    if (typeof event.data.effort === 'string') effort = event.data.effort;
    drawEffort(select.value);
  }
  if (event.data && event.data.models) {
    const select = document.getElementById('model-select');
    const data = event.data.models;
    document.body.classList.remove('model-list-pending');
    if (data.error) {
      document.body.classList.remove('models-loading');
      modelCatalog = [];drawModelPickers('');drawModelCapabilities();
      document.body.classList.add('no-choice');
      select.replaceChildren(new Option('no models', ''));
      document.body.classList.add('no-choice');
      document.body.classList.remove('models-loading');
      // Nothing to select for this provider; the chat remains available to resolve an available configured provider model.
      select.title = data.error;
      const status = document.getElementById('model-status');
      if (status) status.textContent = '';
    } else if (!Array.isArray(data.models) || !data.models.length) {
      document.body.classList.remove('models-loading');
      modelCatalog = [];drawModelPickers('');drawModelCapabilities();
      document.body.classList.add('no-choice');
      select.replaceChildren(new Option('no models', ''));
      select.title = 'No models are currently offered by this provider.';
      const status = document.getElementById('model-status');
      if (status) status.textContent = '';
    } else {
      select.title = 'Model';
      document.body.classList.remove('no-choice');
      const status = document.getElementById('model-status');
      if (status) {
        status.replaceChildren();
        if (data.missing) status.textContent = data.missing + ' is no longer in the provider catalog. Choose another model.';
        else if (data.newCount) {
          const open = document.createElement('a'); open.href = '#'; open.textContent = 'Open LLM Providers';
          open.addEventListener('click', e => { e.preventDefault(); api.postMessage({ action: 'configModels' }); });
          status.append(data.newCount + ' new model' + (data.newCount === 1 ? '' : 's') + ' in the catalog, switched off. ', open);
        }
      }
      // The configured model selects its Vercel subprovider automatically; off models stay visible.
      modelCatalog = data.models.filter(model=>model.modelKind!=="decision");drawModelPickers(data.models.some(model=>model.id===data.model&&model.modelKind==="decision")?"":data.model);drawModelCapabilities();drawEffort(document.getElementById('provider-select').value);
    }
  }
  if (event.data && event.data.chat) {
    document.querySelector('#messages .chat-empty')?.remove();
    const mine = event.data.chat.startsWith('You: ');
    const item = document.createElement(mine ? 'p' : 'div');
    item.className = mine ? 'you' : 'vertex';
    if (mine) { const question=event.data.chat.replace(/^You:\s*/,"");if(event.data.questionTime)showUserMessage(item,'You: '+question,event.data.questionTime);else item.textContent=event.data.chat; } else { markdown(event.data.chat, item); }
    if(event.data.topic)setTopic(item,event.data.topic);
    // Each found object is a link: a click opens it, as a single match is opened.
    if (!mine) { links(item, event.data.choices || []);linkProjectFiles(item);linkSapNames(item); }
    let copy = null, logButtons=[];
    if (!mine) {
      copy = document.createElement('button');
      copy.className = 'secondary copy-answer'; copy.textContent = 'Copy'; copy.title = 'Copy this answer to the clipboard';
      const text = event.data.chat.replace(/^VERTEX:\\s*/, '');
      copy.addEventListener('click', () => { lastCopy = copy; api.postMessage({ action: 'copyAnswer', text }); });
      if(event.data.logSessionId){
        const log=document.createElement('button');log.className='secondary copy-answer';log.textContent='Log';log.title='Open this historical conversation in Logs & Cost';
        log.addEventListener('click',()=>api.postMessage({action:'openLogConversation',sessionId:event.data.logSessionId,conversationId:event.data.logConversationId,date:event.data.questionDate}));
        const flow=document.createElement('button');flow.className='secondary copy-answer';flow.innerHTML='<svg aria-hidden="true" viewBox="0 0 20 20" width="13" height="13" style="vertical-align:middle" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h4l2-4 3 8 2-4h3"/><circle cx="3" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>';flow.title='Open this historical run full screen in Flow';flow.setAttribute('aria-label',flow.title);
        flow.addEventListener('click',()=>api.postMessage({action:'showHistoricalLog',promptKey:event.data.logPromptKey,sessionId:event.data.logSessionId,conversationId:event.data.logConversationId,date:event.data.questionDate}));
        logButtons.push(log,flow);
      }
    }
    document.getElementById('messages').appendChild(item);
    if (event.data.usage) {
      const line = document.createElement('p');
      line.className = 'usage';
      line.textContent = event.data.usage;
      item.appendChild(line);
    }
    if (copy) item.appendChild(copy);
    logButtons.forEach(button=>item.appendChild(button));
    const box = document.getElementById('messages');
    box.scrollTop = box.scrollHeight;
  }
});
function links(item, choices) {
  const used = new Set();
  item.querySelectorAll('strong').forEach(name => {
    const li = name.closest('li');
    const type = li && li.firstChild && li.firstChild.nodeType === 3 ? li.firstChild.textContent.trim() : '';
    // The object and package may have identical visible names. Assign each
    // occurrence to the next matching destination so both remain clickable.
    const index = choices.findIndex((choice, i) => !used.has(i) && choice.object_name === name.textContent
      && (!type || choice.object_type === type));
    const object = index >= 0 ? choices[index] : null;
    if (!object) return;
    used.add(index);
    const link = document.createElement('a');
    link.href = '#'; link.className = 'link'; link.title = 'Open ' + object.object_type + ' ' + object.object_name;
    link.appendChild(name.cloneNode(true));
    link.addEventListener('click', event => { event.preventDefault(); api.postMessage({ action: 'openObject', object_type: object.object_type, object_name: object.object_name }); });
    name.replaceWith(link);
  });
}
function linkSapNames(item){
 if(contextMode!=='sap'&&contextMode!=='both')return;
 const nodes=[];const walk=node=>{if(node.nodeType===3){nodes.push(node);return;}if(node.nodeType!==1||['A','PRE','SCRIPT','STYLE','BUTTON'].includes(node.tagName))return;[...node.childNodes].forEach(walk);};walk(item);
 for(const node of nodes){const text=node.textContent;const pattern=/[/][A-Z0-9_]+[/][A-Z][A-Z0-9_/$]+|[ZY][A-Z0-9_]{2,39}/g;const candidates=node.parentElement?.tagName==='CODE'&&/^[A-Z][A-Z0-9_/$]{2,39}$/.test(text)?[{0:text,index:0}]:[...text.matchAll(pattern)];const matches=candidates.filter(m=>!(m.index&&/[A-Z0-9_/$]/.test(text[m.index-1]))&&!/[A-Z0-9_/$*]/.test(text[m.index+m[0].length]||''));if(!matches.length)continue;
 const fragment=document.createDocumentFragment();let start=0;for(const match of matches){fragment.appendChild(document.createTextNode(text.slice(start,match.index)));const link=document.createElement('a');link.href='#';link.className='link';link.textContent=match[0];link.title='Find and open SAP object '+match[0];link.onclick=e=>{e.preventDefault();api.postMessage({action:'openObject',object_type:'',object_name:match[0]});};fragment.appendChild(link);start=match.index+match[0].length;}fragment.appendChild(document.createTextNode(text.slice(start)));node.replaceWith(fragment);}
}
function linkProjectFiles(item){
 if(!projectFileAliases.size)return;
 const nodes=[];const walk=node=>{if(node.nodeType===3){nodes.push(node);return;}if(node.nodeType!==1||['A','PRE','SCRIPT','STYLE'].includes(node.tagName))return;[...node.childNodes].forEach(walk);};walk(item);
 for(const text of nodes){const matches=findFileReferences(text.textContent,projectFileAliases);if(!matches.length)continue;const fragment=document.createDocumentFragment();let cursor=0;for(const match of matches){fragment.appendChild(document.createTextNode(text.textContent.slice(cursor,match.start)));const link=document.createElement('a');link.className='link';link.href='#';link.textContent=text.textContent.slice(match.start,match.end);link.title='Show review or open '+match.reference;link.addEventListener('click',event=>{event.preventDefault();api.postMessage({action:'openProjectFile',reference:match.reference});});fragment.appendChild(link);cursor=match.end;}fragment.appendChild(document.createTextNode(text.textContent.slice(cursor)));text.replaceWith(fragment);}
}
// A citation whose id begins exactly one known session opens it at the cited step.
function runLinks(item, runs) {
  item.querySelectorAll('.run-cite').forEach(cite => {
    const matches = runs.filter(run => run.session_id.startsWith(cite.dataset.run)
      && (cite.dataset.kind !== 'run' || run.kind === 'transpiler'));
    if (matches.length !== 1) return;
    const run = matches[0], link = document.createElement('a');
    link.href = '#'; link.className = 'link'; link.title = 'Open ' + run.kind + ' session ' + run.session_id + ' at step ' + cite.dataset.step + ' in VERTEX Smart Debugger';
    // A run of this conversation reads as its number; one from elsewhere keeps the cited id.
    link.textContent = run.kind === 'transpiler' && run.number ? 'run ' + run.number + ', step ' + cite.dataset.step : cite.textContent;
    link.addEventListener('click', event => { event.preventDefault();
      api.postMessage(run.kind === 'transpiler'
        ? { action: 'openRun', run_id: run.run_id, step: Number(cite.dataset.step) }
        : { action: 'openSession', session_id: run.session_id, step: Number(cite.dataset.step) }); });
    cite.replaceWith(link);
  });
}
// Markdown built as DOM nodes with textContent only, so an answer cannot inject markup.
function inline(text, parent) {
  // Bold and italic hold inline text of their own: code inside bold is bold code, not bold backticks.
  text.split(/(\\[[^\\]\\n]+\\]\\(https?:\\/\\/[^\\s)]+\\)|\\[(?:run|session) [0-9a-f-]{6,36} step \\d+\\]|\\x60[^\\x60]+\\x60|\\*\\*[^*]+\\*\\*|\\*[^*\\s][^*]*\\*)/).forEach(token => {
    if (!token) return;
    let node;
    const cite = /^\\[(run|session) ([0-9a-f-]{6,36}) step (\\d+)\\]$/.exec(token);
    // A cited step of a transpiler run: a link once the run is known (runLinks), plain text otherwise.
    const webLink = /^\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)$/.exec(token);
    // A web link opens only through the host's openExternal, which asks for an untrusted domain. No href: VS Code
    // opens an href of a webview itself, at once, and then the host's open asked a second time. Copy Link
    // (vertex.copyLink) is in its context menu through data-vscode-context; Enter opens it from the keyboard.
    if(webLink){node=document.createElement('a');node.className='link';node.setAttribute('role','link');node.tabIndex=0;node.textContent=webLink[1];node.title=webLink[2];node.setAttribute('data-vscode-context',JSON.stringify({webviewSection:'vertex-link',url:webLink[2]}));
      const open=event=>{event.preventDefault();api.postMessage({action:'openWebLink',url:webLink[2]});};node.addEventListener('click',open);node.addEventListener('keydown',event=>{if(event.key==='Enter')open(event);});}
    else if (cite) { node = document.createElement('span'); node.className = 'run-cite'; node.dataset.kind = cite[1]; node.dataset.run = cite[2]; node.dataset.step = cite[3]; node.textContent = token; }
    else if (/^\\x60[^\\x60]+\\x60$/.test(token)) { node = document.createElement('code'); node.textContent = token.slice(1, -1); }
    else if (/^\\*\\*[^*]+\\*\\*$/.test(token)) { node = document.createElement('strong'); inline(token.slice(2, -2), node); }
    else if (/^\\*[^*\\s][^*]*\\*$/.test(token)) { node = document.createElement('em'); inline(token.slice(1, -1), node); }
    else { node = document.createTextNode(token); }
    parent.appendChild(node);
  });
}
function markdown(text, target) {
  const lines = text.replace(/\\r\\n/g, '\\n').split('\\n');
  let list = null, paragraph = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\\s*\\x60\\x60\\x60/.test(line)) {
      const code = [];
      for (i++; i < lines.length && !/^\\s*\\x60\\x60\\x60/.test(lines[i]); i++) { code.push(lines[i]); }
      const pre = document.createElement('pre'), inner = document.createElement('code');
      inner.textContent = code.join('\\n'); pre.appendChild(inner); target.appendChild(pre);
      list = paragraph = null; continue;
    }
    // A table: a row of cells between pipes, then a separator row of dashes (colons for alignment).
    const cells = row => row.trim().replace(/^\\|/, '').replace(/\\|$/, '').split('|').map(cell => cell.trim());
    if (/^\\s*\\|.*\\|\\s*$/.test(line) && i + 1 < lines.length && /^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?\\s*$/.test(lines[i + 1])) {
      const align = cells(lines[i + 1]).map(cell => /^:-+:$/.test(cell) ? 'center' : /-:$/.test(cell) ? 'right' : '');
      const wrap = document.createElement('div'), table = document.createElement('table');
      wrap.className = 'md-table'; wrap.appendChild(table);
      const add = (section, values, tag) => {
        const tr = document.createElement('tr');
        values.forEach((value, k) => { const cell = document.createElement(tag); if (align[k]) cell.style.textAlign = align[k]; inline(value, cell); tr.appendChild(cell); });
        section.appendChild(tr);
      };
      const head = document.createElement('thead'), body = document.createElement('tbody');
      add(head, cells(line), 'th');
      for (i += 2; i < lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i]); i++) add(body, cells(lines[i]), 'td');
      i--;
      table.append(head, body); target.appendChild(wrap);
      list = paragraph = null; continue;
    }
    const bullet = /^\\s*[-*]\\s+(.*)$/.exec(line), numbered = /^\\s*\\d+[.)]\\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const kind = bullet ? 'UL' : 'OL';
      if (!list || list.tagName !== kind) { list = document.createElement(kind); target.appendChild(list); }
      const li = document.createElement('li'); inline((bullet || numbered)[1], li); list.appendChild(li);
      paragraph = null; continue;
    }
    list = null;
    if (!line.trim()) { paragraph = null; continue; }
    const heading = /^#{1,6}\\s+(.*)$/.exec(line);
    if (heading) {
      const p = document.createElement('p'), strong = document.createElement('strong');
      inline(heading[1], strong); p.appendChild(strong); target.appendChild(p); paragraph = null; continue;
    }
    if (paragraph) { paragraph.appendChild(document.createElement('br')); }
    else { paragraph = document.createElement('p'); target.appendChild(paragraph); }
    inline(line, paragraph);
  }
}
api.postMessage({ action: 'ready' });
</script>
<!-- The scenes' own module, after the page's script so that extracting that script by its tag still finds it: the
     edit scene is driven from JS, so the page needs the module itself, not only its markup and styles. -->
<script nonce="${nonce}">${require(require("path").join(__dirname,"task-visual")).source()}</script>
</body></html>`;
}

module.exports = { register, usageLine };
