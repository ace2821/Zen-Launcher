import {
  Play,
  Settings,
  User,
  Menu,
  Trash2,
  ExternalLink,
  ArrowLeft,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GameCover } from "../components/library/GameCover";
import { Button, IconButton } from "../components/ui/Button";
import { useLaunchAvailability } from "../lib/hooks";
import type { Game } from "../lib/types";
import { useLibraryStore } from "../store/library";
import { useFilteredGames } from "../store/selectors";
import { useShellStore } from "../store/shell";
import styles from "../components/bigpicture/bigPictureDashboard.module.css";
import { ModsPanel, type ModsPanelHandle } from "../components/details/ModsPanel";

/** One of the top-bar tabs. */
type DashboardTab = "games" | "media";

export function BigPictureDashboardView() {
  const { t } = useTranslation();
  const games = useFilteredGames();
  const ready = useLibraryStore((state) => state.ready);
  const launchGame = useLibraryStore((state) => state.launchGame);
  const removeGame = useLibraryStore((state) => state.removeGame);
  const revealGame = useLibraryStore((state) => state.revealGame);
  const goToLibrary = useShellStore((state) => state.goToLibrary);

  const [tab, setTab] = useState<DashboardTab>("games");
  const [focusIndex, setFocusIndex] = useState(0);
  const [menuGame, setMenuGame] = useState<Game | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const tilesRef = useRef<Array<HTMLButtonElement | null>>([]);
  const modsPanelRef = useRef<ModsPanelHandle | null>(null);
  const focusRef = useRef(0);

  const selected = games[focusIndex] ?? null;

  useEffect(() => {
    focusRef.current = focusIndex;
  }, [focusIndex]);

  // Clock in the top bar.
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Land focus on the first tile when the library arrives.
  const tookFocus = useRef(false);
  useEffect(() => {
    if (tookFocus.current || games.length === 0) return;
    tookFocus.current = true;
    tilesRef.current[0]?.focus({ preventScroll: true });
  }, [games.length]);

  // Clamp focus when the list shrinks.
  useEffect(() => {
    if (focusRef.current <= games.length - 1) return;
    const next = Math.max(0, games.length - 1);
    focusRef.current = next;
    setFocusIndex(next);
  }, [games.length]);

  /* ----------------------------------------------------------- movement --- */

  const move = useCallback(
    (delta: number) => {
      const last = games.length - 1;
      if (last < 0) return;
      const next = Math.max(0, Math.min(focusRef.current + delta, last));
      focusRef.current = next;
      setFocusIndex(next);
      tilesRef.current[next]?.focus({ preventScroll: true });
    },
    [games.length],
  );

  const openMenu = useCallback(
    (game: Game, anchor: HTMLElement | null) => {
      setMenuGame(game);
      setMenuAnchor(anchor);
    },
    [],
  );

  const closeMenu = useCallback(() => {
    setMenuGame(null);
    setMenuAnchor(null);
  }, []);

  const launchSelected = useCallback(() => {
    if (!selected) return;
    const launch = useLaunchAvailability(selected);
    if (!launch.available) return;
    void launchGame(selected.id);
  }, [selected, launchGame]);

  /* ------------------------------------------------------------ keyboard -- */

  const handlers = useRef({
    move,
    openMenu,
    closeMenu,
    launchSelected,
    back: () => goToLibrary(),
  });
  useEffect(() => {
    handlers.current = {
      move,
      openMenu,
      closeMenu,
      launchSelected,
      back: () => goToLibrary(),
    };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Menu open: arrows navigate items, Enter activates, Esc closes.
      if (menuGame !== null) {
        switch (event.key) {
          case "Escape": {
            event.preventDefault();
            closeMenu();
            return;
          }
          case "Enter":
          case " ": {
            event.preventDefault();
            return;
          }
          default:
            return;
        }
      }

      switch (event.key) {
        case "ArrowLeft": {
          event.preventDefault();
          handlers.current.move(-1);
          return;
        }
        case "ArrowRight": {
          event.preventDefault();
          handlers.current.move(1);
          return;
        }
        case "Enter":
        case " ": {
          event.preventDefault();
          handlers.current.launchSelected();
          return;
        }
        case "Escape": {
          event.preventDefault();
          handlers.current.back();
          return;
        }
        case "r":
        case "R": {
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

  /* -------------------------------------------------------------- render -- */

  if (games.length === 0 && !ready) {
    return (
      <div className={styles.dashboardView}>
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>{t("bigPicture.emptyTitle")}</div>
          <div className={styles.emptyBody}>
            {t("bigPicture.emptyBody")}
          </div>
        </div>
      </div>
    );
  }

  const timeString = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });


  return (
    <div className={styles.dashboardView}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden />
          <div className={styles.brandText}>
            <span className={styles.brandName}>Zinc Launcher</span>
            <span className={styles.brandMeta}>
              {t("bigPicture.dashboard")}
            </span>
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "games"}
            className={
              tab === "games"
                ? `${styles.tab} ${styles.active}`
                : styles.tab
            }
            onClick={() => setTab("games")}
          >
            {t("bigPicture.tabGames")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "media"}
            className={
              tab === "media"
                ? `${styles.tab} ${styles.active}`
                : styles.tab
            }
            onClick={() => setTab("media")}
          >
            {t("bigPicture.tabMedia")}
          </button>
        </div>

        <div className={styles.clock}>{timeString}</div>

        <div className={styles.topActions}>
          <IconButton
            icon={Search}
            label={t("bigPicture.searchPlaceholder")}
            iconSize={16}
          />
          <IconButton
            icon={Settings}
            label={t("bigPicture.settings")}
            iconSize={16}
          />
          <IconButton icon={User} label={t("bigPicture.profile")} iconSize={16} />
          <Button
            variant="ghost"
            icon={ArrowLeft}
            onClick={goToLibrary}
            size="sm"
          >
            {t("bigPicture.exit")}
          </Button>
        </div>
      </header>

      {/* Poziomy rząd gier u góry ekranu. */}
      <section className={styles.gamesRow}>
        <h2 className={styles.gamesRowTitle}>{t("bigPicture.tabGames")}</h2>
        <div className={styles.gamesTrack}>
          {games.map((game: Game, index: number) => {
            const launch = useLaunchAvailability(game);
            const isFocused = index === focusIndex;
            return (
              <button
                ref={(node) => {
                  tilesRef.current[index] = node;
                }}
                key={game.id}
                type="button"
                role="gridcell"
                aria-selected={isFocused}
                aria-label={
                  game.title +
                  (isFocused ? ", " + t("bigPicture.playGame") : "")
                }
                data-focused={isFocused}
                className={styles.tile}
                tabIndex={isFocused ? 0 : -1}
                onFocus={() => {
                  focusRef.current = index;
                  setFocusIndex(index);

                }}
                onClick={() => {
                  focusRef.current = index;
                  setFocusIndex(index);

                }}
              >
                <div className={styles.tileCover}>
                  <GameCover
                    title={game.title}
                    coverPath={game.coverPath}
                  />
                </div>
                <div className={styles.tileTitle}>
                  {game.title}
                </div>

                <div className={styles.tileActions}>
                  <IconButton
                    icon={Menu}
                    label={t("bigPicture.moreOptions")}
                    iconSize={16}
                    className={styles.moreButton}
                    onClick={(event) => {
                      event.stopPropagation();
                      openMenu(game, event.currentTarget);
                    }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Play}
                    disabled={!launch.available}
                    loading={
                      useLibraryStore.getState().busy[
                        `game:launch:${game.id}`
                      ] === true
                    }
                    title={launch.hint ?? t("bigPicture.playGame")}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!launch.available) return;
                      void launchGame(game.id);
                    }}
                    className={styles.playButton}
                  >
                    {t("bigPicture.playGame")}
                  </Button>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Duża okładka wybranej gry w tle, tytuł i przycisk Graj w centrum. */}
      <main className={styles.main}>
        {selected ? (
          <>
            {selected.coverPath ? (
              <GameCover
                title={selected.title}
                coverPath={selected.coverPath}
                className={styles.backgroundCover}
              />
            ) : (
              <div className={styles.backgroundCoverEmpty} />
            )}

            <div className={styles.gameInfo}>
              <h1 className={styles.gameTitle}>{selected.title}</h1>
              <div className={styles.gameActions}>
                <Button
                  variant="primary"
                  icon={Play}
                  onClick={launchSelected}
                  className={styles.playGameButton}
                >
                  {t("bigPicture.playGame")}
                </Button>
                <IconButton
                  icon={Menu}
                  label={t("bigPicture.moreOptions")}
                  iconSize={16}
                  className={styles.menuButton}
                  onClick={(event) => {
                    event.stopPropagation();
                    openMenu(selected, event.currentTarget);
                  }}
                />
              </div>
            </div>
          </>
        ) : null}
      </main>

      {/* Mody wybranej gry — zastępują stare panele widgetów (znajomi, trofea, sklep…). */}
      {selected ? (
        <section className={styles.modsSection}>
          <h2 className={styles.modsTitle}>
            {t("bigPicture.modsSection", { title: selected.title })}
          </h2>
          <ModsPanel game={selected} compact ref={modsPanelRef} />
        </section>
      ) : null}

      {menuGame !== null && menuAnchor !== null ? (
        <>
          <div className={styles.menuScrim} onClick={closeMenu} />
          <div className={styles.menuPanel}>
            <Button
              variant="primary"
              icon={Play}
              onClick={(event) => {
                event.stopPropagation();
                const launch = useLaunchAvailability(menuGame);
                if (!launch.available) return;
                void launchGame(menuGame.id);
                closeMenu();
              }}
              block
            >
              {t("bigPicture.playGame")}
            </Button>
            <div className={styles.menuDivider} />
            <Button
              variant="ghost"
              icon={ExternalLink}
              onClick={(event) => {
                event.stopPropagation();
                void revealGame(menuGame);
                closeMenu();
              }}
              block
            >
              {t("library.reveal")}
            </Button>
            <div className={styles.menuDivider} />
            <Button
              variant="danger"
              icon={Trash2}
              onClick={(event) => {
                event.stopPropagation();
                void removeGame(menuGame.id);
                closeMenu();
              }}
              block
            >
              {t("library.remove")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
