/**
 * English strings — the reference resource.
 *
 * `pl.ts` is typed as `typeof en`, so a missing or misspelled key is a compile
 * error rather than a silent fallback. Counts are phrased as `label: value` so
 * no plural keys are needed and both locales stay structurally identical.
 */
export const en = {
  app: {
    name: "Zen Launcher",
    subtitle: "Local game library",
  },

  nav: {
    library: "Library",
    sources: "Sources & Import",
    settings: "Settings",
    pendingBadge: "Pending candidates",
  },

  header: {
    searchPlaceholder: "Search library",
    searchLabel: "Search library",
    clearSearch: "Clear search",
    layoutGrid: "Cover grid",
    layoutList: "List view",
    sortLabel: "Sort",
    sortTitle: "Title",
    sortRecent: "Recently played",
    sortPlaytime: "Playtime",
  },

  units: {
    hour: "h",
    minute: "min",
    lessThanMinute: "<1 min",
    none: "—",
    never: "Never played",
  },

  common: {
    play: "Play",
    cancel: "Cancel",
    confirm: "Confirm",
    close: "Close",
    back: "Back",
    remove: "Remove",
    save: "Save",
    add: "Add",
    retry: "Try again",
    loading: "Loading",
    yes: "Yes",
    no: "No",
    none: "None",
    dismiss: "Dismiss notification",
  },

  engine: {
    unity: "Unity",
    godot: "Godot",
    unreal: "Unreal",
    gamemaker: "GameMaker",
    renpy: "Ren'Py",
    unknown: "Unknown engine",
  },

  gameType: {
    native: "Native",
    windows: "Windows",
    retro: "Retro",
    mod: "Mod",
  },

  gameStatus: {
    ready: "Ready",
    missing: "Files missing",
  },

  candidateStatus: {
    pending: "Pending",
    approved: "Approved",
    rejected: "Rejected",
  },

  library: {
    emptyTitle: "Your library is empty",
    emptyBody:
      "Add a folder you keep games in, scan it, and approve what the scanner finds.",
    emptyAction: "Go to Sources & Import",
    noResultsTitle: "Nothing matches",
    noResultsBody: "No entry in the library matches “{{query}}”.",
    noResultsAction: "Clear search",
    showing: "Shown: {{count}} / {{total}}",
    favoriteAdd: "Add to favorites",
    favoriteRemove: "Remove from favorites",
    openDetails: "Open details",
    reveal: "Reveal in file manager",
    remove: "Remove from library",
    removeTitle: "Remove “{{title}}” from the library?",
    removeBody:
      "The entry is removed from the library only. Files on disk stay exactly where they are — nothing is deleted or moved.",
    removedToast: "Removed from the library",
    removedToastBody: "“{{title}}” is no longer listed. Files were not touched.",
    removeFailed: "Could not remove the entry",
    favoriteFailed: "Could not change the favorite flag",
    table: {
      title: "Title",
      type: "Type",
      playtime: "Playtime",
      lastPlayed: "Last played",
      status: "Status",
      tags: "Tags",
      actions: "Actions",
    },
  },

  import: {
    title: "Sources & Import",
    description:
      "Scan roots are folders Zen Launcher walks to find game folders. Nothing is added to the library until you approve it.",
    sourcesTitle: "Scan roots",
    sourcesEmptyTitle: "No scan root yet",
    sourcesEmpty:
      "Add the folder where your games live, then scan it for entries.",
    addFolder: "Add folder",
    addFolderDialog: "Choose a folder to scan",
    scan: "Scan",
    rescan: "Scan again",
    scanning: "Scanning",
    removeSource: "Remove scan root",
    removeSourceTitle: "Remove the scan root “{{path}}”?",
    removeSourceBody:
      "Only the root is forgotten. Candidates and library entries stay untouched, and no file on disk is affected.",
    lastScan: "Last scan: {{value}}",
    neverScanned: "Never scanned",
    sourceAdded: "Scan root added",
    sourceAddFailed: "Could not add the scan root",
    sourceRemoved: "Scan root removed",
    sourceRemoveFailed: "Could not remove the scan root",
    scanFailed: "Scan failed",
    scanRunning: "Scanning {{path}}",
    scanProgressWaiting: "Looking for game folders…",
    scanProgressCurrent: "Checking {{path}}",
    progressFound: "Candidates so far: {{count}}",
    scanFinished: "Scan finished",
    scanFinishedBody: "New candidates: {{count}}",
    autoScanNote: "Automatic scanning of roots arrives with the M2 watcher.",
    candidatesTitle: "Candidates",
    candidatesDescription:
      "Review what the scanner found. Edit the title or executable, then approve or reject.",
    tabPending: "Pending ({{count}})",
    tabApproved: "Approved ({{count}})",
    tabRejected: "Rejected ({{count}})",
    noPending: "No candidates waiting",
    noPendingBody:
      "Scan a root or add a new folder — anything new the scanner finds shows up here for review.",
    noApproved: "Nothing approved yet",
    noApprovedBody:
      "Approved candidates became library entries — they are waiting in the Library.",
    noRejected: "Nothing rejected yet",
    noRejectedBody:
      "Rejected candidates stay out of the library and can always be found again by scanning.",
    fieldTitle: "Title",
    fieldExecutable: "Executable",
    fieldEngine: "Engine",
    confidence: "Confidence",
    evidence: "Evidence",
    suggestedPath: "Folder",
    missingExecutableHint:
      "The scanner found no executable here. Set one before approving.",
    approve: "Approve",
    reject: "Reject",
    approveAll: "Approve all ({{count}})",
    rejectAll: "Reject all ({{count}})",
    approveAllTitle: "Approve all {{count}} pending candidates?",
    approveAllBody:
      "Each candidate becomes a library entry with the suggested title and executable. Candidates without an executable are skipped.",
    rejectAllTitle: "Reject all {{count}} pending candidates?",
    rejectAllBody:
      "They leave the review list. Files on disk are not affected and the folders can be scanned again later.",
    approvedToast: "Added to the library",
    approvedToastBody: "“{{title}}” is ready.",
    rejectedToast: "Candidate rejected",
    rejectedToastBody: "“{{title}}” will not be added.",
    approveFailed: "Could not approve the candidate",
    rejectFailed: "Could not reject the candidate",
    bulkApproved: "Candidates approved: {{count}}",
    bulkRejected: "Candidates rejected: {{count}}",
    bulkPartial: "Skipped (no executable): {{count}}",
    bulkFailed: "Failed: {{count}}",
  },

  details: {
    backToLibrary: "Back to library",
    notFoundTitle: "This entry is gone",
    notFoundBody: "It is no longer in the library.",
    play: "Play",
    playBlockedType: "Launching {{type}} entries isn't supported yet.",
    playBlockedMissing:
      "The executable is missing. Fix the path in the launch options.",
    launchOptions: "Launch options",
    launchOptionsDescription:
      "Passed straight to the process — arguments as an array, never a shell string.",
    executable: "Executable",
    executableHint: "Absolute path to the program that starts the game.",
    executableRequired: "An entry needs an executable path.",
    workDir: "Working directory",
    workDirHint: "Optional. Defaults to the folder the game was found in.",
    workDirPlaceholder: "Leave empty to use the install folder",
    args: "Arguments",
    argsHint:
      "Free text. Use quotes to keep a value together, e.g. -screen-width 1920 -name \"Player One\".",
    argsPreview: "Parsed arguments",
    argsPreviewEmpty: "No arguments",
    env: "Environment variables",
    envHint: "One KEY=value per line. Lines starting with # are ignored.",
    envPreview: "Parsed variables",
    envPreviewEmpty: "No variables",
    saveOptions: "Save options",
    revertChanges: "Revert",
    unsaved: "Unsaved changes",
    optionsSaved: "Launch options saved",
    optionsSaveFailed: "Could not save the launch options",
    notes: "Notes",
    notesField: "Text",
    notesHint: "Saved automatically while you type.",
    notesPlaceholder: "Anything worth remembering about this game…",
    notesSaving: "Saving…",
    notesSaved: "Saved",
    notesSaveFailed: "Notes were not saved",
    sessions: "Session history",
    sessionsEmpty: "No session recorded yet.",
    sessionsDescription: "The ten most recent sessions.",
    sessionDuration: "Duration",
    sessionStarted: "Started",
    sessionExit: "Exit code",
    sessionInProgress: "In progress",
    sessionExitOk: "Exited cleanly",
    reveal: "Reveal in file manager",
    remove: "Remove from library",
    factsTitle: "Entry",
    installPath: "Install folder",
    entryId: "Library id",
    createdAt: "Added",
    updatedAt: "Updated",
    tagsTitle: "Tags",
    tagsEmpty: "No tags",
    tagsNote: "Tags are read-only in M1 — editing arrives with M3.",
    launched: "Session started",
    launchedBody: "“{{title}}” is running.",
    launchFailed: "Could not launch the game",
    sessionEnded: "Session ended",
    sessionEndedBody: "“{{title}}” ran for {{duration}}.",
    revealFailed: "Could not open the file manager",
  },

  settings: {
    title: "Settings",
    description: "Stored on this machine only — no account, no telemetry.",
    languageTitle: "Language",
    languageDescription: "Applies immediately across the interface.",
    languageEn: "English",
    languagePl: "Polski",
    behaviourTitle: "Window behaviour",
    behaviourDescription: "How the window reacts while a game is running.",
    closeToTray: "Keep running in the tray on close",
    closeToTrayHint:
      "Closing the window hides it to the tray. To exit the app entirely, use Quit in the tray menu.",
    hideOnLaunch: "Hide the window when a game starts",
    hideOnLaunchHint:
      "The launcher drops out of the way and the session keeps running.",
    storageTitle: "Storage",
    storageDescription: "Read-only in M1 — paths are fixed by the design document.",
    configPath: "Config file",
    dataPath: "Data folder",
    storageNote:
      "Artwork, saves and mods folders arrive with their milestones; library.db and logs live in the data folder today.",
    aboutTitle: "About",
    version: "Version",
    license: "License",
    mode: "IPC mode",
    modeTauri: "Tauri core",
    modeMock: "Mock (in-memory)",
    modeMockHint:
      "No Rust core attached: every action runs against the in-memory adapter and nothing is written to disk.",
    onboardingTitle: "Setup tour",
    onboardingDescription:
      "Language, interface font, accent, default library view and what the window does while a game runs. Every choice persists the moment you make it, so there is nothing to submit.",
    onboardingRun: "Run the setup tour again",
    settingsSaved: "Settings saved",
    settingsSaveFailed: "Could not save the settings",
    licenseName: "MIT",
  },

  onboarding: {
    kicker: "First run",
    stepCounter: "Step {{current}} of {{total}}",
    railLabel: "Setup steps",
    stepLanguage: "Language",
    stepAppearance: "Appearance",
    stepLibrary: "Library",
    stepWindow: "Window",
    stepFinish: "Done",

    languageTitle: "Choose your language",
    languageBody:
      "The whole interface follows immediately, including this tour. Nothing is stuck: Settings switches it back at any time.",

    appearanceTitle: "Set the tone",
    appearanceBody:
      "The interface is set in Maple Mono by default; the accent colours the small, loud things — buttons, focus rings, counters. Both are yours to change.",

    fontTitle: "Interface font",
    fontBody:
      "Applies to text across the app. Headings are always in Space Grotesk.",
    fontMapleMono: "Maple Mono",
    fontMapleMonoHint: "Default. A calm fixed-width face with coding ligatures.",
    fontInstrumentSans: "Instrument Sans",
    fontInstrumentSansHint: "Proportional and softer, without ligatures.",
    fontSystem: "System",
    fontSystemHint: "Whatever your desktop already uses.",

    accentTitle: "Accent",
    accentJade: "Jade",
    accentPlum: "Plum",
    accentAzure: "Azure",
    accentEmber: "Ember",
    accentRose: "Rose",
    accentNeutral: "Graphite",

    previewTitle: "Preview",
    previewDisplay: "Ink & Jade",
    fontSample: "Zażółć gęślą jaźń",
    previewSample:
      "Zażółć gęślą jaźń. The quick brown fox jumps over the lazy dog.",
    previewMeta: "~/.local/share/zen-launcher/library.db",
    previewButton: "Play",

    libraryTitle: "How should the library open?",
    libraryBody:
      "The view your collection lands in. The header toggles between the two whenever you like.",
    libraryGrid: "Cover grid",
    libraryGridHint: "Big artwork, three or four to a row.",
    libraryList: "List",
    libraryListHint: "Denser: title, type, playtime, last played.",

    windowTitle: "While a game runs",
    windowBody:
      "What the launcher does with its own window, both changeable later in Settings.",

    finishTitle: "Ready when you are",
    finishBody: "Here is everything the tour collected.",
    summaryLanguage: "Language",
    summaryFont: "Font",
    summaryAccent: "Accent",
    summaryLibrary: "Library view",
    summaryTray: "Close to tray",
    summaryHideOnLaunch: "Hide on launch",
    finishNote:
      "Saved on this machine only. Run the tour again from Settings whenever you want to revisit these.",

    back: "Back",
    next: "Next",
    finish: "Start using Zen Launcher",
    skip: "Skip",
    skipHint: "Skip the tour and keep the defaults.",
    footHint: "Your choices are saved as you go.",
  },

  errors: {
    title: "Something went wrong",
    NOT_FOUND: "Not found",
    IO: "File error",
    DB: "Database error",
    VALIDATION: "Not accepted",
    LAUNCH_FAILED: "Launch failed",
    UNSUPPORTED: "Not supported yet",
    UNKNOWN: "Unexpected error",
    initFailed: "Could not load the library",
  },

  parse: {
    unterminatedQuote: "Unclosed {{token}} quote — finish the value or remove it.",
    invalidEnvLine: "Line {{line}} is not KEY=value: {{text}}",
  },

  toasts: {
    libraryChanged: "Library updated",
  },
} as const;

export type TranslationResource = typeof en;

/**
 * Widens literal types so `pl` must mirror the key structure of `en` while
 * keeping the freedom to use different (Polish) strings.
 */
export type DeepStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]>;
};

export type TranslationShape = DeepStrings<TranslationResource>;
