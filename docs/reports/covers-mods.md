# Raport: okładki + mod loader + instalacja modyfikacji przeciąganiem

## Status

Etap rdzeń + UI zakończony, zbudowany na mroczonym kontrakcie
(`docs/INTERFACES.md`, sekcje „Covers (artwork)" + „Mods (loaders & installs)").

- Core: `src-tauri/src/covers.rs`, `src-tauri/src/mods.rs` — nowe moduły
- UI: `src/components/details/CoverPicker.tsx`, `src/components/details/ModsPanel.tsx`,
  `src/lib/assets.ts`, `src/lib/dnd.ts` + integracja w bibliotece i widoku szczegółów
- Commity: `3aa75ed` (rdzeń + kontrakt + DESIGN), `78e1744` (UI)

## Pliki

- `src-tauri/src/paths.rs` — `covers_dir()` + tworzenie katalogu w `ensure_dirs`
- `src-tauri/src/covers.rs` — Steam storesearch (bez klucza API), pobieranie
  (limit 10 MB, walidacja magic bytes PNG/JPEG/WebP), okładka z pliku,
  unikalne nazwy `cover-<gameId>-<stamp>.<ext>`, auto-usuwanie starych okładek gry
- `src-tauri/src/mods.rs` — detekcja loadera (BepInEx → MelonLoader → doorstop:
  `doorstop_config.ini`/`winhttp.dll`/`version.dll`), silnik (mono/il2cpp),
  sugerowany loader (mono→bepinex5, il2cpp→melonloader), instalacja loadera z
  GitHub releases (BepInEx win x64 / MelonLoader x64), instalacja archiwum mody
  (.zip/.7z/.rar przez systemowe 7z) do stagingu, walidacja ścieżek i symlinków,
  przeniesienie do folderu mody, archiwum do kosza (`trash` crate — nigdy rm)
- `src-tauri/src/commands.rs` — 6 nowych komend IPC, `game_root_for()` helper
- `src-tauri/src/lib.rs` — rejestracja komend + scope asset protocol (runtime,
  tylko katalog `covers/`)
- `src-tauri/tauri.conf.json` — `assetProtocol.enable` + feature `protocol-asset`
- `src/lib/assets.ts` — `convertFileSrc` dla okładek (asset protocol)
- `src/lib/dnd.ts` — HTML5 drag&drop z fallbackiem w trybie mock
- `src/components/details/CoverPicker.tsx` + testy — modal kandydatów okładki,
  przycisk „wybierz plik..."
- `src/components/details/ModsPanel.tsx` + testy — badge loadera, silnik,
  folder mody, lista zainstalowanych (limit 50), przyciski instalacji
  BepInEx/MelonLoader z ostrzeżeniem, dropzone archiwów, toasty VALIDATION/IO
- `src/i18n/{en,pl}.ts` — komplet tekstów; `src/lib/{ipc,api,hooks,types}.ts`,
  mock adapter i store — nowe typy/akcje

## Uruchamianie

- Rozpoznawanie loaderów: BepInEx`, MelonLoader`, doorstop marker",
  none" (matriks testów na tempdir)
- Instalacja loadera: GitHub `releases/latest` (bez tokenu); matchery
  zweryfikowane na realnych wydaniach: `BepInEx_win_x64_5.4.23.5.zip` ✓,
  `MelonLoader.x64.zip` ✓
- Wyszukiwanie okładek Steam bez klucza (term→items: AoH id 2186320,
  WorldBox id 1206560; obrazy 200 OK na cdn.cloudflare.steamstatic.com)

## Testy

- Rust: `cargo test` — 52 testy (40 unit + 12 integration), zielone
- Rust: `cargo clippy` — bez ostrzeżeń; `cargo fmt` — czysty
- Frontend: `bun run test` — 114 testów (11 plików), zielone
- `bunx tsc --noEmit` — czyste; `bun run build` — poprawny, ~0.9 s

## Różnice vs kontrakt

- Brak. Kontrakt w `docs/INTERFACES.md` jest mrozony od początku etapu; UI
  (lane ui-planner) i rdzeń implementowały dokładnie 6 komend z tych sekcji.

## Kryteria akceptacji

- [x] Wyszukiwanie i pobieranie okładki (Steam, bez klucza API)
- [x] Okładka z pliku lokalnego (PNG/JPEG/WebP, limit 10 MB)
- [x] Detekcja loadera + silnika + sugerowany loader (bez sieci)
- [x] Instalacja BepInEx 5.x / MelonLoader x64 z GitHub (walidacja ścieżek zip)
- [x] Drag&drop archiwum moda do folderu mody (zip/7z/rar, staging + walidacja)
- [x] Archiwum po instalacji trafia do kosza systemowego (XDG trash; nie rm)
- [x] Asset protocol ograniczony do katalogu `covers/`
- [x] Testy Rust 52/52, frontend 114/114, tsc/clippy czyste
- [ ] Test na żywo z użytkownikiem (okładki AoH/WorldBox, drop moda, Play .exe)
- [x] AppImage 0.1.0 zbudowany z tym etapem (111,57 MiB, 2026-10-18 11:35)
      i podmieniony na pulpicie (`~/Pulpit/Zen Launcher_0.1.0_amd64.AppImage`)

## Uwagi

- Sieciowe komendy są `async fn` (Tauri 2 synchroniczne uruchamia na wątku
  głównym); modyfikacje są wykrywane per gra typu Windows.
- Oversize/tuż tuż: okładka >10 MB i archiwum >512 MB odrzucane VALIDATION.
- Mod loader dla gier z innym typem niż Windows odrzucany VALIDATION.
