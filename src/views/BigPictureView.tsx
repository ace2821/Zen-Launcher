import { Clock, Gamepad2, Play, Timer, TriangleAlert, Tv, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import { GlyphLegend, Keycap } from "../components/bigpicture/Glyph";
import styles from "../components/bigpicture/bigpicture.module.css";
import { GameCover } from "../components/library/GameCover";
import { Badge } from "../components/ui/Badge";
import { Button, IconButton } from "../components/ui/Button";
import { EmptyState, Skeleton } from "../components/ui/Feedback";
import { api, isTauriAvailable } from "../lib/api";
import { navIntent, type GlyphTheme, type NavIntent } from "../lib/gamepad";
import {
  useFormatters,
  useGameLabels,
  useGlyphTheme,
  useLaunchAvailability,
} from "../lib/hooks";
import type { Game, Session } from "../lib/types";
import { useLibraryStore } from "../store/library";
import { useFilteredGames } from "../store/selectors";
import { useShellStore } from "../store/shell";

/* --------------------------------------------------------------------------
 * Rail geometry
 *
 * Pure arithmetic, exported so the follow-the-focus maths can be tested without
 * a layout engine: jsdom measures nothing, and "does the rail slide to the right
 * place" should not depend on it measuring something.
 * ------------------------------------------------------------------------ */

export interface RailMetrics {
  /** Poster width in pixels; the artwork is 3:4 of it. */
  tile: number;
  gap: number;
  /** Padding before the first tile and after the last. */
  edge: number;
}

/**
 * Poster size for a window.
 *
 * Width drives it, but the height caps it too: a row of posters taller than the
 * screen is worse than slightly smaller ones, and a square-ish window would
 * otherwise push the labels off the bottom.
 */
export function railMetrics(width: number, height: number): RailMetrics {
  const tile = Math.max(
    180,
    Math.min(290, Math.round(width * 0.19), Math.round(height * 0.34)),
  );
  return {
    tile,
    gap: Math.max(14, Math.round(tile * 0.1)),
    edge: Math.max(40, Math.round(width * 0.06)),
  };
}

/**
 * How far the rail has to slide so the focused poster sits in the middle.
 *
 * Clamped at both ends: the first tile keeps its edge padding instead of sliding
 * under the left fade, and the last one stops rather than leaving a void.
 */
export function railOffset(
  index: number,
  count: number,
  viewport: number,
  metrics: RailMetrics,
): number {
  if (viewport <= 0 || count === 0) return 0;
  const step = metrics.tile + metrics.gap;
  const railWidth = count * step - metrics.gap + 2 * metrics.edge;
  const furthest = Math.max(0, railWidth - viewport);
  const centred = metrics.edge + index * step + metrics.tile / 2 - viewport / 2;
  return Math.min(Math.max(centred, 0), furthest);
}

/** The rail's geometry, handed to CSS as custom properties. */
type RailVars = CSSProperties & Record<`--bp-${string}`, string>;

/** Window height, tracked so the poster cap follows a resize. */
function useWindowHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === "undefined" ? 900 : window.innerHeight,
  );

  useEffect(() => {
    const measure = () => setHeight(window.innerHeight);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return height;
}

/* --------------------------------------------------------------------------
 * Details panel
 * ------------------------------------------------------------------------ */

/**
 * The prompt bar.
 *
 * The gamepad half only appears when there is a pad to hold: a machine with no
 * controller should not be told about buttons it does not have. The keyboard
 * half is always true.
 */
function HintsBar({ theme, gamepad }: { theme: GlyphTheme; gamepad: boolean }) {
  const { t } = useTranslation();

  return (
    <footer className={styles.hints}>
      {gamepad ? (
        <div className={styles.hintGroup}>
          <span className={styles.hintGroupLabel}>
            {t("bigPicture.gamepadLabel")}
          </span>
          <GlyphLegend
            theme={theme}
            hints={[
              { button: "south", label: t("bigPicture.hintSelect") },
              { button: "east", label: t("bigPicture.hintBack") },
              { button: "start", label: t("bigPicture.hintMenu") },
            ]}
          />
        </div>
      ) : null}

      <div className={styles.hintGroup}>
        <span className={styles.hintGroupLabel}>{t("bigPicture.keyboardLabel")}</span>
        <span className={styles.legend}>
          <span className={styles.legendItem}>
            <Keycap>← →</Keycap>
            <span className={styles.legendLabel}>{t("bigPicture.hintNavigate")}</span>
          </span>
          <span className={styles.legendItem}>
            <Keycap>⏎</Keycap>
            <span className={styles.legendLabel}>{t("bigPicture.hintSelect")}</span>
          </span>
          <span className={styles.legendItem}>
            <Keycap>Esc</Keycap>
            <span className={styles.legendLabel}>{t("bigPicture.hintBack")}</span>
          </span>
        </span>
      </div>
    </footer>
  );
}

/**
 * What `South` opens: what the entry is, when it was last played, and the one
 * thing a couch actually came here to do.
 *
 * Focus lands on Play, so the pad's `South` and the keyboard's `Enter` both do
 * the obvious thing without anyone aiming at anything.
 */
function DetailsPanel({ game, onClose }: { game: Game; onClose(): void }) {
  const { t } = useTranslation();
  const labels = useGameLabels();
  const { playtime, relativeDate } = useFormatters();
  const launch = useLaunchAvailability(game);
  const launchGame = useLibraryStore((state) => state.launchGame);
  const launching = useLibraryStore(
    (state) => state.busy[`game:launch:${game.id}`] === true,
  );
  const playRef = useRef<HTMLButtonElement | null>(null);
  /** `undefined` while the answer is still coming, `null` when there is none. */
  const [lastSession, setLastSession] = useState<Session | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let live = true;
    setLastSession(undefined);
    void api
      .listSessions(game.id, 1)
      .then((sessions) => {
        if (live) setLastSession(sessions[0] ?? null);
      })
      .catch(() => {
        // "Never played" and "could not ask" look the same here on purpose: the
        // panel is not the place to raise an error about session history.
        if (live) setLastSession(null);
      });
    return () => {
      live = false;
    };
  }, [game.id]);

  useEffect(() => {
    playRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <motion.div
        className={styles.scrim}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: "linear" }}
        onClick={onClose}
      />
      <motion.div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={game.title}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={styles.panelArt}>
          <GameCover title={game.title} coverPath={game.coverPath} />
        </div>

        <div className={styles.panelBody}>
          <div className={styles.panelFlags}>
            <Badge tone="info">{labels.type(game.type)}</Badge>
            <Badge tone={game.status === "missing" ? "warn" : "quiet"}>
              {labels.status(game.status)}
            </Badge>
          </div>

          <h2 className={styles.panelTitle}>{game.title}</h2>

          <div className={styles.panelMeta}>
            <span className={styles.panelMetaRow}>
              <span className={styles.panelMetaKey}>
                <Timer size={13} aria-hidden />{t("bigPicture.panelPlaytime")}
              </span>
              <span className={styles.panelMetaValue}>
                {playtime(game.totalSeconds)}
              </span>
            </span>
            <span className={styles.panelMetaRow}>
              <span className={styles.panelMetaKey}>
                <Clock size={13} aria-hidden />{t("bigPicture.panelLastSession")}
              </span>
              <span className={styles.panelMetaValue}>
                {lastSession === undefined
                  ? "…"
                  : lastSession === null
                    ? t("bigPicture.panelNever")
                    : relativeDate(lastSession.startedAt)}
              </span>
            </span>
          </div>

          <div className={styles.panelActions}>
            <Button
              ref={playRef}
              variant="primary"
              icon={Play}
              loading={launching}
              disabled={!launch.available}
              title={launch.hint ?? t("bigPicture.panelPlay")}
              onClick={() => {
                // Leaving the panel is the point: the game is taking over.
                void launchGame(game.id).then(onClose);
              }}
            >
              {launching ? t("bigPicture.panelLaunching") : t("bigPicture.panelPlay")}
            </Button>
            <Button variant="ghost" icon={X} onClick={onClose}>
              {t("bigPicture.hintBack")}
            </Button>
          </div>

          {launch.hint !== null ? (
            <p className={styles.panelNote}>{launch.hint}</p>
          ) : null}
        </div>
      </motion.div>
    </>
  );
}

/* --------------------------------------------------------------------------
 * The view
 * ------------------------------------------------------------------------ */

/**
 * Big Picture: the library as one row of posters, driven by a gamepad or the
 * arrow keys, taking over the whole window — and the real fullscreen state,
 * when there is a Tauri window to ask.
 *
 * Focus is the only state that matters. The poster under it holds the DOM focus
 * *and* is what the rail slides to, so there is never a highlighted tile the
 * keyboard disagrees with.
 */
export function BigPictureView() {
  const { t } = useTranslation();
  const labels = useGameLabels();
  const games = useFilteredGames();
  const ready = useLibraryStore((state) => state.ready);
  const settings = useLibraryStore((state) => state.settings);
  const goToLibrary = useShellStore((state) => state.goToLibrary);
  const { theme, pads } = useGlyphTheme(settings?.bigPictureLayout ?? "auto");

  const [focus, setFocus] = useState(0);
  const [open, setOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tiles = useRef<Array<HTMLButtonElement | null>>([]);
  const focusRef = useRef(0);
  const openRef = useRef(false);
  const countRef = useRef(0);
  const windowHeight = useWindowHeight();

  useEffect(() => {
    countRef.current = games.length;
  }, [games.length]);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  /* ------------------------------------------------------------ geometry -- */

  const [viewportWidth, setViewportWidth] = useState(0);

  // Measured from the element itself, so the rail stays correct when the window
  // is resized or a sidebar changes width. Before the first measurement the
  // fallback keeps the row laid out instead of collapsing and re-spreading.
  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const measure = () => {
      const measured =
        element.clientWidth > 0
          ? element.clientWidth
          : element.getBoundingClientRect().width;
      setViewportWidth(measured > 0 ? measured : window.innerWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [games.length === 0]);

  const metrics = useMemo(
    () => railMetrics(viewportWidth || 1280, windowHeight),
    [viewportWidth, windowHeight],
  );
  const offset = railOffset(focus, games.length, viewportWidth, metrics);

  const railVars: RailVars = {
    "--bp-tile": `${metrics.tile}px`,
    "--bp-gap": `${metrics.gap}px`,
    "--bp-edge": `${metrics.edge}px`,
  };

  /* ------------------------------------------------------------ movement -- */

  /** Moves the focus and takes the *real* DOM focus with it. */
  const move = useCallback((delta: number) => {
    const last = countRef.current - 1;
    if (last < 0) return;
    const next = Math.max(0, Math.min(focusRef.current + delta, last));
    focusRef.current = next;
    setFocus(next);
    tiles.current[next]?.focus({ preventScroll: true });
  }, []);

  const openPanel = useCallback(() => {
    if (countRef.current === 0) return;
    setOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    tiles.current[focusRef.current]?.focus({ preventScroll: true });
  }, []);

  const back = useCallback(() => {
    if (openRef.current) closePanel();
    else goToLibrary();
  }, [closePanel, goToLibrary]);

  /**
   * `Start`. Unlike `East`/Escape it does not stop at the panel: the prompt bar
   * promises "Library", and the panel is not somewhere to get stuck.
   */
  const exit = useCallback(() => goToLibrary(), [goToLibrary]);

  // The first poster takes the focus as soon as the library is in: a row that
  // answers the arrow keys from the first moment needs nothing else to be usable.
  const tookFocus = useRef(false);
  useEffect(() => {
    if (tookFocus.current || games.length === 0) return;
    tookFocus.current = true;
    tiles.current[focusRef.current]?.focus({ preventScroll: true });
  }, [games.length]);

  // A library that shrinks must not leave the focus pointing past the end.
  useEffect(() => {
    if (focusRef.current <= games.length - 1) return;
    const next = Math.max(0, games.length - 1);
    focusRef.current = next;
    setFocus(next);
  }, [games.length]);

  /* ------------------------------------------------------------ keyboard -- */

  // Held in refs so the window listener is bound once, not re-bound on every
  // focus change.
  const handlers = useRef({ move, openPanel, back, exit });
  useEffect(() => {
    handlers.current = { move, openPanel, back, exit };
  }, [move, openPanel, back, exit]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          // With the panel open the row is behind a dialog: the arrow keys stay
          // with the panel rather than moving a focus nobody can see.
          if (openRef.current) return;
          event.preventDefault();
          handlers.current.move(event.key === "ArrowLeft" ? -1 : 1);
          return;
        }
        case "Enter": {
          if (openRef.current) return;
          event.preventDefault();
          handlers.current.openPanel();
          return;
        }
        case "Escape": {
          event.preventDefault();
          handlers.current.back();
          return;
        }
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* ------------------------------------------------------------- gamepad -- */

  /**
   * The core's `gilrs` thread is the only writer of `gamepad-event`, and this is
   * the only subscriber: the rail is the only screen with a focus to move.
   */
  const intentRef = useRef<(intent: NavIntent) => void>(() => {});

  useEffect(() => {
    intentRef.current = (intent) => {
      if (intent === "back") {
        handlers.current.back();
        return;
      }
      // `menu` is Start, which leaves Big Picture — as the hint promises.
      if (intent === "menu") {
        handlers.current.exit();
        return;
      }
      if (intent === "left" || intent === "right") {
        if (!openRef.current) handlers.current.move(intent === "left" ? -1 : 1);
        return;
      }
      if (intent === "confirm" && !openRef.current) handlers.current.openPanel();
    };
  }, []);

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    void api
      .on("gamepad-event", (event) => {
        const intent = navIntent(event);
        if (intent !== null) intentRef.current(intent);
      })
      .then((off) => {
        if (live) unlisten = off;
        else off();
      })
      .catch(() => {
        // No event bus is the normal case outside Tauri; a pad that cannot be
        // listened for is not something to raise a toast about.
      });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [goToLibrary]);

  /* ---------------------------------------------------------- fullscreen -- */

  /**
   * Big Picture asks the window to go fullscreen and gives it back on the way
   * out. Outside Tauri there is no window to ask, so mock mode never touches
   * one — and a window manager that refuses leaves the view exactly as usable
   * as it was.
   */
  useEffect(() => {
    if (!isTauriAvailable()) return;
    let live = true;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (live) await getCurrentWindow().setFullscreen(true);
      } catch {
        // Best effort: nothing here depends on it.
      }
    })();

    return () => {
      live = false;
      void (async () => {
        try {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          await getCurrentWindow().setFullscreen(false);
        } catch {
          // Leaving the window as it is beats a failed exit.
        }
      })();
    };
  }, []);

  /* ------------------------------------------------------------- render -- */

  const selected = games[focus] ?? null;

  return (
    <div className={styles.view}>
      <div className={styles.backdrop} aria-hidden />

      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden>
            <Gamepad2 size={16} />
          </span>
          <span className={styles.brandText}>
            <span className={styles.brandName}>{t("app.name")}</span>
            <span className={styles.brandMeta}>{t("bigPicture.title")}</span>
          </span>
        </div>

        <div className={styles.topActions}>
          {games.length > 0 ? (
            <span className={styles.count}>
              {t("bigPicture.railLabel")}: {games.length}
            </span>
          ) : null}
          <IconButton
            icon={X}
            label={t("bigPicture.exit")}
            iconSize={16}
            onClick={goToLibrary}
          />
        </div>
      </header>

      {games.length === 0 ? (
        ready ? (
          <div className={styles.center}>
            <EmptyState
              icon={TriangleAlert}
              title={t("bigPicture.emptyTitle")}
              body={t("bigPicture.emptyBody")}
              action={
                <Button variant="primary" icon={Tv} onClick={goToLibrary}>
                  {t("bigPicture.exit")}
                </Button>
              }
            />
          </div>
        ) : (
          <div className={styles.center} aria-busy>
            <div className={styles.railSkeleton} style={railVars} aria-hidden>
              {[0, 1, 2, 3].map((key) => (
                <Skeleton key={key} className={styles.skeletonTile} />
              ))}
            </div>
          </div>
        )
      ) : (
        <div className={styles.railViewport} ref={viewportRef}>
          <ul
            className={styles.rail}
            style={{ ...railVars, transform: `translate3d(${-offset}px, 0, 0)` }}
            role="listbox"
            aria-label={t("bigPicture.railLabel")}
          >
            {games.map((game, index) => (
              <li className={styles.tileSlot} key={game.id} role="none">
                <button
                  ref={(node) => {
                    tiles.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={index === focus}
                  aria-label={t("bigPicture.tileLabel", { title: game.title })}
                  data-focused={index === focus}
                  className={styles.tile}
                  tabIndex={index === focus ? 0 : -1}
                  onFocus={() => {
                    focusRef.current = index;
                    setFocus(index);
                  }}
                  onClick={() => {
                    focusRef.current = index;
                    setFocus(index);
                    openPanel();
                  }}
                >
                  <span className={styles.tileArt}>
                    <GameCover title={game.title} coverPath={game.coverPath} />
                    {index === focus ? (
                      <span className={styles.tileFlag}>
                        <Badge tone="quiet">{labels.type(game.type)}</Badge>
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.tileLabel}>{game.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <HintsBar theme={theme} gamepad={pads.length > 0} />

      <AnimatePresence>
        {open && selected !== null ? (
          <DetailsPanel game={selected} onClose={closePanel} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
