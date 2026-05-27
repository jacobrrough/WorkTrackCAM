<#
.SYNOPSIS
    Download, verify, and extract the OrcaSlicer Windows portable binary into
    resources/orca-slicer/win32-x64/ so the OrcaSlicer CLI wrapper
    (src/main/slicer/orca-wrapper.ts) can spawn it.

.DESCRIPTION
    WorkTrackCAM bundles OrcaSlicer as its FDM slicing engine for the
    Creality K2 Plus. This script is intended to be run ONCE on a Windows
    developer machine (Jacob's box) to materialize the binary tree that
    electron-builder later ships via `extraResources` in package.json.

    The script:
      1. Pins a SPECIFIC OrcaSlicer release tag for reproducibility.
      2. Downloads the official Windows portable .zip from GitHub.
      3. Verifies the SHA256 of the download against a pinned hash.
      4. Extracts the zip into a staging directory.
      5. Flattens the inner OrcaSlicer_Windows_V*_portable/ folder into
         resources/orca-slicer/win32-x64/ and renames OrcaSlicer.exe to
         orca-slicer.exe (the name the wrapper resolves).
      6. Writes a small VERSION file so re-runs can detect the bundled version.

    The script is idempotent: re-running with the binary already present
    prints a "skipping" message and exits 0. Pass -Force to re-download.

    The binary is NOT committed to git (.gitignore excludes the platform
    directory). electron-builder packs the result via extraResources at
    `npm run build` time.

.PARAMETER Force
    Re-download and re-extract even if the binary is already bundled.

.EXAMPLE
    PS> ./scripts/bundle-orca-slicer.ps1
    Downloads OrcaSlicer 2.3.2 if not already present.

.EXAMPLE
    PS> ./scripts/bundle-orca-slicer.ps1 -Force
    Re-downloads and replaces any existing bundle. Useful when bumping
    $OrcaVersion in this script.

.NOTES
    Style matches existing scripts under scripts/ (check-no-dump-stubs.cjs,
    verify-release-gate.mjs). Comment style favors explicit "why" notes.
#>
[CmdletBinding()]
param(
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------
# Pinned release - bump these three together when upgrading OrcaSlicer.
#
# How to bump:
#   1. Find the latest stable release tag at
#      https://github.com/OrcaSlicer/OrcaSlicer/releases/latest
#      (NOT a pre-release / nightly).
#   2. Grab the SHA256 of the *_Windows_V*_portable.zip asset. GitHub serves
#      it both in the release notes and via the `digest` field of the REST
#      API (`gh api repos/OrcaSlicer/OrcaSlicer/releases/latest`).
#   3. Update $OrcaVersion, $OrcaZipName, $OrcaZipSha256.
#   4. Re-run this script with -Force on a Windows box and commit the new
#      VERSION file once the smoke test passes.
# --------------------------------------------------------------------------
$OrcaVersion   = 'v2.3.2'
$OrcaZipName   = 'OrcaSlicer_Windows_V2.3.2_portable.zip'
$OrcaZipSha256 = '9b83da960d57d8acc35b5a5f9c4d938345688f9d0368adfa20e707d9af618491'
$OrcaZipUrl    = "https://github.com/OrcaSlicer/OrcaSlicer/releases/download/$OrcaVersion/$OrcaZipName"

# --------------------------------------------------------------------------
# Path layout (must match orca-wrapper.ts resolveOrcaInstall()).
# --------------------------------------------------------------------------
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot    = Resolve-Path (Join-Path $ScriptDir '..')
$PlatformDir = Join-Path $RepoRoot 'resources\orca-slicer\win32-x64'
$BinaryPath  = Join-Path $PlatformDir 'orca-slicer.exe'
$VersionFile = Join-Path $PlatformDir 'VERSION'

# --------------------------------------------------------------------------
# Idempotency check - if the binary AND a matching VERSION file already
# exist, do nothing. -Force overrides.
# --------------------------------------------------------------------------
if (-not $Force -and (Test-Path $BinaryPath) -and (Test-Path $VersionFile)) {
    $existing = (Get-Content $VersionFile -Raw).Trim()
    if ($existing -eq $OrcaVersion) {
        Write-Host "OrcaSlicer already bundled at version $existing, skipping. Use -Force to re-download."
        exit 0
    }
    Write-Host "Found OrcaSlicer $existing but script pins $OrcaVersion - re-bundling."
}

# --------------------------------------------------------------------------
# Stage 1: download the zip to a temp file.
#
# We download to a temp file (not directly into the platform dir) so a
# failed/aborted download never leaves a half-extracted tree the wrapper
# would happily try to spawn.
# --------------------------------------------------------------------------
$TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "worktrackcam-orca-$OrcaVersion"
if (Test-Path $TempRoot) {
    Remove-Item $TempRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $TempRoot | Out-Null

$ZipPath = Join-Path $TempRoot $OrcaZipName

Write-Host "Downloading OrcaSlicer $OrcaVersion ..."
Write-Host "  From: $OrcaZipUrl"
Write-Host "  To:   $ZipPath"

try {
    # ProgressPreference=SilentlyContinue speeds Invoke-WebRequest dramatically
    # on Windows PowerShell 5.1 (the default progress bar tanks throughput).
    $oldProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $OrcaZipUrl -OutFile $ZipPath -UseBasicParsing
    $ProgressPreference = $oldProgress
} catch {
    Write-Error "Download failed: $($_.Exception.Message)"
    Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

if (-not (Test-Path $ZipPath)) {
    Write-Error "Download appeared to succeed but $ZipPath is missing."
    exit 1
}

# --------------------------------------------------------------------------
# Stage 2: verify SHA256 against the pinned hash.
#
# This guards against (a) a tampered mirror, (b) an in-flight network
# corruption, and (c) silent re-tagging of the GitHub release (which has
# happened before in upstream slicer projects).
# --------------------------------------------------------------------------
Write-Host "Verifying SHA256 ..."
$actualHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
$expectedHash = $OrcaZipSha256.ToLower()

if ($actualHash -ne $expectedHash) {
    Write-Error @"
SHA256 mismatch for $OrcaZipName.
  Expected: $expectedHash
  Actual:   $actualHash
Refusing to extract - the download may be corrupt or the pinned hash is
stale. Verify the release at
https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/$OrcaVersion
and update `$OrcaZipSha256 in this script if the asset legitimately changed.
"@
    Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "  OK ($actualHash)"

# --------------------------------------------------------------------------
# Stage 3: extract zip into a staging subdirectory.
#
# Expand-Archive is the built-in PowerShell unzipper (no external deps).
# We extract to staging first so we can inspect the layout before touching
# the live PlatformDir.
# --------------------------------------------------------------------------
$ExtractDir = Join-Path $TempRoot 'extract'
New-Item -ItemType Directory -Path $ExtractDir | Out-Null

Write-Host "Extracting ..."
try {
    Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force
} catch {
    Write-Error "Extraction failed: $($_.Exception.Message)"
    Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# The portable zip contains a single top-level folder, typically named
# OrcaSlicer_Windows_V2.3.2_portable/. Locate it dynamically rather than
# hard-coding so a casing/naming change between releases doesn't break us.
$InnerDirs = Get-ChildItem -Path $ExtractDir -Directory
if ($InnerDirs.Count -ne 1) {
    Write-Error "Expected exactly one top-level directory in zip; found $($InnerDirs.Count)."
    Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}
$InnerDir = $InnerDirs[0].FullName

# Locate the OrcaSlicer executable inside the inner folder. Upstream ships
# it as 'OrcaSlicer.exe' (Pascal case) but we'll match case-insensitively
# in case that ever changes.
$ExeCandidates = Get-ChildItem -Path $InnerDir -Filter 'OrcaSlicer.exe' -File
if ($ExeCandidates.Count -lt 1) {
    Write-Error "Could not find OrcaSlicer.exe in extracted folder $InnerDir."
    Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue
    exit 1
}

# --------------------------------------------------------------------------
# Stage 4: replace the live PlatformDir atomically-ish.
#
# We wipe the existing platform directory (it's a build artifact, not a
# source-tracked tree) and move the freshly extracted folder into place.
# The OrcaSlicer.exe is then renamed to orca-slicer.exe - that name is
# what the wrapper at src/main/slicer/orca-wrapper.ts:60 resolves on
# win32. Doing a rename (not a copy) keeps all the sibling DLLs / resource
# folders that OrcaSlicer.exe needs at runtime.
# --------------------------------------------------------------------------
if (Test-Path $PlatformDir) {
    Write-Host "Removing existing $PlatformDir ..."
    Remove-Item $PlatformDir -Recurse -Force
}
New-Item -ItemType Directory -Path $PlatformDir -Force | Out-Null

Write-Host "Copying extracted tree into $PlatformDir ..."
# Copy contents, not the inner directory itself, so OrcaSlicer.exe ends up
# at the root of $PlatformDir alongside its DLLs.
Copy-Item -Path (Join-Path $InnerDir '*') -Destination $PlatformDir -Recurse -Force

# Rename the executable to the name the TS wrapper expects.
$ExtractedExe = Join-Path $PlatformDir 'OrcaSlicer.exe'
if (-not (Test-Path $ExtractedExe)) {
    Write-Error "After copy, $ExtractedExe is missing - something went wrong."
    exit 1
}
Move-Item -Path $ExtractedExe -Destination $BinaryPath -Force

# Drop a VERSION file so the next run can detect what's installed.
Set-Content -Path $VersionFile -Value $OrcaVersion -Encoding ASCII

# Best-effort cleanup of the temp tree; ignore failures (Windows AV
# sometimes briefly locks freshly extracted files).
Remove-Item $TempRoot -Recurse -Force -ErrorAction SilentlyContinue

# --------------------------------------------------------------------------
# Done.
# --------------------------------------------------------------------------
Write-Host ""
Write-Host "Done. OrcaSlicer $OrcaVersion bundled."
Write-Host "  Binary: $BinaryPath"
Write-Host "  VERSION: $VersionFile"
Write-Host ""
Write-Host "electron-builder will pack this tree via the 'extraResources'"
Write-Host "block in package.json at the next 'npm run build'."
