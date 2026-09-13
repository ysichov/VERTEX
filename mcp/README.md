# VERTEX MCP without VS Code

## Experimental: ChatGPT and Claude web

This is development work only and is not a supported or tested integration.
The tested integrations are GitHub Copilot in VS Code, Claude Code, and Codex in VS Code.
Claude web, ChatGPT web, Claude Desktop, and other MCP clients may not work.

The web chats cannot connect to a local `127.0.0.1` or stdio server. For them,
run the HTTP host below and publish it through Secure MCP Tunnel or another
trusted HTTPS reverse proxy. The public URL must point to `/mcp` and preserve
the `Authorization: Bearer <token>` header.

```powershell
$env:VERTEX_MCP_TOKEN = 'generate-a-long-random-token'
$env:VERTEX_MCP_HOST = '127.0.0.1'
$env:VERTEX_MCP_PORT = '37777'
node mcp/http-server.js
```

Do not expose the port directly to the internet. Put TLS and access control in
the tunnel/proxy, then register the resulting HTTPS `/mcp` URL in ChatGPT or
Claude's connector settings. The server remains read-only and exposes only the
two transport-review tools.

Claude Code, Codex, or another MCP client launches `server.js` as a child process
and communicates over stdio. The process reads SAP directly over HTTP(S), using
the same `sap_transport_changes` and `sap_transport_diff` implementations as the
VS Code extension. VS Code can be closed. No Node packages need installing;
use Node.js 22 or newer and keep this repository checkout available.

With VS Code open, the extension serves the same tools itself, and Copilot finds
them without any setup: see
[the extension's README](../vscode/README.md#review-transports-with-copilot-claude-code-or-codex).
The **Assistant** panels in SelecTor and Versions need no MCP setup at all.

```text
Claude Code / Codex / MCP client
             | stdio (client starts the process)
             v
       VERTEX mcp/server.js
             | HTTPS + SAP credentials
             v
 /sap/bc/adt/zsde/review/<transport>
             |
       AVE prepared review
```

## SAP connection

Set these environment variables for the assistant process. The MCP child inherits
them. For desktop apps, restart the app after configuring its environment. Claude
Desktop is the exception: it takes them from its own configuration file, see
[the experimental Claude Desktop section below].

| Variable | Meaning |
|---|---|
| `VERTEX_SAP_URL` | SAP ICM origin, e.g. `https://sap.example.com:44300` |
| `VERTEX_SAP_USER` | SAP login |
| `VERTEX_SAP_PASSWORD` | SAP password |
| `VERTEX_SAP_CLIENT` | Optional SAP client, e.g. `100` |
| `VERTEX_SAP_TIMEOUT_MS` | Request deadline, default `30000` |
| `VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE` | Default `false`; `true` accepts an unverified SAP certificate |

Credentials are separate from VS Code SecretStorage. The standalone process does
not read VS Code secrets and never writes credentials to disk. Use a trusted CA
(including Node's `NODE_EXTRA_CA_CERTS` setting) for private SAP certificates.
HTTP is supported for systems that require it; HTTPS protects the SAP credentials.

Example for a PowerShell terminal, without putting the password into command history:

```powershell
$env:VERTEX_SAP_URL = 'https://sap.example.com:44300'
$env:VERTEX_SAP_USER = 'DEVELOPER'
$env:VERTEX_SAP_CLIENT = '100'
$vertexCredential = Get-Credential -UserName $env:VERTEX_SAP_USER -Message 'SAP login for VERTEX'
$env:VERTEX_SAP_PASSWORD = $vertexCredential.GetNetworkCredential().Password
```

Start the assistant from that terminal. Keep passwords out of repository files.
One MCP registration targets one SAP system. For multiple systems, register
separate server names with their respective environments.

## Both at once from the VERTEX settings (Windows)

```powershell
python mcp/configure-local.py
```

It takes the SAP system VERTEX already knows — `vertex.systems` and
`vertex.active` in VS Code's user settings — and writes both registrations for
this server:

- in `~/.codex/config.toml`, a `[mcp_servers.vertex]` section with that system
  in `[mcp_servers.vertex.env]`, replacing the old one and keeping every other
  section; it refuses to replace a section that already holds a password;
- in `~/.claude.json`, a `vertex` stdio server with the same environment; it
  refuses when `vertex` is there already, so run
  `claude mcp remove vertex --scope user` first;
- before writing, a copy of each file as `*.vertex-backup-<time>`.

It never writes a password. `VERTEX_SAP_PASSWORD` is left empty in both files and
the server does not start until you fill it in — as plain text, like everything
in `env`. It needs Node on the path and Python 3.11 or newer.

## Codex

Replace the previous HTTP registration by editing its existing section in
`~/.codex/config.toml`. Remove its old `url` and `http_headers` fields:

```toml
[mcp_servers.vertex]
command = "node"
args = ["C:/soft/GitHub/VERTEX/mcp/server.js"]
env_vars = ["VERTEX_SAP_URL", "VERTEX_SAP_USER", "VERTEX_SAP_PASSWORD", "VERTEX_SAP_CLIENT", "VERTEX_SAP_TIMEOUT_MS", "VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE", "NODE_EXTRA_CA_CERTS"]
```

Adjust the absolute path for your checkout. Restart Codex and use `/mcp` to check
that `vertex` offers its two tools. This is a local MCP process, not a remotely
hosted service. The assistant must run on a machine with Node and SAP access.

## Claude Code

From the terminal with the SAP environment configured:

```powershell
# Only if replacing the earlier user-scoped HTTP registration:
claude mcp remove vertex --scope user
claude mcp add --transport stdio --scope user vertex -- node C:/soft/GitHub/VERTEX/mcp/server.js
claude mcp list
claude
```

Start a new conversation after changing the registration. Other MCP clients,
including Copilot, can use the same command and arguments as a stdio server.
The existing VS Code-hosted HTTP mode continues to work independently.

## Experimental: Claude Desktop (chat)

The chat in Claude Desktop is a separate client: a server registered with
`claude mcp add` is not visible there. Claude Desktop reads its own file,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows and
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS;
**Settings → Developer → Edit Config** opens it.

```json
{
  "mcpServers": {
    "vertex": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": ["C:/soft/GitHub/VERTEX/mcp/server.js"],
      "env": {
        "VERTEX_SAP_URL": "https://sap.example.com:44300",
        "VERTEX_SAP_USER": "DEVELOPER",
        "VERTEX_SAP_PASSWORD": "",
        "VERTEX_SAP_CLIENT": "100"
      }
    }
  }
}
```

If the file already has `mcpServers`, add `vertex` inside it rather than a second
`mcpServers`. Use absolute paths; `where node` prints Node's. The variables go into
`env` because the app is not started from a terminal, so nothing set in one reaches
it — which also means the SAP password is stored in this file in plain text. Add
`"VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE": "true"` only for a development system whose
certificate cannot be verified.

Quit Claude Desktop completely, not just its window, and start it again. `vertex`
then appears under **Connectors** in the menu at the bottom left of the chat input.
If it does not, `%APPDATA%\Claude\logs\mcp-server-vertex.log` holds what the server
wrote to stderr.

## What to ask

“Review transport DEVK900123 using the VERTEX SAP tools.”

The SAP SDE ADT resources and AVE must already be installed. A review must first
be prepared in AVE. These tools read saved reviews; they do not generate a review,
approve blocks, or write SAP data. Missing reviews and backend failures are
reported as errors, not as a clean transport.

## Verification

```powershell
node mcp/server.js --help
node --test mcp/test/*.test.js vscode/test/*.test.js
```

The integration tests launch the real standalone process against a local fake SAP
endpoint and check stdio, authentication, client selection, diffs and failures.
They do not require SAP credentials or a running editor.
