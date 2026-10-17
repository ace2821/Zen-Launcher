import { useEffect, useMemo, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import {
  formatAbsoluteDate,
  formatPlaytime,
  formatRelativeDate,
  type PlaytimeUnits,
} from "./format";
import type {
  CandidateStatus,
  EngineKind,
  Game,
  GameStatus,
  GameType,
} from "./types";

/** Debounces a value — used for the notes autosave and the search field. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

/**
 * Observed width of an element. Falls back to `fallback` when nothing has been
 * measured yet (first paint, jsdom) so layout code always has a usable number.
 */
export function useContainerWidth(
  ref: RefObject<HTMLElement | null>,
  fallback = 0,
): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () => {
      const measured =
        element.clientWidth > 0
          ? element.clientWidth
          : element.getBoundingClientRect().width;
      setWidth(measured > 0 ? measured : fallback);
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, fallback]);

  return width;
}

/** Pure column arithmetic so the grid can be reasoned about (and tested). */
export function columnCount(
  width: number,
  minCardWidth: number,
  gap: number,
  max = 8,
): number {
  if (width <= 0) return 1;
  const fit = Math.floor((width + gap) / (minCardWidth + gap));
  return Math.max(1, Math.min(max, fit));
}

export interface Formatters {
  playtime(seconds: number): string;
  relativeDate(iso: string | null): string;
  absoluteDate(iso: string): string;
}

/** Locale-aware formatters bound to the active language. */
export function useFormatters(): Formatters {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const units = useMemo<PlaytimeUnits>(
    () => ({
      hour: t("units.hour"),
      minute: t("units.minute"),
      lessThanMinute: t("units.lessThanMinute"),
      none: t("units.none"),
    }),
    [t],
  );

  return useMemo(
    () => ({
      playtime: (seconds: number) => formatPlaytime(seconds, units),
      relativeDate: (iso: string | null) =>
        formatRelativeDate(iso, locale, t("units.never")),
      absoluteDate: (iso: string) => formatAbsoluteDate(iso, locale),
    }),
    [units, locale, t],
  );
}

export interface GameLabels {
  type(type: GameType): string;
  status(status: GameStatus): string;
  candidateStatus(status: CandidateStatus): string;
  engine(engine: EngineKind): string;
}

/** Localized labels for the contract enums. */
export function useGameLabels(): GameLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      type: (type: GameType) => t(`gameType.${type}`),
      status: (status: GameStatus) => t(`gameStatus.${status}`),
      candidateStatus: (status: CandidateStatus) => t(`candidateStatus.${status}`),
      engine: (engine: EngineKind) => t(`engine.${engine}`),
    }),
    [t],
  );
}

export interface LaunchAvailability {
  available: boolean;
  /** Why the Play button is disabled — an explanatory tooltip, never a silent block. */
  hint: string | null;
}

/**
 * M1 launches native entries directly and Windows entries through Wine
 * (contract: `launch_game` → `UNSUPPORTED` for retro/mod), and never launches
 * a game whose executable is gone. The UI mirrors exactly that instead of
 * offering a button that would fail.
 */
export function useLaunchAvailability(game: Game): LaunchAvailability {
  const { t } = useTranslation();
  return useMemo(() => {
    if (game.status === "missing") {
      return { available: false, hint: t("details.playBlockedMissing") };
    }
    if (game.type !== "native" && game.type !== "windows") {
      return {
        available: false,
        hint: t("details.playBlockedType", { type: t(`gameType.${game.type}`) }),
      };
    }
    return { available: true, hint: null };
  }, [game.status, game.type, t]);
}
