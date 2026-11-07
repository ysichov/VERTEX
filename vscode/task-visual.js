"use strict";

// Small vector scenes: transform/opacity animation only, no timers, filters or remote assets.
const review = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g class="task-paper" fill="var(--task-paper)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M13 9h24l9 9v32H13z"/><path d="M20 14h23l8 8v34H20z"/><path opacity=".55" d="M25 24h17M25 30h17M25 36h11M25 43h15"/></g><g class="review-lens" fill="var(--task-paper)" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="35" cy="32" r="11" fill-opacity=".88"/><path d="m43 40 10 10"/><path class="review-scan" opacity=".55" stroke-width="1.5" d="M29 30h12M29 34h8"/></g></svg>`;
const commit = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g fill="var(--task-paper)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path class="commit-sheets" opacity=".4" d="M11 14h28v36H11zM15 10h28v36H15z"/><path d="M21 14h24l7 7v34H21z"/><g class="commit-lines" opacity=".65"><path d="M27 24h17M27 30h17M27 36h10"/></g><path opacity=".6" d="M9 43h9M9 43v10h14"/><circle cx="9" cy="43" r="2.3"/><circle cx="23" cy="53" r="2.3"/></g><g class="commit-seal" fill="var(--task-paper)" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="46" cy="47" r="11"/><path class="commit-check" d="m40.5 47 3.5 3.5 7-7.5"/></g></svg>`;
function html(kind) {
  return `<span class="vertex-task-visual task-${kind === "commit" ? "commit" : "review"}" aria-hidden="true">${kind === "commit" ? commit : review}</span>`;
}
const css = `
.vertex-task-visual{--task-paper:var(--vscode-editor-background,Canvas);display:inline-flex;flex:none;width:44px;height:44px;color:var(--vscode-focusBorder,var(--vscode-textLink-foreground,Highlight));vertical-align:middle;pointer-events:none}
.vertex-task-visual svg{display:block;width:100%;height:100%;overflow:visible}
.vertex-task-visual .review-lens{animation:vertex-review-lens 2.8s ease-in-out infinite}
.vertex-task-visual .review-scan{animation:vertex-review-scan 2.8s ease-in-out infinite}
.vertex-task-visual .commit-sheets{animation:vertex-commit-sheets 3.2s ease-in-out infinite}
.vertex-task-visual .commit-lines{transform-origin:27px 30px;animation:vertex-commit-lines 3.2s ease-in-out infinite}
.vertex-task-visual .commit-seal{animation:vertex-commit-seal 3.2s ease-in-out infinite}
.vertex-task-visual .commit-check{color:var(--vscode-testing-iconPassed,var(--vscode-focusBorder,Highlight));animation:vertex-commit-check 3.2s ease-in-out infinite}
@keyframes vertex-review-lens{0%,100%{transform:translate(-3px,2px)}50%{transform:translate(4px,-3px)}}
@keyframes vertex-review-scan{0%,100%{opacity:.3}50%{opacity:.9}}
@keyframes vertex-commit-sheets{0%,100%{transform:translate(-3px,1px);opacity:.25}35%,75%{transform:translate(0,0);opacity:.6}}
@keyframes vertex-commit-lines{0%,15%{transform:scaleX(.2);opacity:.2}45%,100%{transform:scaleX(1);opacity:.65}}
@keyframes vertex-commit-seal{0%,25%{transform:translateY(-5px);opacity:.15}50%,85%{transform:translateY(0);opacity:1}100%{transform:translateY(-5px);opacity:.15}}
@keyframes vertex-commit-check{0%,40%{opacity:0}55%,90%{opacity:1}100%{opacity:0}}
body.vscode-reduce-motion .vertex-task-visual *{animation:none!important}
@media(prefers-reduced-motion:reduce){.vertex-task-visual *{animation:none!important}}
`;
module.exports = { html, css };
