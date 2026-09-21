param(
    [Parameter(Mandatory=$true)][string]$Javac,
    [Parameter(Mandatory=$true)][string]$BundlePool
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path $PSScriptRoot -Parent
$project = Join-Path $root 'org.vertex.abap.ui'
$baseVersion = '0.6.2'
$version = $baseVersion + '.' + (Get-Date -Format 'yyyyMMddHHmmss')
$out = Join-Path $root ('target/eclipse-' + $version)
$classes = Join-Path $out 'classes'
$site = Join-Path $out 'site'
New-Item -ItemType Directory -Path $classes,(Join-Path $site 'plugins'),(Join-Path $site 'features') -Force | Out-Null
& node (Join-Path $PSScriptRoot 'prepare.js')
if ($LASTEXITCODE -ne 0) { throw 'Assistant preparation failed.' }
$sources = @(Get-ChildItem (Join-Path $project 'src') -Recurse -Filter '*.java' | ForEach-Object FullName)
& $Javac --release 21 -encoding UTF-8 -cp (Join-Path $BundlePool '*') -d $classes @sources
if ($LASTEXITCODE -ne 0) { throw 'Java compilation failed.' }

function Read-ZipText([string]$file, [string]$entry) {
    $zip = [IO.Compression.ZipFile]::OpenRead($file)
    try { $reader = [IO.StreamReader]::new($zip.GetEntry($entry).Open()); try { return $reader.ReadToEnd() } finally { $reader.Dispose() } }
    finally { $zip.Dispose() }
}
function Add-Text($zip, [string]$name, [string]$text) {
    $entry = $zip.CreateEntry($name)
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($text) } finally { $writer.Dispose() }
}
function Add-Files($zip, [string]$directory, [string]$prefix) {
    foreach ($file in Get-ChildItem -LiteralPath $directory -File -Recurse) {
        $name = $prefix + $file.FullName.Substring($directory.Length + 1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $name) | Out-Null
    }
}
$content = Read-ZipText (Join-Path $root 'docs/content.jar') 'content.xml'
[xml]$metadata = $content
$old = ($metadata.repository.units.unit | Where-Object { $_.id -eq 'org.vertex.abap.ui' } | Select-Object -First 1).version
if (!$old) { throw 'Expected a PDE-exported repository in docs/ as the packaging template.' }
$content = $content.Replace($old, $version)
$content = [regex]::Replace($content, "(name='p2.timestamp' value=')[0-9]+", ('${1}' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()))

$binary = Join-Path $site ('plugins/org.vertex.abap.ui_' + $version + '.jar')
$zip = [IO.Compression.ZipFile]::Open($binary, 'Create')
try {
    $manifest = [IO.File]::ReadAllText((Join-Path $project 'META-INF/MANIFEST.MF')).Replace($baseVersion + '.qualifier', $version)
    Add-Text $zip 'META-INF/MANIFEST.MF' ($manifest.TrimEnd() + "`r`n`r`n")
    Add-Text $zip 'plugin.xml' ([IO.File]::ReadAllText((Join-Path $project 'plugin.xml')))
    Add-Files $zip $classes ''
    Add-Files $zip (Join-Path $project 'resources') 'resources/'
    Add-Files $zip (Join-Path $project 'assistant') 'assistant/'
} finally { $zip.Dispose() }

# Preserve PDE-generated feature and source manifests and update exact versions.
foreach ($item in @(
    @{ Folder='features'; Id='org.vertex.abap.feature' },
    @{ Folder='features'; Id='org.vertex.abap.feature.source' },
    @{ Folder='plugins'; Id='org.vertex.abap.ui.source' }
)) {
    $template = Join-Path $root ('docs/' + $item.Folder + '/' + $item.Id + '_' + $old + '.jar')
    $target = Join-Path $site ($item.Folder + '/' + $item.Id + '_' + $version + '.jar')
    $inputZip = [IO.Compression.ZipFile]::OpenRead($template)
    $outputZip = [IO.Compression.ZipFile]::Open($target, 'Create')
    try {
        foreach ($entry in $inputZip.Entries) {
            if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('.java')) { continue }
            $reader = [IO.StreamReader]::new($entry.Open())
            try { Add-Text $outputZip $entry.FullName ($reader.ReadToEnd().Replace($old, $version)) }
            finally { $reader.Dispose() }
        }
        if ($item.Id -eq 'org.vertex.abap.ui.source') { Add-Files $outputZip (Join-Path $project 'src') '' }
    } finally { $inputZip.Dispose(); $outputZip.Dispose() }
}

[xml]$artifacts = (Read-ZipText (Join-Path $root 'docs/artifacts.jar') 'artifacts.xml').Replace($old, $version)
foreach ($artifact in $artifacts.repository.artifacts.artifact) {
    $folder = if ($artifact.classifier -eq 'osgi.bundle') { 'plugins' } else { 'features' }
    $file = Join-Path $site ($folder + '/' + $artifact.id + '_' + $version + '.jar')
    foreach ($property in @($artifact.properties.property)) {
        if ($property.name -eq 'download.size') { $property.SetAttribute('value', [string](Get-Item $file).Length) }
        elseif ($property.name -like '*checksum*') { $artifact.properties.RemoveChild($property) | Out-Null }
    }
    $hash = $artifacts.CreateElement('property')
    $hash.SetAttribute('name', 'download.checksum.sha-256')
    $hash.SetAttribute('value', (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant())
    $artifact.properties.AppendChild($hash) | Out-Null
    $artifact.properties.SetAttribute('size', [string]$artifact.properties.ChildNodes.Count)
}
foreach ($pair in @(@{Name='content'; Text=$content}, @{Name='artifacts'; Text=$artifacts.OuterXml})) {
    $zip = [IO.Compression.ZipFile]::Open((Join-Path $site ($pair.Name + '.jar')), 'Create')
    try { Add-Text $zip ($pair.Name + '.xml') $pair.Text } finally { $zip.Dispose() }
}
$archive = Join-Path $out ('vertex-eclipse-' + $version + '.zip')
$zip = [IO.Compression.ZipFile]::Open($archive, 'Create')
try { Add-Files $zip $site '' } finally { $zip.Dispose() }
# Windows .NET CreateFromDirectory emits backslashes, which p2 cannot resolve.
# Check actual ZIP entry names, not just the files in the staging directory.
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($artifact in $artifacts.repository.artifacts.artifact) {
        $folder = if ($artifact.classifier -eq 'osgi.bundle') { 'plugins' } else { 'features' }
        $entry = $folder + '/' + $artifact.id + '_' + $version + '.jar'
        if (!$zip.GetEntry($entry)) { throw "Install archive is missing $entry" }
    }
    if (@($zip.Entries | Where-Object { $_.FullName.Contains('\') }).Count) {
        throw 'Install archive contains invalid backslash paths.'
    }
} finally { $zip.Dispose() }
Write-Output "Update site: $site"
Write-Output "Install archive: $archive"
