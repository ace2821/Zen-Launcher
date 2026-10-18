# Raport: wizualne ulepszenia Big Picture + zarządzanie modami

## Status

Zakończone i zweryfikowane. Big Picture obsługuje dwie zakładki w panelu szczegółów (Info / Mods), panel modów jest reużywany z `<ModsPanel>`, nawigacja padem działa przez L1/R1 (łopatki) i strzałki w panelu modów, a South aktywuje fokusowany przycisk.

## Pliki

Zmienione (tylko z listy MOŻESZ):

- `src/views/BigPictureView.tsx` — zakładki Info/Mody, ref na ModsPanel, intencje L/R i strzałek w panelu modów, klawiatura Q/E, wywołanie DetailsPanel z `activeTab`/`onTabChange`/`modsPanelRef`/`theme`.
- `src/views/BigPictureView.test.tsx` — 6 nowych testów: przełączanie zakładek padem (L1/R1), przełączanie klawiatą (Q/E), render ModsPanel w BP z katalogiem loaderów, komunikat unsupported bez przycisków, instalacja loadera przez BP z wywołaniem w mocku.
- `src/components/bigpicture/Glyph.tsx` — `PromptButton` importowane z `types.ts`, glyphy L1/R1 dla `leftTrigger`/`rightTrigger`.
- `src/components/bigpicture/bigpicture.module.css` — `.tabStrip`, silny focus ring (`outline: 2px solid var(--accent)`) na przyciskach zakładek i panelu, kolory glyphów L1/R1.
- `src/components/details/ModsPanel.tsx` — `forwardRef` z handle (`focusFirst`/`focusNext`/`focusPrevious`/`activateFocused`), prop `compact` i `gamepad`, sekcja `sectionRef` z `querySelectorAll` na przyciski, `handlePanelKeyDown` (strzałki cycle, Enter/Space aktywuje), nowy przycisk "Otwórz folder modów" (`api.revealItemInDir`), w compact mode FolderOpen w dropzone, przyciski `size="md"`.
- `src/components/details/details.module.css` — klasa `.compact` (ciasniejszy panelHead, wyższe przyciski, wyraźny focus ring).
- `src/lib/gamepad.ts` — `NavIntent` rozszerzone o `leftBumper`/`rightBumper`, `BUTTON_INTENTS`: `LeftTrigger` → `leftBumper`, `RightTrigger` → `rightBumper`.
- `src/lib/gamepad.test.ts` — usunięto `LeftTrigger` z listy unmapped, dodano describe dla shoulder triggers.
- `src/lib/types.ts` — nowy typ `PromptButton` (south/east/west/north/start/leftTrigger/rightTrigger).
- `src/i18n/en.ts` + `src/i18n/pl.ts` — nowe klucze: `bigPicture.panelTabInfo`, `panelTabMods`, `hintShoulderLeft`, `hintShoulderRight`, `mods.openFolder`, `mods.revealFailed`.

Nienaruszone (lista NIE MOŻESZ): `src-tauri/`, `git`, `components/library/**`, `views/GameDetailsView.tsx`, `Header.tsx`, ustawienia widoku, `mock/index.ts` (nie było potrzeby nic dopisywać — `revealItemInDir`, `installModLoader`, `modsStatus` już istnieją w mocku).

## Uruchamianie

- `bun run test` — 16 plików, 184 testów, wszystkie zielone.
- `bunx tsc --noEmit` — czyste, bez błędów.
- `bun run build` — sukces (jedynie istniejący warning o rozmiarze chunku >500 kB).

## Różnice w wizualiach (3–5 punktów)

1. Panel szczegółów ma pasek zakładek (Info / Mody) pod tytułem gry z glyphami L1/R1 — aktywna zakładka nosi wariant `primary`, nieaktywna `ghost`, z `aria-pressed`.
2. Scrim ma `backdrop-filter: blur(10px)` i panel wjeżdża ruchem `motion` (opacity + scale) — wejście/wyjście z snapem.
3. Silny focus ring (`2px solid var(--accent)`, offset 2px) na przyciskach zakładek i w panelu, więc d-pad focus jest nie do przeoczenia w obu motywach glyphów.
4. Glyphy L1/R1 dodane do legendy gamepad (HintsBar) w obu motywach — neutralna czerń, nie konkurują z kolorowymi przyciskami twarzy.
5. W compact mode (BP) przyciski są wyższe (`min-height: 40px`), panelHead ciaśniejszy, a "Otwórz folder modów" znajduje się w strefie drop zamiast w nagłówku.

## Jak działa nawigacja modów padem (intencje)

- `L1` / `R1` (gamepad codes `LeftTrigger`/`RightTrigger` → intencje `leftBumper`/`rightBumper`) — przełączają zakładkę Info ↔ Mods, tylko gdy panel jest otwarty.
- D-pad lewo/prawo w zakładce Mods — cykle fokusem między przyciskami akcji panelu (refresh, loadery, wybierz archiwum, otwórz folder) w kolejności DOM.
- `South` (`confirm`) w zakładce Mods — klika przycisk, który aktualnie ma fokus (`activateFocused`).
- `East` (`back`) — zawsze zamyka panel i wraca na szynę (jak dotąd).
- Klawiatura: `Q`/`E` przełącza zakładki; strzałki lewo/prawo + Enter działają w panelu modów gdy jest otwarty.

## Nowe stringi i18n (EN + PL)

- `bigPicture.panelTabInfo`: Info / Info
- `bigPicture.panelTabMods`: Mods / Mody
- `bigPicture.hintShoulderLeft`: Previous tab / Poprzednia zakładka
- `bigPicture.hintShoulderRight`: Next tab / Następna zakładka
- `mods.openFolder`: Open mods folder / Otwórz folder modów
- `mods.revealFailed`: Could not open the folder / Nie udało się otworzyć folderu

## Wynik testów / tsc / build

- `bun run test`: 184 testów, 16 plików — wszystkie PASS.
- `bunx tsc --noEmit`: czysto.
- `bun run build`: zbudowane pomyślnie.

## Kryteria akceptacji

- [x] Zakładki Info/Mody przełączają się padem (L1/R1) i klawiaturą (Q/E).
- [x] ModsPanel renderuje się wewnątrz BP (prop `gameId` przez `game`), widoczny katalog loaderów gdy supported.
- [x] Gdy unsupported: czytelny komunikat, brak przycisków install/drop/dialog.
- [x] `installModLoader` wywołanie trafia w mock (przez ModsPanel w BP).
- [x] Istniejące testy glyphów nienaruszone; nowe testy dodane.
- [x] Brak dotknięcia plików z listy NIE MOŻESZ.
- [x] `bun run test` + `bunx tsc --noEmit` + `bun run build` — wszystkie zielone/czyste.
