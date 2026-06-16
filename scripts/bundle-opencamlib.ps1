<#
.SYNOPSIS
    Install the OpenCAMLib (`opencamlib`) Python wheel into the WorkTrack3D
    Python sidecar venv and bridge the legacy top-level `import ocl` so the
    CAM toolpath engine (engines/cam/ocl_toolpath.py) can generate TRUE
    OpenCAMLib waterline / adaptive-waterline / drop-cutter toolpaths instead
    of falling back to the built-in mesh raster.

.DESCRIPTION
    Unlike OrcaSlicer (a downloaded binary zip, see bundle-orca-slicer.ps1),
    OpenCAMLib ships as a normal PyPI wheel. So this script does NOT download a
    zip — it `pip install`s a SHA-pinned wheel into the SAME interpreter the
    sidecar already uses for CadQuery, then writes a tiny `ocl.py` shim so the
    bare `import ocl` in engines/cam/* resolves.

    Why the shim is required (the load-bearing finding)
    ---------------------------------------------------
    The repo's CAM strategy code does `import ocl`, but the ONLY installable
    PyPI distribution (`opencamlib`) exposes its compiled extension as
    `opencamlib.ocl` and re-exports it from the `opencamlib` package — there is
    NO bare top-level `ocl` module after a plain `pip install opencamlib`. So
    `import ocl` fails out of the box. This script writes a one-line shim
    (`from opencamlib.ocl import *`) into the venv's site-packages so the
    existing engine code runs UNCHANGED. This is a packaging concern only — no
    engine, post-template, or G-code-emitting code is touched.

    The script:
      1. Pins a SPECIFIC opencamlib version for reproducibility.
      2. Resolves the target sidecar venv's python.exe (-VenvPath /
         -PythonExe override the default).
      3. Refuses to run on an interpreter with NO available wheel (only
         CPython 3.7-3.11 have win wheels for 2023.1.11 — there is NO 3.12+
         wheel and NO sdist on PyPI, so `pip install` is impossible there).
      4. `pip install`s the wheel (binary-only; never tries to build from
         source, which would need Boost + a C++ toolchain).
      5. Verifies `import opencamlib` works and writes the `ocl.py` shim.
      6. Verifies the bare `import ocl` now resolves and reports ocl.version().

    Idempotency: if the venv already imports `ocl` at the pinned version, the
    script prints a "skipping" message and exits 0. Pass -Force to reinstall.

.PARAMETER VenvPath
    Path to the sidecar virtualenv root (the folder that contains Scripts\).
    Defaults to C:\Users\<you>\wtcam-sidecar-venv — the CadQuery venv documented
    in the project memory. The OCL wheel is installed into THIS venv so OCL and
    CadQuery share one interpreter (the one the app's `settings.pythonPath`
    should point at).

.PARAMETER PythonExe
    Explicit path to a python.exe. Overrides -VenvPath when you want to target
    an interpreter that is not a standard venv layout. Must be CPython 3.7-3.11
    on Windows for a wheel to exist.

.PARAMETER Force
    Reinstall the wheel and rewrite the shim even if `import ocl` already works.

.EXAMPLE
    PS> ./scripts/bundle-opencamlib.ps1
    Installs opencamlib into the default sidecar venv if not already present.

.EXAMPLE
    PS> ./scripts/bundle-opencamlib.ps1 -VenvPath C:\Users\jrrou\wtcam-sidecar-venv -Force
    Reinstalls into an explicit venv (use after bumping $OclVersion).

.EXAMPLE
    PS> ./scripts/bundle-opencamlib.ps1 -PythonExe C:\Python311\python.exe
    Targets a specific 3.11 interpreter directly.

.NOTES
    Style mirrors scripts/bundle-orca-slicer.ps1 (CmdletBinding, -Force,
    pinned version, idempotency check, explicit "why" comments, clear exit
    codes). Run via:
        powershell -ExecutionPolicy Bypass -File ./scripts/bundle-opencamlib.ps1

    Wheel availability (verified against the PyPI JSON API, see docs/OPENCAMLIB.md):
      opencamlib 2023.1.11 — wheels for cp37/cp38/cp39/cp310/cp311 on
      win32 AND win_amd64 (plus macOS + manylinux). NO cp312/cp313/cp314
      wheel and NO sdist exists, so 3.12+ cannot pip-install opencamlib.
#>
[CmdletBinding()]
param(
    [string] $VenvPath = (Join-Path $env:USERPROFILE 'wtcam-sidecar-venv'),
    [string] $PythonExe,
    [switch] $Force
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------
# Pinned release - bump these two together when upgrading OpenCAMLib.
#
# How to bump:
#   1. Check the latest version + wheel availability:
#        py -3.11 -m pip index versions opencamlib
#      (or query https://pypi.org/pypi/opencamlib/json and confirm a
#      cp3xx-...-win_amd64.whl exists for your sidecar's Python).
#   2. Update $OclVersion. The script installs `opencamlib==$OclVersion`.
#   3. Re-run with -Force and confirm the gated smoke
#      (engines/cam/ocl_smoke_test.py) RUNS (not skips).
#
# As of this writing 2023.1.11 is the newest release on PyPI and the project
# appears dormant; do not expect a 3.12+ wheel without an upstream rebuild.
# --------------------------------------------------------------------------
$OclVersion = '2023.1.11'

# --------------------------------------------------------------------------
# Resolve the target python.exe.
#
# -PythonExe wins outright. Otherwise we look for Scripts\python.exe under
# -VenvPath (the standard Windows venv layout that the CadQuery sidecar uses).
# --------------------------------------------------------------------------
if ($PythonExe) {
    $TargetPython = $PythonExe
} else {
    $TargetPython = Join-Path $VenvPath 'Scripts\python.exe'
}

if (-not (Test-Path $TargetPython)) {
    Write-Error @"
Could not find a Python interpreter to install OpenCAMLib into.
  Looked for: $TargetPython
Create the sidecar venv first (the same one CadQuery uses), e.g. with uv:
  uv venv --python 3.11 $VenvPath
  $VenvPath\Scripts\python.exe -m pip install -r engines\requirements.txt
or pass -PythonExe <path-to-python.exe> / -VenvPath <venv-root> explicitly.
OpenCAMLib wheels exist ONLY for CPython 3.7-3.11 on Windows.
"@
    exit 1
}

# --------------------------------------------------------------------------
# Probe the interpreter version. There is NO opencamlib wheel for 3.12+ and
# NO sdist on PyPI, so `pip install` there would either fail outright or try a
# source build (Boost + C++ toolchain) that we explicitly refuse. Fail fast
# with an actionable message instead.
# --------------------------------------------------------------------------
$verRaw = & $TargetPython -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to run '$TargetPython'. Is it a valid Python executable?"
    exit 1
}
$pyVer = $verRaw.Trim()
Write-Host "Target interpreter: $TargetPython (Python $pyVer)"

$supported = @('3.7', '3.8', '3.9', '3.10', '3.11')
if ($supported -notcontains $pyVer) {
    Write-Error @"
Python $pyVer has NO opencamlib wheel on PyPI (only cp37-cp311 are published,
and there is no sdist to build from). OpenCAMLib CANNOT be pip-installed here.

Fix: point the sidecar at a CPython 3.7-3.11 venv. Recommended (matches the
CadQuery sidecar): Python 3.11.

  uv venv --python 3.11 $VenvPath
  $VenvPath\Scripts\python.exe -m pip install -r engines\requirements.txt
  ./scripts/bundle-opencamlib.ps1 -VenvPath $VenvPath

Then set the app's Utilities -> Settings -> Paths python to that interpreter.
"@
    exit 1
}

# --------------------------------------------------------------------------
# site-packages of the target interpreter (where the ocl.py shim lives).
# --------------------------------------------------------------------------
$sitePackages = (& $TargetPython -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
$ShimPath = Join-Path $sitePackages 'ocl.py'

# --------------------------------------------------------------------------
# PS 5.1-safe native probe.
#
# In Windows PowerShell 5.1, redirecting a native exe's stderr (`2>$null`)
# wraps each stderr line in a NativeCommandError ErrorRecord, which trips
# `$ErrorActionPreference = 'Stop'` even when the exe is *expected* to fail
# (e.g. probing `import ocl` before it is installed). This helper runs the
# interpreter with a short Python snippet, swallows stderr safely, and returns
# the trimmed stdout when the snippet exits 0, else $null. It NEVER throws.
# --------------------------------------------------------------------------
function Invoke-PyProbe {
    param([string] $Snippet)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $out = & $TargetPython -c $Snippet 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { return ($out | Out-String).Trim() }
        return $null
    } catch {
        return $null
    } finally {
        $ErrorActionPreference = $prev
    }
}

# --------------------------------------------------------------------------
# Idempotency check - if `import ocl` already works at the pinned version,
# do nothing. -Force overrides.
# --------------------------------------------------------------------------
function Test-OclImport {
    # Returns the reported ocl.version() string, or $null if `import ocl` fails.
    return Invoke-PyProbe 'import ocl; print(ocl.version())'
}

if (-not $Force) {
    $existing = Test-OclImport
    if ($existing) {
        Write-Host "OpenCAMLib already importable as 'ocl' (version $existing) in this venv - skipping."
        Write-Host "Use -Force to reinstall opencamlib==$OclVersion and rewrite the shim."
        exit 0
    }
}

# --------------------------------------------------------------------------
# Stage 1: pip install the wheel (binary-only).
#
# --only-binary=:all: guarantees we NEVER fall back to a source build (which
# would need Boost.Python + a C++ compiler). If no wheel matches, pip errors
# out cleanly and we surface a clear message rather than a half-built mess.
# --------------------------------------------------------------------------
Write-Host "Installing opencamlib==$OclVersion (wheel only) ..."
# pip writes progress to stdout and errors to stderr; gate strictly on the exit
# code. Relax ErrorActionPreference locally so any stderr line pip emits does
# not raise a NativeCommandError under Windows PowerShell 5.1.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $TargetPython -m pip install --only-binary=:all: "opencamlib==$OclVersion"
$pipExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($pipExit -ne 0) {
    Write-Error @"
pip failed to install opencamlib==$OclVersion as a wheel into $TargetPython.
Most likely there is no matching wheel for this interpreter/platform. Confirm
with:
  $TargetPython -m pip index versions opencamlib
Remember: wheels exist ONLY for CPython 3.7-3.11 on win32/win_amd64.
"@
    exit 1
}

# --------------------------------------------------------------------------
# Stage 2: verify the package imports under its real name.
# --------------------------------------------------------------------------
$pkgVer = Invoke-PyProbe 'import opencamlib; print(opencamlib.version())'
if (-not $pkgVer) {
    Write-Error "opencamlib installed but 'import opencamlib' failed. Aborting before writing the shim."
    exit 1
}
Write-Host "  opencamlib imports OK (version $pkgVer)."

# --------------------------------------------------------------------------
# Stage 3: write the ocl.py shim into site-packages.
#
# This is the bridge: engines/cam/ocl_toolpath.py does `import ocl`, but the
# PyPI package only provides `opencamlib` (with its C-extension at
# opencamlib.ocl). A one-line shim makes the legacy import resolve WITHOUT
# editing any engine/strategy code or changing emitted G-code.
# --------------------------------------------------------------------------
$shimContent = @"
# Auto-generated by scripts/bundle-opencamlib.ps1 - DO NOT EDIT BY HAND.
#
# Bridges the legacy top-level ``import ocl`` used by engines/cam/* to the
# PyPI ``opencamlib`` package, whose compiled extension lives at
# ``opencamlib.ocl`` and is re-exported from the ``opencamlib`` package.
#
# Why this file exists: a plain ``pip install opencamlib`` does NOT create a
# bare top-level ``ocl`` module, so ``import ocl`` would fail. Rather than
# patch the engine code (which would touch G-code-generating modules), we make
# the historical import name resolve here.
from opencamlib.ocl import *  # noqa: F401,F403
from opencamlib.ocl import version  # noqa: F401  re-export for ocl.version()
"@
Set-Content -Path $ShimPath -Value $shimContent -Encoding UTF8
Write-Host "Wrote import shim: $ShimPath"

# --------------------------------------------------------------------------
# Stage 4: verify the bare `import ocl` now works end-to-end.
# --------------------------------------------------------------------------
$oclVer = Test-OclImport
if (-not $oclVer) {
    Write-Error "Wrote the shim but 'import ocl' still fails. Inspect $ShimPath and the opencamlib install."
    exit 1
}

# --------------------------------------------------------------------------
# Done.
# --------------------------------------------------------------------------
Write-Host ""
Write-Host "Done. OpenCAMLib $OclVersion installed and bridged."
Write-Host "  Interpreter : $TargetPython"
Write-Host "  import ocl  : OK (ocl.version() = $oclVer)"
Write-Host "  Shim        : $ShimPath"
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Point the app's Utilities -> Settings -> Paths python at this interpreter."
Write-Host "  2. Verify with the gated smoke (it should now RUN, not skip):"
Write-Host "       $TargetPython -m pytest engines/cam/ocl_smoke_test.py -v"
Write-Host "  CAM 3D ops (Waterline / Adaptive / raster) will now use real OpenCAMLib."
