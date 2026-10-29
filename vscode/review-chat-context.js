"use strict";

// A saved request's evidence for chat, read once with the payload, never by rebuilding the review.
function format(payload, summary, limit = 180000) {
  const objects = summary.objects || [];
  const perObject = Math.max(200, Math.floor((limit - 1000) / Math.max(1, objects.length)));
  const sections = objects.map(object => {
    const name = object.class_name ? object.class_name + " / " + (object.display_name || object.obj_name).trim()
      : (object.display_name || object.obj_name).trim();
    const header = object.objtype + " " + name + ": +" + object.inserted + " / ~" + object.modified + " / -" + object.deleted
      + "; " + object.hunks + " blocks; " + (object.is_created ? "new object; " : "") + (object.author_name || object.author || "");
    const diffs = (payload.DIFF_DATA || []).filter(d => d.KEY && d.KEY.OBJTYPE === object.objtype && d.KEY.OBJNAME === object.obj_name
      && d.RETROFIT !== true && d.RETROFIT !== "X");
    const diff = diffs.find(d => (payload.HUNKS || []).some(h => h.OBJTYPE === object.objtype && h.OBJ_NAME === object.obj_name
      && h.VERSNO_OLD === d.KEY.VERSNO_O && h.VERSNO_NEW === d.KEY.VERSNO_N)) || diffs[0];
    if (!diff || !Array.isArray(diff.DIFF)) return header + "\nNo stored line diff is available for this object.";
    const ops = diff.DIFF, keep = new Set();
    ops.forEach((op, i) => { if (op.OP !== "=") for (let k = Math.max(0, i - 3); k <= Math.min(ops.length - 1, i + 3); k++) keep.add(k); });
    const lines = []; let gap = false;
    ops.forEach((op, i) => {
      if (keep.has(i)) { lines.push((op.OP === "=" ? " " : op.OP) + " " + op.TEXT); gap = false; }
      else if (!gap) { lines.push("..."); gap = true; }
    });
    const text = header + "\nVersions " + (diff.KEY.VERSNO_O || "none") + " → " + diff.KEY.VERSNO_N + "\n" + lines.join("\n");
    return text.length > perObject ? text.slice(0, Math.max(0, perObject - 40)) + "\n[Object diff truncated]" : text;
  });
  let text = "Saved review of " + payload.TRKORR + ": " + objects.length + " objects.\n'-' removed, '+' added, other lines unchanged.\n\n" + sections.join("\n\n");
  const truncated = text.length > limit || sections.some(s => s.includes("[Object diff truncated]"));
  if (text.length > limit) text = text.slice(0, limit - 40) + "\n[Review context truncated]";
  return { object: payload.TRKORR, shown: "summary", text, truncated, object_count: objects.length };
}
module.exports = { format };
