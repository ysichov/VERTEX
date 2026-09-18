# VERTEX MCP in Eclipse GitHub Copilot

This connects **GitHub Copilot Chat in Eclipse** to VERTEX's standalone Node
server. It provides two read-only tools for reviews prepared in AVE:

- `sap_transport_changes` — objects and review status in a transport.
- `sap_transport_diff` — changed code and saved review blocks.

This setup was exercised with the official GitHub Copilot Eclipse plugin.
**Copilot4Eclipse by Genuitec is a different product.**

The built-in **Assistant** panel inside VERTEX Selector/Versions is separate:
it launches Codex or Claude and uses the Eclipse ADT session. For that panel,
follow [Built-in Eclipse Assistant](README.md), not this guide. The standalone
server does not expose `sap_table_layout` or apply plans in Selector.

## Prerequisites

1. Official **GitHub Copilot** plugin installed in Eclipse, signed in and working.
2. Node.js **22 or newer** installed on the same machine as Eclipse.
3. A local VERTEX checkout containing `mcp/server.js`, `mcp/sap.js` and
   `vscode/mcp.js`. Keep the checkout available: copying `server.js` alone is
   insufficient. No `npm install` is needed.
4. Network access to SAP, a SAP user with the necessary read authorizations,
   and the SDE review resource `/sap/bc/adt/vertex/review/` installed.
5. A review prepared in AVE for the transport you want to inspect.

VS Code does not need to run. This server uses its own SAP settings; it does
not inherit the ADT login or read VS Code SecretStorage.

## Configure the server

Open **Window > Preferences > GitHub Copilot > Model Context Protocol**.
Alternatively, use the tools icon beside the model selector in Copilot Chat.

In **Server Configurations**, add `vertex` under the top-level **`servers`**
object. Preserve any other server entries already configured.

```json
{
  "servers": {
    "vertex": {
      "command": "D:/soft/nodejs/node.exe",
      "args": [
        "C:/soft/GitHub/VERTEX/mcp/server.js"
      ],
      "env": {
        "VERTEX_SAP_URL": "https://sap.example.com:44300",
        "VERTEX_SAP_USER": "YOUR_SAP_USER",
        "VERTEX_SAP_PASSWORD": "YOUR_SAP_PASSWORD",
        "VERTEX_SAP_CLIENT": "100",
        "VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE": "false"
      }
    }
  }
}
```

Replace the executable path, checkout path and SAP values. Use `/` in JSON
Windows paths, or escape backslashes as `\\`. Environment values are strings.
Do not use the `mcpServers` wrapper in this Eclipse preference field: it can
be interpreted as a server named `mcpServers`, which then fails to start.

The SAP URL is the HTTP(S) origin only, without `/sap/bc/adt/`, credentials,
query parameters or a fragment. Use the scheme and port configured on your SAP
ICM; a port number alone does not prove whether it serves HTTPS.

Keep certificate verification enabled. If SAP uses a private CA, Node supports
`NODE_EXTRA_CA_CERTS` pointing to a PEM file containing the trusted CA certificates.
For a development system only, setting
`VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE` to `"true"` bypasses certificate verification.

The password in the example's `env` is stored as plain text in local preferences.
Do not commit a filled configuration or share it in screenshots. Alternatively,
omit `VERTEX_SAP_PASSWORD` from this JSON and supply it in the environment of
the process that starts Eclipse; the Node child inherits that environment.
An empty password value in `env` would override an inherited password.

Click **Apply and Close**. If tools are not refreshed, restart Eclipse.

## Verify the connection

In Copilot's MCP preferences/tool picker, choose **Agent Mode**, expand
**vertex**, and enable both tools:

```text
vertex
  sap_transport_changes
  sap_transport_diff
```

The **Ask / Agent / Plan** menu lists modes and custom agents. A connected MCP
server does not add an item there. Leave **Agent** selected and try:

```text
Review transport YOUR_TRANSPORT using the VERTEX tools.
First call sap_transport_changes, then inspect the changed objects with
sap_transport_diff. Report concrete findings in English with object and
line/block references. Do not modify files.
```

Seeing the tools confirms MCP discovery. A successful tool call is needed to
verify the SAP connection and permissions.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Failed to initialize MCP server 'mcpServers'` | Replace the outer `mcpServers` key with `servers`. Keep `vertex` inside it. |
| `Failed to initialize MCP server 'vertex'` | Check the full Node and script paths, required SAP variables, and the Copilot/Error Log details. |
| Server waits silently when launched in PowerShell | Normal for stdio: it waits for MCP input. This does not yet verify SAP access. Stop it with Ctrl+C; Copilot starts its own process. |
| Tools exist but nothing changed in the Agent menu | Expected. Tools appear in the tool picker, not the agent list. |
| `Missing environment variable ...` | Supply `VERTEX_SAP_URL`, `VERTEX_SAP_USER` and `VERTEX_SAP_PASSWORD`. |
| SAP HTTP 401 / 403 | Check credentials/client for 401 and SAP authorizations for 403. |
| SAP HTTP 404 | Check that the SDE ADT review resource is installed and active. |
| Certificate or connection error | Check SAP origin, VPN/network and CA trust; see the certificate settings above. |
| No prepared review | Prepare the transport review in AVE first. MCP only reads it. |
| Selector Assistant says the host has no assistant | Update the Eclipse VERTEX plugin and follow the separate built-in Assistant guide. Copilot MCP configuration does not enable that panel. |

For startup errors, open Eclipse's **Error Log** view and inspect the latest
GitHub Copilot / Language Server entries. Remove credentials before sharing logs.

For all standalone environment options, see [MCP server documentation](../mcp/README.md).
The official [GitHub Eclipse MCP instructions](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp?tool=eclipse)
also describe the `servers` configuration format.
