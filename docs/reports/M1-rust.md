# M1 — Rdzeń Rust (Tauri) — raport weryfikacyjny

Podstawa: commit `6163673` (`chore: scaffold Tauri 2 + React/TS app`). Wszystkie
zmiany poniżej leżą w niezacommitowanym drzewie roboczym.

Zakres: `src-tauri/**` (rdzeń, testy, fixtures). Przy scalaniu obu ścieżek
uzgodnienie kilku zachowań wymagało też drobnych zmian po stronie UI i kontraktu
(`docs/INTERFACES.md`, `src/lib/types.ts`, `src/lib/mock/**`) — opis w sekcji
„Różnice". Stan ścieżki frontendowej opisuje `docs/reports/M1-frontend.md`.

---

## Status

Zrobione i zweryfikowane lokalnie:

- Baza: SQLite (WAL, `foreign_keys=ON`, wersjonowana migracja v1 w
  `schema_migrations`), tabele `sources` / `candidates` / `games` / `sessions`
  + indeksy pomocnicze.
- Skaner: sygnatury silników (Unity, Godot, Unreal, GameMaker, Ren'Py) i
  fallback (bit wykonywalności + ELF, `.sh`, `.AppImage`); najgłębszy folder z
  plikiem wykonywalnym wygrywa; pomijanie katalogów strukturalnych i
  redystrybutorów/crash-handlerów/docs; nie podąża za symlinkami; pomija
  zatwierdzone podkatalogi przy ponownym skanie.
- Uruchamianie natywne: `cwd` = katalog pliku wykonawczego (albo `workDir` z
  walidacją istnienia), argumenty jako tablica, `env`; `.sh` przez `sh`;
  `.AppImage` z nadaniem bitu; nazwa względna rozwiązywana wobec
  `installPath`; brak pliku / brak bitu → `LAUNCH_FAILED`; typy nie-natywne →
  `UNSUPPORTED` (bez atrap).
- Sesje: wpis startowy tworzony przed spawnem, rollback przy nieudanym
  starcie (żadnych widm), supervisor czeka na proces i domyka sesję (czas,
  kod wyjścia), aktualizuje `total_seconds` / `last_played_at`, emituje
  `session-started`, `session-ended`, `library-changed`. Mutex bazy nigdy nie
  jest trzymany przez czas oczekiwania na proces.
- 15 komend IPC zgodnych z kontraktem (nazwy, argumenty, kształty odpowiedzi,
  kody błędów).
- Tray: **Show Zen Launcher** (show + focus) i **Quit**; zamknięcie okna
  chowa do tray przy `closeToTray` (domyślnie włączone); `hideOnLaunch` przy
  starcie gry. Ustawienia w `config.toml`, logi dzienne w katalogu danych.
- Uprawnienia: `dialog:allow-open`, `opener:allow-reveal-item-in-dir`.

Wynik komend (ostatni przebieg):

| Komenda | Wynik |
|---|---|
| `cargo fmt --check` | czysto |
| `cargo clippy --all-targets` | 0 ostrzeżeń |
| `cargo test` | **36 zielonych** (25 unit + 11 integracyjnych) |
| `cargo build` | OK |
| `bunx tsc --noEmit` | 0 błędów (kontrola międzywarstwowa) |
| `bun run test` | 63/63 w 5 plikach |
| `bun run build` | OK (JS 559 kB → 175 kB gzip) |

Czego **nie** zweryfikowałem: realnego okna i webview (WebKit) oraz pełnego
cyklu „uruchom grę → licznik → restart". To jest smoke test manualny
(instrukcja niżej) — `bun run tauri dev` nie był jeszcze uruchamiany.

---

## Pliki

| Plik | Linie | Rola |
|---|---|---|
| `src-tauri/src/lib.rs` | 106 | montaż: ścieżki, baza, ustawienia, tray, close-to-tray, logowanie, `invoke_handler` |
| `src-tauri/src/commands.rs` | 365 | powierzchnia IPC (jedno miejsce z mutexem bazy) |
| `src-tauri/src/db.rs` | 1022 | schemat + migracja + CRUD + testy jednostkowe |
| `src-tauri/src/models.rs` | 385 | typy domenowe i zdarzenia 1:1 z kontraktem |
| `src-tauri/src/scanner/mod.rs` | 755 | heurystyki skanera + reguły ignorowania |
| `src-tauri/src/launch.rs` | 304 | plan uruchomienia + supervisor sesji |
| `src-tauri/src/settings.rs` | 143 | TOML (walidacja, zapis atomowy) |
| `src-tauri/src/tray.rs` | 79 | ikona, menu, close-to-tray, hide-on-launch |
| `src-tauri/src/error.rs` | 84 | `AppError { code, message }` + konwersje |
| `src-tauri/src/state.rs` | 39 | muteksy bazy i ustawień |
| `src-tauri/src/paths.rs` | 44 | ścieżki danych/konfiguracji/logów |
| `src-tauri/src/time.rs` | 23 | ISO-8601 UTC |
| `src-tauri/src/main.rs` | 6 | entry point |
| `src-tauri/tests/scanner.rs` + `tests/fixtures/` | 193 | testy integracyjne skanera na drzewach fixture |

Uzgodnieniowo (ten sam changeset): `docs/INTERFACES.md`,
`src/lib/types.ts`, `src/lib/mock/index.ts`, `src/lib/mock/mock.test.ts`.

---

## Uruchamianie

```bash
cargo test --manifest-path src-tauri/Cargo.toml   # pełny zestaw rdzenia
bun run tauri dev                                 # cała aplikacja (WebKit)
bun run dev                                       # sam frontend (mock IPC)
```

Zależności systemowe (CachyOS/Arch): `webkit2gtk-4.1` + `patchelf`
(`sudo pacman -S --needed webkit2gtk-4.1 patchelf`). `webkitgtk-6.0` nie jest
używany przez Tauri 2.

### Smoke test M1 (ręczny, do wykonania)

1. `cd ~/Projekty/ZenLauncher && bun run tauri dev` (pierwsze uruchomienie
   kompiluje ~1–3 min).
2. **Sources & Import → Add folder** — wskaż folder z grami DRM-free
   (natywnymi), zeskanuj źródło.
3. Zatwierdź kandydata (przycisk Approve aktywny tylko, gdy jest plik
   wykonywalny).
4. **Play** — okno chowa się do tray (domyślnie), gra startuje; tray →
   Show wraca.
5. Zagraj chwilę, wyjdź z gry —— w szczegółach pojawia się sesja i rośnie
   „czas gry".
6. Zamknij okno (chowa się do tray), tray → Quit; uruchom `tauri dev` drugi
   raz — biblioteka, licznik i ustawienia przetrwały.

---

## Testy

Rdzeń: **25 testów jednostkowych + 11 integracyjnych** (wszystkie zielone):

- `db.rs` (9): migracja idempotentna i wersjonowana, pragmy (FK/WAL), CRUD
  źródeł, strategia upsertu kandydatów (decyzje approved/rejected zachowane),
  CRUD gier + czyszczenie pól przez `null`, walidacja edycji (puste
  `title`/`executable` → `VALIDATION`, wartości przycinane), usunięcie źródła
  odłącza kandydatów i nie rusza gier, usunięcie wpisu zabiera jego sesje,
  sesje najnowsze-pierwsze + limit.
- `scanner/mod.rs` (6): najgłębszy folder wygrywa, katalogi strukturalne nie
  są kandydatami, reguły ignorowania z kontraktu, czyszczenie tytułu, tokeny
  wersji, korzeń silnika bije zagnieżdżony plik wykonywalny.
- `launch.rs` (6): `.sh` przez `sh`, wymagany bit wykonywalności, `.AppImage`
  dostaje bit, ścieżka względna wobec `installPath`, brak pliku →
  `LAUNCH_FAILED`, typy nie-natywne → `UNSUPPORTED`.
- `settings.rs` (3): brak pliku → domyślne, częściowy plik, round-trip.
- `models.rs` (1): patch rozróżnia „pole nieobecne" od „pole = `null`".
- `tests/scanner.rs` (11, integracyjne na fixtures): detekcja silników,
  `.sh`/`.AppImage`, ELF bez bitu, brak pętli symlinków, redystrybutory /
  crash-handlery / docs pomijane, postęp skanu, pomijanie zatwierdzonych
  (także zagnieżdżonych) podkatalogów, najgłębszy folder.

Testy nie dotykają prawdziwych folderów gier (`tempdir` + `tests/fixtures/`),
zgodnie z `AGENTS.md`.

Kontrola międzywarstwowa (po uzgodnieniach): `bunx tsc --noEmit` 0 błędów,
`bun run test` 63/63, `bun run build` OK.

---

## Różnice

### Uzgodnienie ścieżek Rust ⇄ UI (znalezione przy scalaniu, naprawione)

1. **Usuwanie a klucze obce (realny błąd).** Kontrakt i UI obiecują:
   „usuwamy tylko folder źródłowy — kandydaci i wpisy zostają", a mock usuwał
   wpis razem z historią sesji. Rdzeń z `foreign_keys=ON` rzucałby
   `FOREIGN KEY constraint failed` przy `remove_source` po skanie oraz
   zostawiał sieroty po `remove_game`. Migracja v1 (jeszcze nie wydana — baza
   powstaje po raz pierwszy w M1) poprawiona w miejscu:
   - `candidates.source_id` → `NULL` przy usunięciu źródła
     (`ON DELETE SET NULL`, kolumna nullable),
   - `sessions.game_id` → kaskada (`ON DELETE CASCADE`).
   Kontrakt zaktualizowany w tym samym changesecie; dodane testy
   regresyjne w `db.rs`.
2. **`update_game`: czyszczenie pól przez `null` (realny błąd).** UI wysyła
   `workDir: null`, gdy pole zostaje wyczyszczone, a mock/kontrakt definiują
   `null` jako „wyczyść". Rdzeń traktował `null` jako „bez zmian" — czyszczenie
   katalogu roboczego działałoby w mocku, a w prawdziwej aplikacji po cichu
   nie. `GamePatch` rozróżnia teraz „pole nieobecne" od `null`
   (deserializacja podwójnego `Option`), puste `title`/`executable` są
   odrzucane kodem `VALIDATION` i przycinane. Semantyka zapisana w kontrakcie.
3. **`add_source` idempotentny.** Rdzeń zwracał istniejący wiersz dla już
   znanego folderu; mock rzucał `VALIDATION`. Ujednolicone na zachowanie
   rdzenia (dodanie znanego folderu = sukces, ten sam wiersz), mock i jego
   test zaktualizowane, dopisek w kontrakcie.
4. **`Candidate.sourceId` może być `null`.** Konsekwencja pkt 1 (odłączony
   kandydat); zaktualizowane `types.ts`, mock (odłącza kandydatów przy
   usunięciu źródła) i kontrakt.
5. **Dwie kosmetyczne poprawki clippy** (`collapsible_if`) w `lib.rs` i
   `scanner/mod.rs` — `cargo clippy --all-targets` bez ostrzeżeń.

### Uzgodnienie luk z raportu frontendu (`docs/reports/M1-frontend.md`)

| Luka | Rozstrzygnięcie |
|---|---|
| #1 `UiErrorCode`/`UNKNOWN` po stronie UI | akceptowane — nie przekracza IPC |
| #2 `AppError.message` nietłumaczalny | akceptowane na M1 (do rewizji z i18n w M5) |
| #3 kaskada sesji przy `remove_game` | **domknięte w rdzeniu** (CASCADE + test) |
| #4 brak `get_paths` | akceptowane — stałe z DESIGN §7, read-only w M1 |
| #5 `hidden`/`sortTitle`/`coverPath` bez UI | akceptowane (M3) |
| #6 brak operacji wsadowych | akceptowane (sekwencja w store z raportem częściowych porażek) |
| #7 `pickDirectory` jako rozszerzenie API | akceptowane (tylko tytuł dialogu) |
| #8–#17 decyzje projektowe | akceptowane bez zmian |

### Świadome granice M1 (bez atrap)

- Typy `windows` / `retro` / `mod` → `UNSUPPORTED` (Wine/Proton/RetroArch to
  M2+); UI wyłącza Play z wyjaśnieniem.
- Auto-skan (watcher), metadane, okładki, mody, sejwy, gamepad, Big Picture —
  kolejne milestone'y (kontrakt §„M1 exclusions").
- Znany niuans (nie błąd): dedupe kandydatów jest per źródło, więc po
  usunięciu źródła i ponownym dodaniu tego samego folderu odłączony kandydat
  i nowy wpis mogą wskazywać tę samą ścieżkę. Polityka dedupe do ustalenia
  razem z watcherem (M2).

---

## Kryteria akceptacji

Kryterium M1 (DESIGN §8): **skan → zatwierdzenie → uruchomienie → licznik
czasu → trwałość po restarcie**, dla gier natywnych.

| Kryterium | Dowód |
|---|---|
| Dodaj folder → skan znajduje kandydatów | 11 testów integracyjnych skanera + `candidate_upsert_keeps_decisions`; pełny przebieg w smoke teście |
| Zatwierdzenie tworzy wpis w bibliotece | `db.rs` (CRUD gier, dedupe po ścieżce) + mock UI; smoke |
| Uruchomienie natywnej gry | `launch.rs` (6 testów planu) + walidacje `LAUNCH_FAILED`/`UNSUPPORTED`; smoke |
| Zliczanie czasu gry | testy sesji w `db.rs` (start, domknięcie, najnowsze-pierwsze, `total_seconds`, `last_played_at`); proces → smoke |
| Trwałość po restarcie | plik SQLite + migracja idempotentna (test) + TOML; smoke |
| Tray: Show/Quit, close-to-tray, hide-on-launch | kod + uprawnienia; smoke |
| Kontrakt 1:1 między warstwami | `models.rs` ↔ `src/lib/types.ts`; zmiany kontraktu w tym samym changesecie |
| Zero atrap | nie-natywne typy jawnie `UNSUPPORTED`; „M1 exclusions" z kontraktu |

Jedynym elementem bez dowodu z tej ścieżki pozostaje smoke test manualny
(`bun run tauri dev`, kroki wyżej) — należy do właściciela.
