# ACE frontend parity audit

Source comparison, 2026-10-06. This is an ongoing audit, not a claim of complete parity.

| Area | ACE reference | Frontend status |
|---|---|---|
| Call depth | `zcl_vx_ace_source_parser`, `code_execution_scanner`, `parse_call`: increment and check before parsing | Event/routine is level 1; every entered call adds 1. Boundary sources are not fetched. Covered by depth fixtures. |
| Metrics keyword classification | `zcl_vx_ace_keywords`: statement and expression grammar; split phrases | Corrected to traverse both abaplint matcher groups. Previously used statement class names. |
| Metrics unit boundaries | `zcl_vx_ace_metrics`: opening through closing statement | Corrected to include routine header and closer; event excludes next unit. |
| Metrics token stream | SAP scanner, synthetic COMPUTE, inline declaration normalization | Still differs from expanded frontend tokens. Exact Halstead/MI parity is not established. |
| Calls diagram | `zcl_vx_ace_flow=>build_steps_flow`: ordered stack, typed styles, rounded nodes, node map, bindings | Corrected names, rounded nodes, all six ACE colours and removal of synthetic root. Removed depth recalculation after class aggregation. Source navigation, parameter bindings and ordered scanner equivalence still require comparison. |
| Dispatch | ACE class/interface, function, screen and include resolution | Static method, FORM and literal function calls supported. Shared Value Origin enumeration now handles NEW receivers, assignment and nested argument calls. Dynamic dispatch and screens require further comparison. |
| Logic diagram | `zcl_vx_ace_code_html`: analyze/build_scheme/ops_node/flush_pending | Source-based port exists; block fixtures pass. SAP scanner structure equivalence is not fully established. |
| UML | `zcl_vx_ace_uml` | Corrected dependency scope to attributes/method declarations, excluded self/OBJECT, sorted methods, and limited class response to the requested object. Empty routines retained. Target existence checks against SAP SEOCLASS remain unverified. |
| BSE/debugger | ACE origin and execution path contracts | Requires captured ACE results for all three trees and runtime debugger scenarios. Current unit tests alone cannot establish parity. |

Regression fixtures must assert ACE behavior independently of the frontend implementation. Live SAP comparison remains necessary for scanner tokenization and dynamic target resolution.

## Full local verification

Final complete VS Code suite passed: 366 tests, zero failures, zero skipped, including the light/dark palette test. Syntax checks passed for ten changed runtime modules; git diff whitespace checks passed. The rebuilt 0.8.1 archive was read fully and its packaged Scheme navigation test passed. Both bundled libraries were verified: abap-adt-api 8.4.3 and @abaplint/core 2.120.68. Packaged FLOW parameter support was verified directly in the archive.

## Unified call engine

Subsequent complete suite: 374 tests passed, zero failures. `vscode/call-graph.js` is the common call enumeration, target resolution and traversal adapter. Calls uses it for depth-bounded source loading; Visual Debug uses its walker for breakpoint ranges; Value Origin uses its resolution for callSites. The shared resolver remains in value-origin-model, including inferred reference types and interface implementations. The separate Calls owner heuristic and debugger method-name fallback were removed. Rendering and entry selection are view-specific adapters. Static resolution still cannot certify runtime dispatch or full ACE scanner parity.

Confirmed fixes during this run:

- Shared FLOW now carries the parameter transfers already computed by BSE; repeated identical transfers at one call site are deduplicated.
- Empty routines are retained as metric units and call leaves.
- UML reference scope, self-reference exclusion, method ordering and requested-class filtering follow ACE source.
- Test adapters now supply source-backed codeFlow and current DOM/DI contracts. Existing Formula assertions remain exercised.

Passing local tests does **not** establish complete equivalence to ACE on a live SAP system. Outstanding scanner, dispatch and ordered-call contracts above remain explicit gaps; the local audit must not be presented as a live SAP certification.
