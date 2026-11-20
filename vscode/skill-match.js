"use strict";

// Only skill metadata is sent to Jev. The body and linked references load after a match.
const fs = require("fs");
const path = require("path");

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
      policy: "Match the current user request to a project skill only if the user asks to execute its workflow now. Discussion, inspection, quoted requests, explicit do-not-execute instructions, and different artifacts do not match. A standalone 'пересобери' or 'vsix' in the VERTEX repository refers to its VSIX build skill. A short repeat request such as 'еще раз' may refer to the active topic's workflow; use the routed topic to resolve what to repeat, but do not execute a skill merely because the topic matches. No earlier chat is available.",
      currentRequest: String(question || "").slice(0, 4000),
      ...(topic?.label ? { activeTopic: String(topic.label).slice(0, 200) } : {}),
      skills: skills.map(({ name, description }) => ({ name, description }))
    },
    questions: {
      ...Object.fromEntries(skills.map((skill, index) => ["match_" + index, { type: "noul",
        instructions: "Does the current user request ask to execute skill '" + skill.name + "' now? Say No for discussion, inspection, explicit do-not-execute, or a different artifact." }])),
      ...(skills.some(skill => skill.name === "build-vertex-vsix") ? { vsix_version: { type: "choice",
        instructions: "If this is a VSIX build request, should VERTEX increment the current patch version before building? Choose increment only when the request calls for a new release/version, +1, or raising the version. An explicit version number is parsed by code separately. For a plain build/rebuild choose current.",
        criteria: { current: "Build the current version", increment: "Increment the patch version then build" } } } : {})
    }
  };
}

async function match(vscode, question, root, options = {}) {
  const skills = discover(root);
  if (!skills.length) return { matched: false, status: "unavailable" };
  let audit;
  try {
    const connection = options.connection || await require("./review-jev").connection(vscode);
    if (!connection) return { matched: false, status: "unavailable" };
    const input = decision(require("./context-protection").protect(question), skills, options.topic);
    audit = (options.begin || require("./ai-accounting").begin)(vscode, connection.provider || "typesafe-api", connection.model, "Skill match with Jev",
      { ...require("./session-log").independentScope(), relatedTurnId: options.turnId });
    audit.decision({ provider: connection.provider || "typesafe-api", model: connection.model, ...input });
    const result = await (options.evaluate || require("./jev").evaluate)(connection.provider || "typesafe-api", connection.key, connection.model,
      input.state, input.questions, { ...audit.callbacks, signal: options.signal });
    audit.finish(result);
    if (options.signal?.aborted) return { matched: false, status: "aborted" };
    const ranked = skills.map((skill, index) => ({ skill, probability: result.answers?.["match_" + index]?.noul || 0 }))
      .sort((a, b) => b.probability - a.probability);
    const winner = ranked[0], matched = winner.probability >= 0.8 && (!ranked[1] || winner.probability - ranked[1].probability >= 0.1);
    return { matched, status: matched ? "matched" : "not_matched", probability: winner.probability,candidate:winner.skill.name,
      versionChoice: winner.skill.name === "build-vertex-vsix" ? result.answers?.vsix_version?.choice || "current" : null,
      skill: matched ? load(winner.skill, root) : null, usage: result.usage };
  } catch (error) {
    audit?.fail(error);
    return { matched: false, status: "fallback", reason: error.message };
  }
}

module.exports = { discover, load, decision, match };
