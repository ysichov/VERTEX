"""Configure this workstation's Codex and Claude MCP without storing a SAP password."""
from pathlib import Path
from datetime import datetime
import json
import re
import shutil
import tomllib


def main():
    home = Path.home()
    codex = home / '.codex/config.toml'
    claude = home / '.claude.json'
    script = str(Path(__file__).resolve().with_name('server.js'))
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node.js is not installed')
    settings = json.loads((home / 'AppData/Roaming/Code/User/settings.json').read_text(encoding='utf-8'))
    systems = settings.get('vertex.systems', [])
    active = settings.get('vertex.active')
    system = next((s for s in systems if s['name'] == active), None) if active else systems[0]
    if not system:
        raise RuntimeError('No active VERTEX SAP system')
    env = {
        'VERTEX_SAP_URL': system['url'],
        'VERTEX_SAP_USER': system['user'],
        'VERTEX_SAP_CLIENT': str(system.get('client', '')),
        'VERTEX_SAP_PASSWORD': '',
        'VERTEX_SAP_ALLOW_INSECURE_CERTIFICATE': str(system.get('allowInsecureCertificate') is True).lower(),
    }
    original = codex.read_text(encoding='utf-8') if codex.exists() else ''
    parsed = tomllib.loads(original)
    previous = parsed.get('mcp_servers', {}).get('vertex', {})
    if previous.get('env', {}).get('VERTEX_SAP_PASSWORD'):
        raise RuntimeError('Existing Codex SAP password: refusing to overwrite')
    # Remove only the vertex table and its subtables, keeping all other settings.
    chunks = re.split(r'(?m)^(?=\s*\[)', original)
    kept = []
    for chunk in chunks:
        header = re.match(r'\s*\[([^\]\n]+)\]', chunk)
        if header:
            key = header.group(1).replace('"', '').replace("'", '').replace(' ', '')
            if key == 'mcp_servers.vertex' or key.startswith('mcp_servers.vertex.'):
                continue
        kept.append(chunk)
    section = '\n[mcp_servers.vertex]\ncommand = ' + json.dumps(node) + '\nargs = ' + json.dumps([script])
    section += '\n\n[mcp_servers.vertex.env]\n'
    section += '\n'.join(k + ' = ' + json.dumps(v) for k, v in env.items()) + '\n'
    updated = ''.join(kept).rstrip() + '\n' + section
    expected = dict(parsed)
    expected['mcp_servers'] = dict(parsed.get('mcp_servers', {}))
    expected['mcp_servers']['vertex'] = {'command': node, 'args': [script], 'env': env}
    assert tomllib.loads(updated) == expected, 'Unrelated Codex configuration changed'
    old_claude = json.loads(claude.read_text(encoding='utf-8')) if claude.exists() else {}
    if 'vertex' in old_claude.get('mcpServers', {}):
        raise RuntimeError('Claude vertex already exists: refusing to overwrite')
    new_claude = json.loads(json.dumps(old_claude))
    new_claude.setdefault('mcpServers', {})['vertex'] = {
        'type': 'stdio', 'command': node, 'args': [script], 'env': env}
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    for target in (codex, claude):
        if target.exists():
            shutil.copy2(target, target.with_name(target.name + '.vertex-backup-' + stamp))
    codex.parent.mkdir(parents=True, exist_ok=True)
    codex.write_text(updated, encoding='utf-8')
    claude.write_text(json.dumps(new_claude, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert tomllib.loads(codex.read_text(encoding='utf-8')) == expected
    assert json.loads(claude.read_text(encoding='utf-8')) == new_claude
    print('Configured Codex and Claude Code for standalone VERTEX; passwords are empty.')
    print('Backups created. Other MCP servers and VS Code settings preserved.')


if __name__ == '__main__':
    main()
