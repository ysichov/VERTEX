"use strict";

// Deterministic executor for the repository's VSIX skill. Jev chooses only the branch;
// version arithmetic and file edits are performed here, in the review copy.
const fs = require("node:fs");
const path = require("node:path");

const files = ["vscode/package.json", "vscode/package-lock.json", "org.vertex.abap.feature/feature.xml",
  "org.vertex.abap.ui/META-INF/MANIFEST.MF"];
const buildCommand = process.platform === "win32" ? ".\\vscode\\package.ps1" : "./vscode/package.sh";
const exactVersion = request => {
  const matches = [...String(request).matchAll(/(?<![\d.])(?:\d+\.){2}\d+(?![\d.])/g)].map(match => match[0]);
  if (new Set(matches).size > 1) throw new Error("More than one VSIX version was specified.");
  return matches[0] || null;
};
function decide(request, jevChoice = "current") {
  const exact = exactVersion(request);
  if (exact) return { action: "version", version: exact };
  if (/\+\s*1\b/.test(request) || jevChoice === "increment") return { action: "increment" };
  return { action: "current" };
}
function prepare(root, request, jevChoice) {
  const choice = decide(request, jevChoice);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, files[0]), "utf8"));
  if (manifest.name !== "vertex-abap" || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error("This folder is not a valid VERTEX VSIX project.");
  const current = manifest.version;
  const version = choice.action === "increment"
    ? current.replace(/\d+$/, patch => String(Number(patch) + 1))
    : choice.version || current;
  if (version === current) return { action: "current", current, version, edits: [], command: buildCommand };
  const lockFile = path.join(root, files[1]), lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  if (lock.version !== current || lock.packages?.[""]?.version !== current)
    throw new Error("The VSIX lockfile version disagrees with package.json.");
  const featureFile = path.join(root, files[2]), feature = fs.readFileSync(featureFile, "utf8");
  const bundleFile = path.join(root, files[3]), bundle = fs.readFileSync(bundleFile, "utf8");
  if (!feature.includes(`version="${current}.qualifier"`) || !bundle.includes(`Bundle-Version: ${current}.qualifier`))
    throw new Error("The Eclipse feature or bundle version disagrees with package.json.");
  manifest.version = version; lock.version = version; lock.packages[""].version = version;
  const edits = [
    { file: files[0], content: JSON.stringify(manifest, null, 2) + "\n" },
    { file: files[1], content: JSON.stringify(lock, null, 2) + "\n" },
    { file: files[2], content: feature.replace(`version="${current}.qualifier"`, `version="${version}.qualifier"`) },
    { file: files[3], content: bundle.replace(`Bundle-Version: ${current}.qualifier`, `Bundle-Version: ${version}.qualifier`) }
  ];
  const readmeFile = path.join(root, "README.md");
  if (fs.existsSync(readmeFile)) {
    const readme = fs.readFileSync(readmeFile, "utf8");
    const before = `Current VS Code extension: **${current}**.`;
    if (readme.includes(before)) edits.push({ file: "README.md", content: readme.replace(before, `Current VS Code extension: **${version}**.`) });
  }
  const guideFile = path.join(root, "vscode/README.md");
  if (fs.existsSync(guideFile)) {
    const guide = fs.readFileSync(guideFile, "utf8");
    const updated = guide.replace(/^\*\*Version: \d+\.\d+\.\d+\*\*/m, `**Version: ${version}**`);
    if (updated !== guide) edits.push({ file: "vscode/README.md", content: updated });
  }
  for (const [file, title, sentence] of [
    ["history.md", `VSIX ${version}`, `The VS Code extension version is ${version}. The VSIX is built after the version changes are approved.`],
    ["dev_history.md", `Prepare VSIX ${version}`, `The deterministic VSIX workflow updated both host version manifests, the lockfile and current version references in a review copy. Packaging runs after all files are applied; a verified build is reported separately.`]
  ]) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) continue;
    const old = fs.readFileSync(target, "utf8");
    if (!old.includes(`## ${title}\n`)) edits.push({ file, content: `## ${title}\n\n${sentence}\n\n` + old });
  }
  return { action: "version", current, version, edits, command: buildCommand };
}
function stage(copyRoot, plan) {
  if (plan.action !== "version") return;
  for (const edit of plan.edits)
    if (!fs.existsSync(path.join(copyRoot, edit.file))) throw new Error("Missing VSIX version file in review copy: " + edit.file);
  for (const edit of plan.edits) {
    const target = path.join(copyRoot, edit.file);
    fs.writeFileSync(target, edit.content);
  }
}
module.exports = { files, buildCommand, exactVersion, decide, prepare, stage };
