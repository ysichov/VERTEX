"use strict";

const own = (object, name) => Object.keys(object || {}).find(key => key.toUpperCase() === name);
const component = (value, names) => names.reduce((current, name) => {
  if (!current || typeof current !== "object") return undefined;
  const key = own(current, name);
  return key === undefined ? undefined : current[key];
}, value);

function conditionOf(name, condition) {
  if (!condition) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp("^\\s*" + escaped + "\\s*(>=|<=|<>|=|>|<)\\s*(-?\\d+(?:\\.\\d+)?|'(?:[^']|'')*')\\s*$", "i").exec(condition);
  if (!match) throw new Error("Local watch condition must compare " + name + " with a number or quoted text, for example " + name + " >= 10.");
  return { operator: match[1], target: match[2].startsWith("'") ? match[2].slice(1, -1).replaceAll("''", "'") : Number(match[2]) };
}

function reaches(value, condition) {
  if (!condition) return true;
  const left = typeof condition.target === "number" ? Number(value) : String(value ?? "");
  const right = condition.target;
  if (typeof condition.target === "number" && !Number.isFinite(left)) return false;
  switch (condition.operator) {
    case "=": return left === right;
    case "<>": return left !== right;
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
  }
  return false;
}

function hits(record, earlier, watchpoints) {
  return (watchpoints || []).filter(point => {
    const direct = own(record?.changed, point.name.toUpperCase());
    const condition = conditionOf(point.name, point.condition);
    if (direct !== undefined) return reaches(record.changed[direct], condition);
    const [root, ...parts] = point.name.toUpperCase().split("-");
    const key = own(record?.changed, root);
    if (key === undefined) return false;
    if (!parts.length) return reaches(record.changed[key], condition);
    const previous = [...(earlier || [])].reverse().find(item => own(item.changed, root) !== undefined);
    const before = previous ? component(previous.changed[own(previous.changed, root)], parts) : undefined;
    const after = component(record.changed[key], parts);
    return JSON.stringify(before) !== JSON.stringify(after) && reaches(after, condition);
  });
}

module.exports = { hits, conditionOf };
