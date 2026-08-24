[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'manifest.json') | ConvertFrom-Json
$version = $manifest.version
$staging = Join-Path $projectRoot "dist\windows-watchdog-$version"
$archive = Join-Path $projectRoot "dist\lock-in-$version-windows-watchdog.zip"

if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot 'watchdog\LockInWatchdog.ps1') -Destination $staging
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-windows-watchdog.ps1') -Destination $staging
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'disarm-windows-watchdog.ps1') -Destination $staging
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'uninstall-windows-watchdog.ps1') -Destination $staging
Copy-Item -LiteralPath (Join-Path $projectRoot 'watchdog\README.md') -Destination $staging

if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archive -CompressionLevel Optimal
$stream = [IO.File]::OpenRead($archive)
try {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { $hash = ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha256.Dispose() }
} finally { $stream.Dispose() }
Set-Content -LiteralPath "$archive.sha256" -Value "$hash  $(Split-Path -Leaf $archive)" -Encoding ascii

Write-Host "Built $archive"
Write-Host "SHA-256: $hash"
