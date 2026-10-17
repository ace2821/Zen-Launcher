/**
 * Where Zen Launcher keeps its files.
 *
 * The M1 contract exposes no path query, so these are the fixed locations named
 * by the design document (§7). The Settings view shows them read-only; if a
 * later milestone adds a `get_paths` command, this module becomes its fallback
 * and nothing else has to change.
 *
 * Contract gap — recorded in `docs/reports/M1-frontend.md` (§ Różnice).
 */
export interface StoragePaths {
  config: string;
  data: string;
}

export const STORAGE_PATHS: StoragePaths = {
  config: "~/.config/zen-launcher/config.toml",
  data: "~/.local/share/zen-launcher/",
};
