import { isTauriAvailable } from "./api";

/**
 * Reaching files on disk from the webview.
 *
 * Covers live in `<dataDir>/covers/`, outside the bundle, so `<img src>` cannot
 * point at the path the core stores. Tauri's asset protocol is the only bridge,
 * and it is deliberately scoped to that one directory — this is not a general
 * file server, and nothing else in the UI may use it.
 *
 * `convertFileSrc` comes from `@tauri-apps/api/core`, which must not be imported
 * at module scope: doing so would evaluate Tauri internals in a plain browser,
 * which is exactly what mock mode has to keep working (the same reason `ipc.ts`
 * imports its Tauri modules lazily).
 *
 * The resolved function is cached, so a grid of covers converts synchronously
 * after the first call — and `primeAssetProtocol` does that first call at boot,
 * before the library paints.
 */
let convertFileSrc: ((path: string) => string) | null = null;
let converting: Promise<void> | null = null;

/** `true` for URLs the webview loads as they are, i.e. everything but a path. */
export function isWebUrl(value: string): boolean {
  return /^(?:data|blob|https?|asset|tauri):/i.test(value);
}

/**
 * Resolves the asset-protocol converter ahead of the first cover so the grid
 * never waits for a chunk mid-paint. A no-op outside Tauri.
 */
export function primeAssetProtocol(): Promise<void> {
  if (!isTauriAvailable() || convertFileSrc !== null) return Promise.resolve();
  converting ??= import("@tauri-apps/api/core").then((module) => {
    convertFileSrc = module.convertFileSrc;
  });
  return converting;
}

/**
 * The converter's answer *right now*, or `null` while it is still loading.
 *
 * A path that needs no protocol — `data:`, `blob:`, an http URL — always answers.
 * Callers that can afford to wait (or that have no way to retry) use
 * `toAssetUrl`; callers rendering a cover use this first, because the converter
 * is primed at boot and the answer is therefore normally available before the
 * browser paints.
 */
export function assetUrlSync(path: string): string | null {
  if (isWebUrl(path)) return path;
  return convertFileSrc === null ? null : convertFileSrc(path);
}

/**
 * A path on disk as something `<img src>` may load.
 *
 * In mock mode (and in the test suite) the covers are `data:` URLs to begin with,
 * so this hands them straight back and the grid renders in a plain browser.
 */
export async function toAssetUrl(path: string): Promise<string> {
  const known = assetUrlSync(path);
  if (known !== null) return known;
  await primeAssetProtocol();
  return assetUrlSync(path) ?? path;
}
