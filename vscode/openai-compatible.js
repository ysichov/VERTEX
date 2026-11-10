"use strict";

const https = require("https");
const http = require("http");
const toolSupport = require("./tool-support");

// Provider endpoints from ABAP-AI-Code's ZAICODE_PROVIDER seed list. The
// Assistant calls only these fixed HTTPS hosts; keys stay in SecretStorage.
const PROVIDERS = Object.freeze({
  "openai-api": { label: "OpenAI", base: "https://api.openai.com/v1" },
  "mistral-api": { label: "Mistral", base: "https://api.mistral.ai/v1" },
  "gemini-api": { label: "Gemini", base: "https://generativelanguage.googleapis.com/v1beta/openai" },
  "groq-api": { label: "Groq", base: "https://api.groq.com/openai/v1" },
  "cerebras-api": { label: "Cerebras", base: "https://api.cerebras.ai/v1" },
  "openrouter-api": { label: "OpenRouter", base: "https://openrouter.ai/api/v1" },
  "nvidia-api": { label: "NVIDIA", base: "https://integrate.api.nvidia.com/v1" },
  "vercel-api": { label: "Vercel AI Gateway", base: "https://ai-gateway.vercel.sh/v1" },
  "opencode-api": { label: "OpenCode Console", base: "https://opencode.ai/inference", routes: {
    "/models": "/v1/models", "/chat/completions": "/openai/v1/chat/completions"
  } },
  "typesafe-api": { label: "TypeSafe Jev", base: "https://api.typesafe.ai/v1", decisionOnly: true },
  // Local servers on this computer: plain HTTP to localhost, no API key.
  "lmstudio-local": { label: "LM Studio", base: "http://localhost:1234/v1", local: true },
  "ollama-local": { label: "Ollama", base: "http://localhost:11434/v1", local: true }
});

function isLocal(id) { return PROVIDERS[id]?.local === true; }

// Local reasoning models (Qwen3, QwQ, DeepSeek-R1) think through thousands of tokens before a commit
// message; an empty think block opening the answer makes them write it at once. LM Studio ignores
// enable_thinking and reasoning_effort for these models, but continues a final assistant message.
function skipsThinking(id, model, options = {}) {
  return isLocal(id) && options.noThinking === true && /qwen3|qwq|deepseek-r1/i.test(String(model || ""));
}
const EMPTY_THINK = { role: "assistant", content: "<think>\n\n</think>\n\n" };

// A local server may run on another port: vertex.ai.lmstudioUrl / vertex.ai.ollamaUrl.
const localOverrides = {};
function setLocalBase(id, url) { if (url) localOverrides[id] = url; else delete localOverrides[id]; }
function baseUrl(id) {
  const provider = PROVIDERS[id];
  if (!provider?.local) return provider?.base;
  if (localOverrides[id]) return localOverrides[id];
  let configured = "";
  try { configured = require("vscode").workspace.getConfiguration("vertex.ai").get(id === "lmstudio-local" ? "lmstudioUrl" : "ollamaUrl", ""); } catch (_) {}
  return String(configured || provider.base).trim().replace(/\/+$/, "");
}

function secretKey(id) { return "vertex.provider." + id + ".apiKey"; }

function requestJson(id, apiKey, route, body, maxBytes = 64000, timeoutMs, signal) {
  const provider = PROVIDERS[id];
  if (!provider) { return Promise.reject(new Error("Unknown API provider: " + id)); }
  if (!apiKey && !provider.local) { return Promise.reject(new Error("No " + provider.label + " API key is configured. Enter it in LLM Providers.")); }
  const payload = body == null ? null : JSON.stringify(body);
  if (payload && Buffer.byteLength(payload, "utf8") > maxBytes) {
    return Promise.reject(new Error("VERTEX: request exceeds " + (maxBytes === 64000 ? "64 KB" : (maxBytes / 1024) + " KiB") + "; narrow the context or start a new conversation."));
  }
  const base = baseUrl(id);
  const url = new URL(base + (provider.routes?.[route] || route));
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "http:" ? http : https).request(url, { signal, method: payload ? "POST" : "GET", headers: {
      ...(apiKey && !provider.local ? { authorization: "Bearer " + apiKey } : {}), ...(payload ? { "content-type": "application/json",
        "content-length": Buffer.byteLength(payload, "utf8") } : {})
    } }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", part => {
        text += part;
        if (Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024) {
          req.destroy(new Error(provider.label + " response exceeds 8 MB."));
        }
      });
      res.on("error", reject);
      res.on("aborted", () => reject(Object.assign(new Error(provider.label + " connection closed before the response completed."), {code:"ECONNRESET"})));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
        if (res.statusCode < 200 || res.statusCode >= 300 || !parsed) {
          const error = new Error(provider.label + " API returned " + res.statusCode + ": "
            + String(parsed && parsed.error && (parsed.error.message || parsed.error) || text).slice(0, 500));
          error.status = res.statusCode; error.retryAfter = res.headers?.["retry-after"];
          if (provider.local && /insufficient system resources|requires approximately [\d.]+ ?GB|out of memory/i.test(error.message))
            error.message += " — Not enough memory for this model next to the models already loaded. Unload the others in "
              + provider.label + (id === "lmstudio-local" ? " (Developer tab, or `lms unload --all`)" : " (`ollama stop <model>`)") + ", or choose a smaller model.";
          if (provider.local && /context length|context window|n_ctx|exceeds the context/i.test(error.message))
            error.message += " — The model is loaded with too small a context. In " + provider.label
              + (id === "lmstudio-local" ? ", set a larger Context Length for the model (My Models → model settings, e.g. 32768 or more) and load it again."
                : ", raise the context, e.g. OLLAMA_CONTEXT_LENGTH=32768 before `ollama serve`.");
          reject(error);
        } else { resolve(parsed); }
      });
    });
    if (timeoutMs) {
      const deadline = setTimeout(() => req.destroy(new Error(provider.label + " API timed out.")), timeoutMs);
      req.on("close", () => clearTimeout(deadline));
    }
    req.on("error", error => reject(provider.local && error.code === "ECONNREFUSED"
      ? Object.assign(new Error(require("./local-servers").installed(id)
        ? provider.label + " is installed, but its server does not answer at " + base + ". Start its local server and load a model."
        : provider.label + " is not installed on this computer (or its server does not answer at " + base + "). Download it from "
          + require("./local-servers").SITES[id] + "."), { code: error.code }) : error));
    req.setTimeout(timeoutMs || (provider.local ? 600000 : payload ? 180000 : 60000), () => req.destroy(new Error(provider.label + " API timed out.")));
    req.end(payload || undefined);
  });
}

async function models(id, apiKey, request = requestJson) {
  const response = await request(id, apiKey, "/models");
  if (id === "typesafe-api") {
    if (!Array.isArray(response.models) || !response.models.length) throw new Error("TypeSafe returned no decision models.");
    const list = response.models.filter(item => typeof item?.name === "string" && item.name.trim()).map(item => ({
      id: item.name, label: item.name + " (Decision API)", modelKind: "decision", modelProvider: "typesafe",
      description: item.description || "", metadataSource: "TypeSafe /models API",
      capabilities: { tools: false, json: true, reasoning: false, vision: null, web: false }
    }));
    if (!list.length) throw new Error("TypeSafe returned no valid model names.");
    return list;
  }
  if (!Array.isArray(response.data)) { throw new Error(PROVIDERS[id].label + " did not return a model list."); }
  // Chat does not implement asynchronous batch variants; Vercel also lists non-chat models.
  const list = response.data.filter(item => item && item.id && (id !== "vercel-api" || item.type === "language")
    && !(isLocal(id) && /(?:^|[-_/.])embed(?:ding)?(?:$|[-_/.])|^text-embedding/i.test(String(item.id)))
    && !/(?:^|[-_/:])batch(?:$|[-_/:])/i.test(String(item.id))
    && !/\bbatch\b/i.test(String(item.name || "") + " " + String(item.display_name || ""))).map(item => id === "opencode-api" ? require("./opencode-models").decorate(item) : ({
    id: String(item.id), label: String(item.name || item.display_name || item.id),
    ...(id === "openrouter-api" ? { free: /:free$/i.test(item.id) || item.id === "openrouter/free" || [item.pricing?.prompt,item.pricing?.completion].every(value => (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number(value) === 0) && Object.values(item.pricing || {}).every(value => Number(value) === 0) } : {}),
    ...(id === "vercel-api" ? require("./model-capabilities").metadata(item) : {})
  }));
  if (!list.length) { throw new Error(PROVIDERS[id].label + " returned no models" + (PROVIDERS[id].local ? ". Download or load a model in " + PROVIDERS[id].label + " first." : " for this key.")); }
  if (isLocal(id)) return loadedOnly(id, apiKey, list, request);
  return list.sort((a, b) => a.label.localeCompare(b.label));
}

// A local server lists every downloaded model (all of them go to LLM Providers); each is marked
// loaded or not, with the context it was loaded with, so the panel can offer only the running ones.
async function loadedOnly(id, apiKey, list, request) {
  let loaded;
  try {
    if (id === "lmstudio-local") {
      const state = await request(id, apiKey, "/../api/v0/models", undefined, 64000, 5000);
      if (!Array.isArray(state?.data)) return list;
      loaded = new Map(state.data.filter(m => m?.state === "loaded").map(m => [String(m.id), m.loaded_context_length]));
    } else {
      const state = await request(id, apiKey, "/../api/ps", undefined, 64000, 5000);
      if (!Array.isArray(state?.models)) return list;
      loaded = new Map(state.models.map(m => [String(m.name || m.model), m.context_length]));
    }
  } catch (_) { return list; }
  return list.map(m => !loaded.has(m.id) ? { ...m, loaded: false }
    : { ...m, loaded: true, ...(Number(loaded.get(m.id)) > 0 ? { label: m.label + " · context " + loaded.get(m.id) } : {}) })
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function retryWait(ms, options) {
  let timer, cancel;
  const cancelled = new Promise((resolve, reject) => {
    cancel = () => { clearTimeout(timer); reject(new Error("This request was superseded.")); };
  });
  options.onRetryWait?.(cancel);
  try {
    await Promise.race([cancelled, options.sleep ? options.sleep(ms) : new Promise(resolve => { timer = setTimeout(resolve, ms); })]);
  } finally { clearTimeout(timer); options.onRetryWait?.(null); }
}

async function rateLimitedRequest(send, options = {}) {
  let retry = 0, networkRetries = 0;
  for (;;) {
    if (options.isActive && !options.isActive()) throw new Error("This request was superseded.");
    try { return await send(); }
    catch (error) {
      const transient = ["ECONNRESET", "EPIPE", "ECONNREFUSED", "EAI_AGAIN"].includes(error.code)
        || /\b(?:ECONNRESET|EPIPE|ECONNREFUSED|EAI_AGAIN)\b/.test(error.message || "");
      if (options.retryNetwork && transient) {
        error.networkAttempts = networkRetries + 1;
        if (networkRetries >= 1) throw error;
        networkRetries++;
        options.onProgress?.({status:"Connection interrupted. Retrying message generation once…"});
        options.onProviderResponse?.({provider:options.assistant,scope:"network_retry",response:{model:options.model,is_error:true,error:error.message,code:error.code,operation:"Generate commit message",attempt:networkRetries}});
        await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1500);
        continue;
      }
      if (!(error.status === 429 || /returned 429\b/.test(error.message || ""))) throw error;
      const limitState = await options.onRateLimit?.(error);
      // A daily quota cannot recover during the short retry delay.
      if (/free-models-per-day/i.test(error.message || "") || limitState?.retry === false) throw error;
      if (retry >= 2) throw error;
      const hint = /retry\s+after\s+(\d+(?:\.\d+)?)\s*s/i.exec(error.message || "");
      let ms = Number.isFinite(Number(error.retryAfter)) && error.retryAfter !== undefined ? Number(error.retryAfter) * 1000
        : error.retryAfter && Number.isFinite(Date.parse(error.retryAfter)) ? Date.parse(error.retryAfter) - Date.now()
        : hint ? Number(hint[1]) * 1000 : 60000;
      ms = Math.max(1000, ms + 250);
      if (ms > 60250) throw error;
      retry++;
      options.onProgress?.({ status: "Rate limit reached. Waiting " + Math.ceil(ms / 1000) + " s before retrying the model request (" + retry + "/2)." });
      await retryWait(ms, options);
    }
  }
}

// One minimal paid generation request: no tool schemas, history or agent rounds.
async function probe(id, apiKey, model, request = requestJson, options = {}) {
  if (id === "typesafe-api" || id === "opencode-api" && require("./opencode-models").isDecision(model)) {
    const response = await request(id, apiKey, id === "typesafe-api" ? "/systemone" : "/systemone/v1/systemone", {
      model, state: "Synthetic connectivity check: the test passed.",
      questions: { passed: { type: "noul", instructions: "Did the test pass?" } }
    }, 64000, 10000, options.signal);
    options.onProviderResponse?.({ provider: id, scope: "model_response", response });
    const raw = response.usage || {};
    const cost = raw.cost;
    const usage = { input_tokens: Number(raw.input_tokens ?? raw.prompt_tokens ?? 0), output_tokens: Number(raw.output_tokens ?? raw.completion_tokens ?? 0),
      ...(cost !== null && cost !== undefined && cost !== "" && Number.isFinite(Number(cost)) && Number(cost) >= 0 ? { cost_usd: Number(cost) } : {}) };
    options.onModelCall?.({ model: response.model || model, usage, text: JSON.stringify(response.answers || {}) });
    const value = response.answers?.passed?.noul;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(PROVIDERS[id].label + " returned no valid Jev decision probability.");
    return { model: response.model || model, usage };
  }
  // A check must not make a local server load a model the user has not started.
  if (isLocal(id)) {
    const found = (await models(id, apiKey, request)).find(m => m.id === model);
    if (found && found.loaded === false) throw new Error(model + " is not loaded in " + PROVIDERS[id].label + ". Start it there, then check again.");
  }
  const response = await request(id, apiKey, "/chat/completions", {
    model, messages: [{ role: "user", content: "Reply OK." }], stream: false,
    ...(id === "openai-api" ? { max_completion_tokens: 16 } : { max_tokens: 16 })
  }, 64000, isLocal(id) ? 180000 : 10000);
  const message = response.choices?.[0]?.message;
  const answer = typeof message?.content === "string" ? message.content.trim() : Array.isArray(message?.content) ? message.content.filter(part => part?.type === "text").map(part => part.text || "").join("\n").trim() : "";
  options.onProviderResponse?.({provider:id,scope:"model_response",response:{...response,finish_reason:response.choices?.[0]?.finish_reason,
    message_diagnostics:{content_characters:answer.length,reasoning_tokens:Number(response.usage?.completion_tokens_details?.reasoning_tokens||0)}}});
  const raw=response.usage||{},cached=Number(raw.prompt_tokens_details?.cached_tokens??raw.cache_read_input_tokens??0)||0,created=Number(raw.cache_creation_input_tokens||0);
  const usage={input_tokens:raw.prompt_tokens==null?Number(raw.input_tokens||0):Math.max(0,Number(raw.prompt_tokens)-cached-created),output_tokens:Number(raw.completion_tokens??raw.output_tokens??0)||0,cache_read_input_tokens:cached,cache_creation_input_tokens:created,...(["vercel-api","openrouter-api","opencode-api"].includes(id)?await generationCost(response,{...options,assistant:id,apiKey},request):{})};
  const reasoning=typeof message?.reasoning_content==="string"?message.reasoning_content:typeof message?.reasoning==="string"?message.reasoning:"";
  options.onModelCall?.({model:response.model||model,usage,text:answer,...(reasoning?{reasoning}:{})});
  if (!message) throw new Error(PROVIDERS[id].label + " answered without a chat message.");
  return {model:response.model||model,usage};
}

// Actual Gateway debit, never an estimate from catalog token prices.
async function generationCost(response, options, request) {
  if (["openrouter-api", "opencode-api"].includes(options.assistant)) {
    const value = response.usage?.cost;
    const cost = (typeof value === "number" || typeof value === "string" && value.trim() !== "") && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
    return { generation_id: response.id || null, cost_usd: cost };
  }
  const gateway = response.providerMetadata?.gateway || response.provider_metadata?.gateway || response.choices?.[0]?.message?.provider_metadata?.gateway;
  const generationId = gateway?.generationId || response.id;
  const number = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  let cost = number(response.usage?.gateway_cost ?? response.usage?.cost ?? gateway?.cost);
  if (cost === null && generationId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (options.isActive && !options.isActive()) break;
      try {
        const result = await request("vercel-api", options.apiKey, "/generation?id=" + encodeURIComponent(generationId), undefined, 64000, 5000);
        cost = number(result.data?.total_cost ?? result.data?.gateway_cost);
        if (cost !== null) break;
      } catch (error) {
        if (error.status !== 404 && !/Usage event not found/i.test(error.message || "")) break;
      }
      if (attempt < 2) await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))((attempt + 1) * 1000);
    }
  }
  return { generation_id: generationId || null, cost_usd: cost };
}

function searchCallCount(response) {
  const gateway=response.choices?.[0]?.message?.provider_metadata?.gateway || response.provider_metadata?.gateway || response.providerMetadata?.gateway;
  const count=value=>typeof value==="number" ? Math.max(0,value) : Array.isArray(value) ? value.reduce((n,v)=>n+count(v),0) : value && typeof value==="object" ? (typeof value.count==="number" ? Math.max(0,value.count) : Object.values(value).reduce((n,v)=>n+count(v),0)) : 0;
  return gateway?.gatewayToolCalls == null ? null : count(gateway.gatewayToolCalls);
}
async function ask(options) {
  const id = options.assistant;
  if (PROVIDERS[id]?.decisionOnly || id === "opencode-api" && require("./opencode-models").isDecision(options.model)) throw new Error("Jev is a decision model. Use Check models in LLM Providers to test its Decision API; choose a language model for chat.");
  const request = (id,key,route,body,maxBytes,timeout) => (options.request || requestJson)(id,key,route,body,maxBytes,timeout,options.signal);
  if (options.images?.length && options.capabilities?.vision === false) throw new Error("This model does not accept screenshots. Choose a Vision model or remove the images.");
  if(options.webSearch && id!=="vercel-api")throw new Error("Web mode currently requires Vercel AI Gateway.");
  if(options.webSearch && (options.capabilities?.tools===false || toolSupport.rejection(id,options.apiKey,options.model)))throw new Error("This model cannot use Gateway search tools. Choose another Vercel model for Web mode.");
  let tools = options.structuredResult ? [] : options.webSearch ? [{type:"vercel:perplexity_search",config:{query:options.webQuery || options.prompt,max_results:5}}] : options.capabilities?.tools === false || toolSupport.rejection(id, options.apiKey, options.model) ? [] : (options.tools || []).map(tool => ({ type: "function", function: {
    name: tool.name, description: tool.description, parameters: tool.inputSchema
  } })).concat([{ type: "function", function: { name: "submit_vertex_answer",
    description: "Submit the final VERTEX answer and navigation plan.", parameters: options.schema } }]);
  const content = options.images?.length ? [{ type: "text", text: options.prompt },
    ...options.images.map(image => ({ type: "image_url", image_url: { url: "data:" + image.media_type + ";base64," + image.data } }))] : options.prompt;
  const textOnly = "Tools are unavailable for this request. Reply directly as plain text from supplied context, not through submit_vertex_answer or JSON. Do not claim to read files, search, run commands, modify objects or perform live actions. The supplied source, review and debugger context are available for reading and analysis. Do not say that this supplied context is unavailable. Mention tool limitations only when the actual requested action needs unavailable tools.";
  const messages = [{ role: "system", content: options.instructions + (options.structuredResult?"\nReturn a root JSON object matching this schema, with no answer wrapper: "+JSON.stringify(options.schema):!tools.length?"\n"+textOnly:"") }, { role: "user", content }];
  const imageBytes = (options.images || []).reduce((sum, image) => sum + Buffer.byteLength(image.data || "", "utf8") + 256, 0);
  async function retryAnswer(plan){
    const feedback=await options.onBeforeAnswer?.(plan);
    if(!feedback)return false;
    messages.push({role:"assistant",content:plan.answer||""},{role:"user",content:feedback});
    return true;
  }
  let usage = null;
  for (let round = 0; round < (options.maxRounds || 12); round += 1) {
    // A toolset the model enabled adds tools to options.tools during the request; they join before submit_vertex_answer.
    if (tools.length && !options.webSearch && (options.tools || []).length + 1 > tools.length) {
      const known = new Set(tools.map(tool => tool.function && tool.function.name));
      const added = options.tools.filter(tool => !known.has(tool.name)).map(tool => ({ type: "function", function: {
        name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
      tools = tools.slice(0, -1).concat(added, tools.slice(-1));
    }
    options.onProgress?.({ status: "Model request " + (round + 1) });
    const send = () => rateLimitedRequest(() => request(id, options.apiKey, "/chat/completions", {
      ...(options.structuredResult&&!options.structuredFallback?{response_format:{type:"json_schema",json_schema:{name:"vertex_result",strict:true,schema:options.schema}}}:{}),
      model: options.model, messages: skipsThinking(id, options.model, options) && !tools.length ? messages.concat([EMPTY_THINK]) : messages, ...(tools.length ? { tools } : {}), ...(options.webSearch ? {tool_choice:"required"} : {}),
      ...(Number.isInteger(options.maxOutputTokens)&&options.maxOutputTokens>0 ? id==="openai-api"?{max_completion_tokens:options.maxOutputTokens}:{max_tokens:options.maxOutputTokens} : {}), stream: false
    // The limit is on the conversation and its context; the tool definitions are a fixed part on top of it -
    // an MCP server's alone can pass 64 KB.
    }, (options.maxInputBytes || (options.localTools ? 2 * 1024 * 1024 : 64000)) + imageBytes + (tools.length ? Buffer.byteLength(JSON.stringify(tools), "utf8") : 0)), options);
    let response;
    try { response = await send(); }
    catch (error) {
      const unsupported = (error.status === 400 || /returned 400\b/.test(error.message || ""))
        && /(?:does(?:n't| not)|does not|cannot|can't) support (?:tool use|tool calling|tools|function calling)|(?:tool use|tool calling|tools|function calling) (?:is |are )?not supported/i.test(error.message || "");
      if (tools.length && unsupported && !options.webSearch) {
        const evidence = await toolSupport.reject(id, options.apiKey, options.model);
        options.onToolUnsupported?.(evidence);
        options.onProviderResponse?.({ provider:id, scope:"tool_support_rejected", response:{ model:options.model, is_error:true, error:error.message, model_step:round+1, operation:"Tool support negotiation" } });
        // Only an initial rejected request may be resent. Never replay completed tools.
        if (round === 0) {
          tools = [];
          messages[0].content += "\n" + textOnly;
          options.onProgress?.({ status:"API rejected tools. Continuing once in text-only mode." });
          try { response = await send(); } catch (retryError) { retryError.model_step=round+1; retryError.operation="Text-only model request"; throw retryError; }
        } else {
          error.message += " Tool support was disabled for future requests. Earlier tool operations were not repeated.";
        }
      }
      if (!response) { error.model_step = round + 1; error.operation = "Model request"; throw error; }
    }
    const webSearchCalls=options.webSearch ? searchCallCount(response) : null;
    const choice=response.choices?.[0],rawMessage=choice?.message;
    const diagnostics={content_type:Array.isArray(rawMessage?.content)?"array":typeof rawMessage?.content,content_characters:typeof rawMessage?.content==="string"?rawMessage.content.length:0,
      reasoning_characters:typeof rawMessage?.reasoning_content==="string"?rawMessage.reasoning_content.length:typeof rawMessage?.reasoning==="string"?rawMessage.reasoning.length:0,
      reasoning_tokens:Number(response.usage?.completion_tokens_details?.reasoning_tokens||0),refusal:typeof rawMessage?.refusal==="string"?rawMessage.refusal.slice(0,500):null};
    if (options.onProviderResponse) options.onProviderResponse({ provider: id, scope: "model_response", response:{...response,finish_reason:choice?.finish_reason,message_diagnostics:diagnostics,...(options.webSearch?{gateway_tool_calls:webSearchCalls}:{})} });
    // The model's reasoning goes to the session log with its answer.
    const reasoningText=typeof rawMessage?.reasoning_content==="string"?rawMessage.reasoning_content:typeof rawMessage?.reasoning==="string"?rawMessage.reasoning:"";
    const onModelCall=options.onModelCall&&(event=>options.onModelCall(reasoningText?{...event,reasoning:reasoningText}:event));
    let roundUsage = null;
    if (response.usage) {
      const raw = response.usage;
      const cached = Number(raw.prompt_tokens_details?.cached_tokens ?? raw.cache_read_input_tokens ?? 0) || 0;
      const created = Number(raw.cache_creation_input_tokens ?? 0) || 0;
      const prompt = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0) || 0;
      const next = { input_tokens: raw.prompt_tokens == null ? prompt : Math.max(0, prompt - cached - created),
        output_tokens: Number(raw.completion_tokens ?? raw.output_tokens ?? 0) || 0,
        cache_read_input_tokens: cached, cache_creation_input_tokens: created };
      roundUsage = next;
      if (!usage) usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      for (const key of Object.keys(next)) usage[key] = (usage[key] || 0) + next[key];
    }
    if (["vercel-api", "openrouter-api", "opencode-api"].includes(id)) {
      roundUsage = { ...(roundUsage || {}), ...await generationCost(response, options, request) };
      if (roundUsage.cost_usd !== null) {
        if (!usage) usage = {};
        usage.cost_usd = (usage.cost_usd || 0) + roundUsage.cost_usd;
      } else {
        if (!usage) usage = {};
        usage.cost_missing = (usage.cost_missing || 0) + 1;
      }
    }
    const message = response.choices && response.choices[0] && response.choices[0].message;
    if (!message) { throw new Error(PROVIDERS[id].label + " answered without a chat message."); }
    if(options.webSearch){
      roundUsage={...(roundUsage||{}),web_search_calls:webSearchCalls};
      if(!(webSearchCalls>0)){
        onModelCall?.({model:response.model||options.model,usage:roundUsage,text:"Web search execution was not confirmed; answer withheld."});
        throw new Error("Vercel did not confirm a successful web search. No web-verified answer is available; try another model or retry.");
      }
      if(message.tool_calls?.length)throw new Error("Gateway returned client tool calls instead of executing web search. No SAP or file action was performed.");
    }
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!tools.length && calls.length) throw new Error("The model returned tool calls although tools are disabled; no action was executed.");
    const final = calls.find(call => call.function && call.function.name === "submit_vertex_answer");
    if (final) {
      let plan;
      try { plan = JSON.parse(final.function.arguments || "{}"); } catch (_) { throw new Error(PROVIDERS[id].label + " returned an invalid VERTEX plan."); }
      if (typeof plan.answer !== "string") { throw new Error(PROVIDERS[id].label + " returned a VERTEX plan without an answer."); }
      if(await retryAnswer(plan)){onModelCall?.({model:response.model||options.model,usage:roundUsage,text:"[Draft withheld by orchestrator review]",withheld:true});continue;}
      if (onModelCall) onModelCall({ model: response.model || options.model, usage: roundUsage, text: plan.answer });
      return { plan, model: options.model, usage };
    }
    if (!calls.length) {
      let answer = typeof message.content === "string" ? message.content.trim() : Array.isArray(message.content)
        ? message.content.filter(part=>part && ["text","output_text"].includes(part.type)&&typeof part.text==="string").map(part=>part.text).join("\n").trim() : "";
      if(options.structuredResult){
        onModelCall?.({model:response.model||options.model,usage:roundUsage,text:answer});
        if(diagnostics.refusal)throw new Error(PROVIDERS[id].label+" refused the structured request: "+diagnostics.refusal);
        let structured;try{structured=JSON.parse(answer);}catch(_){throw Object.assign(new Error("Provider returned invalid structured JSON."),{code:"STRUCTURED_FORMAT"});}
        return {plan:structured,model:response.model||options.model,usage};
      }
      if(answer&&options.schema){
        try{const object=JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g,""));if(object&&typeof object.answer==="string"&&Object.keys(object).every(key=>["answer","navigation","build_command"].includes(key)))answer=object.answer.trim();}catch(_){}
      }
      if (answer && options.schema && /^\{\s*\}$/.test(answer)) {
        onModelCall?.({model:response.model||options.model,usage:roundUsage,text:"[The model returned an empty JSON object without an answer.]"});
        const error=new Error(PROVIDERS[id].label+" returned an empty JSON object without an answer. The supplied context was sent; try another model or generate again.");error.model_step=round+1;error.operation="Read model response";throw error;
      }
      if (answer) {
        if(await retryAnswer({answer,navigation:null})){onModelCall?.({model:response.model||options.model,usage:roundUsage,text:"[Draft withheld by orchestrator review]",withheld:true});continue;}
        if (onModelCall) onModelCall({ model: response.model || options.model, usage: roundUsage, text: answer });
        return { plan: { answer, navigation: null }, model: options.model, usage };
      }
      onModelCall?.({model:response.model||options.model,usage:roundUsage,text:"[The model returned no final text.]"});
      const reason=diagnostics.refusal ? " refused to answer: "+diagnostics.refusal
        : choice?.finish_reason==="length" ? " reached its output limit before returning final text."
        : diagnostics.reasoning_tokens>0||diagnostics.reasoning_characters>0 ? " returned reasoning only, with no final text."
        : " returned an empty final response.";
      const error=new Error(PROVIDERS[id].label+reason+" Finish reason: "+(choice?.finish_reason||"not reported")+". Try generating again or select another model.");
      error.model_step=round+1;error.operation="Read model response";error.finish_reason=choice?.finish_reason;throw error;
    }
    if (onModelCall) onModelCall({ model: response.model || options.model, usage: roundUsage,
      text: typeof message.content === "string" ? message.content : "" });
    messages.push({ role: "assistant", content: message.content || null, tool_calls: calls });
    for (const call of calls) {
      const name = call.function && call.function.name;
      if (!(options.tools || []).some(tool => tool.name === name)) {
        throw new Error(PROVIDERS[id].label + " requested an unavailable tool: " + name);
      }
      let content;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        content = JSON.stringify(await options.callTool(name, args));
      } catch (error) { if(error.orchestratorFatal||options.signal?.aborted)throw error; content = JSON.stringify({ error: error.message }); }
      if (Buffer.byteLength(content, "utf8") > 24000) {
        content = "Result too large for chat. Ask the user to narrow the request; the full result was not sent.";
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new Error(PROVIDERS[id].label + " did not finish the VERTEX plan.");
}

// OpenRouter's own account of the key after an answer: free-model requests left today (UTC) and money spent.
async function keyLimits(apiKey, request = requestJson) {
  const data = (await request("openrouter-api", apiKey, "/key", undefined, 64000, 10000))?.data;
  if (!data || typeof data !== "object") throw new Error("OpenRouter returned no key data.");
  const free = data.free_model_daily_requests;
  const num = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  return { free: free && typeof free === "object" ? { used: num(free.used), limit: num(free.limit), remaining: num(free.remaining) } : null,
    usage_daily: num(data.usage_daily), limit_remaining: num(data.limit_remaining) };
}
function limitsText(limits) {
  if (!limits) return "";
  if (limits.error) return "OpenRouter limits not reported: " + limits.error;
  const parts = [];
  if (limits.free && limits.free.remaining !== null) parts.push("free today " + limits.free.remaining + " of " + limits.free.limit + " left");
  if (limits.usage_daily !== null) parts.push("spent today $" + limits.usage_daily.toLocaleString("en-US", { maximumSignificantDigits: 21, useGrouping: false }));
  if (limits.limit_remaining !== null) parts.push("key limit $" + limits.limit_remaining + " left");
  return parts.length ? "OpenRouter: " + parts.join(" · ") : "OpenRouter limits not reported";
}

module.exports = { PROVIDERS, isLocal, setLocalBase, baseUrl, secretKey, requestJson, models, ask, probe, rateLimitedRequest, keyLimits, limitsText };
