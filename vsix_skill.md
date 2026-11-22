# Build the VERTEX VSIX

Use this skill only when the current user request clearly instructs VERTEX to build or rebuild this repository's VS Code extension now, including short commands such as “пересобери”, “собери всикс”, a standalone “vsix”, or “VSIX +1”. A version number may select the build version only after an execution request is clear. Questions about whether or when a build is possible or permitted are not build requests: for example, “я сделал апрув — можно собирать?” asks whether it is okay to build; answer the question without starting the workflow. The current request is authoritative. This skill does not apply when the user asks only to discuss a build, explicitly says not to build, or requests the Eclipse update site alone.

1. Jev chooses between building the current version and incrementing the patch before building. An explicit `major.minor.patch` in the request takes precedence. VERTEX executes the choice with `vscode/vsix-workflow.js`; the selected assistant is not called for this workflow.
2. For an unchanged version, VERTEX runs the wrapper in the real repository through its Bash tool and normal command approval. For a version change, VERTEX calculates and stages the edits listed in `vsix-version.md` in the review copy. The user reviews and applies the diff; only after all files are applied does VERTEX run the wrapper in the real repository.
3. VERTEX checks the wrapper's exit code and its `Verified VSIX:` artifact before reporting success. A failed or cancelled build does not count as a built VSIX. Do not invoke `vsce` directly.

The executor uses the current request and the repository's version files. Previous chat prompts are excluded from the skill match; the normal conversation remains available after the workflow.
