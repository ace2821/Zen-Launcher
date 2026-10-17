# M1 — Frontend (React UI) — verification report

Podstawa: commit `6163673` (`chore: scaffold Tauri 2 + React/TS app`). Wszystkie
zmiany poniżej leżą w niezacommitowanym drzewie roboczym.

Zakres: wyłącznie `src/**`, `index.html`, `package.json`, `vite.config.ts`,
`vitest.config.ts`, `public/`. **`src-tauri/**` nie zostało zmienione** — rdzeń
Rust prowadzi równoległa ścieżka.

---

## Status

Zrobione i zweryfikowane lokalnie:

- Warstwa IPC (`types.ts` 1:1 z `docs/INTERFACES.md`, `ipc.ts`, `mock/`) —
  wybór adaptera: `VITE_MOCK=1` → mock, brak `window.__TAURI_INTERNALS__` → mock,
  inaczej Tauri.
- Shell aplikacji (sidebar + header + przełączanie widoków), „Ink & Jade”:
  głęboka neutralna paleta, jeden akcent (jade), tokeny CSS, promienie 10–14 px,
  przejścia 120–200 ms, ziarno + jedna poświata radialna.
- Biblioteka: wirtualizowany grid okładek + tabela, wyszukiwanie, sortowanie
  (tytuł / ostatnio grane / czas gry), ulubione przez `update_game`, akcje
  Play/Reveal/Remove, deterministyczna okładka zastępcza (gradient + inicjały),
  trzy stany puste (brak gier, brak wyników, błąd inicjalizacji).
- Import: źródła (dodawanie przez `plugin-dialog` za warstwą api, skanowanie z
  postępem z `scan-progress` i podsumowaniem z `scan-finished`), karty kandydatów
  z edytowalnym tytułem i plikiem wykonywalnym, silnikiem, pewnością, przesłankami
  i ścieżką; Approve/Reject oraz Approve all/Reject all; badge w sidebarze
  aktualizuje się przez `library-changed`.
- Szczegóły: hero, Play (`launch_game`), edytor opcji uruchamiania (plik
  wykonywalny, argumenty jako tekst z podglądem sparsowanej tablicy, katalog
  roboczy, zmienne `KEY=value`), notatki z autosave po debounce, historia sesji
  (ograniczona do 10 przez warstwę api), Reveal, Remove, fakty wpisu.
- Ustawienia: EN/PL przez `i18next`, `closeToTray` / `hideOnLaunch` przez
  `update_settings`, ścieżki danych (read-only) i wersja aplikacji.
- UX: system toastów (`AppError.code` + komunikat), skeletony, modal potwierdzeń
  z gwarancją „pliki na dysku zostają nietknięte”.

Wynik komend (ostatni przebieg):

| Komenda | Wynik |
|---|---|
| `bunx tsc --noEmit` | 0 błędów |
| `bun run test` | 5 plików, **62 testy, wszystkie zielone** |
| `bun run build` | `tsc` + `vite build` OK (JS 559 kB → 175 kB gzip, CSS 36 kB → 8 kB gzip) |

Czego **nie** weryfikowałem: wyglądu w prawdziwym webview (WebKit). Renderowanie
sprawdziłem w jsdom (testy) i przez uruchomiony serwer dev (HTTP 200 + poprawna
transformacja modułów), natomiast wizualna ocena w oknie Tauri należy do ścieżki
Rust — świadomie nie uruchamiałem `tauri dev`, żeby nie wchodzić w jej proces.

---

## Pliki

### Wejście i konfiguracja

| Plik | Rola |
|---|---|
| `index.html` | `lang`, favicon `zen.svg`, kolor tła przed pierwszym renderem, `color-scheme: dark`, tytuł |
| `src/main.tsx` | synchroniczna inicjalizacja i18n (`initAsync: false`), montaż Reacta, import `global.css` |
| `src/App.tsx` | `MotionConfig reducedMotion="user"` + `AppShell` |
| `src/vite-env.d.ts` | typy `VITE_MOCK` i `__APP_VERSION__` |
| `vite.config.ts` | `define: __APP_VERSION__` z `package.json`; reszta konfiguracji Tauri bez zmian |
| `vitest.config.ts` | jsdom, `setupFiles`, `include src/**/*.test.*` |
| `package.json` | skrypty `test` / `test:watch`; zależności runtime: zustand, i18next, react-i18next, @tanstack/react-virtual, lucide-react, motion, @tauri-apps/plugin-dialog |

### `src/lib/` — kontrakt, IPC, logika czysta

| Plik | Rola |
|---|---|
| `types.ts` | lustro `docs/INTERFACES.md` 1:1 (typy, błędy, zdarzenia) |
| `api.ts` | interfejs `LauncherApi`, wybór implementacji, `isMock` |
| `ipc.ts` | `invoke` + `listen` w Tauri (leniwe importy), normalizacja odrzuceń do `UiAppError` |
| `mock/data.ts` | deterministyczny seed: 3 źródła, 13 kandydatów (8 pending), 11 gier (native/windows/retro/mod, w tym jedna `missing`), 24 sesje |
| `mock/index.ts` | adapter w pamięci: skan z postępem, sesje z timerem, walidacje, `reset()`, `revealedPaths` |
| `errors.ts` | `UiErrorCode` / `UiAppError` (+ UI-owy `UNKNOWN`), `toUiError` |
| `filter.ts` | wyszukiwanie odporne na polskie znaki + sortowanie |
| `args.ts` | `parseArgs` / `stringifyArgs` (cudzysłowy, escapy) i `parseEnvLines` / `stringifyEnv` |
| `format.ts` | czas gry, czas sesji, daty bezwzględne, daty względne (`Intl.RelativeTimeFormat`) |
| `cover.ts` | paleta okładki z hasza tytułu + inicjały |
| `hooks.ts` | `useFormatters`, `useGameLabels`, `useLaunchAvailability`, `useContainerWidth`, `useDebouncedValue` |
| `paths.ts` | ścieżki z dokumentu projektowego (Ustawienia, read-only) |

### `src/i18n/`, `src/store/`, `src/styles/`

- `i18n/en.ts` (zasób referencyjny), `i18n/pl.ts` (typowany jako `TranslationShape`,
  więc brakujący lub przekręcony klucz to błąd kompilacji), `i18n/index.ts`
  (init, `setLanguage`, `translate`, wykrycie języka przeglądarki, `html[lang]`).
- `store/library.ts` (dane + wszystkie akcje), `store/selectors.ts` (pochodne),
  `store/shell.ts` (widok/szukanie/sort/układ, persist dla sort+layout),
  `store/toasts.ts`, `store/confirm.ts`.
- `styles/tokens.css`, `styles/fonts.css`, `styles/global.css` (reset, rytm,
  ziarno, scrollbary, keyframes, `prefers-reduced-motion`).

### `src/components/`, `src/views/`

- `ui/`: Button/IconButton, Badge/Chip/CountBadge, Field (`TextField`,
  `TextAreaField`, `SelectField`, `SwitchField`, `Segmented`), Modal (pułapka
  fokusa, Escape, przywrócenie fokusu), ConfirmHost, Toaster, Feedback
  (Meter, Skeleton, ProgressBar, EmptyState) + `ui.module.css`.
- `layout/`: `AppShell.tsx`, `Sidebar.tsx`, `Header.tsx`, `ZenMark.tsx`,
  `layout.module.css`.
- `page/page.module.css`: wspólny szkielet stron (scroll, kolumna, panel, fakty).
- `library/`: `GameGrid.tsx` (wirtualizacja `@tanstack/react-virtual`),
  `GameTable.tsx`, `GameCard.tsx`, `GameCover.tsx`.
- `import/`: `SourceRow.tsx`, `CandidateCard.tsx`.
- `details/`: `LaunchOptionsPanel.tsx`, `NotesPanel.tsx`, `FactsPanel.tsx`,
  `SessionHistory.tsx`.
- `views/`: `LibraryView.tsx`, `ImportView.tsx`, `GameDetailsView.tsx`,
  `SettingsView.tsx`.

### Testy i assety

- `src/test/setup.ts`, `src/test/harness.ts`,
  `src/lib/mock/mock.test.ts`, `src/lib/filter.test.ts`, `src/lib/args.test.ts`,
  `src/views/ImportView.test.tsx`, `src/views/views.smoke.test.tsx`.
- `src/assets/fonts/` — 5 plików woff2 (Instrument Sans + Instrument Serif) i
  `OFL.txt`; `public/zen.svg` (favicon).

Usunięte resztki szablonu: `src/App.css`, `src/assets/react.svg`,
`public/vite.svg`, `public/tauri.svg` (żaden plik w repo już ich nie
referencjonuje; ikony aplikacji Tauri są w `src-tauri/icons/`, nienaruszone).

Skala: ~9 030 linii źródła (TS/TSX/CSS) + ~890 linii testów.

---

## Uruchamianie

```bash
bun install          # zależności frontendu
bun run dev          # tryb mock: http://localhost:1420
bun run test         # vitest (jsdom)
bun run build        # tsc + vite build
```

### Tryb mock — jak kliknąć całość

`bun run dev` wystarczy: w zwykłej przeglądarce nie ma `window.__TAURI_INTERNALS__`,
więc `src/lib/api.ts` wybiera adapter w pamięci. Wymuszenie: `VITE_MOCK=1 bun run dev`.

Proponowana ścieżka:

1. **Biblioteka** — 11 gier; przełącz grid/tabelę (ikony przy wyszukiwaniu),
   posortuj po „Playtime”, wpisz np. `zolc` w wyszukiwaniu (polskie znaki są
   składane), kliknij gwiazdkę i otwórz kartę.
2. **Szczegóły** (np. Hollow Knight) — Play startuje sesję (timer mockowy zamyka ją
   po ~15 s i odświeża historię), zmień argumenty na `-fullscreen --name "Player One"`
   (podgląd pokazuje tablicę), dodaj linię `MANGOHUD=1`, zapisz; wróć do biblioteki.
   „Rogue Legacy” ma `status: missing`, więc Play jest wyłączony z wyjaśnieniem;
   wpisy `mod`/`windows`/`retro` są wyłączone z podpowiedzią o M2+.
   Reveal jest ukryty w mocku (nie ma menedżera plików).
3. **Sources & Import** — dodaj folder (mock zwraca gotową ścieżkę), zeskanuj
   źródło (pasek postępu + licznik), przejrzyj kandydatów: popraw tytuł, zatwierdź,
   odrzuć, „Approve all”; „Kenney Bundle” i „Rondo of Blood” nie mają wykrytego
   pliku wykonywalnego, więc Approve jest zablokowany. Badge w sidebarze zmienia się
   od razu, a zatwierdzeni kandydaci pojawiają się w Bibliotece.
4. **Ustawienia** — przełącz na Polski (cały interfejs, `html[lang]`), przełącz
   zachowanie okna, zobacz ścieżki danych (read-only) i tryb IPC „Mock (in-memory)”.
5. **Gry** — usuń wpis: modal pokazuje ścieżkę i informuje, że pliki na dysku
   zostają nietknięte.

Tryb rzeczywisty (rdzeń Rust): `bun run tauri dev` — poza zakresem tej ścieżki.

---

## Testy

```bash
bun run test          # 5 plików, 62 testy
bunx tsc --noEmit     # 0 błędów
bun run build         # tsc + vite build
```

| Plik | Co sprawdza |
|---|---|
| `src/lib/mock/mock.test.ts` (24) | seed i jego kopiowanie, skan (postęp → `scan-finished` → kandydaci `pending`), duplikaty i błędne ścieżki źródeł, zatwierdzanie (nadpisany tytuł/ścieżka, inferencja `.exe`, „plik zniknął”), odmowy bez pliku wykonywalnego i przy ponownej decyzji, `VALIDATION`/`NOT_FOUND` w `update_game`, round-trip `args`/`env`/`workDir`, launch tylko `native` + realnie zainstalowany (`UNSUPPORTED`, `IO`), pełny cykl sesji (`session-started` → koniec → `session-ended`), limit i kolejność sesji, `remove_game` (+ jego historia), walidacja ustawień, `pickDirectory`, `reset()`, odpinanie listenerów |
| `src/lib/filter.test.ts` (11) | składanie polskich znaków, dopasowanie po tytule/tagach/ścieżce, wszystkie słowa muszą trafić, trzy tryby sortowania, brak mutacji wejścia |
| `src/lib/args.test.ts` (15) | tokenizacja, oba typy cudzysłowów, escapy, pusty argument, niezamknięty cudzysłów, `KEY=value` z komentarzami i `export`, ostatnia duplikacja wygrywa, numer błędnej linii, round-trip parsowania i serializacji |
| `src/views/ImportView.test.tsx` (6) | lista źródeł i kandydatów, zatwierdzenie pojedynczego, blokada Approve bez pliku wykonywalnego, Approve all (6 zatwierdzonych, 2 pominięte), Reject all po potwierdzeniu w modalu, przeniesienie odrzuconego do zakładki „Rejected” |
| `src/views/views.smoke.test.tsx` (6) | shell (sidebar/header/grid + licznik „Shown: 11 / 11”), nawigacja do importu, przełączenie grid/table, stan „brak wyników”, szczegóły (hero, opcje uruchamiania, historia sesji, Play zablokowany przy `missing`, zapis argumentów, komunikat o niezamkniętym cudzysłowie), ustawienia (zmiana języka → `Język`, przełącznik → `update_settings`, ścieżki, tryb mock), widok importu |

Testy działają w `jsdom`, który nie ma silnika layoutu. Dlatego `src/test/setup.ts`
dodaje: stub `ResizeObserver`, stub `matchMedia` (dla `motion`) oraz nominalny
rozmiar `clientWidth`/`clientHeight` — bez tego wirtualizator uznawałby kontener za
pusty i nie montował wierszy. To ograniczenie środowiska testowego, nie obejście
logiki aplikacji. Testy nie dotykają prawdziwych folderów gier (wyłącznie adapter
w pamięci), zgodnie z `AGENTS.md`.

Dodatkowo wykonane ręcznie: `bun run dev` → `GET /` 200, `GET /src/main.tsx` 200,
`GET /src/App.tsx` 200 (poprawna transformacja modułów).

---

## Różnice

### Luki w kontrakcie (nie wymyślałem pól, tylko je opisuję)

1. **Brak kodu błędu dla UI.** Kontrakt zna wyłącznie kody rdzenia, a interfejs
   musi opisać także porażki z warstwy wtyczek (dialog, opener) i wyjątki JS.
   Dodane lokalnie `UiErrorCode` / `UiAppError` z jednym kodem `UNKNOWN`
   (`src/lib/errors.ts`). `types.ts` pozostaje 1:1 z kontraktem; `UNKNOWN` nigdy nie
   przekracza granicy IPC.
2. **`AppError.message` nie jest tłumaczalny.** W kontrakcie to zwykły `String`
   rdzenia. Pokazuję go dosłownie (w toaście) i dokładam wyłącznie zlokalizowany
   tytuł oraz kod — inaczej trzeba by wprowadzić kody komunikatów.
3. **`remove_game` milczy o historii sesji.** Reguła kaskady dla `sessions` nie jest
   zapisana. Mock usuwa wpis **razem z jego sesjami**, żeby nie zostawały sieroty,
   i UI zakłada, że historia znika razem z wpisem. Do potwierdzenia z rdzeniem.
4. **Brak komendy na ścieżki danych.** Kontrakt M1 nie ma `get_paths`, a
   dokument projektowy ustala je na sztywno (§7). Ustawienia pokazują je jako
   stałe z `src/lib/paths.ts` z podpisem „read-only w M1”. Gdy pojawi się komenda,
   moduł staje się jej fallbackiem.
5. **Pola bez powierzchni w UI.** `hidden`, `sortTitle` i `coverPath` są lustrem
   kontraktu i przechodzą przez `update_game`, ale M1 nie ma UI, który miałby je
   sensownie ustawiać (kolekcje/metadane to M3) — świadomie brak kontrolek-atrap.
6. **Brak operacji wsadowych.** Kontrakt zna tylko `approve_candidate` /
   `reject_candidate` pojedynczo. „Approve all” to sekwencja wywołań w store
   z raportem częściowych porażek („Skipped (no executable): n”, „Failed: n”),
   a nie osobna komenda.
7. **`pickDirectory(options?)` nie jest komendą.** To rozszerzenie `LauncherApi`
   (UI-only), żeby tytuł systemowego dialogu dał się zlokalizować; w Tauri to
   `plugin-dialog open({ directory: true })`, w mocku gotowa ścieżka.

### Decyzje projektowe

8. **Bez `@tanstack/react-query`.** Dla M1 store zustand + jawne odświeżanie po
   `library-changed` jest prostszy, a warstwa api pozostaje jedynym źródłem prawdy.
   Gdy dojdą metadane i cache okładek (M3), warto wrócić do tematu.
9. **`useLaunchAvailability`.** Play jest wyłączony, gdy `status !== "ready"` lub
   `type !== "native"` — dokładnie te przypadki, w których rdzeń zwraca `IO` i
   `UNSUPPORTED`; nigdy nie oferujemy przycisku, który z góry wiadomo, że padnie.
   Zablokowanie jest zawsze wyjaśnione podpowiedzią.
10. **Reveal ukryty w mocku** (`isMock`) — adapter nie ma menedżera plików, więc
    akcja byłaby atrapą.
11. **Kandydat bez pliku wykonywalnego nie da się zatwierdzić** (przycisk
    zablokowany + komunikat + wpis w podsumowaniu zbiorczym). Mock odrzuca taki
    approve kodem `VALIDATION`, tak samo jak zrobi to rdzeń.
12. **Auto-skan jest M2.** Zamiast martwego przełącznika widok importu mówi wprost,
    że automatyczne skanowanie źródeł przyjdzie z obserwatorem w M2.
13. **Tagi są read-only w M1** — panel faktów pokazuje je z notką, że edycja
    przyjdzie z M3.
14. **i18n kompletne w M1** (PL w 100%), choć dokument projektowy umieszcza to
    dopiero w M5 — wymóg zadania. `pl.ts` jest typowany strukturą `en.ts`, więc
    rozjazd kluczy to błąd kompilacji, a liczby są formatowane jako `label: value`
    (bez kluczy mnogich; daty względne przez `Intl.RelativeTimeFormat`).
15. **Mock to jedyne miejsce z zegarem.** `MockOptions { scanStepMs, sessionMs, now }`
    istnieje po to, żeby testy były deterministyczne (stała data `SEED_NOW`).
16. **Rozmiar bundla**: 559 kB (175 kB gzip) w jednym chunku. To głównie React 19 +
    `motion` + i18next; ikony z `lucide-react` są tree-shake'owane (nieużywana ikona
    nie trafia do bundla — sprawdzone). Code-splitting to temat na późniejszy
    milestone, bo M1 to jedna aplikacja desktopowa.
17. **Wyszukiwanie i sortowanie są liczone w UI**, nie w rdzeniu: `filterGames` /
    `sortGames` operują na migawce z `list_games`, dzięki czemu są czystymi,
    testowalnymi funkcjami i nie wymagają zmian w kontrakcie.

---

## Kryteria akceptacji

Wymagania M1 dla frontendu (dokument projektowy §8 + karta zadania) i dowód:

| Kryterium | Dowód |
|---|---|
| `bun run build` zielone, zero błędów `tsc` | przebieg `tsc && vite build` — OK, 0 błędów |
| `bun run test` zielone | 62/62 testy w 5 plikach |
| Tryb mock w pełni klikalny | `bun run dev` → adapter w pamięci; testy `views.smoke` renderują prawdziwy `App` na prawdziwym adapterze; ścieżka klikania opisana wyżej |
| Typy 1:1 z kontraktem | `src/lib/types.ts`; `apply_candidate`/`update_game`/`list_sessions` itd. zgodne z `docs/INTERFACES.md` (nazwy komend, argumentów i zdarzeń) |
| Warstwa IPC: `invoke` + `listen`, mock ≥ 8 gier | `src/lib/ipc.ts`, `src/lib/mock/` (11 gier, 3 źródła, 13 kandydatów, 24 sesje) |
| Wybór mocka: `VITE_MOCK=1` lub brak Tauri | `resolveApiKind()` w `src/lib/api.ts` |
| Sidebar: Library / Sources & Import (badge) / Settings | `src/components/layout/Sidebar.tsx`; badge = liczba `pending`, aktualizowana przez `library-changed` |
| Header: wyszukiwanie, grid/list, sort (tytuł / ostatnio grane / czas gry) | `src/components/layout/Header.tsx` + `src/lib/filter.ts` |
| Grid okładek z wirtualizacją + tabela | `GameGrid.tsx` (`@tanstack/react-virtual`), `GameTable.tsx` |
| Okładka zastępcza: gradient + inicjały | `src/lib/cover.ts` + `GameCover.tsx` |
| Akcje: Play, Reveal (ukryty w mocku), Remove z modalem „pliki zostają na dysku” | `GameCard.tsx`, `GameDetailsView.tsx`, `store/confirm.ts` + `ConfirmHost.tsx`; tekst: `library.removeBody` |
| Ulubione przez `update_game`, tagi tylko do odczytu | `toggleFavorite` (optymistycznie + rollback), `FactsPanel.tsx` |
| Import: dodawanie źródeł przez `plugin-dialog`, skan z postępem i podsumowaniem | `api.pickDirectory`, `store.scanSource`, `scan-progress` / `scan-finished`, `SourceRow.tsx` |
| Przegląd kandydatów: tytuł, silnik, pewność, przesłanki, ścieżka + Approve/Reject + wsadowo | `CandidateCard.tsx`, `ImportView.tsx` |
| Szczegóły: hero, Play, edytor opcji uruchamiania, notatki z autosave, historia 10 sesji, Reveal, Remove | `GameDetailsView.tsx`, `LaunchOptionsPanel.tsx`, `NotesPanel.tsx`, `SessionHistory.tsx` |
| Argumenty jako tekst → `string[]` z obsługą cudzysłowów | `src/lib/args.ts` (+ `args.test.ts`) |
| Ustawienia: EN/PL, `closeToTray`, `hideOnLaunch`, ścieżki read-only, wersja | `SettingsView.tsx`, `i18n/{en,pl}.ts`, `STORAGE_PATHS`, `__APP_VERSION__` |
| Wszystkie napisy w i18n, PL kompletne | brak literałów w komponentach; `pl.ts` typowane `TranslationShape` |
| Toast dla `AppError {code, message}`, skeletony, modal potwierdzeń | `store/toasts.ts` + `Toaster.tsx`, skeletony w każdym widoku, `ConfirmHost.tsx` |
| Zero `any`, sensowna struktura katalogów | grep `: any` / `as any` = 0; `src/{lib,i18n,store,styles,components/{ui,layout,library,import,details,page},views,test}/` |
| Usunięte resztki szablonu | `App.css`, `react.svg`, `vite.svg`, `tauri.svg` usunięte; `index.html` bez logotypów szablonu |
| `src-tauri/**` nietknięte | `git status` nie pokazuje zmian w tej ścieżce po mojej stronie* |

\* W drzewie roboczym widać zmiany w `src-tauri/` — pochodzą z równoległej ścieżki
Rust, nie z tej pracy. Ścieżka frontendowa nie dotykała tych plików.
