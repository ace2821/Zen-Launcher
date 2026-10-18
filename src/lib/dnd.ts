import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriAvailable } from "./api";

/**
 * Dropping files onto the window.
 *
 * Tauri intercepts native file drops, so the webview never sees an HTML5 `drop`
 * carrying *paths* — a drop there would hand us a `File` we cannot hand back to
 * the core. `onDragDropEvent` is therefore the real path, and it is only
 * available inside Tauri; in a plain browser the caller falls back to HTML5 drop
 * events, which is enough for the mock adapter (it installs by file name).
 */

/** The archive formats `install_mod_archive` accepts, without the dot. */
export const ARCHIVE_EXTENSIONS = ["zip", "7z", "rar"] as const;

const ARCHIVE_PATTERN = new RegExp(`\\.(?:${ARCHIVE_EXTENSIONS.join("|")})$`, "i");

/** `true` for a mod archive — the only thing the drop zone installs. */
export function isArchivePath(path: string): boolean {
  return ARCHIVE_PATTERN.test(path.trim());
}

export interface WindowDropState {
  /**
   * Paths the drag currently carries, or `null` while nothing is being dragged.
   * Empty means "something is being dragged, but nothing we would install" —
   * which is worth knowing, because it must *not* light up the drop zone.
   */
  dragging: string[] | null;
}

/**
 * Tracks a native drag over the window and reports the paths on drop.
 *
 * `enabled` is how a view opts in: the details screen passes its own openness, so
 * nothing is listening — and no drop is accepted — while it is off screen.
 */
export function useWindowDragDrop(
  onDrop: (paths: string[]) => void,
  enabled = true,
): WindowDropState {
  const [dragging, setDragging] = useState<string[] | null>(null);
  // Kept in a ref so re-subscribing is not needed when the callback identity
  // changes (it does on every render of the consumer).
  const dropRef = useRef(onDrop);
  useEffect(() => {
    dropRef.current = onDrop;
  }, [onDrop]);

  const finish = useCallback(() => setDragging(null), []);

  useEffect(() => {
    if (!enabled || !isTauriAvailable()) {
      setDragging(null);
      return;
    }
    let live = true;
    let unlisten: (() => void) | null = null;

    void (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      if (!live) return;
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        switch (payload.type) {
          case "enter":
            setDragging(payload.paths.filter(isArchivePath));
            return;
          case "over":
            // Position-only event: the drag is still over us, keep the state.
            return;
          case "leave":
            setDragging(null);
            return;
          case "drop":
            setDragging(null);
            dropRef.current(payload.paths);
            return;
        }
      });
    })();

    return () => {
      live = false;
      finish();
      unlisten?.();
    };
  }, [enabled, finish]);

  return { dragging };
}
