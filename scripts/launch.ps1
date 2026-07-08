# ---------------------------------------------------------------------------
# WorkTrack3D one-click launcher.
#
# Goal: a desktop icon that ALWAYS runs the latest local source, with no
# reinstall step. On each launch this script:
#   1. Ensures node_modules is present (npm install on first run).
#   2. Rebuilds the app ONLY when a source file is newer than the last build
#      (electron-vite build -> out/). A clean run skips straight to launch.
#   3. Launches the freshly built app via electron-vite preview.
#
# This intentionally does NOT touch the NSIS installer or the per-user
# installed copy in %LOCALAPPDATA%\Programs\WorkTrack3D. The installed shortcut
# launched a frozen 0.1.0 build; this launcher runs whatever is checked out in
# the repo, so "the latest version" is always what you see.
#
# Run directly, or install a desktop shortcut that calls it:
#   npm run shortcut:install
# ---------------------------------------------------------------------------
#Requires -Version 5
$ErrorActionPreference = 'Stop'

# scripts/launch.ps1 -> repo root is the parent of this script's folder.
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo

function Fail($msg) {
  Write-Host $msg -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

Write-Host "WorkTrack3D launcher" -ForegroundColor Cyan
Write-Host "  repo: $repo" -ForegroundColor DarkGray

# 1. Dependencies -----------------------------------------------------------
if (-not (Test-Path -LiteralPath (Join-Path $repo 'node_modules'))) {
  Write-Host 'Installing dependencies (first run, this is slow once)...' -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }
}

# 2. Rebuild only when source is newer than the last build ------------------
$outMain = Join-Path $repo 'out\main\index.js'
$needBuild = $true

if (Test-Path -LiteralPath $outMain) {
  $builtAt = (Get-Item -LiteralPath $outMain).LastWriteTimeUtc

  # Newest write time across the inputs that actually affect the build. Test
  # files (*.test.ts / *.spec.tsx) are excluded so editing a test does not
  # force a rebuild of the app itself.
  $newest = [DateTime]::MinValue
  $watchRoots = @('src', 'resources', 'electron.vite.config.ts', 'package.json', 'package-lock.json')
  foreach ($rel in $watchRoots) {
    $full = Join-Path $repo $rel
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $files = Get-ChildItem -LiteralPath $full -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch '\.(test|spec)\.' }
    foreach ($f in $files) {
      if ($f.LastWriteTimeUtc -gt $newest) { $newest = $f.LastWriteTimeUtc }
    }
  }

  if ($newest -le $builtAt) { $needBuild = $false }
}

if ($needBuild) {
  Write-Host 'Source changed since last build -- rebuilding...' -ForegroundColor Yellow
  npm run build:app
  if ($LASTEXITCODE -ne 0) { Fail 'Build failed. Fix the errors above, then relaunch.' }
} else {
  Write-Host 'Build is up to date -- skipping rebuild.' -ForegroundColor Green
}

# 3. Launch -----------------------------------------------------------------
Write-Host 'Launching WorkTrack3D...' -ForegroundColor Cyan
npm run preview
if ($LASTEXITCODE -ne 0) { Fail 'App exited with an error.' }
