<#
Build a releasable VSIX. Do not call vsce with --no-dependencies: that switch
produces an extension which installs but cannot load abap-adt-api.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$final = Join-Path $root ($manifest.name + '-' + $manifest.version + '.vsix')
$candidate = Join-Path $root ($manifest.name + '-' + $manifest.version + '.candidate.vsix')

Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
Push-Location $root
try {
    & npx --yes @vscode/vsce package --out $candidate
    if ($LASTEXITCODE -ne 0) { throw 'VSCE packaging failed.' }
    $archive = [IO.Compression.ZipFile]::OpenRead($candidate)
    try {
        $required = @('extension/package.json', 'extension/node_modules/abap-adt-api/package.json',
            'extension/resources/metrics.html', 'extension/resources/source.html', 'extension/resources/versions.html', 'extension/pages/visual-debug.html')
        foreach ($name in $required) { if (!$archive.GetEntry($name)) { throw "VSIX verification failed: missing $name" } }
        # Opening a ZIP only validates its central directory. Read each entry
        # now, before promotion, so a truncated compressed stream can never
        # be installed as the release VSIX.
        $buffer = New-Object byte[] 65536
        foreach ($entry in $archive.Entries) {
            $stream = $entry.Open()
            try {
                while ($stream.Read($buffer, 0, $buffer.Length) -gt 0) { }
            } finally { $stream.Dispose() }
        }
        $reader = [IO.StreamReader]::new($archive.GetEntry('extension/resources/metrics.html').Open())
        try { $metrics = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $testPage = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.html')
        $previousPage = $env:VERTEX_METRICS_HTML
        try {
            [IO.File]::WriteAllText($testPage, $metrics)
            $env:VERTEX_METRICS_HTML = $testPage
            & node --test (Join-Path $root 'test/scheme-navigation.test.js')
            if ($LASTEXITCODE -ne 0) { throw 'Packaged Scheme navigation test failed.' }
        } finally {
            $env:VERTEX_METRICS_HTML = $previousPage
            Remove-Item -LiteralPath $testPage -Force -ErrorAction SilentlyContinue
        }
        foreach ($needle in @('function renderUmlParts()', 'var UML_SECTIONS', 'mode === "scheme" && classMetrics()')) {
            if (!$metrics.Contains($needle)) { throw "VSIX verification failed: UML Parts navigator is missing $needle" }
        }
        $reader = [IO.StreamReader]::new($archive.GetEntry('extension/package.json').Open())
        try { $inside = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($inside.version -ne $manifest.version) { throw "VSIX verification failed: expected version $($manifest.version), got $($inside.version)." }
    } finally { $archive.Dispose() }
    Move-Item -LiteralPath $candidate -Destination $final -Force
    Write-Output "Verified VSIX: $final"
} finally {
    Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue
    Pop-Location
}
