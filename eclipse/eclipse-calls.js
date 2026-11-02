// One request to Eclipse at a time: it answers through sdeReady, and sdeTake hands over the one answer it holds.
// call(name, ...args) asks window[name] and resolves with the answer, or rejects with an "ERROR:" one or none at all.
// Shared by the Eclipse pages that ask their view (reach-path, session-logs, value-origin.html): eclipse/pages.js puts
// it where a page marks it, when eclipse/prepare.js writes the page into the plugin.
var waiting = [], active = null;
function call(name) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function (resolve, reject) {
    waiting.push({ name: name, args: args, resolve: resolve, reject: reject });
    pump();
  });
}
function pump() {
  if (active || !waiting.length) { return; }
  active = waiting.shift();
  window[active.name].apply(window, active.args);
}
window.sdeReady = function () {
  var raw = sdeTake(), item = active;
  active = null;
  if (item) {
    var text = raw === null || raw === undefined ? null : String(raw);
    if (text === null) { item.reject(new Error("Eclipse gave no answer to " + item.name + ".")); }
    else if (text.indexOf("ERROR:") === 0) { item.reject(new Error(text.slice(6))); }
    else { item.resolve(text); }
  }
  pump();
};
