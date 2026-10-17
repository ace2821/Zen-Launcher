# Wine launch + auto-setup prefixów — raport weryfikacyjny

Podstawa: `21b8d89` (settings v2). Zmiana: commit `fecc868` („Launch Windows
games through Wine: per-game prefix, auto setup, .bat detection”).

Zakres: `src-tauri/**` (rdzeń, testy, fixtures) + jedna reguła UI
(`src/lib/hooks.ts`) + kontrakt (`docs/INTERFACES.md`, `docs/DESIGN.md`).

---

## Status

Zrobione i zweryfikowane lokalnie:

- Uruchamianie gier `windows` przez systemowe `wine`:
  - `.exe` (i inne) startuje wprost: `wine <gra> <args>`,
  - `.bat` / `.cmd` przez `wine cmd /c <gra>`,
  - per-growy prefix `~/.local/share/zen-launcher/prefixes/<gameId>`,
  - domyślne `WINEDLLOVERRIDES=mscoree,mshtml=` (bez okien Mono/Gecko);
    `WINEPREFIX` / `WINEDLLOVERRIDES` nadpisywalne per gra przez `env`,
  - katalog prefixu tworzony przed spawnem — `wine` robi `chdir` do
    `WINEPREFIX`, brak katalogu = natychmiastowe wyjście z błędem,
  - `retro` / `mod` nadal `UNSUPPORTED` (bez atrap).
- Auto-setup prefixów: `wineboot -u` w tle (a) przy starcie aplikacji dla
  każdej gry `windows` bez gotowego prefixu, (b) od razu po zatwierdzeniu gry
  `windows`; deduplikacja „in flight”; porażka tylko logowana — Play nigdy nie
  zależy od setupu (kolejka wine na locku prefixu jest bezpieczna).
- Skaner: wykrywanie launcherów `.bat` w folderach generycznych (preferencja
  `launcher.bat`, potem najkrótsza nazwa, potem alfabetycznie); fixture
  `batch_launcher/` z przynętą `boot.bat`.
- Zatwierdzanie: `.exe` / `.bat` / `.cmd` → typ `windows` (zgadywanie typu).
- UI: Play dla `windows` odblokowany w `useLaunchAvailability`; `retro`/`mod`
  dalej zablokowane z podpowiedzią.
- Dowód na żywo (dev, 2026-10-17 18:14–18:15): zatwierdzenie AoH3/AoH2
  (`Launcher.bat`) od razu utworzyło i zainicjalizowało prefixy 3/4 w tle
  (~40 s, log `wine prefix ready`); sesja 1 = AoH2, 20 s, exit 0, czysto
  domknięta.

Wynik komend (ostatni przebieg):

| Komenda | Wynik |
|---|---|
| `cargo fmt --check` | OK |
| `cargo clippy --all-targets` | OK (0 ostrzeżeń) |
| `cargo test` | 34 + 12 = 46 testów, 0 porażek |

## Pliki

- `src-tauri/src/wine.rs` — nowy moduł auto-setup prefixów (wineboot, in-flight
  dedupe, filtr gier).
- `src-tauri/src/launch.rs` — plan startu dla `windows`, `ensure_prefix_dir`,
  nowe testy jednostkowe.
- `src-tauri/src/commands.rs` — inferencja typu, auto-setup po `approve`.
- `src-tauri/src/lib.rs` — sweep prefixów przy starcie.
- `src-tauri/src/scanner/mod.rs` — `first_bat_launcher` + gałąź `.bat`.
- `src-tauri/tests/scanner.rs`, `tests/fixtures/batch_launcher/`.
- `src/lib/hooks.ts` — Play dla `windows`.
- `docs/INTERFACES.md` — sekcja „Launch rules (M1)” + heurystyki skanera.

## Uruchamianie

- Dev: `bun run tauri dev` → Play na dowolnej grze `windows`.
- Prefixy: `~/.local/share/zen-launcher/prefixes/<id>`; ręczna weryfikacja
  prefixu: `WINEPREFIX=~/.local/share/zen-launcher/prefixes/<id> wine cmd /c ver`.

## Testy

- Nowe testy jednostkowe (`launch.rs`, `wine.rs`): wine dla `.exe`, `wine cmd
  /c` dla `.bat`, nadpisanie `WINEPREFIX` przez `env`, `retro`/`mod` →
  `UNSUPPORTED`, tworzenie brakującego katalogu prefixu, `is_ready` na markerze
  `system.reg`, filtr `needs_prefix`.
- Integracyjny: `detects_batch_launcher_with_priority` (fixture z przynętą).

## Różnice

- Katalog prefixu musi istnieć przed startem `wine` — wcześniej gra startowała
  i natychmiast kończyła się ciszą w logach (`chdir` do nieistniejącego
  katalogu). Naprawione w `ensure_prefix_dir` + `wineboot` tworzy katalog.
- Sesja kończy się, gdy bezpośrednie dziecko wyjdzie — launchery `.bat`, które
  same kończą proces po odpaleniu gry, domykają sesję wcześniej (znane
  ograniczenie; licznik mierzy proces-korzeń, nie całe drzewo).
- Kandydaci `.bat` w folderach generycznych dostają pewność 0.5 (jak `.sh`);
  dedupe kandydatów nadal per-źródło (odłożone do watchera w M2).

## Kryteria akceptacji

- [x] Gra z `Launcher.bat` startuje z UI przez `wine cmd /c` (sesja 1, exit 0).
- [x] Prefixy przygotowują się same — przy starcie apki i przy zatwierdzeniu
      gry (`wine prefix ready` dla 3/4 w logu trace).
- [x] Play odblokowany dla `windows`; `retro`/`mod` zablokowane z podpowiedzią.
- [x] `cargo fmt` / `clippy` / `test` zielone (46/46).
- [ ] Bezpośredni start `.exe` (worldbox.exe / Ages of Conflict) potwierdzony
      klikiem w UI — plan i spawn pokryte testami; do potwierdzenia na żywo.
