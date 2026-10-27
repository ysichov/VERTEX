"use strict";
// Keep a source binding, never a live debugger, execution trace or document instance.
function capture(source) {
  if (!source?.object_name || source.storedRun || source.storedDebugRecord) return undefined;
  return {
    object_name: source.object_name, object_type: source.object_type,
    system_name: source.system_name, local: source.local === true,
    uri: source.document?.uri.toString(), entryLine: source.entryLine,
    cursorLine: source.cursorLine, sapCopies: source.sapCopies, program: source.program
  };
}
async function restore(saved, workspace, Uri) {
  if (!saved?.object_name) return null;
  const source = { ...saved, autoRun: false, runOnly: false };
  if (source.local) {
    if (!saved.uri) return null;
    source.document = await workspace.openTextDocument(Uri.parse(saved.uri));
  }
  return source;
}
module.exports = { capture, restore };
