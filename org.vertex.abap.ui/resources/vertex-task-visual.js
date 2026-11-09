// The waiting scenes, once for both hosts: VS Code requires this file (task-visual.js), and a page that shows one
// inlines it where it marks /*VERTEX_TASK_VISUAL*/ (Versions, for the review build). Wrapped so that, inlined as a
// classic script, it leaves only window.vertexTaskVisual.
(function () {
"use strict";

// Small vector scenes: CSS animation only, no timers, filters or remote assets.
const review = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g class="task-paper" fill="var(--task-paper)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M13 9h24l9 9v32H13z"/><path d="M20 14h23l8 8v34H20z"/><path opacity=".55" d="M25 24h17M25 30h17M25 36h11M25 43h15"/></g><g class="review-lens" fill="var(--task-paper)" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="35" cy="32" r="11" fill-opacity=".88"/><path d="m43 40 10 10"/><path class="review-scan" opacity=".55" stroke-width="1.5" d="M29 30h12M29 34h8"/></g></svg>`;
const commit = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g fill="var(--task-paper)" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M12 10v45"/><circle opacity=".65" cx="12" cy="13" r="3"/><circle opacity=".65" cx="12" cy="54" r="3"/><g class="commit-stack"><path class="commit-sheet-back" opacity=".35" d="M19 15h26v35H19z"/><path class="commit-sheet-middle" opacity=".6" d="M23 11h26v35H23z"/><path d="M27 7h23l7 7v29H27z"/><path opacity=".5" d="M33 17h16M33 23h16M33 29h8"/></g><path class="commit-link" d="M12 39h15"/><circle class="commit-node" cx="12" cy="39" r="4.7"/><path class="commit-check" fill="none" stroke-width="2.5" d="m39 36 4 4 9-10"/></g></svg>`;

const commitWide = `<svg class="commit-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path opacity=".22" d="M20 30H980"/><path opacity=".18" d="M220 30C280 30 280 9 340 9H600C660 9 660 30 720 30"/><path class="cw-branch" pathLength="100" stroke-dasharray="100" d="M220 30C280 30 280 9 340 9H600C660 9 660 30 720 30H786"/><circle class="cw-hist cw-hist-0" cx="60" cy="30" r="3.2" fill="var(--task-paper)"/><circle class="cw-hist cw-hist-1" cx="180" cy="30" r="3.2" fill="var(--task-paper)"/><circle class="cw-hist cw-hist-2" cx="640" cy="30" r="3.2" fill="var(--task-paper)"/><circle class="cw-hist cw-hist-3" cx="920" cy="30" r="3.2" fill="var(--task-paper)"/><circle cx="220" cy="30" r="3.6" fill="var(--task-paper)"/><g class="cw-docs" fill="var(--task-paper)"><path class="cw-sheet-back" opacity=".4" d="M86 13h20v22H86z"/><path class="cw-sheet-mid" opacity=".7" d="M91 9h20v22H91z"/><path d="M96 5h16l5 5v18H96z"/><path class="cw-doc-add" stroke="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" d="M100 13h10"/><path class="cw-doc-del" stroke="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" d="M100 18h10"/><path opacity=".6" d="M100 23h6"/></g><g class="cw-packet"><path d="M128 4h12v9h-12z" fill="var(--task-paper)"/><path opacity=".6" stroke-width="1.2" d="M131 7.5h6M131 10h4"/></g><g class="cw-packet cw-packet-2"><path d="M128 4h12v9h-12z" fill="var(--task-paper)"/><path opacity=".6" stroke-width="1.2" d="M131 7.5h6M131 10h4"/></g><path class="cw-chevrons" d="m740 25 5 5-5 5m-8-10 5 5-5 5"/><circle class="cw-ring" cx="800" cy="30" r="9"/><circle class="cw-ring cw-ring-2" cx="800" cy="30" r="9"/><circle class="cw-spark cw-spark-0" cx="800" cy="30" r="1.8" fill="currentColor" stroke="none"/><circle class="cw-spark cw-spark-1" cx="800" cy="30" r="1.8" fill="var(--vscode-testing-iconPassed,currentColor)" stroke="none"/><circle class="cw-spark cw-spark-2" cx="800" cy="30" r="1.8" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" stroke="none"/><circle class="cw-spark cw-spark-3" cx="800" cy="30" r="1.8" fill="currentColor" stroke="none"/><circle class="cw-spark cw-spark-4" cx="800" cy="30" r="1.8" fill="var(--vscode-testing-iconPassed,currentColor)" stroke="none"/><circle class="cw-spark cw-spark-5" cx="800" cy="30" r="1.8" fill="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" stroke="none"/><circle class="cw-node" cx="800" cy="30" r="7.5" fill="var(--task-paper)" stroke-width="2.2"/><path class="cw-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="2.4" pathLength="10" stroke-dasharray="10" d="m796 30 3 3 5-6"/><g class="cw-hash" stroke="none" fill="currentColor"><rect x="818" y="5" width="9" height="5" rx="1"/><rect x="829" y="5" width="7" height="5" rx="1" opacity=".7"/><rect x="838" y="5" width="11" height="5" rx="1"/><rect x="851" y="5" width="6" height="5" rx="1" opacity=".7"/></g><path class="cw-head" stroke-width="1.4" d="M818 16h30"/><path class="cw-head-tip" stroke-width="1.4" d="m845 13 3 3-3 3"/></g></svg>`;

// The diff being reviewed for a commit message: a beam scans the changed rows, their fragments stream into a merge node, and the draft is typed out.
const reviewWide = `<svg class="generate-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><defs><clipPath id="rw-card-clip"><rect x="592" y="3" width="396" height="34" rx="5"/></clipPath></defs><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><g class="rw-row rw-row-0"><rect x="12" y="4" width="216" height="8" rx="2" fill="var(--task-paper)" stroke="currentColor" stroke-opacity=".45"/><path stroke="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" class="rw-add" stroke-width="2.2" d="M17 8h5m-2.5-2.5v5M27 8h170"/></g><g class="rw-row rw-row-1"><rect x="12" y="16" width="216" height="8" rx="2" fill="var(--task-paper)" stroke="currentColor" stroke-opacity=".45"/><path stroke="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" class="rw-del" stroke-width="2.2" d="M17 20h5M27 20h130"/><path class="rw-strike" stroke="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" stroke-width="1.6" d="M25 20h136"/></g><g class="rw-row rw-row-2"><rect x="12" y="28" width="216" height="8" rx="2" fill="var(--task-paper)" stroke="currentColor" stroke-opacity=".45"/><path stroke="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" class="rw-add rw-add-2" stroke-width="2.2" d="M17 32h5m-2.5-2.5v5M27 32h150"/></g><g class="rw-beam"><rect x="10" y="1" width="16" height="38" rx="3" fill="currentColor" stroke="none" opacity=".08"/><rect x="16" y="1" width="4" height="38" rx="2" fill="currentColor" stroke="none" opacity=".45"/></g><path class="rw-trail" opacity=".35" stroke-dasharray="3 7" d="M236 8C330 8 360 20 452 20M236 20H452M236 32C330 32 360 20 452 20M490 20H570"/><circle class="rw-dot rw-dot-0" cx="236" cy="8" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-1" cx="236" cy="20" r="2.4" fill="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-2" cx="236" cy="32" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-3" cx="236" cy="8" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-4" cx="236" cy="20" r="2.4" fill="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)"/><circle class="rw-dot rw-dot-5" cx="236" cy="32" r="2.4" fill="var(--vscode-gitDecoration-addedResourceForeground,currentColor)"/><circle class="rw-pulse" cx="470" cy="20" r="11"/><circle class="rw-orbit" cx="470" cy="20" r="15" stroke-dasharray="4 5" opacity=".6"/><circle class="rw-core" cx="470" cy="20" r="8" fill="var(--task-paper)"/><path class="rw-core-mark" stroke-width="1.4" d="M466 17h8M466 20h8M466 23h5"/><path class="rw-chevrons" d="m538 15 5 5-5 5m-8-10 5 5-5 5"/><rect x="592" y="3" width="396" height="34" rx="5" fill="var(--task-paper)"/><g clip-path="url(#rw-card-clip)"><path class="rw-title" stroke-width="3.2" d="M606 13H790"/><path class="rw-line rw-line-1" opacity=".7" d="M606 22H940"/><path class="rw-line rw-line-2" opacity=".7" d="M606 30H880"/><rect class="rw-cursor" x="794" y="8" width="2" height="10" fill="currentColor" stroke="none"/><path class="rw-shimmer" stroke="none" fill="currentColor" opacity=".1" d="M560 0h26l-14 40h-26z"/></g><path class="rw-star rw-star-0" fill="currentColor" d="M588 1l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/><path class="rw-star rw-star-1" fill="currentColor" d="M992 3l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/><path class="rw-star rw-star-2" fill="currentColor" d="M986 29l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/><path class="rw-star rw-star-3" fill="currentColor" d="M600 30l1.3 3.7 3.7 1.3-3.7 1.3-1.3 3.7-1.3-3.7-3.7-1.3 3.7-1.3z"/></g></svg>`;

// A pull request being described: the branch's commits light up in turn and fly into one description card, which points at the base branch.
const prWide = `<svg class="pr-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path opacity=".22" d="M20 34H980"/><path opacity=".5" d="M24 34C34 34 34 12 48 12H260"/><circle cx="24" cy="34" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-0" cx="60" cy="12" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-1" cx="120" cy="12" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-2" cx="180" cy="12" r="3.6" fill="var(--task-paper)"/><circle class="pw-c pw-c-3" cx="240" cy="12" r="3.6" fill="var(--task-paper)"/><g class="pw-card pw-card-0"><rect x="54" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M57 8.5h6M57 11h4"/></g><g class="pw-card pw-card-1"><rect x="114" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M117 8.5h6M117 11h4"/></g><g class="pw-card pw-card-2"><rect x="174" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M177 8.5h6M177 11h4"/></g><g class="pw-card pw-card-3"><rect x="234" y="5" width="12" height="9" rx="1.5" fill="var(--task-paper)"/><path stroke-width="1.1" opacity=".7" d="M237 8.5h6M237 11h4"/></g><path class="pw-trail" opacity=".3" stroke-dasharray="3 7" d="M262 12C320 12 330 20 380 20"/><rect class="pw-box" x="390" y="3" width="330" height="34" rx="5" fill="var(--task-paper)"/><g class="pw-icon" stroke-width="1.5"><circle cx="406" cy="12" r="3"/><circle cx="406" cy="28" r="3"/><path d="M406 15v10"/><circle cx="422" cy="28" r="3"/><path d="M422 25v-7a5 5 0 0 0-5-5h-4"/><path d="m415 10-3 3 3 3"/></g><path class="pw-title" stroke-width="3" d="M436 13H600"/><path class="pw-line pw-line-1" opacity=".7" d="M436 22H690"/><path class="pw-line pw-line-2" opacity=".7" d="M436 30H640"/><path class="pw-arrow" stroke-dasharray="4 6" d="M724 20C800 20 820 34 880 34"/><path class="pw-arrow-tip" d="m872 29 8 5-8 5"/><circle class="pw-ring" cx="910" cy="34" r="6"/><circle class="pw-base" cx="910" cy="34" r="4.6" fill="var(--task-paper)" stroke-width="2"/></g></svg>`;

// A push: commits on the local branch rise as packets along an arc into the remote cloud, whose branch grows and checks.
const pushWide = `<svg class="push-scene" viewBox="0 0 1000 40" focusable="false" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path opacity=".5" d="M20 32H330"/><circle class="ph-c ph-c-0" cx="60" cy="32" r="3.6" fill="var(--task-paper)"/><circle class="ph-c ph-c-1" cx="140" cy="32" r="3.6" fill="var(--task-paper)"/><circle class="ph-c ph-c-2" cx="220" cy="32" r="3.6" fill="var(--task-paper)"/><circle class="ph-c ph-c-3" cx="300" cy="32" r="3.6" fill="var(--task-paper)"/><path opacity=".22" stroke-dasharray="3 7" d="M300 32C420 32 470 8 600 8H760"/><path class="ph-arc" pathLength="100" stroke-dasharray="100" d="M300 32C420 32 470 8 600 8H760"/><g class="ph-pk ph-pk-0"><rect x="294" y="27" width="12" height="10" rx="2" fill="var(--task-paper)"/><path stroke-width="1.2" d="m297 33 3-3 3 3"/></g><g class="ph-pk ph-pk-1"><rect x="294" y="27" width="12" height="10" rx="2" fill="var(--task-paper)"/><path stroke-width="1.2" d="m297 33 3-3 3 3"/></g><g class="ph-pk ph-pk-2"><rect x="294" y="27" width="12" height="10" rx="2" fill="var(--task-paper)"/><path stroke-width="1.2" d="m297 33 3-3 3 3"/></g><path class="ph-chevrons" d="m700 3 5 5-5 5m-8-10 5 5-5 5"/><g class="ph-cloud"><path fill="var(--task-paper)" d="M790 30a10 10 0 0 1 3-19 15 15 0 0 1 28 2 9 9 0 0 1 3 17z"/></g><circle class="ph-ring" cx="808" cy="20" r="14"/><path opacity=".22" d="M840 32H980"/><path class="ph-remote" pathLength="100" stroke-dasharray="100" d="M840 32H950"/><circle class="ph-tip" cx="950" cy="32" r="3.6" fill="var(--task-paper)"/><path class="ph-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="2.4" pathLength="10" stroke-dasharray="10" d="m802 20 4 4 7-8"/></g></svg>`;

// An MCP server being fetched and started: a package travels from the registry along the line into the server node.
const installWide = `<svg viewBox="0 0 1000 100" focusable="false" aria-hidden="true"><g class="install-process" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path opacity=".22" d="M95 60H965"/><g opacity=".45"><circle cx="965" cy="60" r="5"/></g><g fill="var(--task-paper)"><path d="M40 52a18 18 0 0 1 8-33 24 24 0 0 1 44 6 15 15 0 0 1 3 29z"/><path opacity=".6" d="M55 40h28M55 47h18"/></g><path class="install-wide-line" d="M95 60H800"/><g class="install-wide-box" fill="var(--task-paper)"><path d="M100 48l16-8 16 8v18l-16 8-16-8z"/><path opacity=".65" d="M100 48l16 8 16-8M116 56v18"/></g><g class="install-wide-packet"><path d="m140 52 8 8-8 8m-10-16 8 8-8 8"/></g><circle class="install-wide-ring" cx="830" cy="60" r="24"/><g fill="var(--task-paper)"><rect class="install-wide-node" x="812" y="40" width="36" height="40" rx="4"/></g><path opacity=".65" d="M820 50h20M820 58h20M820 66h12"/><path class="install-wide-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="3" d="m864 40 6 6 11-13"/></g></svg>`;

function html(kind, wide = false) {
  if (kind === "install") return `<span class="vertex-task-visual task-install task-commit-wide" aria-hidden="true">${installWide}</span>`;
  // The wide review is the generation strip: the commit strip's host set to its generate operation.
  if (kind === "review" && wide) return `<span class="task-wide-host" data-operation="generate"><span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${commitWide}${reviewWide}</span></span>`;
  if (kind === "pr") return `<span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${prWide}</span>`;
  if (kind === "push") return `<span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${pushWide}</span>`;
  if (kind === "commit" && wide) return `<span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${commitWide}${reviewWide}</span>`;
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
.install-wide-box{animation:vertex-install-wide-box 5.4s ease-in-out infinite}
.install-wide-packet{animation:vertex-install-wide-packet 5.4s ease-in-out infinite}
.install-wide-line{animation:vertex-install-wide-line 5.4s ease-in-out infinite}
.install-wide-ring{transform-origin:830px 60px;animation:vertex-install-wide-ring 5.4s ease-out infinite}
.install-wide-check{animation:vertex-install-wide-check 5.4s ease-in-out infinite}
@keyframes vertex-install-wide-box{0%,8%{transform:translateX(0);opacity:.35}18%{opacity:1}68%,80%{transform:translateX(690px);opacity:1}90%,100%{transform:translateX(690px);opacity:0}}
@keyframes vertex-install-wide-packet{0%,15%{transform:translateX(0);opacity:0}25%{opacity:1}66%{transform:translateX(640px);opacity:1}76%,100%{transform:translateX(640px);opacity:0}}
@keyframes vertex-install-wide-line{0%,20%,100%{opacity:.15}45%,70%{opacity:.8}}
@keyframes vertex-install-wide-ring{0%,60%{transform:scale(.7);opacity:0}72%{transform:scale(1);opacity:.7}95%,100%{transform:scale(1.5);opacity:0}}
@keyframes vertex-install-wide-check{0%,70%,100%{opacity:0}80%,92%{opacity:1}}
body.vscode-reduce-motion .vertex-task-visual *{animation:none!important}
@media(prefers-reduced-motion:reduce){.vertex-task-visual *{animation:none!important}}
`;
const api = { html, css };
if (typeof module !== "undefined" && module.exports) module.exports = api; else window.vertexTaskVisual = api;
})();
