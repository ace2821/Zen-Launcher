# Zen Launcher — agent guide

Local-first game library manager for Linux. Tauri 2: Rust core in `src-tauri/`,
React UI in `src/`. The design document (`docs/DESIGN.md`) and interface
contract (`docs/INTERFACES.md`) are the source of truth — update the contract
in the same change that alters any IPC shape or data model.

## Commands

```bash
bun install                                            # frontend deps
bun run tauri dev                                      # full app (needs webkit2gtk-4.1)
bun run dev                                            # frontend only (mock IPC)
bun run build                                          # frontend build + typecheck
bun run test                                           # frontend tests (vitest)
cargo test --manifest-path src-tauri/Cargo.toml        # Rust tests
cargo check --manifest-path src-tauri/Cargo.toml
```

## Rules

- **No placeholder ("atrapa") features.** An interface works for real or stays
  hidden until its milestone. Nothing fake in the UI.
- **Contract first.** IPC/data changes update `docs/INTERFACES.md` in the same
  change.
- **Layer ownership.** `src-tauri/` = Rust core, `src/` = UI. Cross-layer work
  goes through the contract, not through shortcuts.
- **Non-destructive by default.** Deletes go to stash/trash or require explicit
  confirmation showing the file list. Library removal never touches files.
- **No telemetry.** Network only for metadata providers and update check.
- **Tests never touch real game folders** — use `src-tauri/tests/fixtures/`.
- **Milestone reports** go to `docs/reports/` with sections:
  Status / Pliki / Uruchamianie / Testy / Różnice / Kryteria akceptacji.
- **Verify before claiming.** Run what you report (cargo test / bun run build /
  bun run test).

## Layout

```
docs/DESIGN.md        design document (source of truth)
docs/INTERFACES.md    IPC + data model contract
docs/reports/         milestone verification reports
src/                  React UI
src-tauri/            Rust core (Tauri)
```
