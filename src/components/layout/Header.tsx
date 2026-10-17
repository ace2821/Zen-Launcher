import { ChevronLeft, LayoutGrid, List, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GameSort } from "../../lib/filter";
import { useLibraryStore } from "../../store/library";
import { useFilteredGames } from "../../store/selectors";
import { useShellStore } from "../../store/shell";
import { IconButton } from "../ui/Button";
import { Segmented } from "../ui/Field";
import uiStyles from "../ui/ui.module.css";
import styles from "./layout.module.css";

const SORT_LABELS: Record<GameSort, string> = {
  title: "header.sortTitle",
  recent: "header.sortRecent",
  playtime: "header.sortPlaytime",
};

const SORTS: readonly GameSort[] = ["title", "recent", "playtime"];

export function Header() {
  const { t } = useTranslation();
  const view = useShellStore((state) => state.view);
  const search = useShellStore((state) => state.search);
  const setSearch = useShellStore((state) => state.setSearch);
  const sort = useShellStore((state) => state.sort);
  const setSort = useShellStore((state) => state.setSort);
  const layout = useShellStore((state) => state.layout);
  const setLayout = useShellStore((state) => state.setLayout);
  const goToLibrary = useShellStore((state) => state.goToLibrary);
  const currentGame = useLibraryStore((state) => state.currentGame);
  const total = useLibraryStore((state) => state.games.length);
  const shown = useFilteredGames().length;

  return (
    <header className={styles.header}>
      <div className={styles.headerHeading}>
        {view === "game" ? (
          <IconButton
            icon={ChevronLeft}
            label={t("details.backToLibrary")}
            onClick={goToLibrary}
          />
        ) : null}
        <h1 className={styles.headerTitle}>
          {view === "library"
            ? t("nav.library")
            : view === "import"
              ? t("import.title")
              : view === "settings"
                ? t("settings.title")
                : (currentGame?.title ?? "")}
        </h1>
      </div>

      {view === "library" ? (
        <>
          <div className={styles.searchWrap}>
            <Search size={15} className={styles.searchIcon} aria-hidden />
            <input
              type="search"
              className={styles.searchInput}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("header.searchPlaceholder")}
              aria-label={t("header.searchLabel")}
              spellCheck={false}
            />
            {search.length > 0 ? (
              <span className={styles.searchClear}>
                <IconButton
                  icon={X}
                  label={t("header.clearSearch")}
                  iconSize={14}
                  onClick={() => setSearch("")}
                />
              </span>
            ) : null}
          </div>

          <div className={styles.headerActions}>
            <span className={styles.headerCount}>
              {t("library.showing", { count: shown, total })}
            </span>
            <Segmented
              label={t("header.layoutGrid")}
              value={layout}
              onChange={setLayout}
              options={[
                {
                  value: "grid",
                  label: "",
                  title: t("header.layoutGrid"),
                  ariaLabel: t("header.layoutGrid"),
                  icon: <LayoutGrid size={14} aria-hidden />,
                },
                {
                  value: "list",
                  label: "",
                  title: t("header.layoutList"),
                  ariaLabel: t("header.layoutList"),
                  icon: <List size={14} aria-hidden />,
                },
              ]}
            />
            <select
              className={`${uiStyles.select} ${styles.sortSelect}`}
              value={sort}
              onChange={(event) => setSort(event.target.value as GameSort)}
              aria-label={t("header.sortLabel")}
            >
              {SORTS.map((option) => (
                <option key={option} value={option}>
                  {t(SORT_LABELS[option])}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : null}
    </header>
  );
}
