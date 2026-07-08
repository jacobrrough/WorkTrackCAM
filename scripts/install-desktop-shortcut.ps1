# ---------------------------------------------------------------------------
# Creates (or overwrites) a "WorkTrack3D" shortcut on the Desktop that points
# at scripts/launch.ps1 -- the always-latest-source launcher.
#
# Run once from the real checkout (not a git worktree):
#   npm run shortcut:install
#
# The shortcut runs PowerShell minimized; the app window opens on top. It
# replaces the stale installer shortcut that launched the frozen 0.1.0 build.
# ---------------------------------------------------------------------------
#Requires -Version 5
$ErrorActionPreference = 'Stop'

$repo   = Split-Path -Parent $PSScriptRoot
$launch = Join-Path $repo 'scripts\launch.ps1'
if (-not (Test-Path -LiteralPath $launch)) {
  throw "launch.ps1 not found at $launch"
}

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'WorkTrack3D.lnk'

# Icon: prefer the installed app's exe (real WorkTrack3D icon) if present,
# otherwise fall back to the local Electron binary so the shortcut is never
# iconless.
$icon = Join-Path $repo 'node_modules\electron\dist\electron.exe'
$installed = Join-Path $env:LOCALAPPDATA 'Programs\WorkTrack3D\WorkTrack3D.exe'
if (Test-Path -LiteralPath $installed) { $icon = $installed }

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath       = $powershell
$lnk.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$launch`""
$lnk.WorkingDirectory = $repo
$lnk.IconLocation     = "$icon,0"
$lnk.WindowStyle      = 7   # 7 = minimized (build log stays out of the way)
$lnk.Description       = 'Launch WorkTrack3D (always builds & runs the latest local source)'
$lnk.Save()

Write-Host "Desktop shortcut written:" -ForegroundColor Green
Write-Host "  $lnkPath" -ForegroundColor Green
Write-Host "  -> $launch" -ForegroundColor DarkGray
Write-Host ''
Write-Host 'You can delete the old installer shortcut if it is still on your desktop.' -ForegroundColor Yellow
