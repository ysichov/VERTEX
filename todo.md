# TODO

## Declarative skill workflows

- Generalize the VSIX workflow into a reusable skill pattern. A skill declares an ordered graph of steps: questions to Jev for routing or bounded decisions, local scripts for deterministic work, and questions to an LLM when synthesis or coding is needed. LLM steps may run in agent mode with tools and a required JSON result schema.
- Define typed inputs and outputs for each step, JSON schema validation, conditions and transitions, timeouts, cancellation, approvals, review gates, and logged decisions/results. Scripts receive only declared inputs; model output cannot become a shell command or file path without validation and the normal approval gate.
- Add a graphical flow editor and execution view: nodes for Jev questions, scripts, LLM/agent calls, review and approval gates; edges for conditional transitions. Show the active node, inputs, outputs, errors and replayable run history, and validate the graph before execution.
- Make post-Apply builds cancellable from chat and reflect their status in the review page. Extend tests for cancellation, malformed JSON, and invalid step transitions in the future generic executor.
