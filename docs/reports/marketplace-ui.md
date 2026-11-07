# Raport: Marketplace UI (Zen Launcher v1.2)

## Status
Zakończone — `tsc --noEmit` czyste, `bun run test` green (18 plików / 196 testów).

## Pliki
Nowe: `src/components/marketplace/{MarketplacePanel.tsx,MarketplacePanel.test.tsx,marketplace.module.css}`, `src/components/details/{ConflictsPanel.tsx,conflicts.module.css}`.
Zmienione: `src/store/shell.ts`, `src/store/marketplace.ts`, `src/lib/types.ts`, `src/components/layout/{AppShell.tsx,Sidebar.tsx}`, `src/views/GameDetailsView.tsx`, `src/i18n/{de,fi,fr,ru,tr}.ts`.

## Testy
7 testów w `MarketplacePanel.test.tsx`: katalog z tabs, filtrowanie, instalacja+z busy, banner stale, aktywacja tematu, fallback initials, detail view.

## Braki po stronie backendu
- Brak helpera `open_external_url` w API — używam `<a target="_blank">` dla installUrl http(s).
- Backend nie emituje jeszcze eventu `marketplace://install-started` po deep linku `zenlauncher://install?id=` — listener w UI gotowy, event nie nadawany po stronie Rust.

## Kryteria akceptacji
✓ Typy+API+mock z pełną listą itemów ✓ MarketplacePanel (tabs, karty, detail, spinner+toast, banner stale) ✓ Aktywacja tematu (jeden aktywny, CSS inject, reset) ✓ Konfliktów w szczegółach gry (info tylko) ✓ i18n en/pl ✓ ≥6 testów (7) ✓ tsc+testy green
