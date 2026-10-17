/**
 * Deterministic fallback artwork for games without a cover.
 *
 * Covers arrive with the metadata providers (M3), so until then every card gets
 * a stable duotone tile derived from its title. The palette is a fixed, curated
 * set of deep muted pairs — hash-based hue rotation would drift into colours
 * that fight the calm surface.
 */

export interface CoverPalette {
  from: string;
  to: string;
  /** Light tint for the initials and the inner glow. */
  tint: string;
  angle: number;
}

const PALETTES: readonly CoverPalette[] = [
  { from: "#1e3f36", to: "#0e211c", tint: "#a8dcc0", angle: 135 },
  { from: "#213440", to: "#111d24", tint: "#a9c8dc", angle: 150 },
  { from: "#302b40", to: "#181523", tint: "#c2b8e0", angle: 135 },
  { from: "#3c3029", to: "#211a16", tint: "#e0c3a8", angle: 160 },
  { from: "#2c3432", to: "#151b1a", tint: "#b9c9c4", angle: 135 },
  { from: "#35321f", to: "#1c1a10", tint: "#d8cf9c", angle: 150 },
  { from: "#3d2b2f", to: "#221619", tint: "#e0b3bb", angle: 135 },
  { from: "#253139", to: "#131c21", tint: "#a9c3cf", angle: 160 },
];

/** FNV-1a, 32-bit — stable across runs and platforms. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function coverPalette(seed: string): CoverPalette {
  return PALETTES[hashString(seed) % PALETTES.length];
}

const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "or", "to", "in", "la", "le"]);

/** Up to two initials, ignoring leading articles: `Sonic the Hedgehog 2` → `SH`. */
export function titleInitials(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) return "?";

  const significant = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  const pool = significant.length >= 2 ? significant : words;

  if (pool.length === 1) {
    return pool[0].slice(0, 2).toUpperCase();
  }
  return `${pool[0][0]}${pool[1][0]}`.toUpperCase();
}
