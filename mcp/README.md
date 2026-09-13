# VERTEX MCP without VS Code

Claude Code, Codex, or another MCP client launches `server.js` as a child process
and communicates over stdio. The process reads SAP directly over HTTP(S), using
the same `sap_transport_changes` and `sap_transport_diff` implementations as the
VS Code extension. VS Code can be closed. No Node packages need installing;
use Node.js 22 or newer and keep this repository checkout available.

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
them. For desktop apps, restart the app after configuring its environment.

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

## What to ask

“Review transport ALCK900593 using the VERTEX SAP tools.”

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
