"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("each provider gets back the model last picked for it", async () => {
  const modelConfig = require("../model-config");
  const isOn = modelConfig.isOn;
  modelConfig.isOn = () => true;
  try {
    const [first, second] = modelConfig.PROVIDERS.map(p => p.setting).filter(p => /subscription/.test(p));
    const settings = { "vertex.ai.provider": first, "vertex.ai.model": "model-1" };
    const vscode = { ConfigurationTarget: { Global: 1 }, window: { showInputBox: async () => "" },
      workspace: { workspaceFolders: [], onDidChangeConfiguration: () => ({ dispose() {} }),
        getConfiguration: section => ({ get: (key, fallback) => settings[section + "." + key] ?? fallback,
          update: async (key, value) => { settings[section + "." + key] = value; }, inspect: () => ({}) }) } };
    const memory = { values: {}, get(key) { return this.values[key]; }, async update(key, value) { this.values[key] = value; } };
    const ask = require("../chat").create(vscode, { schemas: [], execute: async () => "" }, null, {}, null, null, memory);
    const now = () => [settings["vertex.ai.provider"], settings["vertex.ai.model"]];

    await ask.setProvider(second);
    assert.deepEqual(now(), [second, ""], "a provider never picked starts on its default");
    await ask.setModel("model-2");
    await ask.setProvider(first);
    assert.deepEqual(now(), [first, "model-1"]);
    await ask.setProvider(second);
    assert.deepEqual(now(), [second, "model-2"]);
  } finally { modelConfig.isOn = isOn; }
});
