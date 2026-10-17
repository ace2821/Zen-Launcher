import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useLibraryStore } from "../../store/library";
import { useShellStore } from "../../store/shell";
import { ConfirmHost } from "../ui/ConfirmHost";
import { Toaster } from "../ui/Toaster";
import { GameDetailsView } from "../../views/GameDetailsView";
import { ImportView } from "../../views/ImportView";
import { LibraryView } from "../../views/LibraryView";
import { SettingsView } from "../../views/SettingsView";
import { Header } from "./Header";
import styles from "./layout.module.css";
import { Sidebar } from "./Sidebar";

/**
 * Application frame: the sidebar and header are stable chrome, the middle
 * region swaps between views. Data loading is kicked off exactly once here so
 * every view can assume the store is already being filled.
 */
export function AppShell() {
  const init = useLibraryStore((state) => state.init);
  const view = useShellStore((state) => state.view);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className={styles.shell}>
      <Sidebar />
      <Header />

      <main className={styles.main}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className={styles.view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {view === "library" ? (
              <LibraryView />
            ) : view === "import" ? (
              <ImportView />
            ) : view === "settings" ? (
              <SettingsView />
            ) : (
              <GameDetailsView />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <ConfirmHost />
      <Toaster />
    </div>
  );
}
