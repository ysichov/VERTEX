"use strict";

// Small vector scenes: transform/opacity animation only, no timers, filters or remote assets.
const review = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g class="task-paper" fill="var(--task-paper)" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M13 9h24l9 9v32H13z"/><path d="M20 14h23l8 8v34H20z"/><path opacity=".55" d="M25 24h17M25 30h17M25 36h11M25 43h15"/></g><g class="review-lens" fill="var(--task-paper)" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="35" cy="32" r="11" fill-opacity=".88"/><path d="m43 40 10 10"/><path class="review-scan" opacity=".55" stroke-width="1.5" d="M29 30h12M29 34h8"/></g></svg>`;
const commit = `<svg viewBox="0 0 64 64" focusable="false" aria-hidden="true"><g fill="var(--task-paper)" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path opacity=".45" d="M12 10v45"/><circle opacity=".65" cx="12" cy="13" r="3"/><circle opacity=".65" cx="12" cy="54" r="3"/><g class="commit-stack"><path class="commit-sheet-back" opacity=".35" d="M19 15h26v35H19z"/><path class="commit-sheet-middle" opacity=".6" d="M23 11h26v35H23z"/><path d="M27 7h23l7 7v29H27z"/><path opacity=".5" d="M33 17h16M33 23h16M33 29h8"/></g><path class="commit-link" d="M12 39h15"/><circle class="commit-node" cx="12" cy="39" r="4.7"/><path class="commit-check" fill="none" stroke-width="2.5" d="m39 36 4 4 9-10"/></g></svg>`;

const commitWide = `<svg viewBox="0 0 1000 100" focusable="false" aria-hidden="true"><g class="commit-process"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path opacity=".22" d="M35 72H965M125 72C225 72 225 25 325 25H570C670 25 670 72 770 72"/><g opacity=".45"><circle cx="125" cy="72" r="5"/><circle cx="325" cy="25" r="5"/><circle cx="570" cy="25" r="5"/><circle cx="965" cy="72" r="5"/></g><path class="commit-wide-branch" d="M125 72C225 72 225 25 325 25H570C670 25 670 72 770 72"/><g class="commit-wide-docs" fill="var(--task-paper)"><path opacity=".35" d="M23 27h30v40H23z"/><path opacity=".6" d="M30 21h30v40H30z"/><path d="M37 15h25l9 9v31H37z"/><path opacity=".65" d="M44 29h18M44 36h18M44 43h11"/></g><g class="commit-wide-packet"><path d="m105 64 8 8-8 8m-10-16 8 8-8 8"/></g><circle class="commit-wide-ring" cx="820" cy="72" r="21"/><circle class="commit-wide-node" fill="var(--task-paper)" cx="820" cy="72" r="15"/><path class="commit-wide-check" stroke="var(--vscode-testing-iconPassed,currentColor)" stroke-width="3" d="m812 72 6 6 11-13"/></g></g><g class="generate-process" fill="var(--task-paper)" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g class="generate-source"><rect x="18" y="5" width="205" height="25" rx="4"/><rect x="30" y="38" width="205" height="25" rx="4"/><rect x="18" y="71" width="205" height="25" rx="4"/><g class="generate-diffs" stroke-width="3"><path stroke="var(--vscode-gitDecoration-addedResourceForeground,currentColor)" d="M31 17h12m-6-6v12M56 17h145M43 50h12m-6-6v12M68 50h145"/><path stroke="var(--vscode-gitDecoration-deletedResourceForeground,currentColor)" d="M31 83h12M56 83h145"/></g></g><g class="generate-lens"><circle cx="116" cy="18" r="15" fill-opacity=".65" stroke-width="3"/><path fill="none" stroke-width="4" d="m127 29 14 14"/><path opacity=".7" stroke-width="1.3" d="M108 15h16M108 21h11"/></g><g fill="none" opacity=".25"><path d="M238 18C360 18 360 50 470 50M250 50H470M238 84C360 84 360 50 470 50M530 50H605"/></g><g class="generate-merge-top"><path d="m238 12 10 6-10 6"/></g><g class="generate-merge-middle"><path d="m250 44 10 6-10 6"/></g><g class="generate-merge-bottom"><path d="m238 78 10 6-10 6"/></g><circle class="generate-merge-node" cx="500" cy="50" r="20"/><path fill="none" opacity=".65" d="M491 43h18M491 50h18M491 57h12"/><g class="generate-flow" fill="none"><path d="m540 42 9 8-9 8m-12-16 9 8-9 8"/></g><rect x="625" y="8" width="350" height="83" rx="7"/><path class="generate-title" fill="none" stroke-width="4" d="M648 28H845"/><g fill="none" opacity=".65"><path class="generate-line-one" d="M648 45H949"/><path class="generate-line-two" d="M648 59H915"/><path class="generate-line-three" d="M648 73H865"/></g></g></svg>`;

function html(kind, wide = false) {
  if (kind === "commit" && wide) return `<span class="vertex-task-visual task-commit task-commit-wide" aria-hidden="true">${commitWide}</span>`;
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
.generate-process{display:none}
[data-operation="generate"] .commit-process{display:none}
[data-operation="generate"] .generate-process{display:inline}
.generate-lens{animation:vertex-generate-inspect 4.8s ease-in-out infinite}
.generate-merge-top{animation:vertex-generate-merge-top 4.8s ease-in-out infinite}
.generate-merge-middle{animation:vertex-generate-merge-middle 4.8s ease-in-out infinite}
.generate-merge-bottom{animation:vertex-generate-merge-bottom 4.8s ease-in-out infinite}
.generate-merge-node{animation:vertex-generate-merge-node 4.8s ease-in-out infinite}
@keyframes vertex-generate-inspect{0%,100%{transform:translate(0,0);opacity:.4}10%{transform:translate(55px,0);opacity:1}20%{transform:translate(0,32px);opacity:1}30%{transform:translate(55px,65px);opacity:1}42%,92%{transform:translate(0,65px);opacity:.2}}
@keyframes vertex-generate-merge-top{0%,28%,100%{transform:translate(0,0);opacity:0}36%{opacity:1}54%{transform:translate(234px,32px);opacity:1}62%,95%{transform:translate(234px,32px);opacity:0}}
@keyframes vertex-generate-merge-middle{0%,30%,100%{transform:translateX(0);opacity:0}38%{opacity:1}54%{transform:translateX(222px);opacity:1}62%,95%{transform:translateX(222px);opacity:0}}
@keyframes vertex-generate-merge-bottom{0%,32%,100%{transform:translate(0,0);opacity:0}40%{opacity:1}54%{transform:translate(234px,-34px);opacity:1}62%,95%{transform:translate(234px,-34px);opacity:0}}
@keyframes vertex-generate-merge-node{0%,40%,100%{opacity:.25}56%,90%{opacity:1}}
.generate-flow{animation:vertex-generate-flow 4.8s ease-in-out infinite}
.generate-title{animation:vertex-generate-title 4.8s ease-in-out infinite}
.generate-line-one{animation:vertex-generate-line-one 4.8s ease-in-out infinite}
.generate-line-two{animation:vertex-generate-line-two 4.8s ease-in-out infinite}
.generate-line-three{animation:vertex-generate-line-three 4.8s ease-in-out infinite}
@keyframes vertex-generate-flow{0%,54%{transform:translateX(0);opacity:0}62%{opacity:1}72%{transform:translateX(62px);opacity:1}82%,100%{transform:translateX(62px);opacity:0}}
@keyframes vertex-generate-title{0%,30%,100%{opacity:.15}42%,90%{opacity:1}}
@keyframes vertex-generate-line-one{0%,42%,100%{opacity:.1}54%,90%{opacity:1}}
@keyframes vertex-generate-line-two{0%,54%,100%{opacity:.1}66%,90%{opacity:1}}
@keyframes vertex-generate-line-three{0%,66%,100%{opacity:.1}78%,90%{opacity:1}}
.commit-wide-docs{animation:vertex-commit-wide-docs 5.4s ease-in-out infinite}
.commit-wide-packet{animation:vertex-commit-wide-packet 5.4s ease-in-out infinite}
.commit-wide-branch{animation:vertex-commit-wide-branch 5.4s ease-in-out infinite}
.commit-wide-ring{transform-origin:820px 72px;animation:vertex-commit-wide-ring 5.4s ease-out infinite}
.commit-wide-check{animation:vertex-commit-wide-check 5.4s ease-in-out infinite}
@keyframes vertex-commit-wide-docs{0%,8%{transform:translateX(0);opacity:.35}18%{opacity:1}68%,85%{transform:translateX(730px);opacity:1}95%,100%{transform:translateX(730px);opacity:0}}
@keyframes vertex-commit-wide-packet{0%,15%{transform:translateX(0);opacity:0}25%{opacity:1}70%{transform:translateX(690px);opacity:1}80%,100%{transform:translateX(690px);opacity:0}}
@keyframes vertex-commit-wide-branch{0%,20%,100%{opacity:.15}45%,70%{opacity:.8}}
@keyframes vertex-commit-wide-ring{0%,60%{transform:scale(.7);opacity:0}72%{transform:scale(1);opacity:.7}95%,100%{transform:scale(1.5);opacity:0}}
@keyframes vertex-commit-wide-check{0%,68%,100%{opacity:0}78%,92%{opacity:1}}
body.vscode-reduce-motion .vertex-task-visual *{animation:none!important}
@media(prefers-reduced-motion:reduce){.vertex-task-visual *{animation:none!important}}
`;
module.exports = { html, css };
