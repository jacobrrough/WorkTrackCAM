# Desktop launcher — always run the latest source

**Problem this solves:** the desktop shortcut created by the NSIS installer
launches a *frozen* build (the `WorkTrack3D-0.1.0-Setup.exe` you last
installed). Because the app version never changes, rebuilding and reinstalling
is easy to forget, so the icon quietly keeps opening an old version.

The launcher below never uses the installed copy. Every click builds the
current repo (only when something changed) and runs *that* — so "the latest
version" is always whatever is checked out.

## One-time setup

From the real checkout (not a git worktree):

```powershell
npm run shortcut:install
```

This writes `WorkTrack3D.lnk` to your Desktop, pointing at
[`scripts/launch.ps1`](../scripts/launch.ps1). Delete the old installer
shortcut afterward — you don't need it anymore.

## What one click does

[`scripts/launch.ps1`](../scripts/launch.ps1):

1. Runs `npm install` **only** if `node_modules` is missing (first run).
2. Rebuilds **only** if a source file under `src/`, `resources/`,
   `electron.vite.config.ts`, `package.json`, or `package-lock.json` is newer
   than the last build (`out/main/index.js`). Test/spec files are ignored, so
   editing a test doesn't trigger a rebuild. A clean tree skips straight to
   launch.
3. Launches the freshly built app with `electron-vite preview`.

The PowerShell window runs minimized; the app window opens on top. If a build
fails, the window stays open with the error so you can read it.

## Alternatives

- **Double-click** [`Launch WorkTrack3D.bat`](../Launch%20WorkTrack3D.bat) in
  the repo root — same behavior, no desktop shortcut needed.
- **From a terminal:** `npm run launch` (always rebuilds, then runs).
- **Just build the app** (no installer): `npm run build:app`.

## What this does *not* change

The installer path is untouched. `npm run build` still produces the full NSIS
installer (`electron-vite build && electron-builder`) for when you want to
distribute a packaged `.exe`. The launcher is purely additive — a fast local
"run what I have right now" path for the shop machine.
