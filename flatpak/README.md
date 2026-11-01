# Zen Launcher — Flatpak packaging

App ID: `io.github.ace2821.ZenLauncher` · runtime `org.gnome.Platform//51` ·
license MIT · only `x86_64` (see `flathub.json`).

| File | Purpose |
| --- | --- |
| `io.github.ace2821.ZenLauncher.json` | **Final** Flathub manifest (wine module + app) |
| `smoke.local.json` | Same app module, **without** the wine module, built from the working tree |
| `cargo-sources.json` | Vendored crates for `src-tauri/Cargo.lock` (offline cargo) |
| `node-sources.json` | npm cache for `package-lock.json` (offline `npm ci`) |
| `gen-sources.sh` | Regenerates both `*-sources.json` files |
| `flathub.json` | Restricts the build to x86_64 |

`../io.github.ace2821.ZenLauncher.metainfo.xml` (AppStream) and
`../io.github.ace2821.ZenLauncher.desktop` (desktop entry) live in the repository
root so the app module can install them from the git checkout.

## Local smoke build

Runtimes/SDK used (≈2.5 GB download, ≈7 GB installed):

```bash
flatpak install -y flathub \
  org.flatpak.Builder \
  org.gnome.Sdk//51 org.gnome.Platform//51 \
  org.freedesktop.Sdk.Extension.rust-stable//26.08 \
  org.freedesktop.Sdk.Extension.node24//26.08
```

Build + install the app only (no wine, so it takes minutes instead of hours):

```bash
# NOTE: the runtimes above are installed system-wide here, and Builder's
# flathub-build wrapper installs missing deps into the *user* installation by
# default. Either add flathub to the user installation
# (`flatpak remote-add --if-not-exists --user flathub <url>`) and pass
# `--user`, or build against the system installation and install from the
# local repo as below.
flatpak run --command=flatpak-builder org.flatpak.Builder \
  --force-clean --repo=/tmp/zen-repo /tmp/zen-build \
  flatpak/smoke.local.json

sudo flatpak install -y --system /tmp/zen-repo io.github.ace2821.ZenLauncher
# or, no root needed:
flatpak install -y --user /tmp/zen-repo io.github.ace2821.ZenLauncher

flatpak run io.github.ace2821.ZenLauncher
```

`package-lock.json` (see below) must be generated **without** `node_modules/`
present, otherwise it lacks `resolved`/`integrity` and `npm ci --offline` fails
with `ENOTCACHED`; `gen-sources.sh` refuses to run in that case.

Lint (must be 0 errors; warnings are acceptable but should be reviewed):

```bash
# manifest structure
flatpak run --command=flatpak-builder-lint org.flatpak.Builder \
  manifest flatpak/io.github.ace2821.ZenLauncher.json

# AppStream metadata
flatpak run --command=flatpak-builder-lint org.flatpak.Builder \
  appstream io.github.ace2821.ZenLauncher.metainfo.xml

# desktop entry (host tool)
desktop-file-validate io.github.ace2821.ZenLauncher.desktop
```

Regenerate vendored sources after a `Cargo.lock` / `package-lock.json` change:

```bash
./flatpak/gen-sources.sh    # uses /tmp venv + /tmp/flatpak-builder-tools
```

`package-lock.json` is generated with `npm install --package-lock-only` in the
repository root (the project itself uses bun; the lockfile exists only so
`npm ci --offline` can run inside the sandbox). Keep it in sync with
`package.json`.

### Lint status (2026-10-24)

- `flatpak-builder-lint manifest` → **1 error, `appid-url-not-reachable`**.
  The linter derives `https://github.com/<owner>/<lowercased-app-id>` from the
  app ID, i.e. `https://github.com/ace2821/zenlauncher`, but the upstream
  repository is `ace2821/Zen-Launcher` (hyphen). Fix by renaming the GitHub
  repository to `zenlauncher`, or ask Flathub for a linter exception in the
  submission PR; nothing in the manifest itself can silence it. All other
  manifest checks pass. `smoke.local.json` additionally reports
  `appid-filename-mismatch`, which is expected for a non-app-ID-named local
  file.
- `flatpak-builder-lint appstream` → **0 errors** (1 pedantic notice: the app ID
  contains uppercase letters, which is the upstream choice).
- `appstreamcli validate --no-net` → 0 errors (1 pedantic notice, same as above).
- `desktop-file-validate` → 0 errors (one hint about two main categories,
  `Game;Utility;`, which is intentional).

## Submitting to Flathub

1. Tag the release: `git tag v1.1.0 && git push origin v1.1.0`. Update
   `commit` in the app module to the **tagged** full SHA (currently the 1.1.0
   UI commit `06c3ef4c…`, which is the intended tag target).
2. Fork `flathub/flathub`, branch `new-pr` from `new-pr`:
   `git checkout new-pr && git checkout -b zen-launcher`.
3. Add to the PR branch:
   - `io.github.ace2821.ZenLauncher.json` (the final manifest),
   - `cargo-sources.json`, `node-sources.json`,
   - `flathub.json`.
4. Open the PR against `flathub/flathub:new-pr` with the title
   `Add io.github.ace2821.ZenLauncher`.
5. Flathub's CI runs `flatpak-builder-lint` and builds the manifest. Keep the
   build under the time limit: the wine module is the expensive part (see
   below), the app module is a normal Rust + node build.
6. Add an `update_contact` (e.g. the maintainer's email) to the manifest only
   if you want automated Flathub PRs from `flathub/external-data`; optional.

### Screenshots

The metainfo embeds three screenshots served from
`https://raw.githubusercontent.com/ace2821/Zen-Launcher/main/assets/screenshots/`
(`library.png` as `type="default"`, plus `mods-installed.png` and
`mods-install.png`). Keep them up to date with major UI changes; Flathub
mirrors them during submission.

## Wine module — CI notes and TODOs

- The wine module builds **wine-11.9** from `wine-mirror/wine` (git source with
  `x-checker-data` on the `wine-(\d+\.\d+)` tags). A trunk build is roughly
  **~2 h of CI time** on a normal Flathub worker — that is the main reason the
  local smoke manifest excludes it.
- Current `configure` line is `--enable-archs=x86_64`, i.e. **64-bit Windows
  games only**. 32-bit (`i386`) support needs a WoW64 build plus the mingw-w64
  cross toolchain, which is **not** part of `org.gnome.Sdk`. Add a mingw
  SDK-extension (or an `i386`-capable SDK) and extend `--enable-archs=i386,x86_64`
  before claiming 32-bit game support; expect the build time to grow further.
- `make install` is enough for the wine binaries (`/app/bin/wine`,
  `/app/bin/wineboot`, …) and the wine libraries.
- Reviewers may ask for a `cleanup`/`cleanup-commands` block and for
  `--device=all` justification: the launcher reads gamepads (`/dev/input`) and
  launches DRI/wine titles.
- Filesystem access is intentionally narrow: `/run/media:ro`, `/mnt:ro`,
  `~/Games:rw`, Steam libraries (ro). A library that lives somewhere else (e.g.
  `~/Desktop/…`) will not be visible inside the sandbox — widen the finish-args
  (e.g. `--filesystem=home:ro`) if the scanner needs arbitrary folders.
- `gamemoderun` is **not** available inside the sandbox (the host binary is not
  visible), so the GameMode launch option silently does nothing in the Flatpak
  build; the `com.feralinteractive.GameMode` talk-name is kept for a future
  in-sandbox implementation.
- The tray icon needs `libayatana-appindicator`, which is not in the GNOME
  runtime. Tauri loads it dynamically, so the build succeeds and the app works;
  only the tray icon is missing inside the sandbox.
- Startup class: `tauri.conf.json` sets `mainBinaryName` to `zen-launcher`, and
  Tauri's generated desktop file uses `StartupWMClass=zen-launcher`, so the
  hand-written entry does the same. `Exec=zen-launcher` matches
  `command`/`/app/bin/zen-launcher`.
