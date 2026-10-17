# Zen Launcher

Local-first game library manager and launcher for Linux — organize, launch,
mod and back up games you already own: DRM-free store purchases, freeware,
mods and total conversions, retro via RetroArch, and plain game folders on
disk. No store clients, no accounts, no telemetry.

> **Status: early development (M1)** — not usable yet.

## Stack

Tauri 2 · Rust · React + TypeScript · SQLite

## Development

Prerequisites (Arch / CachyOS):

```bash
sudo pacman -S --needed webkit2gtk-4.1 patchelf
```

Then:

```bash
bun install
bun run tauri dev      # full app (needs system deps above)
bun run dev            # frontend only with mock IPC
```

Checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
bun run build
bun run test
```

## Docs

- `docs/DESIGN.md` — design document (source of truth)
- `docs/INTERFACES.md` — IPC + data contract
- `docs/reports/` — milestone verification reports

## License

MIT
