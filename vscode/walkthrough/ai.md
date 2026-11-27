# Choose the assistant

The VERTEX panel's chat answers with one of:

- **Claude Code** or **Codex** - your subscription, through the CLI installed on this computer
- **GitHub Copilot** - a model made available by the signed-in Copilot extension through VS Code
- **Anthropic, OpenAI, Mistral, Gemini, Groq, Cerebras, OpenRouter, NVIDIA or Vercel API** - with a provider-specific key kept in VS Code's secret storage

Pick the chat provider and model above the message field. The **System context** control beside them shows which request blocks are enabled. **LLM Providers** at the top lets you expand each provider's model list, use **Clear all / Select all** for its models, and add named API keys. Select the active key manually; existing single keys appear as `DEFAULT`.

With a local `.abap` file active, ask about its code directly. The chat uses the current editor text, including unsaved edits; SAP actions still require a configured system.

Select **Jev Decisions** at the top right to open the **VERTEX Jev** editor tab. Choose a decision model at the top of the form and select **Run Jev** when your questions are ready.
