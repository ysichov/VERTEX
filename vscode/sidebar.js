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
  let currentView, ready = false, nextRequest = 0, pendingChat = null;
  // ASK AI of a review: the blocks on the chip above the input, attached to the next question only when it is sent.
  let reviewAsk = null;
  const review = require("./code-review");
  const showReview = () => currentView && ready ? currentView.webview.postMessage({ review: reviewAsk ? review.askLabel(reviewAsk) : "", draft: reviewAsk && reviewAsk.question || "" }) : undefined;
  // Beside the gear in the panel's title: LLM providers (the SAP Systems table is extension.js's).
  context.subscriptions.push(vscode.commands.registerCommand("vertex.openModelSettings", () => ask.configModels()));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.configureOrchestrator", async () => {try{const planner=await ask.configOrchestrator();if(currentView)await currentView.webview.postMessage({planner});return planner;}catch(error){vscode.window.showErrorMessage("VERTEX planner: "+error.message);}}));
  if (chatMcp) context.subscriptions.push(vscode.commands.registerCommand("vertex.mcpServers", () => require("./mcp-window").open(vscode, chatMcp)));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.generateCommitMessage", async (snapshot,draft) => {try{return await ask.generateCommitMessage(snapshot,draft);}catch(error){return {error:error.message,generation:error.generation};}}));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.generatePullRequest", async (snapshot,draft) => {try{return await ask.generateCommitMessage(snapshot,draft,"pr");}catch(error){return {error:error.message,generation:error.generation};}}));
  // Continue a conversation from Session Logs: a new conversation in the panel whose history is the logged questions
  // and answers; it keeps logging under the same conversation id, so its files stay together.
  context.subscriptions.push(vscode.commands.registerCommand("vertex.continueConversation", async found => {
    if (!found || !Array.isArray(found.turns) || !found.turns.length) throw new Error("No questions to continue from.");
    if (!currentView || !ready) {
      await vscode.commands.executeCommand("vertex.launcher.focus");
      for (let waited = 0; (!currentView || !ready) && waited < 5000; waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
      if (!currentView || !ready) throw new Error("The VERTEX panel did not open; open it and try again.");
    }
    require("./session-log").reset(found.conversation || undefined, found.branch);
    await vscode.commands.executeCommand("vertex.resetTranspilerRunNumbers");
    const count = ask.restoreConversation(found.turns);
    reviewAsk = null;
    const view = currentView;
    await view.webview.postMessage({ cleared: true });
    const first = found.turns.find(turn => turn.time), when = first ? new Date(first.time).toLocaleString() : "";
    await view.webview.postMessage({ chat: "VERTEX: Continued from the session log" + (when ? " of " + when : "") + ": " + count + " question" + (count === 1 ? "" : "s")
      + (found.files > 1 ? " from " + found.files + " providers' logs" : "") + ". The next question carries them as history; the tools' results of that session are not repeated." });
    for (const turn of found.turns) {
      await view.webview.postMessage({ chat: "You: " + turn.question });
      await view.webview.postMessage({ chat: "VERTEX: " + (turn.answer || "(no answer was logged)") });
    }
    await showReview();
    view.show(true);
    return count;
  }));
  context.subscriptions.push(vscode.commands.registerCommand("vertex.continueDecision",async input=>{
    if(pendingChat)throw new Error("Wait for the active request to finish before restoring a Jev step.");
    require("./jev").validate(input?.state,input?.questions);
    if(!["typesafe-api","opencode-api"].includes(input.provider)||typeof input.model!=="string")throw new Error("Invalid Jev provider or model in this step.");
    if(!currentView||!ready){
      await vscode.commands.executeCommand("vertex.launcher.focus");
      for(let waited=0;(!currentView||!ready)&&waited<5000;waited+=100)await new Promise(resolve=>setTimeout(resolve,100));
      if(!currentView||!ready)throw new Error("Open the VERTEX panel and try again.");
    }
    const state=await ask.setProvider(input.provider);
    if(state.provider!==input.provider)throw new Error("Select the Jev provider and try again.");
    await ask.setModel(input.model);
    const models=await ask.listModels();
    await currentView.webview.postMessage({ai:ask.state(),models,decisionDraft:input});
    currentView.show(true);
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
    await vscode.commands.executeCommand("vertex.launcher.focus");
    await showReview();
  }));
  const provider = {
    resolveWebviewView(view) {
      currentView = view;
      ready = false;
      const nonce = require("crypto").randomBytes(24).toString("hex");
      view.webview.options = { enableScripts: true, localResourceRoots: [] };
      view.webview.html = html(nonce);
      const refresh = (fresh = false) => {
        const chosen = active();
        return view.webview.postMessage({
          system: chosen.error ? "" : chosen.system.name,
          // The active system's clients, when it lists more than one, and the one in use.
          client: chosen.error ? "" : chosen.system.client, clients: chosen.error ? [] : chosen.system.clients || [],
          systems: systems().map(item => item.name),
          // What the list shows: a system reached through SAP's extension says so beside its name.
          labels: systems().map(item => item.name),
          ai: ask.state(),
          // Where the chat's SAP tools come from: VERTEX itself or an MCP server of vertex.chat.mcpServers.
          mcp: chatMcp ? { servers: chatMcp.choices(), selected: chatMcp.selected(),
            updates: chatMcp.overview().filter(s => Array.isArray(s.update) && s.update.length).map(s => s.name) } : null,
          planner: ask.plannerState(),
          effort: String(vscode.workspace.getConfiguration("vertex.ai").get("effort", "") || "")
        }).then(async () => {
          // The model list comes after: it may have to ask the provider.
          try { await view.webview.postMessage({ models: await ask.listModels(fresh) }); }
          catch (error) { await view.webview.postMessage({ models: { error: error.message } }); }
        });
      };
      // The folder Claude works in, under the SAP system, so the panel does not read as SAP-only.
      let fileLinksUpdated=0;
      const updateFileLinks=async(force=false)=>{if(!ready||!force&&Date.now()-fileLinksUpdated<3000)return;fileLinksUpdated=Date.now();try{await view.webview.postMessage({localFiles:await require("./file-links").catalog(vscode)});}catch(_){};};
      const showFolder = async () => {if(!ready)return;await view.webview.postMessage({folder:ask.state().contextFolder??require("./chat").currentWorkingFolder(vscode),contextMode:ask.state().contextMode});await updateFileLinks();};
      const messages = view.webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== "object") { return; }
        if (message.action === "ready") {
          ready = true;
          await showFolder();
          await refresh();
          await showReview();
          await view.webview.postMessage({chatRunning:!!pendingChat});
          return;
        }
        if(message.action==="setContextMode"){try{await view.webview.postMessage({ai:await ask.setContextMode(message.mode)});await showFolder();}catch(error){vscode.window.showWarningMessage("VERTEX: "+error.message);}return;}
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
          try { await view.webview.postMessage({ ai: await ask.setProvider(message.provider) }); await showFolder(); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "setEffort") {
          const level = String(message.effort || "");
          if (["", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level)) {
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
          try { await require("./git-history").open(vscode, require("./chat").currentWorkingFolder(vscode)); }
          catch (error) { vscode.window.showErrorMessage("VERTEX Git History: " + error.message); }
          return;
        }
        if (message.action === "newConversation") {
          // A new conversation writes to a new log file.
          require("./session-log").reset();
          await vscode.commands.executeCommand("vertex.resetTranspilerRunNumbers");
          ask.newConversation();
          reviewAsk = null;
          await view.webview.postMessage({ cleared: true });
          await showReview();
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
          try { await ask.openObject({ object_type: String(message.object_type), object_name: String(message.object_name) }); }
          catch (error) { await view.webview.postMessage({ chat: "VERTEX: " + error.message }); }
          return;
        }
        if (message.action === "stopChat") {
          if (pendingChat && !pendingChat.cancelled) {
            pendingChat.cancelled = true;
            ask.stop();
            await view.webview.postMessage(pendingChat.kind === "decision" ? {decisionStatus:"Stopping…"} : { progress: { id: pendingChat.id, status: "Stopping…" } });
          }
          return;
        }
        if(message.action === "decision") {
          if(pendingChat)return;
          const pending=pendingChat={id:++nextRequest,cancelled:false,kind:"decision"};
          try{
            await view.webview.postMessage({decisionRunning:true});
            const result=await ask.evaluate({model:message.model,state:message.state,questions:message.questions});
            await view.webview.postMessage(pending.cancelled||result.stopped?{decisionStatus:"Stopped."}:{decisionResult:result});
          }catch(error){await view.webview.postMessage({decisionStatus:pending.cancelled?"Stopped.":"Request failed: "+error.message});}
          finally{if(pendingChat===pending)pendingChat=null;await view.webview.postMessage({decisionRunning:false});}
          return;
        }
        if (message.action === "chat") {
          if (pendingChat) return;
          const requestId = ++nextRequest;
          // The window shows the question as written; the review's blocks go to the model with it, unseen.
          const web=message.web===true||require("./web-intent").requested(message.text);
          const asked = web ? null : reviewAsk;
          if (asked) { reviewAsk = null; await showReview(); }
          const images = (Array.isArray(message.images) ? message.images : []).filter(image => image
            && /^image\/(png|jpeg|gif|webp)$/.test(image.media_type) && typeof image.data === "string" && image.data);
          const shown = String(message.text || "").trim() || (asked ? "What does this change do, and is there a real problem with it?"
            : images.length ? "What is in this screenshot?" : "");
          if (!shown) { return; }
          const pending = pendingChat = { id: requestId, cancelled: false };
          try {
          await view.webview.postMessage({ chat: "You: " + shown + (asked ? "  [" + review.askLabel(asked) + "]" : "")
            + (images.length ? "  [" + images.length + " screenshot" + (images.length > 1 ? "s" : "") + "]" : "") });
          let taskKind=web?"":/коммит|commit/i.test(shown)?"commit":asked||require("./git-history").reviewContext()||/ревью|review|дифф|diff|проверь\s+(?:код|изменен)/i.test(shown)?"review":"";
          await view.webview.postMessage({ progress: { id: requestId, kind:taskKind,status: taskKind==="review"?"Reviewing changes…":taskKind==="commit"?"Preparing commit message…":"Working…" } });
            const scope = asked ? { review_ask: { object: asked.object, all: asked.all, blocks: asked.blocks.map(block => block.block) } } : undefined;
            const state = web ? {} : (await toolContext(scope)) || {};
            if(!web&&!taskKind&&(state.review_source||state.vertex_view?.view==="review")){taskKind="review";await view.webview.postMessage({progress:{id:requestId,kind:taskKind,status:"Reading review context…"}});}
            if (pending.cancelled) { await view.webview.postMessage({progress:{id:requestId,stopped:true,done:true}}); return; }
            if (asked) {
              state.review_ask = { object: asked.object, all: asked.all, blocks: asked.blocks.map(block => block.block) };
              delete state.review_source;
              delete state.selected_fragment;
            }
            const reply = await ask(asked ? review.askRequest(message.text, asked) : shown, {model: message.model, state, web,contextMode:asked?.system==="local"?"folder":ask.state().contextMode,
              ...(images.length ? { images } : {}),
              onProgress: update => { if(pending.cancelled)return; Promise.resolve(view.webview.postMessage({ progress: { id: requestId, kind:taskKind,...update } })).catch(() => {}); } });
            if (pending.cancelled || reply.stopped) { await view.webview.postMessage({progress:{id:requestId,stopped:true,done:true}}); return; }
            if (reply.superseded) { await view.webview.postMessage({ progress: { id: requestId, remove: true } }); return; }
            await view.webview.postMessage({ progress: { id: requestId,
              answer: reply.answer + (reply.navigationError ? "\n\nVERTEX could not open the object: " + reply.navigationError : ""),
              done: true, usage: usageLine(reply)+(reply.planner?" · Planner: "+usageLine(reply.planner):""), choices: reply.choices || [],
              runs: (await vscode.commands.executeCommand("vertex.knownEvidenceSessions")) || [] } });
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
          await chatMcp.select(String(message.name));
          if (String(message.name) === chatMcp.VERTEX || String(message.name) === chatMcp.ORCHESTRATOR) return;
          // Its write settings are asked first, in the same window; the server starts when the user presses Start.
          const options = chatMcp.writeOptions(String(message.name));
          if (options.length) { await view.webview.postMessage({ mcpOptions: { name: String(message.name), options } }); return; }
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
      view.onDidDispose(() => { currentView = undefined; ready = false; messages.dispose(); changes.dispose(); folderWatch.forEach(watch => watch.dispose()); clientSwitch.dispose(); mcpUpdates.dispose(); });
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
  + require("fs").readFileSync(require("path").join(__dirname, "images", "icon.png")).toString("base64");

function html(nonce) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
html, body { height: 100%; margin: 0; }
body { box-sizing: border-box; display: flex; flex-direction: column; padding: 16px 16px 8px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h2 { font-size: 12px; text-transform: uppercase; margin: 8px 0 12px; }
p { line-height: 1.5; color: var(--vscode-descriptionForeground); }
#system { overflow-wrap: anywhere; margin-bottom: 16px; }
#messages { flex: 1 1 auto; min-height: 80px; overflow-y: auto; white-space: pre-wrap; }
/* The question box and VERTEX Tools stay at the bottom; the answers scroll. */
.dock { flex: none; }
/* The attached review context: a quiet tag above the input, its name cut with an ellipsis, × to drop it. */
#review-chip { display: flex; align-items: center; gap: 6px; box-sizing: border-box; max-width: 100%; width: fit-content; margin-bottom: 6px;
  padding: 2px 2px 2px 8px; border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent)); border-left: 3px solid var(--vscode-focusBorder);
  border-radius: 4px; background: var(--vscode-editorWidget-background, var(--vscode-input-background)); color: var(--vscode-foreground); font-size: 12px; }
#review-chip[hidden] { display: none; }
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
#messages p.usage { font-size: 11px; opacity: .7; margin: -0.6em 0 1em; white-space: pre-line; }
#messages p.tool-status { font-size: 11px; opacity: .8; }
#messages p.you { color: var(--vscode-charts-blue); }
#messages .vertex { color: var(--vscode-charts-green); white-space: normal; line-height: 1.5; margin: 1em 0; }
/* Fixed logo slot: the existing VERTEX mark rotates slowly only while this request is active. */
#messages .vertex.task { position: relative; padding-left: 42px; }
#messages .md-table { overflow-x: auto; margin: 6px 0; }
#messages .md-table table { border-collapse: collapse; font-size: inherit; }
#messages .md-table th, #messages .md-table td { border: 1px solid var(--vscode-panel-border); padding: 3px 8px; text-align: left; vertical-align: top; }
#messages .md-table th { background: var(--vscode-editorWidget-background,var(--vscode-sideBar-background)); font-weight: 600; }
#messages .vertex.task::before { content: ""; position: absolute; left: 0; top: 2px; width: 32px; height: 32px; background: url("${LOGO}") center/contain no-repeat; transform-origin: center; }
#messages .vertex.task:not(.working)::before { visibility: hidden; }
#messages .vertex.task.working::before { animation: vertex-task-turn 6s linear infinite; }
@keyframes vertex-task-turn { to { transform: rotate(360deg); } }
body.vscode-reduce-motion #messages .vertex.task.working::before { animation: none; }
@media (prefers-reduced-motion: reduce) { #messages .vertex.task.working::before { animation: none; } }
${require(require("path").join(__dirname,"task-visual")).css}
#messages .vertex.task[data-task-kind]::before{display:none}
#messages .vertex.task .task-scene{display:block;width:100%;margin-top:6px}
#vercel-row-break { display:none; }
body[data-provider="vercel-api"] #vercel-row-break, body[data-provider="opencode-api"] #vercel-row-break, body[data-provider="openrouter-api"] #vercel-row-break { display:block; flex-basis:100%; height:0; }
#subprovider-select[hidden] { display:none; }
body[data-provider="vercel-api"] #subprovider-select, body[data-provider="opencode-api"] #subprovider-select, body[data-provider="openrouter-api"] #subprovider-select { flex:0 1 150px; max-width:45%; }
body[data-provider="vercel-api"] .model-picker, body[data-provider="opencode-api"] .model-picker, body[data-provider="openrouter-api"] .model-picker { flex:1 1 170px; }
.model-picker { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%; }
.model-picker #model-select { flex: 1 1 auto; min-width: 0; }
.line #model-details-button[hidden], .line #mcp-settings[hidden], .line #mcp-servers[hidden], .line #mcp-update[hidden] { display: none; }
.line #model-details-button, .line #mcp-settings, .line #mcp-servers, .line #mcp-update { flex: none; margin: 0; padding: 3px 8px; }
#model-details-dialog { box-sizing: border-box; width: calc(100% - 24px); max-width: 560px; max-height: 80vh; overflow: auto; padding: 14px 18px; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background,var(--vscode-editor-background)); border: 1px solid var(--vscode-widget-border,var(--vscode-contrastBorder,var(--vscode-panel-border))); box-shadow: 0 4px 18px var(--vscode-widget-shadow,transparent); }
#model-details-dialog::backdrop { background: var(--vscode-widget-shadow,transparent); }
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
#messages .reasoning { margin: 0.5em 0; }
#messages .reasoning summary { cursor: pointer; opacity: .8; }
#messages .reasoning pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 20em; overflow-y: auto; }
textarea, select { box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; font: inherit; }
textarea { width: 100%; resize: vertical; padding: 8px; }
#prompt { min-height: 5.5em; max-height: 14em; overflow-y: auto; padding-right: 30px; }
#prompt.expanded { min-height: 60vh; max-height: 70vh; }
.prompt-box { position: relative; }
.chat-actions{display:flex;justify-content:flex-end;padding-top:6px}
#chat #chat-stop{display:inline-flex;align-items:center;gap:6px;width:auto;margin:0}
#chat #chat-stop[hidden]{display:none}
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
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.line button { margin: 4px 0; padding: 4px 10px; }
.line select { padding: 3px 4px; }
/* EPAM CodeMie, while it is the chosen provider: its indigo-violet-magenta on the provider list and on
   VERTEX Tools, darkened for white text (4.7:1 at
   least) in light and dark themes; a high-contrast theme keeps its own colours. The open list stays the theme's. */
body.vscode-dark[data-provider="codemie"] #provider-select, body.vscode-light[data-provider="codemie"] #provider-select,
body.vscode-dark[data-provider="codemie"] #tools, body.vscode-light[data-provider="codemie"] #tools { color: #fff; border-color: transparent; background: linear-gradient(90deg, #4f46e5, #9333ea 55%, #c026d3); }
body.vscode-dark[data-provider="codemie"] #tools:hover, body.vscode-light[data-provider="codemie"] #tools:hover { background: linear-gradient(90deg, #4338ca, #7e22ce 55%, #a21caf); }
body[data-provider="codemie"] #provider-select option { color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); background: var(--vscode-dropdown-background, var(--vscode-input-background)); }
.chat-head { margin-bottom: 4px; }
#new-conversation { margin-left: auto; }
#tools { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 14px; border-radius: 6px; font-size: 1.7em; font-weight: 600; }
#tools img { width: 40px; height: 40px; }
${require(require("path").join(__dirname,"code-review")).controlsCss}
${require(require("path").join(__dirname,"jev-panel")).css}
</style></head><body>
<dialog id="mcp-start-dialog" aria-labelledby="mcp-start-title"><strong id="mcp-start-title">MCP server</strong><span class="mcp-start-scene" id="mcp-start-scene"></span><div id="mcp-start-status" role="status" aria-live="polite"></div><div id="mcp-start-options"></div><form method="dialog"><button type="button" class="secondary" id="mcp-start-go" hidden>Start</button><button type="button" class="secondary" id="mcp-start-node" hidden>Get Node.js</button><button class="secondary" id="mcp-start-close">Close</button></form></dialog>
<dialog id="model-details-dialog" aria-labelledby="model-details-title"><strong id="model-details-title">Model details</strong><div id="model-capabilities"></div><form method="dialog"><button class="secondary">Close</button></form></dialog>
<div class="line" id="context-controls"><span class="vertex-segment-toggle" id="context-mode" role="group" aria-label="Context source"><button type="button" data-context="sap" class="active">SAP</button><button type="button" data-context="folder">Folder</button></span><span id="sap-context-controls"><span>SAP system</span>
<select id="system-select" aria-label="SAP system"><option>Loading…</option></select>
<select id="client-select" aria-label="SAP client" title="SAP client" hidden></select>
<span id="mcp-label" hidden>MCP</span><select id="mcp-select" aria-label="Chat MCP server" title="Where the chat's SAP tools come from" hidden></select><button type="button" class="secondary" id="mcp-settings" title="Settings of the selected MCP server" aria-label="Settings of the selected MCP server" hidden>⚙</button><button type="button" class="secondary" id="mcp-servers" title="MCP servers: descriptions, versions, toolsets and tools" aria-label="MCP servers: descriptions, versions, toolsets and tools" hidden>ⓘ</button><button type="button" class="secondary" id="mcp-update" hidden>Update</button>
</span><span class="note" id="planner-info" hidden></span><span id="folder-line" hidden>Folder <strong id="folder-name"></strong> <button class="secondary" data-action="gitHistory" id="git-history" title="Commits of this folder">Git History</button></span></div>
<main id="messages" aria-live="polite"><p>Ask anything — about SAP or any project in your folder. You can paste screenshots here too.</p></main>
<div class="dock">
<div class="line chat-head"><select id="provider-select" aria-label="AI provider" title="AI provider"></select><span id="vercel-row-break" aria-hidden="true"></span><select id="subprovider-select" aria-label="Model provider" title="Model provider (model ID prefix)" hidden disabled></select><span class="model-picker"><select id="model-select" aria-label="Model" title="Model"><option>Loading…</option></select><button type="button" class="secondary" id="model-details-button" title="Model capabilities, context and prices" aria-label="Model capabilities, context and prices" aria-haspopup="dialog" hidden disabled>$</button></span><select id="effort-select" aria-label="Effort" title="Effort: how much the model thinks before it answers" hidden></select><button class="secondary" data-action="newConversation" id="new-conversation">New conversation</button></div><div class="note" id="model-status" role="status" aria-live="polite"></div>
${require(require("path").join(__dirname,"jev-panel")).html}
<form id="chat"><div id="review-chip" hidden><span id="review-label"></span><button type="button" id="review-clear" class="secondary" title="Ask without the review's blocks" aria-label="Remove the review context">×</button></div><div id="image-chips" hidden></div><div class="prompt-box"><button type="button" id="expand-prompt" class="secondary" title="Expand the message field" aria-label="Expand the message field" aria-pressed="false">⤢</button><textarea id="prompt" rows="4" placeholder="Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)" aria-label="Message"></textarea></div><div class="chat-actions"><button type="button" id="chat-stop" class="secondary" title="Stop AI response" aria-label="Stop AI response" hidden><span aria-hidden="true">■</span> Stop</button></div></form>
<button class="secondary" data-action="tools" id="tools"><img src="${LOGO}" alt="">VERTEX Tools</button>
</div>
<script nonce="${nonce}">
const api = acquireVsCodeApi();
let contextMode="sap";
let projectFileAliases=new Set();
document.querySelectorAll('[data-context]').forEach(button=>button.addEventListener('click',()=>api.postMessage({action:'setContextMode',mode:button.dataset.context})));
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
  const vercel=['vercel-api','openrouter-api','opencode-api'].includes(document.getElementById('provider-select').value);sub.hidden=!vercel;
  const offered=modelCatalog.slice();
  if(selected&&!offered.some(m=>m.id===selected))offered.push({id:selected,label:selected+' (off)'});
  model.disabled=!offered.length;
  if(!offered.length){model.replaceChildren(new Option('Loading…',''));sub.replaceChildren(new Option('Loading…',''));sub.disabled=true;return;}
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
  drawDecisionMode();
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
  const select = document.getElementById('effort-select'), levels = EFFORTS[provider] || [];
  select.hidden = !levels.length;
  select.replaceChildren(new Option('Effort: default', ''), ...levels.map(level => new Option('Effort: ' + level, level)));
  select.value = levels.includes(effort) ? effort : '';
}
document.getElementById('effort-select').addEventListener('change', event => {
  effort = event.target.value;
  api.postMessage({ action: 'setEffort', effort });
});
document.getElementById('provider-select').addEventListener('change', event => {
  document.body.dataset.provider = event.target.value;
  drawEffort(event.target.value);
  modelCatalog = []; drawModelPickers('');drawModelCapabilities();
  api.postMessage({ action: 'setProvider', provider: event.target.value });
});
document.getElementById('model-select').addEventListener('change', event => {
  if(['vercel-api','openrouter-api','opencode-api'].includes(document.getElementById('provider-select').value))lastVercelModels.set(document.getElementById('provider-select').value+':'+document.getElementById('subprovider-select').value,event.target.value);
  drawModelCapabilities(); document.getElementById('model-status').textContent = '';
  api.postMessage({ action: 'setModel', model: event.target.value });
});
document.querySelectorAll('button[data-action]').forEach(button => {
  button.addEventListener('click', () => api.postMessage({ action: button.dataset.action }));
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
document.getElementById('chat').addEventListener('submit', event => {
  event.preventDefault();
  if(chatRunning)return;
  const field = document.getElementById('prompt');
  const text = field.value.trim();
  // With a review's blocks on the chip an empty question asks the default one.
  if (!text && document.getElementById('review-chip').hidden && !images.length) return;
  if(document.getElementById('model-select').disabled){document.getElementById('model-status').textContent='Wait for the model list to load.';return;}
  const selected = modelCatalog.find(m => m.id === document.getElementById('model-select').value);
  if (images.length && selected?.capabilities?.vision === false) { document.getElementById('model-status').textContent = 'This model does not accept screenshots. Choose a Vision model or remove the images.'; return; }
  setChatRunning(true);
  api.postMessage({ action: 'chat', text, model: document.getElementById('model-select').value,
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
let chatRunning = false, chatStopping = false;
const stopChat = document.getElementById('chat-stop');
function setChatRunning(value) { chatRunning=value;if(!value)chatStopping=false;stopChat.hidden=!value;stopChat.disabled=chatStopping; }
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
  const text = field && typeof field.selectionStart === 'number' && field.selectionEnd > field.selectionStart
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
const taskVisuals=${JSON.stringify({review:require(require("path").join(__dirname,"task-visual")).html("review",true),commit:require(require("path").join(__dirname,"task-visual")).html("commit",true)})};
function paintTaskScene(item,update){
      if(['review','commit'].includes(update.kind))item.dataset.taskKind=update.kind;
      let scene=item.querySelector('.task-scene');
      if(update.done){if(scene)scene.remove();}
      else if(taskVisuals[item.dataset.taskKind]){if(!scene){scene=document.createElement('span');scene.className='task-scene';scene.setAttribute('aria-hidden','true');item.appendChild(scene);}if(scene.dataset.kind!==item.dataset.taskKind){scene.dataset.kind=item.dataset.taskKind;scene.innerHTML=taskVisuals[item.dataset.taskKind];}}
      item.setAttribute('aria-busy',String(!update.done));
}
let plannerSettings=null,orchestratorSelected=false;
${require(require("path").join(__dirname,"jev-panel")).script}
function showPlanner(){const node=document.getElementById('planner-info');node.hidden=!orchestratorSelected||!plannerSettings;node.textContent=plannerSettings?(plannerSettings.provider?'Planner: '+plannerSettings.model+' · '+(plannerSettings.effort||'default effort'):'Planner disabled'):'';}
window.addEventListener('message', event => {
  if(event.data.decisionDraft)restoreJevDraft(event.data.decisionDraft);
  if(typeof event.data.decisionRunning==='boolean')setDecisionRunning(event.data.decisionRunning);
  if(typeof event.data.decisionStatus==='string')document.getElementById('jev-status').textContent=event.data.decisionStatus;
  if(event.data.decisionResult)showDecisionResult(event.data.decisionResult);
  if(event.data.planner){plannerSettings=event.data.planner;showPlanner();}
  if(typeof event.data.chatRunning==='boolean')setChatRunning(event.data.chatRunning);
  const selectedContext=event.data.contextMode||event.data.ai?.contextMode;if(selectedContext){contextMode=selectedContext;document.querySelectorAll('[data-context]').forEach(button=>{const selected=button.dataset.context===contextMode;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});document.getElementById('sap-context-controls').hidden=contextMode!=='sap';if(contextMode==='sap')document.getElementById('folder-line').hidden=true;}
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
    const field = document.getElementById('prompt');
    field.placeholder = event.data.review ? 'Ask about this change… (Enter with nothing typed: what it does and any real problem)' : 'Ask VERTEX… (Enter to send · Ctrl+Enter for a new line)';
    if (event.data.review) field.focus();
  }
  if (event.data && event.data.cleared) {
    const box = document.getElementById('messages');
    box.textContent = '';
    const hint = document.createElement('p');
    hint.textContent = 'Ask anything — about SAP or any project in your folder. You can paste screenshots here too.';
    box.appendChild(hint);
    progressItems.clear();
    setChatRunning(false);
  }
  if (event.data && event.data.progress) {
    const update = event.data.progress;
    setChatRunning(!update.done&&!update.remove);
    if (update.toolSupport && document.getElementById('provider-select').value === update.toolSupport.provider) {
      const model = modelCatalog.find(m => m.id === update.toolSupport.model);
      if (model) { model.capabilities = { ...model.capabilities, tools:false }; model.toolSupportEvidence = update.toolSupport.evidence; drawModelCapabilities(); }
    }
    let item = progressItems.get(update.id);
    if (!item && !update.remove) {
      item = document.createElement('div'); item.className = 'vertex task working';
      document.getElementById('messages').appendChild(item);
      progressItems.set(update.id, item);
    }
    if (item && update.remove) { item.remove(); progressItems.delete(update.id); }
    else if (item) {
      // The text first, the waiting scene right under it.
      let body = item.querySelector('.progress-body');
      if (!body) { body = document.createElement('div'); body.className = 'progress-body streaming-answer'; item.appendChild(body); }
      paintTaskScene(item,update);
      const previous = item.dataset.answer || '';
      if(update.stopped)update.answer=previous+(previous?'\\n\\n':'')+'Stopped.';
      if (typeof update.answer === 'string' && (update.answer || !previous)) {
        const answer = update.answer;
        if (answer.startsWith(previous) && previous) body.textContent += answer.slice(previous.length);
        else body.textContent = 'VERTEX:\\n' + answer;
        item.dataset.answer = answer;
        item.dataset.status = '';
      }
      if (typeof update.status === 'string') item.dataset.status = update.status;
      // While there is no answer yet, the status shares the VERTEX: line.
      if (!item.dataset.answer) body.textContent = 'VERTEX: ' + (item.dataset.status || 'Working…');
      let status = item.querySelector('.tool-status');
      if (item.dataset.answer && item.dataset.status && !update.done) {
        if (!status) { status = document.createElement('p'); status.className = 'tool-status'; item.appendChild(status); }
        status.textContent = item.dataset.status;
      } else if (status) status.remove();
      if (typeof update.thinking === 'string' && update.thinking) {
        let details = item.querySelector('.reasoning');
        if (!details) {
          details = document.createElement('details'); details.className = 'reasoning';
          const summary = document.createElement('summary'); summary.textContent = 'Claude reasoning';
          const pre = document.createElement('pre'); details.append(summary, pre); item.appendChild(details);
        }
        details.querySelector('pre').textContent = update.thinking;
      }
      let limitsLine = item.querySelector('.limits');
      if (typeof update.limits === 'string') {
        if (!limitsLine) { limitsLine = document.createElement('p'); limitsLine.className = 'usage limits'; item.appendChild(limitsLine); }
        limitsLine.textContent = update.limits;
      }
      if (update.done && update.usage && limitsLine) limitsLine.remove();
      if (update.done) {
        item.classList.remove('working');
        const answer = item.dataset.answer || '';
        body.classList.remove('streaming-answer'); body.replaceChildren();
        markdown('VERTEX:\\n' + (answer || 'No answer returned.'), body);
        if (status) status.remove();
        links(item, update.choices || []);linkProjectFiles(item);
        runLinks(item, update.runs || []);
        const copy = document.createElement('button');
        copy.className = 'secondary copy-answer'; copy.textContent = 'Copy'; copy.title = 'Copy this answer to the clipboard';
        copy.addEventListener('click', () => { lastCopy = copy; api.postMessage({ action: 'copyAnswer', text: answer }); });
        item.appendChild(copy);
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
    document.getElementById('folder-line').hidden = !folder||contextMode==='sap';
    name.textContent = folder.split(/[\\\\/]/).filter(Boolean).pop() || folder;
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
    orchestratorSelected=event.data.mcp.selected==='VERTEX Orchestrator';showPlanner();
    const mcpSelect = document.getElementById('mcp-select');
    mcpSelect.replaceChildren(...event.data.mcp.servers.map(name => { const option = new Option(name, name); option.selected = name === event.data.mcp.selected; return option; }));
    mcpSelect.hidden = document.getElementById('mcp-label').hidden = document.getElementById('mcp-settings').hidden = document.getElementById('mcp-servers').hidden = false;
    document.getElementById('mcp-settings').title=document.getElementById('mcp-settings').ariaLabel=orchestratorSelected?'Configure orchestrator planner':'Settings of the selected MCP server';
    const waiting = event.data.mcp.updates || [], update = document.getElementById('mcp-update');
    update.hidden = !waiting.length; update.title = waiting.length ? 'A newer version is out for ' + waiting.join(', ') + '. Opens MCP Servers, where you update it.' : '';
  }
  if (event.data && event.data.ai) {
    const select = document.getElementById('provider-select');
    const previousProvider=select.value;
    select.replaceChildren(...(event.data.ai.providers || []).map(p => new Option(p.short, p.setting)));
    select.value = event.data.ai.provider;
    document.body.dataset.provider = select.value;
    if(previousProvider!==select.value){modelCatalog=[];drawModelPickers('');drawModelCapabilities();}
    if (typeof event.data.effort === 'string') effort = event.data.effort;
    drawEffort(select.value);
  }
  if (event.data && event.data.models) {
    const select = document.getElementById('model-select');
    const data = event.data.models;
    if (data.error) {
      modelCatalog = [];drawModelPickers('');drawModelCapabilities();
      select.replaceChildren(new Option('no models', ''));
      select.title = data.error;
      const status = document.getElementById('model-status');
      if (status) status.textContent = data.error;
    } else {
      select.title = 'Model';
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
      modelCatalog = data.models;drawModelPickers(data.model);drawModelCapabilities();
    }
  }
  if (event.data && event.data.chat) {
    const mine = event.data.chat.startsWith('You: ');
    const item = document.createElement(mine ? 'p' : 'div');
    item.className = mine ? 'you' : 'vertex';
    if (mine) { item.textContent = event.data.chat; } else { markdown(event.data.chat, item); }
    // Each found object is a link: a click opens it, as a single match is opened.
    if (!mine) { links(item, event.data.choices || []);linkProjectFiles(item); }
    let copy = null;
    if (!mine) {
      copy = document.createElement('button');
      copy.className = 'secondary copy-answer'; copy.textContent = 'Copy'; copy.title = 'Copy this answer to the clipboard';
      const text = event.data.chat.replace(/^VERTEX:\\s*/, '');
      copy.addEventListener('click', () => { lastCopy = copy; api.postMessage({ action: 'copyAnswer', text }); });
    }
    document.getElementById('messages').appendChild(item);
    if (event.data.usage) {
      const line = document.createElement('p');
      line.className = 'usage';
      line.textContent = event.data.usage;
      document.getElementById('messages').appendChild(line);
    }
    if (copy) document.getElementById('messages').appendChild(copy);
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
    else if (/^\\*\\*[^*]+\\*\\*$/.test(token)) { node = document.createElement('strong'); node.textContent = token.slice(2, -2); }
    else if (/^\\*[^*\\s][^*]*\\*$/.test(token)) { node = document.createElement('em'); node.textContent = token.slice(1, -1); }
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
</script></body></html>`;
}

module.exports = { register, usageLine };
