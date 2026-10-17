# Kreator pierwszego uruchomienia + system wyglądu — raport weryfikacyjny

Podstawa: `fecc868` (Wine + auto-setup). Zmiana: ten commit — slice UI w
`src/**` plus niniejszy raport.

Zakres: `src/**` (kreator, wygląd, i18n, testy). Rdzeń (`src-tauri/**`) bez
zmian; w `docs/` zaktualizowano wzmianki o foncie display (`DESIGN.md`,
`INTERFACES.md`).

---

## Status

Zrobione i zweryfikowane lokalnie:

- **Kreator pierwszego uruchomienia** — 5 kroków (Język → Wygląd → Biblioteka →
  Okno → Gotowe): takeover w portalu `body`, focus trap, `role="dialog"` /
  `aria-modal`, Escape celowo połknięty (wyjście tylko przez Gotowe/Pomiń),
  podgląd na żywo, sterowanie strzałkami w swatchach i radiogroupach.
  - Każdy wybór zapisywany od razu przez `updateSettings` (tryb silent);
    `onboardingCompleted: true` pojawia się wyłącznie w patchu Gotowe albo
    Pomiń. „Pomiń” nie zmienia niczego poza flagą.
  - Kreator widoczny tylko gdy ustawienia wczytane i `!onboardingCompleted`
    (jeden predykat `shouldShowOnboarding`), ponowne uruchomienie z Ustawień
    (tryb edycji z prefilłem).
  - Język przełącza cały interfejs natychmiast, razem z kreatorem.
- **Font UI: Maple Mono jako domyślna** (400/500/600/700, vendored woff2
  latin+latin-ext, OFL); alternatywy Instrument Sans / systemowa.
- **Font display: Space Grotesk** — zmiana właściciela wobec pierwotnej decyzji
  (serif wycofany): Instrument Serif usunięty z `src/**` (pliki + wszystkie
  reguły), 10 miejsc display na `--font-space` (waga 500, tracking `-0.01em`).
  Vendorowane latin + latin-ext, OFL; payload fontów netto −29 kB wobec serifu.
- **Akcenty**: 5 presetów (jadeit/śliwka/lazur/żar/róż) + grafit; domyślny
  jadeit; dark theme tylko (zgodnie z decyzją).
- **i18n**: EN/PL, PL typowane jako `TranslationShape`, naturalny język w obu.
- **Przegląd copy przez main** (w tym commicie): 3 poprawki — `playBlockedType`
  bez nieaktualnego „po M1” / „after M1”, czytelniejszy `closeToTrayHint`,
  hint Instrument Sans bez „pierwotnego wyglądu” (serif już nie istnieje).

Wynik komend (przebieg main po scaleniu z commitem `fecc868` i poprawkach
copy):

| Komenda | Wynik |
|---|---|
| `bun run test` | **86 / 86** (8 plików; wcześniej 63 w 5) |
| `bunx tsc --noEmit` | czysto |
| `bun run build` | ✓ zbudowane (ostrzeżenie o rozmiarze chunka — istniejące) |

## Pliki

- `src/components/onboarding/OnboardingWizard.tsx` + `onboarding.module.css` —
  kreator (5 kroków, ChoiceGroup, swatche, karta podglądu, responsywny rail).
- `src/store/onboarding.ts` — `requested`/`requestRerun`/`endRerun` +
  `shouldShowOnboarding`.
- `src/lib/appearance.ts` — `FONT_IDS`, `ACCENT_IDS`, normalizatory,
  `applyAppearance`.
- `src/assets/fonts/` — `maple-mono-latin-{400..700}.woff2`,
  `space-grotesk-latin{,-ext}-500.woff2` + pliki OFL; usunięte
  `instrument-serif-*.woff2` (3 pliki, italic był martwy).
- `src/styles/{tokens,fonts,global}.css` + moduły `details/layout/library/ui`
  (tokeny fontu display i trackingu, bloki `@font-face`).
- `src/i18n/{en,pl}.ts` — nowe klucze kreatora i ustawień.
- `src/views/SettingsView.tsx` — panel „Uruchom kreatora ponownie”.
- `src/test/{harness,setup}.ts` — guard środowiska dla testów styles.
- Testy: `OnboardingWizard.test.tsx` (10), `appearance.test.ts` (9),
  `appearance.styles.test.ts` (guardy CSS↔TS), rozszerzone `mock.test.ts`.

## Uruchamianie

- Dev: `bun run tauri dev` (kreator pokaże się, gdy `onboardingCompleted` w
  `~/.config/zen-launcher/config.toml` nie jest `true`).
- Ponowne uruchomienie na żądanie: Ustawienia → „Uruchom kreatora ponownie”.
- Frontend na mocku: `bun run dev`.

## Testy

- Kreator (10): widoczność przez predykat, live-switch języka, zapis wyboru po
  wyborze + jeden autorytatywny patch na Gotowe, brak flagi przy patchach
  cząstkowych, cisza toastów pod overlayem, Pomiń = tylko flaga, Escape nie
  zamyka, strzałki w swatchach + repaint `data-accent`, re-run z prefilłem.
- Wygląd (9 + 4 + reszta): normalizatory, `applyAppearance`, kontrast AA
  akcentów, twarze i wagi fontów, dokładnie jedna waga Space Grotesk z oboma
  subsetami, tracking display.
- Guardy CSS↔TS w osobnym pliku (`// @vitest-environment node`) — Vitest
  zaślepia `?raw`, więc pliki czytane przez `node:fs` z idiomem
  `@ts-expect-error` (jak w `vite.config.ts`, bez nowych zależności).

## Różnice

- Waga display 400 → 500 i tracking `+0.01em` → `-0.01em` (grotesk obok mono
  potrzebuje innej optyki); tytuły w siatce biblioteki zostają w foncie UI
  (13 px — display przy tej wielkości byłby błędem).
- Kontrolki fontu/akcentu istnieją wyłącznie w kreatorze; Ustawienia mają
  „uruchom ponownie” (jedno źródło prawdy dla tych wartości).
- Brak weryfikacji wizualnej w środowisku wykonawcy (brak chromium/playwright)
  — sprawdzone obiektywnie: metryki, wagi, cmap (polskie znaki tylko w
  latin-ext), brak dziedziczenia trackingu. **Sign-off wizualny należy do
  właściciela.**
- Jeden istniejący test bywa flaky pod dużym równoległym obciążeniem (cargo);
  pełne przebiegi pod rząd zielone.
- Znane drobiazgi odnotowane w kodzie: `.coverInitials` trzyma własny
  `letter-spacing` (monogram), payload Maple Mono ~304 kB (redukcja wag może
  być osobną decyzją).

## Kryteria akceptacji

- [x] Kreator: skippable, re-runnable, zapis przyrostowy, flaga wyłącznie na
      Gotowe/Pomiń, prefill w trybie edycji.
- [x] Maple Mono jako domyślny font UI + Space Grotesk jako display (bez
      serifu w `src/**`).
- [x] 5 akcentów + grafit, kontrast AA zmierzony; dark theme.
- [x] EN/PL kompletne i naturalne; poprawki copy od main naniesione.
- [x] `bun run test` 86/86 · `tsc` czysto · `bun run build` OK.
- [ ] Ocena wizualna nowego display face i kreatora na żywym oknie —
      do zrobienia przez właściciela.
