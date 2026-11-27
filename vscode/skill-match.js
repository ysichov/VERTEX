"use strict";

// Only skill metadata is sent to Jev. The body and linked references load after a match.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

function isVertexRepository(root) {
  if (!root) return Promise.resolve(false);
  return new Promise(resolve => execFile("git", ["config", "--get", "remote.origin.url"],
    { cwd: root, windowsHide: true, encoding: "utf8" }, (error, output) => {
      resolve(!error && /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/|git:\/\/github\.com\/)ysichov\/VERTEX(?:\.git)?\/?$/i.test(String(output).trim()));
    }));
}

function discover(root) {
  if (!root) return [];
  let dirs;
  try { dirs = fs.readdirSync(path.join(root, ".agents", "skills"), { withFileTypes: true }); }
  catch (_) { return []; }
  return dirs.filter(entry => entry.isDirectory()).map(entry => {
    const file = path.join(root, ".agents", "skills", entry.name, "SKILL.md");
    try {
      const head = fs.readFileSync(file, "utf8").slice(0, 4096);
      const metadata = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1] || "";
      const name = /^name:\s*(.+)$/m.exec(metadata)?.[1]?.trim();
      const description = /^description:\s*(.+)$/m.exec(metadata)?.[1]?.trim();
      return name && description ? { name, description, file } : null;
    } catch (_) { return null; }
  }).filter(Boolean);
}

function load(skill, root) {
  const body = fs.readFileSync(skill.file, "utf8");
  const base = path.resolve(root), references = [];
  for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
    const file = path.resolve(path.dirname(skill.file), match[1]);
    if (file !== base && !file.startsWith(base + path.sep)) continue;
    if (references.some(item => item.file === file)) continue;
    references.push({ file, content: fs.readFileSync(file, "utf8").slice(0, 20000) });
    if (references.length >= 3) break;
  }
  return { ...skill, content: body + references.map(item => "\n\nReferenced procedure " + path.relative(root, item.file) + ":\n" + item.content).join("") };
}

function decision(question, skills, topic) {
  return {
    state: {
      policy: "Match the current user request to a project skill only when it clearly directs VERTEX to execute that workflow now. Questions asking whether execution is possible or permitted are not instructions to execute: examples include 'можно собирать?', 'я сделал апрув — можно собирать?', 'can we build it?' and 'is it ready to build?'. Answer those questions normally without running the skill. Discussion, inspection, quoted requests, explicit do-not-execute instructions, and different artifacts do not match. A standalone imperative such as 'пересобери' or 'собери VSIX' in the VERTEX repository is an execution request. A short repeat request such as 'еще раз' may refer to the active topic's workflow; use the routed topic to resolve what to repeat, but do not execute a skill merely because the topic matches. No earlier chat is available.",
      currentRequest: String(question || "").slice(0, 4000),
      ...(topic?.label ? { activeTopic: String(topic.label).slice(0, 200) } : {}),
      skills: skills.map(({ name, description }) => ({ name, description }))
    },
    questions: {
      ...Object.fromEntries(skills.map((skill, index) => ["match_" + index, { type: "noul",
        instructions: "Does the current user request clearly instruct VERTEX to execute skill '" + skill.name + "' now? This is an execution gate, not a relevance or capability check. Say No for questions about whether or when it can be run, such as 'можно собирать?', even if prior approval is mentioned; say Yes only for a clear instruction to run it now." }]))
    }
  };
}

function versionDecision(question, skill, topic) {
  return {
    state: {
      policy: "The user has explicitly asked to execute this VSIX build workflow. Choose whether to keep the current version or increment the patch. Do not reinterpret the request or cancel the build.",
      currentRequest: String(question || "").slice(0, 4000),
      matchedSkill: skill.name,
      ...(topic?.label ? { activeTopic: String(topic.label).slice(0, 200) } : {})
    },
    questions: { vsix_version: { type: "choice",
      instructions: "Should the explicitly requested VSIX build increment the current patch version? Choose increment only when the request calls for a new release/version, +1, or raising the version. An explicit version number is parsed by code separately. For a plain build/rebuild choose current.",
      criteria: { current: "Build the current version", increment: "Increment the patch version then build" } } }
  };
}

async function match(vscode, question, root, options = {}) {
  if (!await isVertexRepository(root)) return { matched: false, status: "unavailable" };
  const skills = discover(root);
  if (!skills.length) return { matched: false, status: "unavailable" };
  let audit;
  try {
    const connection = options.connection || await require("./review-jev").connection(vscode);
    if (!connection) return { matched: false, status: "unavailable" };
    const currentRequest = require("./context-protection").protect(question);
    // Permission/feasibility questions must never start a build, even if Jev
    // overweights the active review topic or prior approval.
    const directExecution = /(?:^|[.!?]\s*)(?:please\s+)?(?:собери|пересобери|запусти\s+сборку|build|rebuild|package)\b/i.test(currentRequest);
    const permissionQuestion = !directExecution
      && /\b(?:можно(?:\s+ли)?|разрешено\s+ли|можем\s+ли|can\s+(?:we|i)|is\s+it\s+(?:okay|ok|allowed))\b/i.test(currentRequest)
      && /\b(?:собрать|собирать|пересобрать|пересобирать|сборк\w*|build|rebuild|package|packaging|vsix)\b/i.test(currentRequest);
    if (permissionQuestion) return { matched: false, status: "not_matched", candidate: null, versionChoice: null };
    const input = decision(currentRequest, skills, options.topic);
    audit = (options.begin || require("./ai-accounting").begin)(vscode, connection.provider || "typesafe-api", connection.model, "Skill match with Jev",
      { ...require("./session-log").independentScope(), relatedTurnId: options.turnId });
    audit.decision({ provider: connection.provider || "typesafe-api", model: connection.model, ...input });
    const evaluate = options.evaluate || require("./jev").evaluate;
    const result = await evaluate(connection.provider || "typesafe-api", connection.key, connection.model,
      input.state, input.questions, { ...audit.callbacks, signal: options.signal });
    if (options.signal?.aborted) { audit.finish(result); return { matched: false, status: "aborted" }; }
    const ranked = skills.map((skill, index) => ({ skill, probability: result.answers?.["match_" + index]?.noul || 0 }))
      .sort((a, b) => b.probability - a.probability);
    const winner = ranked[0], matched = winner.probability >= 0.8 && (!ranked[1] || winner.probability - ranked[1].probability >= 0.1);
    if (!matched) {
      audit.finish(result);
      return { matched: false, status: "not_matched", probability: winner.probability, candidate: winner.skill.name,
        versionChoice: null, skill: null, usage: result.usage };
    }
    let versionChoice = null, usage = result.usage;
    if (winner.skill.name === "build-vertex-vsix") {
      const versionInput = versionDecision(currentRequest, winner.skill, options.topic);
      audit.decision({ provider: connection.provider || "typesafe-api", model: connection.model, ...versionInput });
      const versionResult = await evaluate(connection.provider || "typesafe-api", connection.key, connection.model,
        versionInput.state, versionInput.questions, { ...audit.callbacks, signal: options.signal });
      if (options.signal?.aborted) { audit.finish(versionResult); return { matched: false, status: "aborted" }; }
      versionChoice = versionResult.answers?.vsix_version?.choice || "current";
      usage = { ...(result.usage || {}), ...(versionResult.usage || {}) };
      for (const key of new Set([...Object.keys(result.usage || {}), ...Object.keys(versionResult.usage || {})])) {
        const before = result.usage?.[key], after = versionResult.usage?.[key];
        if (typeof before === "number" && typeof after === "number") usage[key] = before + after;
      }
      audit.finish({ ...versionResult, usage });
    } else audit.finish(result);
    return { matched: true, status: "matched", probability: winner.probability, candidate: winner.skill.name,
      versionChoice, skill: load(winner.skill, root), usage };
  } catch (error) {
    audit?.fail(error);
    return { matched: false, status: "fallback", reason: error.message };
  }
}

module.exports = { discover, load, decision, match, isVertexRepository };
