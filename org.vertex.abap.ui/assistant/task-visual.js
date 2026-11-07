"use strict";

// Small vector scenes: transform/opacity animation only, no timers, filters or remote assets.
const review = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g class="task-paper" fill="var(--task-paper)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M13 9h24l9 9v32H13z"/><path d="M20 14h23l8 8v34H20z"/><path opacity=".55" d="M25 24h17M25 30h17M25 36h11M25 43h15"/></g><g class="review-lens" fill="var(--task-paper)" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="35" cy="32" r="11" fill-opacity=".88"/><path d="m43 40 10 10"/><path class="review-scan" opacity=".55" stroke-width="1.5" d="M29 30h12M29 34h8"/></g></svg>`;
const commit = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g fill="var(--task-paper)" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M12 10v45"/><circle opacity=".65" cx="12" cy="13" r="3"/><circle opacity=".65" cx="12" cy="54" r="3"/><g class="commit-stack"><path class="commit-sheet-back" opacity=".35" d="M19 15h26v35H19z"/><path class="commit-sheet-middle" opacity=".6" d="M23 11h26v35H23z"/><path d="M27 7h23l7 7v29H27z"/><path opacity=".5" d="M33 17h16M33 23h16M33 29h8"/></g><path class="commit-link" d="M12 39h15"/><circle class="commit-node" cx="12" cy="39" r="4.7"/><path class="commit-check" fill="none" stroke-width="2.5" d="m39 36 4 4 9-10"/></g></svg>`;

function html(kind) {
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
body.vscode-reduce-motion .vertex-task-visual *{animation:none!important}
@media(prefers-reduced-motion:reduce){.vertex-task-visual *{animation:none!important}}
`;
module.exports = { html, css };
