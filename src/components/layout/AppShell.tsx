import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useLibraryStore } from "../../store/library";
import { useShellStore } from "../../store/shell";
import { OnboardingWizard } from "../onboarding/OnboardingWizard";
import { ConfirmHost } from "../ui/ConfirmHost";
import { Toaster } from "../ui/Toaster";
import { BigPictureView } from "../../views/BigPictureView";
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

  /*
   * Big Picture is a takeover, not a page: it brings its own frame, its own
   * header and its own hints, because the sidebar and the library header are
   * both things a couch cannot see across the room. Everything *behind* it —
   * the toaster, the confirmation host, the tour — still mounts, so a failure
   * that happens while it is open is still announced.
   */
  if (view === "bigPicture") {
    return (
      <>
        <BigPictureView />
        <ConfirmHost />
        <Toaster />
        <OnboardingWizard />
      </>
    );
  }

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
      {/* Mounted unconditionally and portaled to <body>: it renders itself only
          while the tour is due, and it is above every view so a first run can
          happen on top of whatever screen the app booted into. */}
      <OnboardingWizard />
    </div>
  );
}
