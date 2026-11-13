// The waiting scenes, once for both hosts: VS Code requires this file (task-visual.js), and a page that shows one
// inlines it where it marks /*VERTEX_TASK_VISUAL*/ (Versions, for the review build). Wrapped so that, inlined as a
// classic script, it leaves only window.vertexTaskVisual.
(function () {
"use strict";

// Small vector scenes: no filters or remote assets, and CSS animation alone except for the edit scene, whose random
// cuts and insertions are driven by drive() - see the comment there for why a CSS loop will not do.
const review = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g class="task-paper" fill="var(--task-paper)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M13 9h24l9 9v32H13z"/><path d="M20 14h23l8 8v34H20z"/><path opacity=".55" d="M25 24h17M25 30h17M25 36h11M25 43h15"/></g><g class="review-lens" fill="var(--task-paper)" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="35" cy="32" r="11" fill-opacity=".88"/><path d="m43 40 10 10"/><path class="review-scan" opacity=".55" stroke-width="1.5" d="M29 30h12M29 34h8"/></g></svg>`;
const commit = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g fill="var(--task-paper)" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M12 10v45"/><circle opacity=".65" cx="12" cy="13" r="3"/><circle opacity=".65" cx="12" cy="54" r="3"/><g class="commit-stack"><path class="commit-sheet-back" opacity=".35" d="M19 15h26v35H19z"/><path class="commit-sheet-middle" opacity=".6" d="M23 11h26v35H23z"/><path d="M27 7h23l7 7v29H27z"/><path opacity=".5" d="M33 17h16M33 23h16M33 29h8"/></g><path class="commit-link" d="M12 39h15"/><circle class="commit-node" cx="12" cy="39" r="4.7"/><path class="commit-check" fill="none" stroke-width="2.5" d="m39 36 4 4 9-10"/></g></svg>`;

const commitWide = `<svg class="commit-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path opacity=".22" d="M20 30H980"/><path opacity=".18" d="M220 30C280 30 280 9 340 9H600C660 9 660 30 720 30"/><path class="cw-branch" pathLength="100" stroke-dasharray="100" d="M220 30C280 30 280 9 340 9H600C660 9 660 30 720 30H786"/><circle class="cw-hist cw-hist-0" cx="60" cy="30" r="3.2" fill="var(--task-paper)"/><circle class="cw-hist cw-hist-1" cx="180" cy="30" r="3.2" fill="var(--task-paper)"/><circle class="cw-hist cw-hist-2" cx="640" cy="30" r="3.2" fill="var(--task-paper)"/><circle class="cw-hist cw-hist-3" cx="920" cy="30" r="3.2" fill="var(--task-paper)"/><circle cx="220" cy="30" r="3.6" fill="var(--task-paper)"/><g class="cw-docs" fill="var(--task-paper)"><path class="cw-sheet-back" opacity=".4" d="M86 13h20v22H86z"/><path class="cw-sheet-mid" opacity=".7" d="M91 9h20v22H91z"/><path d="M96 5h16l5 5v18H96z"/><path class="cw-doc-add" stroke="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" d="M100 13h10"/><path class="cw-doc-del" stroke="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" d="M100 18h10"/><path opacity=".6" d="M100 23h6"/></g><g class="cw-packet"><path d="M128 4h12v9h-12z" fill="var(--task-paper)"/><path opacity=".6" stroke-width="1.2" d="M131 7.5h6M131 10h4"/></g><g class="cw-packet cw-packet-2"><path d="M128 4h12v9h-12z" fill="var(--task-paper)"/><path opacity=".6" stroke-width="1.2" d="M131 7.5h6M131 10h4"/></g><path class="cw-chevrons" d="m740 25 5 5-5 5m-8-10 5 5-5 5"/><circle class="cw-ring" cx="800" cy="30" r="9"/><circle class="cw-ring cw-ring-2" cx="800" cy="30" r="9"/><circle class="cw-spark cw-spark-0" cx="800" cy="30" r="1.8" fill="currentColor" stroke="none"/><circle class="cw-spark cw-spark-1" cx="800" cy="30" r="1.8" fill="var(--vscode-testing-iconPassed,currentColor)" stroke="none"/><circle class="cw-spark cw-spark-2" cx="800" cy="30" r="1.8" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" stroke="none"/><circle class="cw-spark cw-spark-3" cx="800" cy="30" r="1.8" fill="currentColor" stroke="none"/><circle class="cw-spark cw-spark-4" cx="800" cy="30" r="1.8" fill="var(--vscode-testing-iconPassed,currentColor)" stroke="none"/><circle class="cw-spark cw-spark-5" cx="800" cy="30" r="1.8" fill="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" stroke="none"/><circle class="cw-node" cx="800" cy="30" r="7.5" fill="var(--task-paper)" stroke-width="2.2"/><path class="cw-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="2.4" pathLength="10" stroke-dasharray="10" d="m796 30 3 3 5-6"/><g class="cw-hash" stroke="none" fill="currentColor"><rect x="818" y="5" width="9" height="5" rx="1"/><rect x="829" y="5" width="7" height="5" rx="1" opacity=".7"/><rect x="838" y="5" width="11" height="5" rx="1"/><rect x="851" y="5" width="6" height="5" rx="1" opacity=".7"/></g><path class="cw-head" stroke-width="1.4" d="M818 16h30"/><path class="cw-head-tip" stroke-width="1.4" d="m845 13 3 3-3 3"/></g></svg>`;

// The diff being reviewed for a commit message: a beam scans the changed rows, their fragments stream into a merge node, and the draft is typed out.
const reviewWide = `<svg class="generate-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><defs><clipPath id="rw-card-clip"><rect x="592" y="3" width="396" height="34" rx="5"/></clipPath></defs><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g class="rw-row rw-row-0"><rect x="12" y="4" width="216" height="8" rx="2" fill="var(--task-paper)" stroke="currentColor" stroke-opacity=".45"/><path stroke="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" class="rw-add" stroke-width="2.2" d="M17 8h5m-2.5-2.5v5M27 8h170"/></g><g class="rw-row rw-row-1"><rect x="12" y="16" width="216" height="8" rx="2" fill="var(--task-paper)" stroke="currentColor" stroke-opacity=".45"/><path stroke="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" class="rw-del" stroke-width="2.2" d="M17 20h5M27 20h130"/><path class="rw-strike" stroke="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" stroke-width="1.6" d="M25 20h136"/></g><g class="rw-row rw-row-2"><rect x="12" y="28" width="216" height="8" rx="2" fill="var(--task-paper)" stroke="currentColor" stroke-opacity=".45"/><path stroke="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" class="rw-add rw-add-2" stroke-width="2.2" d="M17 32h5m-2.5-2.5v5M27 32h150"/></g><g class="rw-beam"><rect x="10" y="1" width="16" height="38" rx="3" fill="currentColor" stroke="none" opacity=".08"/><rect x="16" y="1" width="4" height="38" rx="2" fill="currentColor" stroke="none" opacity=".45"/></g><path class="rw-trail" opacity=".35" stroke-dasharray="3 7" d="M236 8C330 8 360 20 452 20M236 20H452M236 32C330 32 360 20 452 20M490 20H570"/><circle class="rw-dot rw-dot-0" cx="236" cy="8" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-1" cx="236" cy="20" r="2.4" fill="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-2" cx="236" cy="32" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-3" cx="236" cy="8" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-4" cx="236" cy="20" r="2.4" fill="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-5" cx="236" cy="32" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-pulse" cx="470" cy="20" r="11"/><circle class="rw-orbit" cx="470" cy="20" r="15" stroke-dasharray="4 5" opacity=".6"/><circle class="rw-core" cx="470" cy="20" r="8" fill="var(--task-paper)"/><path class="rw-core-mark" stroke-width="1.4" d="M466 17h8M466 20h8M466 23h5"/><path class="rw-chevrons" d="m538 15 5 5-5 5m-8-10 5 5-5 5"/><rect x="592" y="3" width="396" height="34" rx="5" fill="var(--task-paper)"/><g clip-path="url(#rw-card-clip)"><path class="rw-title" stroke-width="3.2" d="M606 13H790"/><path class="rw-line rw-line-1" opacity=".7" d="M606 22H940"/><path class="rw-line rw-line-2" opacity=".7" d="M606 30H880"/><rect class="rw-cursor" x="794" y="8" width="2" height="10" fill="currentColor" stroke="none"/><path class="rw-shimmer" stroke="none" fill="currentColor" opacity=".1" d="M560 0h26l-14 40h-26z"/></g><path class="rw-star rw-star-0" fill="currentColor" d="M588 1l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/><path class="rw-star rw-star-1" fill="currentColor" d="M992 3l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/><path class="rw-star rw-star-2" fill="currentColor" d="M986 29l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/><path class="rw-star rw-star-3" fill="currentColor" d="M600 30l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/></g></svg>`;

// A pull request being described: the branch's commits light up in turn and fly into one description card, which points at the base branch.
const prWide = `<svg class="pr-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path opacity=".22" d="M20 34H980"/><path opacity=".5" d="M24 34C34 34 34 12 48 12H260"/><circle cx="24" cy="34" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-0" cx="60" cy="12" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-1" cx="120" cy="12" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-2" cx="180" cy="12" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-3" cx="240" cy="12" r="3.6" fill="var(--task-paper)"/><g class="pw-card pw-card-0"><rect x="54" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M57 8.5h6M57 11h4"/></g><g class="pw-card pw-card-1"><rect x="114" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M117 8.5h6M117 11h4"/></g><g class="pw-card pw-card-2"><rect x="174" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M177 8.5h6M177 11h4"/></g><g class="pw-card pw-card-3"><rect x="234" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M237 8.5h6M237 11h4"/></g><path class="pw-trail" opacity=".3" stroke-dasharray="3 7" d="M262 12C320 12 330 20 380 20"/><rect class="pw-box" x="390" y="3" width="330" height="34" rx="5" fill="var(--task-paper)"/><g class="pw-icon" stroke-width="1.5"><circle cx="406" cy="12" r="3"/><circle cx="406" cy="28" r="3"/><path d="M406 15v10"/><circle cx="422" cy="28" r="3"/><path d="M422 25v-7a5 5 0 0 0-5-5h-4"/><path d="m415 10-3 3 3 3"/></g><path class="pw-title" stroke-width="3" d="M436 13H600"/><path class="pw-line pw-line-1" opacity=".7" d="M436 22H690"/><path class="pw-line pw-line-2" opacity=".7" d="M436 30H640"/><path class="pw-arrow" stroke-dasharray="4 6" d="M724 20C800 20 820 34 880 34"/><path class="pw-arrow-tip" d="m872 29 8 5-8 5"/><circle class="pw-ring" cx="910" cy="34" r="6"/><circle class="pw-base" cx="910" cy="34" r="4.6" fill="var(--task-paper)" stroke-width="2"/></g></svg>`;

// A push: commits on the local branch rise as packets along an arc into the remote cloud, whose branch grows and checks.
const pushWide = `<svg class="push-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path opacity=".5" d="M20 32H330"/><circle class="ph-c ph-c-0" cx="60" cy="32" r="3.6" fill="var(--task-paper)"/><circle class="ph-c ph-c-1" cx="140" cy="32" r="3.6" fill="var(--task-paper)"/><circle class="ph-c ph-c-2" cx="220" cy="32" r="3.6" fill="var(--task-paper)"/><circle class="ph-c ph-c-3" cx="300" cy="32" r="3.6" fill="var(--task-paper)"/><path opacity=".22" stroke-dasharray="3 7" d="M300 32C420 32 470 8 600 8H760"/><path class="ph-arc" pathLength="100" stroke-dasharray="100" d="M300 32C420 32 470 8 600 8H760"/><g class="ph-pk ph-pk-0"><rect x="294" y="27" width="12" height="10" rx="2" fill="var(--task-paper)"/><path stroke-width="1.2" d="m297 33 3-3 3 3"/></g><g class="ph-pk ph-pk-1"><rect x="294" y="27" width="12" height="10" rx="2" fill="var(--task-paper)"/><path stroke-width="1.2" d="m297 33 3-3 3 3"/></g><g class="ph-pk ph-pk-2"><rect x="294" y="27" width="12" height="10" rx="2" fill="var(--task-paper)"/><path stroke-width="1.2" d="m297 33 3-3 3 3"/></g><path class="ph-chevrons" d="m700 3 5 5-5 5m-8-10 5 5-5 5"/><g class="ph-cloud"><path fill="var(--task-paper)" d="M790 30a10 10 0 0 1 3-19 15 15 0 0 1 28 2 9 9 0 0 1 3 17z"/></g><circle class="ph-ring" cx="808" cy="20" r="14"/><path opacity=".22" d="M840 32H980"/><path class="ph-remote" pathLength="100" stroke-dasharray="100" d="M840 32H950"/><circle class="ph-tip" cx="950" cy="32" r="3.6" fill="var(--task-paper)"/><path class="ph-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="2.4" pathLength="10" stroke-dasharray="10" d="m802 20 4 4 7-8"/></g></svg>`;

// An MCP server package being installed through npx: gears fly from the registry along an arc, turning, and drop
// into an open container, whose lid closes. Its end frame (.scene-done) shows the closed container and the check.
const installGears = `<svg class="install-gears" viewBox="0 0 1000 100" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path opacity=".22" d="M100 72H965"/><g fill="var(--task-paper)"><path d="M40 52a18 18 0 0 1 8-33 24 24 0 0 1 44 6 15 15 0 0 1 3 29z"/><path opacity=".6" d="M55 40h28M55 47h18"/></g><path opacity=".14" stroke-dasharray="2 8" d="M95 40C300 -10 600 -10 835 52"/><g class="ig-fly ig-1"><g class="ig-turn"><path fill="var(--task-paper)" fill-rule="evenodd" d="M9.2 -2.2L12.9 -1.6L12.9 1.6L9.2 2.2L8.1 5.0L10.3 8.0L8.0 10.3L5.0 8.1L2.2 9.2L1.6 12.9L-1.6 12.9L-2.2 9.2L-5.0 8.1L-8.0 10.3L-10.3 8.0L-8.1 5.0L-9.2 2.2L-12.9 1.6L-12.9 -1.6L-9.2 -2.2L-8.1 -5.0L-10.3 -8.0L-8.0 -10.3L-5.0 -8.1L-2.2 -9.2L-1.6 -12.9L1.6 -12.9L2.2 -9.2L5.0 -8.1L8.0 -10.3L10.3 -8.0L8.1 -5.0ZM4.0 0a4 4 0 1 0 -8 0a4 4 0 1 0 8 0Z"/></g></g><g class="ig-fly ig-2"><g class="ig-turn"><path fill="var(--task-paper)" fill-rule="evenodd" d="M6.7 -2.2L9.4 -1.6L9.4 1.6L6.7 2.2L5.2 4.7L6.1 7.3L3.3 8.9L1.5 6.8L-1.5 6.8L-3.3 8.9L-6.1 7.3L-5.2 4.7L-6.7 2.2L-9.4 1.6L-9.4 -1.6L-6.7 -2.2L-5.2 -4.7L-6.1 -7.3L-3.3 -8.9L-1.5 -6.8L1.5 -6.8L3.3 -8.9L6.1 -7.3L5.2 -4.7ZM3.0 0a3 3 0 1 0 -6 0a3 3 0 1 0 6 0Z"/></g></g><g class="ig-fly ig-3"><g class="ig-turn"><path fill="var(--task-paper)" fill-rule="evenodd" d="M11.8 -2.2L15.9 -1.6L15.9 1.6L11.8 2.2L10.9 5.1L13.8 8.1L11.9 10.7L8.2 8.7L5.8 10.5L6.4 14.6L3.4 15.6L1.5 11.9L-1.5 11.9L-3.4 15.6L-6.4 14.6L-5.8 10.5L-8.2 8.7L-11.9 10.7L-13.8 8.1L-10.9 5.1L-11.8 2.2L-15.9 1.6L-15.9 -1.6L-11.8 -2.2L-10.9 -5.1L-13.8 -8.1L-11.9 -10.7L-8.2 -8.7L-5.8 -10.5L-6.4 -14.6L-3.4 -15.6L-1.5 -11.9L1.5 -11.9L3.4 -15.6L6.4 -14.6L5.8 -10.5L8.2 -8.7L11.9 -10.7L13.8 -8.1L10.9 -5.1ZM5.0 0a5 5 0 1 0 -10 0a5 5 0 1 0 10 0Z"/></g></g><g fill="var(--task-paper)"><path opacity=".55" d="M800 52l35-14 35 14"/></g><g fill="var(--task-paper)"><path d="M800 52v30l35 14 35-14V52l-35 14z"/><path opacity=".6" d="M835 66v30"/></g><g class="ig-lid" fill="var(--task-paper)"><path d="M800 52l35-14 35 14-35 14z"/></g><circle class="ig-ring" cx="835" cy="66" r="30"/><path class="ig-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="3" d="m890 40 7 7 13-15"/></g></svg>`;

// An MCP server starting: an orbiter on the runway with the server's name on its hull revs its engines now and then.
// Once the server has started (.scene-done) the orbiter stays put while the runway, its lights and the trees run back
// faster and faster and the clouds slower; it lifts off at speed and flies out to the right.
const escapeXml = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function startScene(name) {
  const tree = x => `<path d="M${x} 112v-8"/><path fill="var(--task-paper)" d="M${x - 7} 105q7-22 14 0z"/>`;
  const cloud = (x, y, k) => `<path fill="var(--task-paper)" opacity=".8" d="M${x} ${y}a${8 * k} ${8 * k} 0 0 1 ${10 * k}-${8 * k}a${11 * k} ${11 * k} 0 0 1 ${20 * k} ${2 * k}a${7 * k} ${7 * k} 0 0 1 ${4 * k} ${12 * k}H${x}z"/>`;
  const trees = [], lights = [], clouds = [];
  for (let x = 40; x < 3200; x += 90 + (x * 7) % 50) trees.push(tree(x));
  for (let x = 20; x < 3200; x += 60) lights.push(`<circle cx="${x}" cy="116" r="2.2"/>`);
  for (let x = 60; x < 2600; x += 230) clouds.push(cloud(x, 30 + (x % 3) * 9, 0.8 + (x % 5) * 0.12));
  const label = String(name || "");
  return `<svg class="start-cruise" viewBox="0 0 1000 140" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`
    + `<g class="sc-clouds">${clouds.join("")}</g><path opacity=".5" d="M0 120H1000"/>`
    + `<g class="sc-ground"><g opacity=".7">${trees.join("")}</g><g fill="currentColor" stroke="none" opacity=".6">${lights.join("")}</g><path opacity=".3" stroke-dasharray="18 14" d="M0 128H3200"/></g>`
    + `<g class="sc-craft"><g transform="translate(60 33)">`
    // the flame: a plume tapering away from the nozzles, with a bright core; it is scaled along its length from the nozzles
    + `<g class="sc-flame" stroke="none"><path class="sc-flame-outer" d="M105 54C88 55 58 59 26 64C58 69 88 73 105 74z"/><path class="sc-flame-mid" d="M105 57C90 58 70 61 46 64C70 67 90 70 105 71z"/><path class="sc-flame-core" d="M105 60C96 61 84 62 70 64C84 66 96 67 105 68z"/></g>`
    + `<path opacity=".6" d="M146 74v12M222 72v14"/><circle cx="146" cy="87" r="2"/><circle cx="222" cy="87" r="2"/>`
    + `<g fill="var(--task-paper)"><path d="M122 55L112 24h12l28 31z"/><path d="M114 56l-9-3v8l9-1zM114 62l-9-1v7l9-1zM114 68l-9 0v7l9-2z"/>`
    + `<path d="M114 57l6-3h96q26 0 36 10-8 8-26 8H120l-6-2z"/><path d="M152 68h36l20 2-56 12h-22z"/><path d="M120 54q14-5 30 0"/></g>`
    + `<path d="M222 58h9l5 4h-14z"/><path opacity=".45" d="M130 58h82"/><path stroke-width="3.5" opacity=".85" d="M152 72h74q14 0 22-6"/>`
    + `<text x="130" y="68.5" font-size="8.5" font-weight="700" letter-spacing=".4" fill="currentColor" stroke="none"`
    + (label.length > 11 ? ` textLength="80" lengthAdjust="spacingAndGlyphs"` : "") + `>${escapeXml(label)}</text>`
    + `</g></g>`
    + `<path class="sc-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="3.5" d="m900 50 8 8 15-17"/>`
    + `</g></svg>`;
}

// name is the MCP server's, written on the hull in the start scene.
/* A digital timer beside a wide scene: minutes and seconds since the scene was put on the page, counted by CSS alone
   (two integer custom properties stepped by animations and shown through counters), so the scenes stay timer-free. The
   end frame (.scene-done) stops it at the time the work took. */
const timed = scene => `<span class="task-timed">${scene}<span class="task-timer" aria-hidden="true"></span></span>`;

/* The chat's step stream has three scenes, all in the review strip's proportions. They speak one language - bits and
   bytes - so that a reader tells them apart by what moves, not by a legend.
   search: a lens runs along a chain of zeros and ones; what it finds stays lit.
   mcp:    the LLM cloud and the SAP system exchange packets both ways.
   edit:   a double helix built from the bits themselves; pairs are cut out and spliced in.
   The first two are CSS alone. The helix is not: its cuts and insertions must fall at random, and a fixed loop reads
   as a blink every few seconds when a request is long, so drive() below moves it from JS. */
const BITS = "1011010010110011010011011001";
const bitGlyph = (one, x) => one
  ? `<path d="M${x} 14v12M${x - 3} 16.5l3-2.5"/>`
  : `<ellipse cx="${x}" cy="20" rx="4" ry="6"/>`;
const searchWide = (() => {
  const step = 28, x0 = 26, count = 34, hits = [13, 26];
  let bits = "";
  for (let i = 0; i < count; i++) {
    bits += `<g class="sw-bit${hits.indexOf(i) < 0 ? "" : " sw-hit"}" style="animation-delay:${(i * 0.133).toFixed(2)}s">`
      + bitGlyph(BITS[i % BITS.length] === "1", x0 + i * step) + `</g>`;
  }
  return `<svg viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${bits}<g class="sw-lens"><circle cx="26" cy="20" r="14" fill="currentColor" fill-opacity=".06" stroke-width="2.2"/><path stroke-width="2.6" d="m36.5 29.5 7 7"/></g></g></svg>`;
})();
const mcpWide = `<svg viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g class="mw-stage" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path class="mw-cloud" fill="var(--task-paper)" d="M40 34C26 34 22 22 33 17 31 6 48 1 57 9 64-1 84 1 86 12 100 6 114 16 108 25 118 28 116 34 106 34Z"/><text class="mw-label" x="68" y="28" text-anchor="middle" stroke="none">LLM</text><path class="mw-lane" d="M132 12H828"/><path class="mw-lane" d="M828 28H132"/><path stroke-opacity=".5" d="m822 8 5 4-5 4"/><path stroke-opacity=".5" d="m138 24-5 4 5 4"/><path class="mw-ask" d="M132 12H828"/><path class="mw-answer" d="M828 28H132"/><g class="mw-packets"></g><rect x="846" y="3" width="134" height="34" rx="4" fill="var(--task-paper)" stroke-opacity=".55"/><rect class="mw-glow" x="846" y="3" width="134" height="34" rx="4" fill="var(--task-ok)" stroke="none"/><circle class="mw-led" cx="860" cy="11" r="2.2" fill="var(--task-ok)" stroke="none"/><circle class="mw-led" cx="860" cy="20" r="2.2" fill="var(--task-ok)" stroke="none"/><circle class="mw-led" cx="860" cy="29" r="2.2" fill="var(--task-ok)" stroke="none"/><path stroke-opacity=".3" d="M872 7v26"/><text class="mw-label" x="930" y="26" text-anchor="middle" stroke="none">SAP</text><path class="mw-arc" d="M886 9l7 7-5 2 6 9"/><path class="mw-arc mw-arc2" d="M968 10l-6 7 5 2-7 8"/></g></svg>`;
const HX_STEP = 70, HX_X0 = 40, HX_KEEP = 21;
const hxColumn = (one, ph, x) => `<g class="hx-col" style="transform:translateX(${x}px)"><path class="hx-r hx-p${ph}" d="M0 9V31"/><text class="hx-n hx-p${ph}" x="0" y="20">${one ? 1 : 0}</text><text class="hx-n hx-p${(ph + 4) % 8}" x="0" y="20">${one ? 0 : 1}</text></g>`;
const editWide = (() => {
  let row = "";
  for (let i = 0; i < HX_KEEP; i++) row += hxColumn(BITS[i % BITS.length] === "1", i % 8, HX_X0 + i * HX_STEP);
  return `<svg viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><defs><clipPath id="vx-hx-clip"><rect x="0" y="0" width="1000" height="40"/></clipPath></defs><g clip-path="url(#vx-hx-clip)"><g class="hx-row" text-anchor="middle" dominant-baseline="central">${row}</g></g></svg>`;
})();

/* Starts the edit scene's random cuts and insertions on a scene already on the page, and returns the function that
   stops it. Called again on the same row it does nothing. Without this call the helix still turns - it simply never
   changes - so a host that cannot run it loses the edits, not the scene. It also stops by itself once the scene is
   taken off the page, so a caller that forgets to stop it leaks no timer. */
function drive(root) {
  if (!root || !root.querySelector) return () => {};
  const stops = [driveHelix(root.querySelector(".hx-row")), driveExchange(root.querySelector(".mw-stage"))];
  return () => stops.forEach(stop => stop());
}

/* One round of the MCP exchange: the question goes out, the system thinks with its arcs, and what comes back is a
   packet of real bits - a different count of them each time, which is the point a CSS loop cannot make. */
function driveExchange(stage) {
  if (!stage || stage.getAttribute("data-driven")) return () => {};
  stage.setAttribute("data-driven", "1");
  stage.classList.add("mw-driven");
  const NS = "http://www.w3.org/2000/svg";
  const packets = stage.querySelector(".mw-packets");
  if (!packets) return () => {};
  const node = (name, attrs, text) => {
    const made = document.createElementNS(NS, name);
    for (const key in attrs) made.setAttribute(key, attrs[key]);
    if (text != null) made.textContent = text;
    return made;
  };
  let stopped = false;
  const timers = new Set();
  const wait = (run, ms) => { const id = setTimeout(() => { timers.delete(id); if (!stopped) run(); }, ms); timers.add(id); };
  const replay = (name, ms) => {
    stage.classList.remove(name);
    void stage.getBoundingClientRect();
    stage.classList.add(name);
    wait(() => stage.classList.remove(name), ms);
  };
  const answer = () => {
    const count = 4 + Math.floor(Math.random() * 15);
    const width = 16 + count * 12;
    const left = 828 - width;
    const carrier = node("g", { class: "mw-packet" });
    carrier.appendChild(node("rect", { x: left, y: 21, width, height: 14, rx: 3,
      fill: "var(--task-paper)", stroke: "var(--task-ok)", "stroke-width": 1.4 }));
    for (let i = 0; i < count; i++) {
      carrier.appendChild(node("text", { class: "mw-bitlet", x: left + 10 + i * 12, y: 28 }, Math.random() < 0.5 ? "0" : "1"));
    }
    packets.appendChild(carrier);
    const travel = left - 134;
    /* The packet has to be laid out where it starts before it is told where to go, or the browser has nothing to
       move from and it simply appears at the far end: hence the explicit start, the forced layout read, and the
       second frame. */
    carrier.style.transform = "translateX(0px)";
    void carrier.getBoundingClientRect();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!stopped) carrier.style.transform = `translateX(${-travel}px)`;
    }));
    wait(() => { carrier.classList.add("mw-landed"); replay("mw-echo", 500); }, 1680);
    wait(() => { carrier.remove(); round(); }, 2100 + Math.random() * 700);
  };
  const round = () => {
    if (!stage.isConnected) { stop(); return; }
    replay("mw-sending", 1700);
    wait(() => { replay("mw-busy", 720); wait(answer, 640); }, 1660);
  };
  const stop = () => { stopped = true; timers.forEach(clearTimeout); timers.clear(); };
  round();
  return stop;
}

function driveHelix(row) {
  if (!row || row.getAttribute("data-driven")) return () => {};
  row.setAttribute("data-driven", "1");
  const NS = "http://www.w3.org/2000/svg";
  const at = i => HX_X0 + i * HX_STEP;
  const node = (name, attrs, text) => {
    const made = document.createElementNS(NS, name);
    for (const key in attrs) made.setAttribute(key, attrs[key]);
    if (text != null) made.textContent = text;
    return made;
  };
  const cols = [];
  const existing = row.querySelectorAll(".hx-col");
  for (let i = 0; i < existing.length; i++) cols.push({ g: existing[i], ph: i % 8 });
  if (!cols.length) return () => {};
  const layout = () => { for (let i = 0; i < cols.length; i++) cols[i].g.style.transform = `translateX(${at(i)}px)`; };
  const bit = () => Math.random() < 0.5;
  const make = (one, ph, x) => {
    const g = node("g", { class: "hx-col" });
    g.style.transform = `translateX(${x}px)`;
    g.appendChild(node("path", { class: `hx-r hx-p${ph}`, d: "M0 9V31" }));
    g.appendChild(node("text", { class: `hx-n hx-p${ph}`, x: 0, y: 20 }, one ? "1" : "0"));
    g.appendChild(node("text", { class: `hx-n hx-p${(ph + 4) % 8}`, x: 0, y: 20 }, one ? "0" : "1"));
    return { g, ph };
  };
  let timer = null, stopped = false;
  const later = (run, wait) => { const id = setTimeout(run, wait); return id; };
  const dustAt = x => {
    const count = 6 + Math.floor(Math.random() * 3);
    for (let d = 0; d < count; d++) {
      const angle = Math.random() * Math.PI * 2, reach = 5 + Math.random() * 9;
      const dot = node("circle", { class: "hx-dust",
        cx: (x + (Math.random() - 0.5) * 15).toFixed(1),
        cy: (10 + Math.random() * 20).toFixed(1),
        r: (1 + Math.random() * 0.9).toFixed(2) });
      dot.style.setProperty("--hx-dx", `${(Math.cos(angle) * reach).toFixed(1)}px`);
      dot.style.setProperty("--hx-dy", `${(Math.sin(angle) * reach).toFixed(1)}px`);
      dot.style.animationDelay = `${(Math.random() * 0.45).toFixed(2)}s`;
      row.appendChild(dot);
      later(() => dot.remove(), 1800);
    }
  };
  const cut = () => {
    const span = 3 + Math.floor(Math.random() * 4);
    const start = 1 + Math.floor(Math.random() * Math.max(1, 13 - span));
    const doomed = cols.slice(start, start + span);
    if (!doomed.length) return;
    doomed.forEach((column, i) => { column.g.classList.add("hx-dying"); dustAt(at(start + i)); });
    later(() => {
      if (stopped) return;
      doomed.forEach(column => column.g.remove());
      cols.splice(start, doomed.length);
      for (let i = 0; i < doomed.length; i++) {
        const made = make(bit(), (cols[cols.length - 1].ph + 1) % 8, at(cols.length));
        row.appendChild(made.g); cols.push(made);
      }
      layout();
    }, 520);
  };
  const paste = () => {
    const span = 1 + Math.floor(Math.random() * 2);
    const pos = 2 + Math.floor(Math.random() * 9);
    for (let i = 0; i < span; i++) {
      const made = make(bit(), (cols[pos + i - 1].ph + 1) % 8, at(pos + i));
      made.g.classList.add("hx-born");
      row.appendChild(made.g);
      cols.splice(pos + i, 0, made);
      later(() => made.g.classList.remove("hx-born"), 2600);
    }
    for (let i = 0; i < span; i++) cols.pop().g.remove();
    layout();
  };
  const tick = () => {
    timer = later(() => {
      if (stopped) return;
      if (!row.isConnected) { stop(); return; }
      (Math.random() < 0.55 ? cut : paste)();
      tick();
    }, 2200 + Math.random() * 3600);
  };
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); timer = null; };
  tick();
  return stop;
}
function html(kind, wide = false, name = "") {
  if (kind === "install") return timed(`<span class="vertex-task-visual task-install" aria-hidden="true">${installGears}</span>`);
  if (kind === "start") return timed(`<span class="vertex-task-visual task-start" aria-hidden="true">${startScene(name)}</span>`);
  // The wide review is the generation strip: the commit strip's host set to its generate operation.
  if (kind === "review" && wide) return timed(`<span class="task-wide-host" data-operation="generate"><span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${commitWide}${reviewWide}</span></span>`);
  if (kind === "search") return timed(`<span class="vertex-task-visual task-band" aria-hidden="true">${searchWide}</span>`);
  if (kind === "mcp") return timed(`<span class="vertex-task-visual task-band" aria-hidden="true">${mcpWide}</span>`);
  if (kind === "edit") return timed(`<span class="vertex-task-visual task-band" aria-hidden="true">${editWide}</span>`);
  if (kind === "pr") return timed(`<span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${prWide}</span>`);
  if (kind === "push") return timed(`<span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${pushWide}</span>`);
  if (kind === "commit" && wide) return timed(`<span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${commitWide}${reviewWide}</span>`);
  return `<span class="vertex-task-visual task-${kind === "commit" ? "commit" : "review"}" aria-hidden="true">${kind === "commit" ? commit : review}</span>`;
}
const css = `
.vertex-task-visual{--task-paper:var(--vscode-editor-background,Canvas);display:inline-flex;flex:none;width:44px;height:44px;color:var(--vscode-focusBorder,var(--vscode-textLink-foreground,Highlight));vertical-align:middle;pointer-events:none}
.vertex-task-visual svg{display:block;width:100%;height:100%;overflow:visible}
.vertex-task-visual .review-lens{animation:vertex-review-lens 2.8s ease-in-out infinite}
.vertex-task-visual .review-scan{animation:vertex-review-scan 2.8s ease-in-out infinite}
.vertex-task-visual .commit-stack{animation:vertex-commit-stack 3.6s ease-in-out infinite}
.vertex-task-visual .commit-sheet-back{animation:vertex-commit-sheet-back 3.6s ease-in-out infinite}
.vertex-task-visual .commit-sheet-middle{animation:vertex-commit-sheet-middle 3.6s ease-in-out infinite}
.vertex-task-visual .commit-link{transform-origin:12px 39px;animation:vertex-commit-link 3.6s ease-in-out infinite}
.vertex-task-visual .commit-node{transform-origin:12px 39px;animation:vertex-commit-node 3.6s ease-in-out infinite}
.vertex-task-visual .commit-check{color:var(--vscode-testing-iconPassed,var(--vscode-focusBorder,Highlight));animation:vertex-commit-check 3.6s ease-in-out infinite}
@keyframes vertex-review-lens{0%,100%{transform:translate(-3px,2px)}50%{transform:translate(4px,-3px)}}
@keyframes vertex-review-scan{0%,100%{opacity:.3}50%{opacity:.9}}
@keyframes vertex-commit-stack{0%,100%{opacity:.3}30%,85%{opacity:1}}
@keyframes vertex-commit-sheet-back{0%,100%{transform:translate(-7px,4px)}30%,85%{transform:translate(0,0)}}
@keyframes vertex-commit-sheet-middle{0%,100%{transform:translate(5px,-4px)}30%,85%{transform:translate(0,0)}}
@keyframes vertex-commit-link{0%,30%{transform:scaleX(0);opacity:0}55%,85%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
@keyframes vertex-commit-node{0%,35%,100%{transform:scale(.65);opacity:.35}60%,85%{transform:scale(1);opacity:1}}
@keyframes vertex-commit-check{0%,60%,100%{opacity:0}75%,90%{opacity:1}}
.vertex-task-visual.task-commit-wide{width:100%;height:auto;aspect-ratio:10/1;min-height:72px}
.task-wide-host{display:block;width:100%}
.vertex-task-visual .generate-scene{display:none}
.vertex-task-visual.task-commit.task-commit-wide{aspect-ratio:25/1;min-height:30px;max-height:44px}
[data-operation="generate"] .commit-scene{display:none}
[data-operation="generate"] .generate-scene{display:block}
.generate-scene *{transform-box:fill-box}
.rw-beam{animation:vertex-rw-beam 2.4s ease-in-out infinite alternate}
.rw-row{animation:vertex-rw-row 2.4s ease-in-out infinite}.rw-row-1{animation-delay:.25s}.rw-row-2{animation-delay:.5s}
.rw-add{transform-origin:left center;animation:vertex-rw-add 4.8s ease-out infinite}.rw-add-2{animation-delay:1.2s}
.rw-del{animation:vertex-rw-del 4.8s ease-in-out infinite}
.rw-strike{transform-origin:left center;animation:vertex-rw-strike 4.8s ease-in-out infinite}
@keyframes vertex-rw-add{0%{transform:scaleX(0);opacity:0}18%{transform:scaleX(1);opacity:1}24%{stroke-width:3.4}32%,88%{stroke-width:2.2;transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
@keyframes vertex-rw-del{0%,30%{opacity:1;transform:translateX(0)}55%{opacity:1}75%,90%{opacity:.15;transform:translateX(6px)}100%{opacity:1;transform:translateX(0)}}
@keyframes vertex-rw-strike{0%,30%{transform:scaleX(0);opacity:0}32%{opacity:1}50%,85%{transform:scaleX(1);opacity:1}95%,100%{transform:scaleX(1);opacity:0}}
.rw-trail{animation:vertex-rw-trail 1.2s linear infinite}
.rw-dot{opacity:0;animation:vertex-rw-dot-mid 2.4s cubic-bezier(.5,0,.4,1) infinite}
.rw-dot-0,.rw-dot-3{animation-name:vertex-rw-dot-top}.rw-dot-2,.rw-dot-5{animation-name:vertex-rw-dot-bottom}
.rw-dot-1{animation-delay:.3s}.rw-dot-2{animation-delay:.6s}.rw-dot-3{animation-delay:1.2s}.rw-dot-4{animation-delay:1.5s}.rw-dot-5{animation-delay:1.8s}
.rw-orbit{animation:vertex-rw-spin 1.5s linear infinite}
.rw-pulse{transform-origin:center;animation:vertex-rw-pulse 1.2s ease-out infinite}
.rw-core{animation:vertex-rw-core 1.2s ease-in-out infinite}
.rw-chevrons{animation:vertex-rw-chevrons 1.2s ease-in-out infinite}
.rw-title,.rw-line{transform-origin:left center;animation:vertex-rw-type-title 4.8s steps(24,end) infinite}
.rw-line-1{animation-name:vertex-rw-type-one}.rw-line-2{animation-name:vertex-rw-type-two}
.rw-cursor{animation:vertex-rw-cursor 4.8s linear infinite,vertex-rw-blink .6s steps(2,start) infinite}
.rw-shimmer{animation:vertex-rw-shimmer 4.8s ease-in-out infinite}
.rw-star{transform-origin:center;opacity:0;animation:vertex-rw-star 2.4s ease-in-out infinite}.rw-star-1{animation-delay:.6s}.rw-star-2{animation-delay:1.2s}.rw-star-3{animation-delay:1.8s}
@keyframes vertex-rw-beam{0%{transform:translateX(0)}100%{transform:translateX(204px)}}
@keyframes vertex-rw-row{0%,100%{opacity:.55}20%{opacity:1}}
@keyframes vertex-rw-trail{to{stroke-dashoffset:-20}}
@keyframes vertex-rw-dot-top{0%{transform:translate(0,0);opacity:0}10%{opacity:1}45%{transform:translate(110px,8px)}70%{transform:translate(230px,12px);opacity:1}78%,100%{transform:translate(234px,12px);opacity:0}}
@keyframes vertex-rw-dot-mid{0%{transform:translateX(0);opacity:0}10%{opacity:1}70%{transform:translateX(226px);opacity:1}78%,100%{transform:translateX(234px);opacity:0}}
@keyframes vertex-rw-dot-bottom{0%{transform:translate(0,0);opacity:0}10%{opacity:1}45%{transform:translate(110px,-8px)}70%{transform:translate(230px,-12px);opacity:1}78%,100%{transform:translate(234px,-12px);opacity:0}}
@keyframes vertex-rw-spin{to{stroke-dashoffset:-18}}
@keyframes vertex-rw-pulse{0%{transform:scale(.8);opacity:.7}100%{transform:scale(1.9);opacity:0}}
@keyframes vertex-rw-core{0%,100%{stroke-width:1.6}50%{stroke-width:3}}
@keyframes vertex-rw-chevrons{0%{transform:translateX(-14px);opacity:0}50%{opacity:1}100%{transform:translateX(18px);opacity:0}}
@keyframes vertex-rw-type-title{0%,8%{transform:scaleX(0)}30%,92%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes vertex-rw-type-one{0%,30%{transform:scaleX(0)}55%,92%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes vertex-rw-type-two{0%,55%{transform:scaleX(0)}78%,92%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes vertex-rw-cursor{0%,8%{transform:translate(-188px,0)}30%{transform:translate(0,0)}31%{transform:translate(-188px,9px)}55%{transform:translate(146px,9px)}56%{transform:translate(-188px,17px)}78%,92%{transform:translate(86px,17px)}100%{transform:translate(-188px,0)}}
@keyframes vertex-rw-blink{to{visibility:hidden}}
@keyframes vertex-rw-shimmer{0%,78%{transform:translateX(0)}96%,100%{transform:translateX(460px)}}
@keyframes vertex-rw-star{0%,100%{transform:scale(0);opacity:0}30%{transform:scale(1.15);opacity:.9}60%{transform:scale(0);opacity:0}}
.commit-scene *{transform-box:fill-box}
.cw-branch{animation:vertex-cw-branch 4.8s ease-in-out infinite}
.cw-hist{animation:vertex-cw-hist 4.8s ease-in-out infinite}.cw-hist-1{animation-delay:.2s}.cw-hist-2{animation-delay:.4s}.cw-hist-3{animation-delay:.6s}
.cw-docs{animation:vertex-cw-docs 4.8s ease-in-out infinite}
.cw-sheet-back{animation:vertex-cw-back 4.8s ease-in-out infinite}.cw-sheet-mid{animation:vertex-cw-mid 4.8s ease-in-out infinite}
.cw-doc-add,.cw-doc-del{transform-origin:left center;animation:vertex-cw-mark 4.8s ease-out infinite}.cw-doc-del{animation-delay:.15s}
.cw-packet{opacity:0;animation:vertex-cw-packet 4.8s cubic-bezier(.45,0,.4,1) infinite}.cw-packet-2{animation-delay:.35s}
.cw-chevrons{animation:vertex-cw-chevrons 1.2s ease-in-out infinite}
.cw-ring{transform-origin:center;opacity:0;animation:vertex-cw-ring 4.8s ease-out infinite}.cw-ring-2{animation-delay:.3s}
.cw-node{animation:vertex-cw-node 4.8s ease-in-out infinite}
.cw-check{animation:vertex-cw-check 4.8s ease-in-out infinite}
.cw-spark{opacity:0;animation:vertex-cw-spark-0 4.8s ease-out infinite}.cw-spark-1{animation-name:vertex-cw-spark-1}.cw-spark-2{animation-name:vertex-cw-spark-2}.cw-spark-3{animation-name:vertex-cw-spark-3}.cw-spark-4{animation-name:vertex-cw-spark-4}.cw-spark-5{animation-name:vertex-cw-spark-5}
.cw-hash rect{transform-origin:left center;animation:vertex-cw-hash 4.8s steps(4,end) infinite}
.cw-head,.cw-head-tip{animation:vertex-cw-head 4.8s ease-in-out infinite}
@keyframes vertex-cw-branch{0%,10%{stroke-dashoffset:100;opacity:.2}55%{stroke-dashoffset:0;opacity:.9}88%{stroke-dashoffset:0;opacity:.9}100%{stroke-dashoffset:0;opacity:.2}}
@keyframes vertex-cw-hist{0%,100%{opacity:.4}8%{opacity:1}16%{opacity:.4}}
@keyframes vertex-cw-docs{0%,100%{opacity:.5}12%,85%{opacity:1}}
@keyframes vertex-cw-back{0%,100%{transform:translate(-6px,3px)}18%,85%{transform:translate(4px,-3px)}}
@keyframes vertex-cw-mid{0%,100%{transform:translate(-3px,2px)}18%,85%{transform:translate(2px,-2px)}}
@keyframes vertex-cw-mark{0%,6%{transform:scaleX(0)}16%,90%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes vertex-cw-packet{0%,14%{transform:translate(0,22px);opacity:0}20%{transform:translate(90px,22px);opacity:1}28%{transform:translate(190px,5px)}50%{transform:translate(470px,5px)}58%{transform:translate(580px,22px);opacity:1}64%,100%{transform:translate(650px,22px);opacity:0}}
@keyframes vertex-cw-chevrons{0%{transform:translateX(-12px);opacity:0}50%{opacity:1}100%{transform:translateX(16px);opacity:0}}
@keyframes vertex-cw-ring{0%,60%{transform:scale(.8);opacity:0}64%{opacity:.8}85%,100%{transform:scale(2.6);opacity:0}}
@keyframes vertex-cw-node{0%,58%,100%{stroke-width:1.6}66%{stroke-width:3.4}74%,92%{stroke-width:2.2}}
@keyframes vertex-cw-check{0%,64%{stroke-dashoffset:10;opacity:0}66%{opacity:1}74%,92%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes vertex-cw-spark-0{0%,62%{transform:translate(0,0);opacity:0}64%{opacity:1}80%,100%{transform:translate(-18px,-12px);opacity:0}}
@keyframes vertex-cw-spark-1{0%,62%{transform:translate(0,0);opacity:0}64%{opacity:1}80%,100%{transform:translate(0,-16px);opacity:0}}
@keyframes vertex-cw-spark-2{0%,62%{transform:translate(0,0);opacity:0}64%{opacity:1}80%,100%{transform:translate(18px,-12px);opacity:0}}
@keyframes vertex-cw-spark-3{0%,62%{transform:translate(0,0);opacity:0}64%{opacity:1}80%,100%{transform:translate(-20px,6px);opacity:0}}
@keyframes vertex-cw-spark-4{0%,62%{transform:translate(0,0);opacity:0}64%{opacity:1}80%,100%{transform:translate(20px,6px);opacity:0}}
@keyframes vertex-cw-spark-5{0%,62%{transform:translate(0,0);opacity:0}64%{opacity:1}80%,100%{transform:translate(8px,10px);opacity:0}}
@keyframes vertex-cw-hash{0%,68%{transform:scaleX(0);opacity:0}80%,92%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
@keyframes vertex-cw-head{0%,76%{opacity:0;transform:translateX(-8px)}84%,92%{opacity:.8;transform:translateX(0)}100%{opacity:0}}
.pr-scene *,.push-scene *{transform-box:fill-box}
.pw-c{animation:vertex-pw-c 4.8s ease-in-out infinite}.pw-c-1{animation-delay:.25s}.pw-c-2{animation-delay:.5s}.pw-c-3{animation-delay:.75s}
.pw-card{opacity:0;animation:vertex-pw-card-0 4.8s cubic-bezier(.45,0,.4,1) infinite}.pw-card-1{animation-name:vertex-pw-card-1}.pw-card-2{animation-name:vertex-pw-card-2}.pw-card-3{animation-name:vertex-pw-card-3}
.pw-trail{animation:vertex-rw-trail 1.2s linear infinite}
.pw-box{animation:vertex-pw-box 4.8s ease-in-out infinite}
.pw-icon{animation:vertex-pw-icon 4.8s ease-in-out infinite}
.pw-title,.pw-line{transform-origin:left center;animation:vertex-pw-type-title 4.8s steps(20,end) infinite}.pw-line-1{animation-name:vertex-pw-type-one}.pw-line-2{animation-name:vertex-pw-type-two}
.pw-arrow{animation:vertex-pw-arrow 4.8s linear infinite}
.pw-arrow-tip,.pw-base{animation:vertex-pw-target 4.8s ease-in-out infinite}
.pw-ring{transform-origin:center;opacity:0;animation:vertex-pw-ring 4.8s ease-out infinite}
@keyframes vertex-pw-c{0%,100%{stroke-width:1.6}6%{stroke-width:3.4}14%{stroke-width:1.6}}
@keyframes vertex-pw-card-0{0%,4%{transform:translate(0,0);opacity:0}8%{opacity:1}26%{transform:translate(370px,8px);opacity:1}30%,100%{transform:translate(380px,8px);opacity:0}}
@keyframes vertex-pw-card-1{0%,9%{transform:translate(0,0);opacity:0}13%{opacity:1}31%{transform:translate(310px,8px);opacity:1}35%,100%{transform:translate(320px,8px);opacity:0}}
@keyframes vertex-pw-card-2{0%,14%{transform:translate(0,0);opacity:0}18%{opacity:1}36%{transform:translate(250px,8px);opacity:1}40%,100%{transform:translate(260px,8px);opacity:0}}
@keyframes vertex-pw-card-3{0%,19%{transform:translate(0,0);opacity:0}23%{opacity:1}41%{transform:translate(190px,8px);opacity:1}45%,100%{transform:translate(200px,8px);opacity:0}}
@keyframes vertex-pw-box{0%,24%,100%{stroke-width:1.6}30%{stroke-width:2.8}40%{stroke-width:1.6}}
@keyframes vertex-pw-icon{0%,20%,100%{opacity:.4}34%,90%{opacity:1}}
@keyframes vertex-pw-type-title{0%,30%{transform:scaleX(0)}48%,92%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes vertex-pw-type-one{0%,46%{transform:scaleX(0)}62%,92%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes vertex-pw-type-two{0%,60%{transform:scaleX(0)}74%,92%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes vertex-pw-arrow{0%,70%{opacity:.15;stroke-dashoffset:0}76%,95%{opacity:1}100%{opacity:.15;stroke-dashoffset:-30}}
@keyframes vertex-pw-target{0%,74%,100%{opacity:.4}82%,94%{opacity:1}}
@keyframes vertex-pw-ring{0%,76%{transform:scale(.8);opacity:0}80%{opacity:.8}96%,100%{transform:scale(2.6);opacity:0}}
.ph-c{animation:vertex-pw-c 4.8s ease-in-out infinite}.ph-c-1{animation-delay:.2s}.ph-c-2{animation-delay:.4s}.ph-c-3{animation-delay:.6s}
.ph-arc{animation:vertex-ph-arc 4.8s ease-in-out infinite}
.ph-pk{opacity:0;animation:vertex-ph-pk 4.8s cubic-bezier(.45,0,.4,1) infinite}.ph-pk-1{animation-delay:.3s}.ph-pk-2{animation-delay:.6s}
.ph-chevrons{animation:vertex-rw-chevrons 1.2s ease-in-out infinite}
.ph-cloud{animation:vertex-ph-cloud 4.8s ease-in-out infinite}
.ph-ring{transform-origin:center;opacity:0;animation:vertex-ph-ring 4.8s ease-out infinite}
.ph-remote{animation:vertex-ph-remote 4.8s ease-in-out infinite}
.ph-tip{animation:vertex-pw-target 4.8s ease-in-out infinite}
.ph-check{animation:vertex-ph-check 4.8s ease-in-out infinite}
@keyframes vertex-ph-arc{0%,10%{stroke-dashoffset:100;opacity:.2}50%{stroke-dashoffset:0;opacity:.9}88%{stroke-dashoffset:0;opacity:.9}100%{stroke-dashoffset:0;opacity:.2}}
@keyframes vertex-ph-pk{0%,10%{transform:translate(0,0);opacity:0}14%{opacity:1}30%{transform:translate(170px,-14px)}46%{transform:translate(330px,-24px);opacity:1}56%{transform:translate(500px,-24px);opacity:1}60%,100%{transform:translate(510px,-20px);opacity:0}}
@keyframes vertex-ph-cloud{0%,55%,100%{stroke-width:1.6}62%{stroke-width:3}72%{stroke-width:1.6}}
@keyframes vertex-ph-ring{0%,58%{transform:scale(.8);opacity:0}62%{opacity:.7}82%,100%{transform:scale(1.9);opacity:0}}
@keyframes vertex-ph-remote{0%,60%{stroke-dashoffset:100;opacity:.3}78%,94%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:.3}}
@keyframes vertex-ph-check{0%,64%{stroke-dashoffset:10;opacity:0}66%{opacity:1}74%,92%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
.task-timed{display:flex;align-items:center;gap:12px;width:100%}
.task-timed>.vertex-task-visual,.task-timed>.task-wide-host{flex:1 1 auto;min-width:0}
@property --task-min{syntax:"<integer>";inherits:false;initial-value:0}
@property --task-sec{syntax:"<integer>";inherits:false;initial-value:0}
.task-timer{flex:none;padding:2px 7px;border:1px solid var(--vscode-focusBorder,currentColor);border-radius:4px;color:var(--vscode-focusBorder,var(--vscode-textLink-foreground,Highlight));
  font:600 13px/1 Consolas,"Cascadia Mono","Courier New",monospace;letter-spacing:.08em;font-variant-numeric:tabular-nums;
  animation:vertex-task-min 3600s steps(60,end) infinite,vertex-task-sec 60s steps(60,end) infinite;counter-reset:task-min var(--task-min) task-sec var(--task-sec)}
.task-timer::after{content:counter(task-min,decimal-leading-zero) ":" counter(task-sec,decimal-leading-zero)}
@keyframes vertex-task-min{from{--task-min:0}to{--task-min:60}}
@keyframes vertex-task-sec{from{--task-sec:0}to{--task-sec:60}}
.task-timed:has(.scene-done) .task-timer,.task-timed.scene-done .task-timer{animation-play-state:paused}
/* Without motion (vertex.animations off, or auto with reduced motion asked for) a scene is not shown: a still one says nothing. */
body.vscode-reduce-motion:not(.vertex-motion-on) .task-timed{display:none!important}
@media(prefers-reduced-motion:reduce){body:not(.vertex-motion-on) .task-timed{display:none!important}}
body.vertex-motion-off .task-timed{display:none!important}
body.vscode-reduce-motion:not(.vertex-motion-on) .vertex-task-visual{display:none!important}
@media(prefers-reduced-motion:reduce){body:not(.vertex-motion-on) .vertex-task-visual{display:none!important}}
body.vertex-motion-off .vertex-task-visual{display:none!important}

.task-install,.task-start{display:block;width:100%;height:auto}
.task-install{aspect-ratio:10/1}.task-start{aspect-ratio:1000/140}
.task-install svg,.task-start svg{width:100%;height:100%}
.task-install svg{overflow:visible}.task-start svg{overflow:hidden}
.ig-fly{offset-path:path("M95 40C300 -10 600 -10 835 58");offset-rotate:0deg;animation:vertex-ig-fly 4.8s cubic-bezier(.45,.05,.55,.95) infinite}
.ig-2{animation-delay:.55s}.ig-3{animation-delay:1.1s}
.ig-turn{animation:vertex-ig-turn 1.6s linear infinite}
.ig-2 .ig-turn{animation-duration:1.1s;animation-direction:reverse}.ig-3 .ig-turn{animation-duration:2.2s}
.ig-lid{transform-box:fill-box;transform-origin:0% 50%;animation:vertex-ig-lid 4.8s ease-in-out infinite}
.ig-ring{transform-box:fill-box;transform-origin:center;animation:vertex-ig-ring 4.8s ease-out infinite}
.ig-check,.sc-check{opacity:0}
@keyframes vertex-ig-fly{0%{offset-distance:0%;opacity:0;transform:scale(.6)}8%{opacity:1;transform:scale(1)}62%{offset-distance:100%;opacity:1;transform:scale(.8)}70%,100%{offset-distance:100%;opacity:0;transform:scale(.5)}}
@keyframes vertex-ig-turn{to{transform:rotate(360deg)}}
@keyframes vertex-ig-lid{0%,72%{transform:translate(-6px,-26px) rotate(-38deg)}82%,94%{transform:none}100%{transform:translate(-6px,-26px) rotate(-38deg)}}
@keyframes vertex-ig-ring{0%,80%{transform:scale(.7);opacity:0}86%{transform:scale(1);opacity:.6}98%,100%{transform:scale(1.4);opacity:0}}
.scene-done .ig-fly{animation:none;opacity:0}.scene-done .ig-lid{animation:none;transform:none}.scene-done .ig-ring{animation:none;opacity:0}
.scene-done .ig-check,.scene-done .sc-check{opacity:1;transition:opacity .25s}
.sc-flame{transform-box:fill-box;transform-origin:100% 50%;transform:scaleX(.22);opacity:.6;animation:vertex-sc-rev 3.2s ease-out infinite}
/* Plasma, in the theme's chart colours: a violet glow, a blue body and a bright yellow core at the nozzles. */
.sc-flame-outer{fill:var(--vscode-charts-purple,currentColor);opacity:.45}
.sc-flame-mid{fill:var(--vscode-charts-blue,currentColor);opacity:.8}
.sc-flame-core{fill:var(--vscode-charts-yellow,var(--vscode-editorWarning-foreground,currentColor))}
@keyframes vertex-sc-rev{0%,18%{transform:scaleX(.22);opacity:.6}24%{transform:scaleX(.7) scaleY(1.05);opacity:1}36%,58%{transform:scaleX(.28);opacity:.7}64%{transform:scaleX(.95) scaleY(1.08);opacity:1}70%{transform:scaleX(.6)}76%{transform:scaleX(.9) scaleY(1.05)}88%,100%{transform:scaleX(.22);opacity:.6}}
.scene-done .sc-flame{animation:vertex-sc-burn .09s linear infinite alternate}
@keyframes vertex-sc-burn{from{transform:scaleX(1.55);opacity:.9}to{transform:scaleX(1.8) scaleY(1.1);opacity:1}}
.sc-craft{transform-box:fill-box;transform-origin:50% 50%;animation:vertex-sc-shake 3.2s linear infinite}
@keyframes vertex-sc-shake{0%,22%,34%,62%,80%,100%{transform:none}24%,28%,32%,64%,68%,72%,76%{transform:translateY(-.6px)}26%,30%,66%,70%,74%,78%{transform:translateY(.6px)}}
.scene-done .sc-ground{animation:vertex-sc-ground 3.2s cubic-bezier(.6,0,.9,.6) forwards}
.scene-done .sc-clouds{animation:vertex-sc-clouds 3.2s cubic-bezier(.6,0,.9,.6) forwards}
.scene-done .sc-craft{animation:vertex-sc-lift 3.2s linear forwards}
.scene-done .sc-check{transition-delay:2.6s}
@keyframes vertex-sc-ground{from{transform:none}to{transform:translateX(-2100px)}}
@keyframes vertex-sc-clouds{from{transform:none}to{transform:translateX(-700px)}}
@keyframes vertex-sc-lift{0%,62%{transform:none;animation-timing-function:cubic-bezier(.4,0,.7,1)}100%{transform:translate(900px,-70px) rotate(-10deg)}}

/* The chat's step scenes share the review strip's band: full width, 25:1, never taller than the message line. */
.vertex-task-visual.task-band{width:100%;height:auto;aspect-ratio:25/1;min-height:30px;max-height:44px}
.vertex-task-visual{--task-ok:var(--vscode-testing-iconPassed,var(--vscode-charts-green,currentColor));
  --task-cut:var(--vscode-gitDecoration-deletedResourceForeground,var(--vscode-errorForeground,currentColor));
  --task-new:var(--vscode-gitDecoration-addedResourceForeground,var(--vscode-testing-iconPassed,currentColor))}
.task-band *{transform-box:fill-box}

.sw-bit{transform-origin:center;opacity:.38;animation:vertex-sw-bit 4.8s ease-in-out infinite}
.sw-hit{animation-name:vertex-sw-hit}
.sw-hit ellipse,.sw-hit path{stroke:var(--task-ok)}
.sw-lens{animation:vertex-sw-lens 4.8s linear infinite}
@keyframes vertex-sw-bit{0%{transform:scale(1);opacity:.38}4%{transform:scale(1.4);opacity:1}11%,100%{transform:scale(1);opacity:.38}}
@keyframes vertex-sw-hit{0%{transform:scale(1);opacity:.38}4%{transform:scale(1.45);opacity:1}11%,93%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:.38}}
@keyframes vertex-sw-lens{0%{transform:translateX(0);opacity:0}4%{opacity:1}88%{transform:translateX(924px);opacity:1}100%{transform:translateX(980px);opacity:0}}

.mw-label{fill:currentColor;font:500 16px/1 var(--vscode-font-family,sans-serif);letter-spacing:.06em}
.mw-lane{stroke:currentColor;stroke-opacity:.22;stroke-dasharray:4 6}
/* The exchange is not symmetric: the question that leaves is one short pulse, what the system sends back is a long,
   heavier one. Each is a single dash running along its lane; the gap is longer than the lane, so only one pulse is
   ever on the wire and there is no wrap at the ends. */
/* Without the driver the exchange still runs, as one CSS loop: a short question out, a long answer back. With it
   (.mw-driven) each round is played instead - question, the system thinking, then a packet of actual bits whose
   length is different every time, which is what no CSS loop can do. */
.mw-ask,.mw-answer{stroke-linecap:round;animation:vertex-mw-pulse 2.8s linear infinite}
.mw-ask{stroke:currentColor;stroke-width:2.2;stroke-dasharray:40 784}
.mw-answer{stroke:var(--task-ok);stroke-width:4.4;stroke-dasharray:190 634;animation-delay:2.4s}
@keyframes vertex-mw-pulse{from{stroke-dashoffset:0}to{stroke-dashoffset:-824}}
.mw-glow{opacity:0;transform-origin:center;animation:vertex-mw-hit 2.8s ease-out infinite}
.mw-led{animation:vertex-mw-led 2.8s ease-out infinite}
.mw-arc{stroke:var(--task-ok);stroke-width:1.6;stroke-dasharray:26;stroke-dashoffset:26;opacity:0;
  animation:vertex-mw-arc 2.8s ease-out infinite}
.mw-arc2{animation-delay:.07s}
@keyframes vertex-mw-hit{0%,82%{opacity:0;transform:scale(.96)}86%{opacity:.22;transform:scale(1)}100%{opacity:0;transform:scale(1.05)}}
@keyframes vertex-mw-led{0%,83%{opacity:.5}87%{opacity:1}100%{opacity:.5}}
@keyframes vertex-mw-arc{0%,83%{stroke-dashoffset:26;opacity:0}86%{opacity:1}90%{stroke-dashoffset:0;opacity:1}96%,100%{stroke-dashoffset:0;opacity:0}}

.mw-driven .mw-ask,.mw-driven .mw-glow,.mw-driven .mw-led,.mw-driven .mw-arc{animation:none}
.mw-driven .mw-answer{display:none}
.mw-driven .mw-glow{opacity:0}
.mw-driven .mw-arc{opacity:0;stroke-dashoffset:26}
.mw-driven.mw-sending .mw-ask{animation:vertex-mw-out 1.7s linear forwards}
.mw-driven.mw-busy .mw-glow{animation:vertex-mw-think .72s ease-out}
.mw-driven.mw-busy .mw-led{animation:vertex-mw-flare .72s ease-out}
.mw-driven.mw-busy .mw-arc{animation:vertex-mw-strike .72s ease-out}
.mw-driven.mw-busy .mw-arc2{animation-delay:.1s}
.mw-driven.mw-echo .mw-cloud{animation:vertex-mw-echo .5s ease-out}
.mw-cloud{transform-origin:center}
@keyframes vertex-mw-out{from{stroke-dashoffset:0}to{stroke-dashoffset:-824}}
@keyframes vertex-mw-think{0%{opacity:0;transform:scale(.96)}25%{opacity:.24;transform:scale(1)}100%{opacity:0;transform:scale(1.05)}}
@keyframes vertex-mw-flare{0%{opacity:.5}20%{opacity:1}100%{opacity:.5}}
@keyframes vertex-mw-strike{0%{stroke-dashoffset:26;opacity:0}15%{opacity:1}45%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
@keyframes vertex-mw-echo{0%{transform:scale(1)}35%{transform:scale(1.06)}100%{transform:scale(1)}}
.mw-packet{transition:transform 1.6s cubic-bezier(.3,0,.5,1)}
.mw-packet.mw-landed{opacity:0;transition:transform 1.6s cubic-bezier(.3,0,.5,1),opacity .35s ease-in}
.mw-bitlet{font:600 9px/1 var(--vscode-editor-font-family,Consolas,monospace);fill:var(--task-ok);stroke:none;
  text-anchor:middle;dominant-baseline:central}

.hx-n{font:600 20px/1 var(--vscode-editor-font-family,Consolas,monospace);fill:currentColor;transition:fill .9s;
  transform-origin:center;animation:vertex-hx-turn 5.6s linear infinite}
.hx-r{stroke:var(--vscode-focusBorder,currentColor);stroke-width:1.8;opacity:.3;fill:none;transition:stroke .9s;
  transform-origin:center;animation:vertex-hx-rung 5.6s linear infinite}
.hx-p0{animation-delay:0s}.hx-p1{animation-delay:-.7s}.hx-p2{animation-delay:-1.4s}.hx-p3{animation-delay:-2.1s}
.hx-p4{animation-delay:-2.8s}.hx-p5{animation-delay:-3.5s}.hx-p6{animation-delay:-4.2s}.hx-p7{animation-delay:-4.9s}
.hx-col{transition:transform .6s cubic-bezier(.4,0,.3,1)}
.hx-col.hx-dying{opacity:0;transition:transform .6s cubic-bezier(.4,0,.3,1),opacity .5s ease-in}
.hx-dying .hx-n{fill:var(--task-cut);transition:fill .12s}
.hx-born .hx-n{fill:var(--task-new)}
.hx-born .hx-r{stroke:var(--task-new)}
.hx-born{animation:vertex-hx-born .55s ease-out}
.hx-dust{fill:var(--task-cut);opacity:0;animation:vertex-hx-dust 1.15s ease-out forwards}
@keyframes vertex-hx-born{from{opacity:0}to{opacity:1}}
@keyframes vertex-hx-dust{0%{transform:translate(0,0);opacity:0}12%{opacity:.95}
  100%{transform:translate(var(--hx-dx),var(--hx-dy));opacity:0}}
@keyframes vertex-hx-turn{
0%{transform:translateY(0) scale(1.15);opacity:1}
12.5%{transform:translateY(7.1px) scale(1.09);opacity:.92}
25%{transform:translateY(10px) scale(.98);opacity:.68}
37.5%{transform:translateY(7.1px) scale(.86);opacity:.45}
50%{transform:translateY(0) scale(.8);opacity:.36}
62.5%{transform:translateY(-7.1px) scale(.86);opacity:.45}
75%{transform:translateY(-10px) scale(.98);opacity:.68}
87.5%{transform:translateY(-7.1px) scale(1.09);opacity:.92}
100%{transform:translateY(0) scale(1.15);opacity:1}}
@keyframes vertex-hx-rung{
0%{transform:scaleY(0)}12.5%{transform:scaleY(.71)}25%{transform:scaleY(1)}37.5%{transform:scaleY(.71)}
50%{transform:scaleY(0)}62.5%{transform:scaleY(.71)}75%{transform:scaleY(1)}87.5%{transform:scaleY(.71)}
100%{transform:scaleY(0)}}
`;
const api = { html, css, drive };
if (typeof module !== "undefined" && module.exports) module.exports = api; else window.vertexTaskVisual = api;
})();
