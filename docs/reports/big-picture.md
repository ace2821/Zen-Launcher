# Raport: M2.x — Big Picture, ustawienia v3, mody v2, GameMode/MangoHud

## Status

Zakończony. Rdzeń + UI + mock spójne ze zmarzniętą częścią kontraktu
`docs/INTERFACES.md` (Settings v3, Covers auto-install, Mods v2, Gamepad &
Big Picture, events table: `gamepad-event`).

Commity (this slice):
- `4840098` feat(core) — settings v3, katalog loaderów, lenient walidacja,
  GameMode/MangoHud, auto-okładki, most gilrs
- `6c7ea83` feat(ui) — Big Picture, settings v3, ModsPanel v2, polerka
- `docs` — ten raport

## Pliki (kluczowe)

- `src-tauri/src/settings.rs`, `models.rs` — 6 nowych ustawień + walidatory,
  delta-TOML backwards-compat (stare config.toml → defaults)
- `src-tauri/src/mods.rs` — katalog 4 loaderów (bepinex5, melonloader,
  bepinex6mono, bepinex6il2cpp), `ModsStatus.supported` + `loaders`,
  `install_loader(gameId, loaderId?)`, leniwy walidator (symlinki skip vs
  refuse), limity z ustawień
- `src-tauri/src/launch.rs` — `LaunchExtras` (GameMode wrap via PATH-scan,
  MANGOHUD=1 + MANGOHUD_DLSYM=1)
- `src-tauri/src/input.rs` — gilrs 0.11 wątek: `gamepad-event` (przyciski +
  syntetyczne kierunki stika z 120 ms auto-repeatem), `pad_kind()` detekcja
  PS/Xbox, `list_gamepads()`
- `src-tauri/src/commands.rs` — list_gamepads zwraca `{ pads: [...] }`
  (kształt z kontraktu)
- `src/components/bigpicture/*` + `src/views/BigPictureView.tsx` — konsolowe
  menu na pełny ekran: szyna kafli, fokus z glow, panel szczegółów, motyw
  glyphów xbox/playstation (autentyczne kolory Sony), wyjście Esc/Start/✕
- `src/lib/gamepad.ts` — tłumaczenie eventów na intencje nawigacyjne
- `src/views/SettingsView.tsx` — 4 nowe sekcje ustawień z optymistycznymi
  zapisami i rollbackiem
- `src/components/details/ModsPanel.tsx` — v2: katalog loaderów z etykietą
  „zalecany", stan „brak wsparcia dla modów", tryb walidacji na dropzone
- mock adapter — kompletna symulacja nowych kształtów (w tym sesje Wine)

## Uruchamianie

- Tryb konsolowy z headera biblioteki lub pada; pełny ekran przez
  `getCurrentWindow().setFullscreen` (perm `core:window:allow-set-fullscreen`)
- Nawigacja: dpad/drążek (auto-repeat), ✕/A = zatwierdzenie, ○/B = powrót,
  Start = powrót do biblioteki
- GameMode: tylko gdy `gamemoderun` na PATH (best-effort), MangoHud: env

## Testy

- Rust: 55 (43 unit + 12 integration), `cargo clippy` czysty
- Frontend: 178 testów / 16 plików, `bunx tsc --noEmit` czysty
- Nowe w frontecie: BigPictureView (17), gamepad (10), settings/store (14),
  toasts (8), i18n parity test (4)

## Różnice / decyzje

- „Tryb konsolowy" to widok w istniejącym shell store, nie route `#/...`
  (aplikacja nie ma routera) — deep-link był by nowym wymaganiem
- Kolory keycapów PS wg autentycznego Sony (✕ niebieski, ○ czerwony)
- Mock nie symuluje limity rozmiaru/symlinków (brak plików na dysku) —
  testowalne tylko na prawdziwym rdzeniu
- `list_gamepads` zwraca z rdzenia kształt `{pads}` a UI toleruje też
  ładowanie surowej tablicy (obronność na stronie kontraktu)

## Kryteria akceptacji

- [x] Łagodniejszy walidator (default leniwy; strict opt-in; symlinki skip)
- [x] Więcej opcji ustawień (6 pól w 4 sekcjach, z persystencją TOML)
- [x] Tryb Big Picture z supporting pada PS i Xbo x (2 układy glyphów)
- [x] Auto-instalacja okładek przy zatwierdzaniu (Steam, fallbacki)
- [x] GameMode i MangoHud (best-effort wrap + env)
- [x] Więcej loaderów (4 w katalogu wg popularności) + „brak wsparcia"
  stan dla silników spoza Unity
- [ ] Test na żywo z użytkownikiem
- [ ] Push do GitHuba
