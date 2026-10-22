import { coverPalette, hashString, titleInitials } from "../cover";
import type {
  BigPictureLayout,
  Candidate,
  CoverCandidate,
  Game,
  GamepadInfo,
  ModEngine,
  ModLoader,
  ModLoaderInfo,
  ModsDirKind,
  Session,
  Settings,
  Source,
} from "../types";

/**
 * Deterministic seed for the in-memory adapter.
 *
 * All timestamps are derived from a fixed reference instant so that mock data is
 * reproducible across runs and assertions in tests stay stable.
 */
export const SEED_NOW = "2026-10-17T12:00:00Z";

/** The documented defaults, exactly as the contract lists them. */
export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  closeToTray: true,
  hideOnLaunch: true,
  font: "maple-mono",
  accent: "jade",
  onboardingCompleted: false,
  autoCovers: true,
  modsLenient: true,
  modsMaxMb: 1024,
  useGameMode: true,
  useMangoHud: false,
  bigPictureLayout: "auto",
};

/** The default pad the mock "sees" plugged in (see `MockOptions.gamepads`). */
export const DEFAULT_GAMEPADS: GamepadInfo[] = [
  { id: 0, name: "Xbox Wireless Controller", kind: "xbox" },
];

/**
 * Mirrors how the core reads `config.toml`.
 *
 * A key that is absent — every file written before this milestone — or that
 * cannot be used loads as its default instead of failing the whole read, which
 * is what keeps an existing install opening on current defaults. Well-formed but
 * unknown `font`/`accent` ids are passed through on purpose: the UI is the layer
 * that degrades them (see `lib/appearance.ts`). `bigPictureLayout` is the same
 * deal — the core stores a `String` and validates only patches, so the mock
 * hands back whatever non-empty value it was given and the UI resolves it
 * (`lib/gamepad.ts` falls back to `auto` for anything unrecognised).
 */
export function loadSettings(seed: Partial<Settings> = {}): Settings {
  const pick = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T => (typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);
  const pickId = (value: unknown, fallback: string): string =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  const pickBool = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;
  // The core does not clamp a stored value on read — `normalize_mods_max_mb`
  // guards patches only — so neither does this: only a non-number falls back.
  const pickNumber = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    language: pick(seed.language, ["en", "pl"], DEFAULT_SETTINGS.language),
    closeToTray: pickBool(seed.closeToTray, DEFAULT_SETTINGS.closeToTray),
    hideOnLaunch: pickBool(seed.hideOnLaunch, DEFAULT_SETTINGS.hideOnLaunch),
    font: pickId(seed.font, DEFAULT_SETTINGS.font),
    accent: pickId(seed.accent, DEFAULT_SETTINGS.accent),
    onboardingCompleted: pickBool(
      seed.onboardingCompleted,
      DEFAULT_SETTINGS.onboardingCompleted,
    ),
    autoCovers: pickBool(seed.autoCovers, DEFAULT_SETTINGS.autoCovers),
    modsLenient: pickBool(seed.modsLenient, DEFAULT_SETTINGS.modsLenient),
    modsMaxMb: pickNumber(seed.modsMaxMb, DEFAULT_SETTINGS.modsMaxMb),
    useGameMode: pickBool(seed.useGameMode, DEFAULT_SETTINGS.useGameMode),
    useMangoHud: pickBool(seed.useMangoHud, DEFAULT_SETTINGS.useMangoHud),
    // Documented cast: an unrecognised stored string is possible (hand-edited
    // file), and every consumer degrades instead of trusting the union.
    bigPictureLayout: pickId(
      seed.bigPictureLayout,
      DEFAULT_SETTINGS.bigPictureLayout,
    ) as BigPictureLayout,
  };
}

const SEED_DAY = Date.UTC(2026, 9, 17, 0, 0, 0);

/** ISO timestamp `dayOffset` days before the seed day, at `hour:minute` UTC. */
function at(dayOffset: number, hour: number, minute = 0): string {
  return new Date(SEED_DAY - dayOffset * 86_400_000 + hour * 3_600_000 + minute * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

export interface DiscoverySeed {
  folder: string;
  executable: string | null;
  engine: Candidate["engine"];
  title: string;
  confidence: number;
  evidence: string[];
}

export interface MockState {
  sources: Source[];
  candidates: Candidate[];
  games: Game[];
  sessions: Session[];
  settings: Settings;
  nextSourceId: number;
  nextCandidateId: number;
  nextGameId: number;
  nextSessionId: number;
  /** Emulated filesystem: executables this machine does not have (status = missing). */
  missingExecutables: Set<string>;
  /** Folders the emulated scanner still has to hand out per source. */
  discoveries: Map<number, DiscoverySeed[]>;
  /** Canned answers for the directory picker. */
  pickablePaths: string[];
  /** Canned answers for the file picker (cover images). */
  pickableFiles: string[];
  /** Emulated per-game mod state: loaders this machine "detected". */
  mods: Map<number, ModsSeed>;
}

/**
 * What the mock pretends to have found in a game folder.
 *
 * `modsDir` is stored relative to the game's install path so the returned status
 * carries a real absolute path, exactly as the core's detection would produce.
 * Only *detected* facts live here: the installable catalog is derived from the
 * engine (see `loadersFor`), which is how the core's `mods::status` splits the
 * two as well.
 */
export interface ModsSeed {
  loader: ModLoader;
  /** e.g. `BepInEx/plugins`; `null` when the folder does not exist. */
  modsDir: string | null;
  modsDirKind: ModsDirKind;
  engine: ModEngine;
  /** Root entries the fake folder carries — mirrors `spec_matches_root`. */
  markers: string[];
  installed: string[];
}

/** One installable loader; mirrors the core's `mods::CATALOG` entry for entry. */
export interface LoaderSpec {
  id: string;
  name: string;
  engines: ModEngine[];
  /** Root entries the game folder must carry (mirror of `mods.rs` markers). */
  markers: string[];
  install: "download" | "manual";
  docs: string | null;
}

/**
 * The loader catalog, in the core's popularity order — the first entry matching
 * the game's engine (and markers) becomes `suggestedLoader`. Kept literal
 * (rather than derived) so a drift from `src-tauri/src/mods.rs` is visible here.
 */
export const LOADER_CATALOG: readonly LoaderSpec[] = [
  {
    id: "neomodloader",
    name: "NeoModLoader",
    engines: ["unity-mono"],
    markers: ["worldbox_Data", "worldbox.exe"],
    install: "download",
    docs: "https://worldboxopenmods.gitbook.io/mod-tutorial-en/player-manual/install",
  },
  {
    id: "mscloader",
    name: "MSC Mod Loader",
    engines: ["unity-mono"],
    markers: ["mysummercar_Data", "mysummercar.exe"],
    install: "manual",
    docs: "https://github.com/piotrulos/MSCModLoader/releases",
  },
  { id: "bepinex5", name: "BepInEx 5", engines: ["unity-mono"], markers: [], install: "download", docs: null },
  {
    id: "melonloader",
    name: "MelonLoader",
    engines: ["unity-mono", "unity-il2cpp"],
    markers: [],
    install: "download",
    docs: null,
  },
  { id: "bepinex6mono", name: "BepInEx 6 (Mono)", engines: ["unity-mono"], markers: [], install: "download", docs: null },
  {
    id: "bepinex6il2cpp",
    name: "BepInEx 6 (IL2CPP)",
    engines: ["unity-il2cpp"],
    markers: [],
    install: "download",
    docs: null,
  },
  {
    id: "tmodloader",
    name: "tModLoader",
    engines: ["terraria"],
    markers: [],
    install: "download",
    docs: "https://github.com/tModLoader/tModLoader/wiki/Manual-Install",
  },
  { id: "cleo5", name: "CLEO 5", engines: ["gta-classic"], markers: [], install: "download", docs: "https://cleo.li" },
  { id: "cleo4", name: "CLEO 4", engines: ["gta-classic"], markers: [], install: "download", docs: "https://cleo.li" },
  {
    id: "cleoredux",
    name: "CLEO Redux",
    engines: ["gta-classic"],
    markers: [],
    install: "download",
    docs: "https://re.cleo.li/docs/en/installation.html",
  },
  {
    id: "scripthook-iv",
    name: "Script Hook IV",
    engines: ["gta-iv"],
    markers: [],
    install: "manual",
    docs: "https://www.gtaforums.com/",
  },
  {
    id: "scripthook-v",
    name: "Script Hook V",
    engines: ["gta-v"],
    markers: [],
    install: "manual",
    docs: "https://www.gta5-mods.com/tools/script-hook-v",
  },
  {
    id: "frosty",
    name: "Frosty Mod Manager",
    engines: ["frostbite"],
    markers: [],
    install: "download",
    docs: "https://github.com/J-Lyt/FrostyToolsuite/releases",
  },
];

/**
 * Catalog entries that apply to an engine (and to the fake folder's markers,
 * mirroring `spec_matches_root`), most popular first.
 */
export function loadersFor(engine: ModEngine, rootMarkers: string[] = []): ModLoaderInfo[] {
  return LOADER_CATALOG.filter(
    (spec) =>
      spec.engines.includes(engine) &&
      (spec.markers.length === 0 || rootMarkers.some((m) => spec.markers.includes(m))),
  ).map((spec) => ({
    id: spec.id,
    name: spec.name,
    engines: [...spec.engines],
    install: spec.install,
    docs: spec.docs,
  }));
}

/** The product name a loader id installs, or the id itself when unknown. */
export function loaderName(id: string): string {
  return LOADER_CATALOG.find((spec) => spec.id === id)?.name ?? id;
}

const SOURCES: Source[] = [
  {
    id: 1,
    path: "/home/oliwier/Games",
    autoScan: false,
    createdAt: at(45, 18, 20),
    lastScanAt: at(7, 19, 5),
  },
  {
    id: 2,
    path: "/home/oliwier/Games/itch",
    autoScan: false,
    createdAt: at(33, 20, 41),
    lastScanAt: at(7, 19, 7),
  },
  {
    id: 3,
    path: "/home/oliwier/Games/retro",
    autoScan: false,
    createdAt: at(16, 12, 10),
    lastScanAt: null,
  },
];

const G = "/home/oliwier/Games";

/* --------------------------------------------------------------- artwork --- */

/**
 * Deterministic stand-in artwork for the mock adapter.
 *
 * The core stores a downloaded JPEG/PNG in `<dataDir>/covers/` and the webview
 * reaches it through the asset protocol. The mock has no filesystem and must not
 * touch the network, so it hands out an inline SVG poster instead: a `data:` URL
 * the webview renders directly. That keeps `bun run dev` honest — covers really
 * are images here, so the "has artwork" path is exercised rather than faked.
 *
 * The palette comes from the same hashed set as the fallback tile, so mock art
 * sits in the app's colours rather than fighting them.
 */
/**
 * A stand-in poster, drawn inline: a duotone field seeded from `seed` with
 * `label`'s initials set into it.
 *
 * Two arguments because the two uses differ: a stored cover seeds *and* labels
 * with the game title, while a store candidate seeds with the variant
 * (`poster:`, `capsule:`, `header:`) so the five results for one query are not
 * five identical swatches — but still labels with the game's own name, which is
 * what a real cover shows.
 */
export function coverArtUri(seed: string, label = seed): string {
  const palette = coverPalette(seed);
  const hash = hashString(seed);
  const circle = { cx: 22 + (hash % 56), cy: 28 + ((hash >>> 8) % 38), r: 24 + ((hash >>> 16) % 16) };
  const bar = 14 + ((hash >>> 24) % 16);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140" width="600" height="840">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="100" height="140" fill="url(#g)"/>` +
    `<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}" fill="${palette.tint}" opacity="0.13"/>` +
    `<rect x="-10" y="${104 - bar}" width="120" height="${bar}" fill="${palette.tint}" opacity="0.09" transform="rotate(-11 50 104)"/>` +
    `<text x="50" y="126" text-anchor="middle" font-family="monospace" font-size="15" fill="${palette.tint}" opacity="0.92">${titleInitials(label)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const GAMES: Game[] = [
  {
    id: 1,
    title: "Hollow Knight",
    sortTitle: null,
    type: "native",
    installPath: `${G}/Hollow Knight`,
    executable: `${G}/Hollow Knight/HollowKnight.x86_64`,
    args: ["-screen-fullscreen", "1"],
    env: { LC_ALL: "en_US.UTF-8" },
    workDir: `${G}/Hollow Knight`,
    tags: ["metroidvania", "atmospheric"],
    favorite: true,
    hidden: false,
    notes: "Steel Soul run still going. Pantheon 4 next.",
    coverPath: coverArtUri("Hollow Knight"),
    status: "ready",
    createdAt: at(44, 19, 2),
    updatedAt: at(1, 20, 40),
    lastPlayedAt: at(1, 20, 12),
    totalSeconds: 152_460,
  },
  {
    id: 2,
    title: "Celeste",
    sortTitle: null,
    type: "native",
    installPath: `${G}/Celeste`,
    executable: `${G}/Celeste/Celeste`,
    args: [],
    env: {},
    workDir: `${G}/Celeste`,
    tags: ["platformer", "precision"],
    favorite: true,
    hidden: false,
    notes: null,
    coverPath: null,
    status: "ready",
    createdAt: at(44, 19, 4),
    updatedAt: at(12, 21, 15),
    lastPlayedAt: at(12, 21, 0),
    totalSeconds: 48_300,
  },
  {
    id: 3,
    title: "Brotato",
    sortTitle: null,
    type: "native",
    installPath: `${G}/itch/brotato-linux`,
    executable: `${G}/itch/brotato-linux/Brotato.x86_64`,
    args: [],
    env: {},
    workDir: `${G}/itch/brotato-linux`,
    tags: ["roguelite", "arena"],
    favorite: false,
    hidden: false,
    notes: null,
    coverPath: null,
    status: "ready",
    createdAt: at(33, 20, 45),
    updatedAt: at(9, 22, 30),
    lastPlayedAt: at(9, 22, 12),
    totalSeconds: 19_800,
  },
  {
    id: 4,
    title: "Dwarf Fortress",
    sortTitle: null,
    type: "native",
    installPath: `${G}/dwarf-fortress/df_linux`,
    executable: `${G}/dwarf-fortress/df_linux/df`,
    args: [],
    env: {},
    workDir: `${G}/dwarf-fortress/df_linux`,
    tags: ["simulation", "colony"],
    favorite: false,
    hidden: false,
    notes: "Fortress 'Boatmurdered II' still alive. 214 dwarves.",
    coverPath: null,
    status: "ready",
    createdAt: at(40, 11, 5),
    updatedAt: at(30, 22, 0),
    lastPlayedAt: null,
    totalSeconds: 0,
  },
  {
    id: 5,
    title: "OpenTTD",
    sortTitle: null,
    type: "native",
    installPath: `${G}/openttd`,
    executable: `${G}/openttd/openttd`,
    args: ["-g", "savegames/zen-transport.sav"],
    env: {},
    workDir: `${G}/openttd`,
    tags: ["tycoon", "sandbox"],
    favorite: false,
    hidden: false,
    notes: null,
    coverPath: null,
    status: "ready",
    createdAt: at(45, 18, 30),
    updatedAt: at(19, 18, 40),
    lastPlayedAt: at(19, 18, 22),
    totalSeconds: 223_200,
  },
  {
    id: 6,
    title: "Veloren",
    sortTitle: null,
    type: "native",
    installPath: `${G}/itch/veloren`,
    executable: `${G}/itch/veloren/veloren`,
    args: [],
    env: {},
    workDir: `${G}/itch/veloren`,
    tags: ["sandbox", "multiplayer"],
    favorite: false,
    hidden: false,
    notes: null,
    coverPath: null,
    status: "ready",
    createdAt: at(20, 17, 12),
    updatedAt: at(20, 21, 3),
    lastPlayedAt: at(20, 20, 41),
    totalSeconds: 11_400,
  },
  {
    id: 7,
    title: "OpenMW",
    sortTitle: null,
    type: "mod",
    installPath: `${G}/openmw`,
    executable: `${G}/openmw/openmw`,
    args: ["--data", `${G}/Morrowind/Data Files`],
    env: {},
    workDir: `${G}/openmw`,
    tags: ["total-conversion", "rpg"],
    favorite: false,
    hidden: false,
    notes:
      "Morrowind engine reimplementation. Data files point at the GOG install next door.",
    coverPath: null,
    status: "ready",
    createdAt: at(28, 13, 25),
    updatedAt: at(16, 20, 10),
    lastPlayedAt: at(16, 19, 55),
    totalSeconds: 32_760,
  },
  {
    id: 8,
    title: "AM2R",
    sortTitle: null,
    type: "mod",
    installPath: `${G}/itch/AM2R`,
    executable: `${G}/itch/AM2R/AM2R`,
    args: [],
    env: {},
    workDir: `${G}/itch/AM2R`,
    tags: ["fan-project", "metroidvania"],
    favorite: false,
    hidden: false,
    notes: "Community 1.5.5 build.",
    coverPath: null,
    status: "ready",
    createdAt: at(33, 21, 0),
    updatedAt: at(24, 19, 30),
    lastPlayedAt: at(24, 19, 8),
    totalSeconds: 14_580,
  },
  {
    id: 9,
    title: "The Elder Scrolls III: Morrowind",
    sortTitle: "Elder Scrolls III, The: Morrowind",
    type: "windows",
    installPath: `${G}/Morrowind`,
    executable: `${G}/Morrowind/Morrowind.exe`,
    args: [],
    env: {},
    workDir: `${G}/Morrowind`,
    tags: ["rpg", "nostalgia"],
    favorite: false,
    hidden: false,
    notes: "Launches through Wine; saves and config live in the prefix.",
    coverPath: null,
    status: "ready",
    createdAt: at(28, 13, 20),
    updatedAt: at(16, 20, 12),
    lastPlayedAt: at(28, 22, 15),
    totalSeconds: 94_800,
  },
  {
    id: 10,
    title: "Sonic the Hedgehog 2",
    sortTitle: null,
    type: "retro",
    installPath: `${G}/retro/sonic2`,
    executable: `${G}/retro/sonic2/Sonic The Hedgehog 2 (World).md`,
    args: [],
    env: {},
    workDir: `${G}/retro/sonic2`,
    tags: ["platformer", "16-bit"],
    favorite: false,
    hidden: false,
    notes: "RetroArch runner is an M2 item.",
    coverPath: coverArtUri("Sonic the Hedgehog 2"),
    status: "ready",
    createdAt: at(16, 12, 20),
    updatedAt: at(16, 12, 20),
    lastPlayedAt: null,
    totalSeconds: 21_960,
  },
  {
    id: 11,
    title: "Rogue Legacy",
    sortTitle: null,
    type: "native",
    installPath: `${G}/Rogue Legacy`,
    executable: `${G}/Rogue Legacy/RogueLegacy.x86_64`,
    args: [],
    env: {},
    workDir: `${G}/Rogue Legacy`,
    tags: ["roguelite"],
    favorite: false,
    hidden: false,
    notes: "Executable disappeared after a bad unpack — shows up as missing.",
    coverPath: null,
    status: "missing",
    createdAt: at(38, 15, 0),
    updatedAt: at(38, 15, 0),
    lastPlayedAt: at(59, 23, 40),
    totalSeconds: 54_000,
  },
  /*
   * The two Unity/Windows entries exist for the mods panel: one IL2CPP game with
   * nothing installed (so the MelonLoader suggestion is on screen) and one Mono
   * game that already has BepInEx (so the "installed" state is on screen). Both
   * are real Unity titles whose community loaders are the ones the core would
   * suggest.
   */
  {
    id: 12,
    title: "Vampire Survivors",
    sortTitle: null,
    type: "windows",
    installPath: `${G}/Vampire Survivors`,
    executable: `${G}/Vampire Survivors/VampireSurvivors.exe`,
    args: [],
    env: {},
    workDir: `${G}/Vampire Survivors`,
    tags: ["roguelite", "bullet-heaven"],
    favorite: false,
    hidden: false,
    notes: null,
    coverPath: coverArtUri("Vampire Survivors"),
    status: "ready",
    createdAt: at(2, 19, 40),
    updatedAt: at(2, 20, 55),
    lastPlayedAt: at(2, 20, 30),
    totalSeconds: 9_600,
  },
  {
    id: 13,
    title: "ULTRAKILL",
    sortTitle: null,
    type: "windows",
    installPath: `${G}/ULTRAKILL`,
    executable: `${G}/ULTRAKILL/ULTRAKILL.exe`,
    args: [],
    env: {},
    workDir: `${G}/ULTRAKILL`,
    tags: ["shooter", "speedrun"],
    favorite: true,
    hidden: false,
    notes: "BepInEx is already in place; plugins live in BepInEx/plugins.",
    coverPath: coverArtUri("ULTRAKILL"),
    status: "ready",
    createdAt: at(5, 18, 5),
    updatedAt: at(4, 21, 30),
    lastPlayedAt: at(4, 21, 5),
    totalSeconds: 14_400,
  },
];

const CANDIDATES: Candidate[] = [
  {
    id: 101,
    sourceId: 1,
    path: `${G}/Deaths Door`,
    executable: `${G}/Deaths Door/DeathsDoor.x86_64`,
    engine: "unreal",
    suggestedTitle: "Death's Door",
    confidence: 0.86,
    evidence: ["Deaths Door/Binaries/Linux/", "DeathsDoor.pak"],
    status: "pending",
    createdAt: at(7, 19, 5),
  },
  {
    id: 102,
    sourceId: 1,
    path: `${G}/prototype-godot`,
    executable: `${G}/prototype-godot/prototype.x86_64`,
    engine: "godot",
    suggestedTitle: "Prototype Godot",
    confidence: 0.63,
    evidence: ["prototype.pck", "export_presets.cfg"],
    status: "pending",
    createdAt: at(7, 19, 5, ),
  },
  {
    id: 103,
    sourceId: 1,
    path: `${G}/Unreal Tournament 99`,
    executable: `${G}/Unreal Tournament 99/System/ut99.sh`,
    engine: "unreal",
    suggestedTitle: "Unreal Tournament 99",
    confidence: 0.71,
    evidence: ["System/", "Maps/", "*.unr"],
    status: "pending",
    createdAt: at(7, 19, 5),
  },
  {
    id: 104,
    sourceId: 1,
    path: `${G}/renpy-visual-novel`,
    executable: `${G}/renpy-visual-novel/visual-novel.sh`,
    engine: "renpy",
    suggestedTitle: "Ren'Py visual novel",
    confidence: 0.58,
    evidence: ["renpy/", "game/script.rpy"],
    status: "pending",
    createdAt: at(7, 19, 5),
  },
  {
    id: 105,
    sourceId: 2,
    path: `${G}/itch/chess-sentinel`,
    executable: `${G}/itch/chess-sentinel/chess-sentinel.x86_64`,
    engine: "unknown",
    suggestedTitle: "Chess Sentinel",
    confidence: 0.52,
    evidence: ["executable bit + ELF magic"],
    status: "pending",
    createdAt: at(7, 19, 7),
  },
  {
    id: 106,
    sourceId: 2,
    path: `${G}/itch/goodboy-galaxy`,
    executable: `${G}/itch/goodboy-galaxy/GoodboyGalaxy`,
    engine: "gamemaker",
    suggestedTitle: "Goodboy Galaxy",
    confidence: 0.74,
    evidence: ["data.win", "options.ini"],
    status: "pending",
    createdAt: at(7, 19, 7),
  },
  {
    id: 107,
    sourceId: 2,
    path: `${G}/itch/kenney-bundle`,
    executable: null,
    engine: "unknown",
    suggestedTitle: "Kenney Bundle",
    confidence: 0.31,
    evidence: ["no primary executable found"],
    status: "pending",
    createdAt: at(7, 19, 7),
  },
  {
    id: 108,
    sourceId: 3,
    path: `${G}/retro/rondo-of-blood`,
    executable: null,
    engine: "unknown",
    suggestedTitle: "Rondo of Blood",
    confidence: 0.38,
    evidence: ["*.cue", "*.bin"],
    status: "pending",
    createdAt: at(7, 19, 7),
  },
  {
    id: 109,
    sourceId: 1,
    path: `${G}/Hollow Knight`,
    executable: `${G}/Hollow Knight/HollowKnight.x86_64`,
    engine: "unity",
    suggestedTitle: "Hollow Knight",
    confidence: 0.94,
    evidence: ["UnityPlayer.so", "Hollow Knight_Data/"],
    status: "approved",
    createdAt: at(45, 18, 22),
  },
  {
    id: 110,
    sourceId: 1,
    path: `${G}/Celeste`,
    executable: `${G}/Celeste/Celeste`,
    engine: "unknown",
    suggestedTitle: "Celeste",
    confidence: 0.81,
    evidence: ["executable bit + ELF magic"],
    status: "approved",
    createdAt: at(45, 18, 22),
  },
  {
    id: 111,
    sourceId: 2,
    path: `${G}/itch/brotato-linux`,
    executable: `${G}/itch/brotato-linux/Brotato.x86_64`,
    engine: "godot",
    suggestedTitle: "Brotato",
    confidence: 0.89,
    evidence: ["Brotato.pck", "Brotato.x86_64"],
    status: "approved",
    createdAt: at(33, 20, 42),
  },
  {
    id: 112,
    sourceId: 1,
    path: `${G}/unityhub-tools/lib`,
    executable: null,
    engine: "unknown",
    suggestedTitle: "lib",
    confidence: 0.12,
    evidence: ["matches ignore rule: support/"],
    status: "rejected",
    createdAt: at(45, 18, 23),
  },
  {
    id: 113,
    sourceId: 1,
    path: `${G}/CommonRedist`,
    executable: null,
    engine: "unknown",
    suggestedTitle: "CommonRedist",
    confidence: 0.08,
    evidence: ["matches ignore rule: _CommonRedist"],
    status: "rejected",
    createdAt: at(45, 18, 23),
  },
];

interface SessionSeed {
  gameId: number;
  dayOffset: number;
  hour: number;
  minute: number;
  durationSeconds: number;
  exitCode: number | null;
}

const SESSION_SEEDS: SessionSeed[] = [
  { gameId: 1, dayOffset: 1, hour: 20, minute: 12, durationSeconds: 6_480, exitCode: 0 },
  { gameId: 1, dayOffset: 3, hour: 21, minute: 5, durationSeconds: 9_240, exitCode: 0 },
  { gameId: 1, dayOffset: 6, hour: 19, minute: 48, durationSeconds: 5_100, exitCode: 0 },
  { gameId: 1, dayOffset: 8, hour: 22, minute: 30, durationSeconds: 3_600, exitCode: 1 },
  { gameId: 1, dayOffset: 11, hour: 18, minute: 12, durationSeconds: 7_800, exitCode: 0 },
  { gameId: 1, dayOffset: 14, hour: 20, minute: 2, durationSeconds: 10_500, exitCode: 0 },
  { gameId: 1, dayOffset: 17, hour: 23, minute: 15, durationSeconds: 2_700, exitCode: 0 },
  { gameId: 1, dayOffset: 21, hour: 19, minute: 40, durationSeconds: 8_400, exitCode: 0 },
  { gameId: 1, dayOffset: 25, hour: 20, minute: 55, durationSeconds: 6_120, exitCode: 0 },
  { gameId: 1, dayOffset: 29, hour: 18, minute: 30, durationSeconds: 4_800, exitCode: 0 },
  { gameId: 1, dayOffset: 33, hour: 21, minute: 10, durationSeconds: 9_000, exitCode: 0 },
  { gameId: 1, dayOffset: 38, hour: 20, minute: 0, durationSeconds: 5_400, exitCode: 0 },
  { gameId: 2, dayOffset: 12, hour: 21, minute: 0, durationSeconds: 3_900, exitCode: 0 },
  { gameId: 2, dayOffset: 18, hour: 20, minute: 25, durationSeconds: 4_500, exitCode: 0 },
  { gameId: 2, dayOffset: 27, hour: 19, minute: 5, durationSeconds: 2_400, exitCode: 0 },
  { gameId: 3, dayOffset: 9, hour: 22, minute: 12, durationSeconds: 2_100, exitCode: 0 },
  { gameId: 3, dayOffset: 15, hour: 21, minute: 45, durationSeconds: 1_800, exitCode: 0 },
  { gameId: 5, dayOffset: 19, hour: 18, minute: 22, durationSeconds: 7_200, exitCode: 0 },
  { gameId: 5, dayOffset: 26, hour: 17, minute: 50, durationSeconds: 5_700, exitCode: 0 },
  { gameId: 6, dayOffset: 20, hour: 20, minute: 41, durationSeconds: 3_300, exitCode: 0 },
  { gameId: 7, dayOffset: 16, hour: 19, minute: 55, durationSeconds: 4_200, exitCode: 0 },
  { gameId: 8, dayOffset: 24, hour: 19, minute: 8, durationSeconds: 2_760, exitCode: 0 },
  { gameId: 9, dayOffset: 28, hour: 22, minute: 15, durationSeconds: 5_100, exitCode: 0 },
  { gameId: 11, dayOffset: 59, hour: 23, minute: 40, durationSeconds: 2_880, exitCode: 0 },
  { gameId: 12, dayOffset: 2, hour: 20, minute: 30, durationSeconds: 3_600, exitCode: 0 },
  { gameId: 13, dayOffset: 4, hour: 21, minute: 5, durationSeconds: 5_400, exitCode: 0 },
  { gameId: 13, dayOffset: 9, hour: 22, minute: 40, durationSeconds: 7_200, exitCode: 0 },
];

function buildSessions(): Session[] {
  return SESSION_SEEDS.map((seed, index) => {
    const startedAt = at(seed.dayOffset, seed.hour, seed.minute);
    const endedAt = new Date(
      Date.parse(startedAt) + seed.durationSeconds * 1_000,
    ).toISOString();
    return {
      id: index + 1,
      gameId: seed.gameId,
      startedAt,
      endedAt,
      durationSeconds: seed.durationSeconds,
      exitCode: seed.exitCode,
    };
  });
}

/* ------------------------------------------------------------------ mods --- */

/**
 * Mod state the mock "detects" per game.
 *
 * The core walks the game folder; the mock cannot, so detection is a table.
 * Between them the three seeds cover every state the panel can render: a loader
 * already installed (ULTRAKILL), a known engine with nothing installed yet
 * (Vampire Survivors) and a game whose engine could not be told apart (Morrowind,
 * `engine: "unknown"`) — which is the one case where the panel has to say "no
 * known mod support" and offer no loader at all.
 *
 * Morrowind's script extender injects through a proxy DLL at the game root, which
 * is exactly what `doorstop` describes; its mods sit in `Mods/`.
 */
const MODS_SEED: Record<number, ModsSeed> = {
  9: {
    loader: "doorstop",
    modsDir: "Mods",
    modsDirKind: "mods",
    engine: "unknown",
    markers: [],
    installed: ["MWSE", "MGE-XE", "Patch for Purists", "Tamriel Rebuilt"],
  },
  12: {
    loader: "none",
    modsDir: null,
    modsDirKind: "none",
    engine: "unity-il2cpp",
    markers: [],
    installed: [],
  },
  13: {
    loader: "bepinex",
    modsDir: "BepInEx/plugins",
    modsDirKind: "bepinex-plugins",
    engine: "unity-mono",
    markers: [],
    installed: ["CustomWeapons.dll", "UltraQoL", "config"],
  },
};

export function modsSeeds(): Array<[number, ModsSeed]> {
  return Object.entries(MODS_SEED).map(([gameId, seed]) => [
    Number(gameId),
    { ...seed, installed: [...seed.installed] },
  ]);
}

/* ---------------------------------------------------------------- covers --- */

/** Store entries the mock "finds", with their real app ids. */
const COVER_CATALOGUE: { id: string; name: string }[] = [
  { id: "367520", name: "Hollow Knight" },
  { id: "504230", name: "Celeste" },
  { id: "1942280", name: "Brotato" },
  { id: "975370", name: "Dwarf Fortress" },
  { id: "1536610", name: "Vampire Survivors" },
  { id: "1229490", name: "ULTRAKILL" },
  { id: "312520", name: "Rain World" },
];

/** Store entries are never alone: there is always an edition or two alongside. */
const COVER_EDITIONS = [
  "",
  " — Deluxe Edition",
  " (Classic)",
  ": Definitive Edition",
  " — Anniversary Edition",
];

/**
 * Deterministic search results: catalogue matches first, then editions of the
 * query itself, so a search for a title that is not in the catalogue still shows
 * a realistic list rather than a dead end.
 *
 * One candidate deliberately has no portrait art (`portraitUrl: null`), because
 * plenty of store entries do not — the UI has to fall back to the capsule
 * instead of leaving a gap.
 */
export function coverCandidates(query: string): CoverCandidate[] {
  const trimmed = query.trim();
  // Total-function guard only: `fetch_cover_candidates` refuses an empty query
  // before it gets here (the core does the same), and the dialog disables its
  // button for one.
  if (trimmed.length === 0) return [];

  const needle = trimmed.toLowerCase();
  const entries = [
    ...COVER_CATALOGUE.filter((entry) => entry.name.toLowerCase().includes(needle)),
    // Synthetic ids sit in a range above every real app id in the catalogue, so
    // a synthesized edition can never collide with a matched one.
    ...COVER_EDITIONS.map((suffix) => ({
      id: String(2_000_000 + (hashString(`${trimmed}${suffix}`) % 999_999)),
      name: `${trimmed}${suffix}`,
    })),
  ];

  const seen = new Set<string>();
  const unique: { id: string; name: string }[] = [];
  for (const entry of entries) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    unique.push(entry);
  }

  return unique.slice(0, 8).map((entry, index) => ({
    provider: "steam",
    id: entry.id,
    name: entry.name,
    thumbUrl: coverArtUri(`capsule:${entry.name}`, entry.name),
    // One result deliberately has no portrait art: the contract allows `null`,
    // and the picker has to fall back to the capsule.
    portraitUrl: index === 2 ? null : coverArtUri(`poster:${entry.name}`, entry.name),
    landscapeUrl: index === 3 ? null : coverArtUri(`header:${entry.name}`, entry.name),
  }));
}

/** Files the emulated file picker hands back, in order. */
const PICKABLE_FILES = [
  "/home/oliwier/Pictures/covers/hollow-knight-alt.png",
  "/home/oliwier/Pictures/covers/celeste-poster.jpg",
  "/home/oliwier/Downloads/steamgriddb-ultrakill.webp",
  "/home/oliwier/Downloads/CoolMod-2.1.zip",
  "/home/oliwier/Downloads/TexturePack.7z",
];

/** Archive names a real drop would carry — used by the mock's own tests. */
export const ARCHIVE_NAME_HINT = "CoolMod-2.1.zip";

/**
 * Folders the emulated scanner still has to discover, per source. Re-scanning a
 * source drains its pool, so a second scan honestly reports "nothing new".
 */const DISCOVERIES: Record<number, DiscoverySeed[]> = {
  1: [
    {
      folder: "The Messenger",
      executable: "TheMessenger.x86_64",
      engine: "unity",
      title: "The Messenger",
      confidence: 0.88,
      evidence: ["UnityPlayer.so", "The Messenger_Data/"],
    },
    {
      folder: "Cave Story+",
      executable: "CaveStory+",
      engine: "unknown",
      title: "Cave Story+",
      confidence: 0.66,
      evidence: ["executable bit + ELF magic"],
    },
    {
      folder: "Aseprite build",
      executable: null,
      engine: "unknown",
      title: "Aseprite build",
      confidence: 0.22,
      evidence: ["matches ignore rule: docs/"],
    },
  ],
  2: [
    {
      folder: "dome-keeper",
      executable: "dome_keeper.x86_64",
      engine: "godot",
      title: "Dome Keeper",
      confidence: 0.83,
      evidence: ["DomeKeeper.pck", "dome_keeper.x86_64"],
    },
    {
      folder: "patchwork-princess",
      executable: "patchwork_princess.x86_64",
      engine: "gamemaker",
      title: "Patchwork Princess",
      confidence: 0.69,
      evidence: ["data.win", "options.ini"],
    },
  ],
  3: [
    {
      folder: "super-metroid",
      executable: null,
      engine: "unknown",
      title: "Super Metroid",
      confidence: 0.41,
      evidence: ["*.smc"],
    },
  ],
};

/** Used for sources added at runtime, so a newly added root still scans. */
const GENERIC_DISCOVERIES: DiscoverySeed[] = [
  {
    folder: "sunken-caverns",
    executable: "SunkenCaverns.x86_64",
    engine: "unity",
    title: "Sunken Caverns",
    confidence: 0.84,
    evidence: ["UnityPlayer.so", "Sunken Caverns_Data/"],
  },
  {
    folder: "pixel-rogue",
    executable: "pixel_rogue.x86_64",
    engine: "godot",
    title: "Pixel Rogue",
    confidence: 0.77,
    evidence: ["pixel_rogue.pck", "export_presets.cfg"],
  },
  {
    folder: "densetsu-fangame",
    executable: null,
    engine: "unknown",
    title: "Densetsu (fangame)",
    confidence: 0.29,
    evidence: ["matches ignore rule: redists/"],
  },
];

const PICKABLE_PATHS = [
  "/home/oliwier/Games/Indie",
  "/home/oliwier/Games/DRM-free",
  "/mnt/data/backup-games",
  "/home/oliwier/Downloads/games",
];

export function createSeedState(settings?: Partial<Settings>): MockState {
  return {
    sources: SOURCES.map((source) => ({ ...source })),
    candidates: CANDIDATES.map((candidate) => ({
      ...candidate,
      evidence: [...candidate.evidence],
    })),
    games: GAMES.map((game) => ({
      ...game,
      args: [...game.args],
      env: { ...game.env },
      tags: [...game.tags],
    })),
    sessions: buildSessions(),
    settings: loadSettings(settings),
    nextSourceId: SOURCES.length + 1,
    nextCandidateId: 200,
    nextGameId: GAMES.length + 1,
    nextSessionId: SESSION_SEEDS.length + 1,
    missingExecutables: new Set([`${G}/Rogue Legacy/RogueLegacy.x86_64`]),
    discoveries: new Map(
      Object.entries(DISCOVERIES).map(([sourceId, seeds]) => [
        Number(sourceId),
        seeds.map((seed) => ({ ...seed, evidence: [...seed.evidence] })),
      ]),
    ),
    pickablePaths: [...PICKABLE_PATHS],
    pickableFiles: [...PICKABLE_FILES],
    mods: new Map(modsSeeds()),
  };
}

export function genericDiscoveries(): DiscoverySeed[] {
  return GENERIC_DISCOVERIES.map((seed) => ({
    ...seed,
    evidence: [...seed.evidence],
  }));
}
