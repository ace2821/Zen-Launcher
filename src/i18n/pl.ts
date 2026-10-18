import type { TranslationShape } from "./en";

/**
 * Polish strings. Typed as `TranslationShape`, so the compiler refuses to build
 * if a key is missing or misspelled relative to `en.ts`.
 */
export const pl: TranslationShape = {
  app: {
    name: "Zen Launcher",
    subtitle: "Lokalna biblioteka gier",
  },

  nav: {
    library: "Biblioteka",
    sources: "Źródła i import",
    settings: "Ustawienia",
    pendingBadge: "Kandydaci do przejrzenia",
  },

  header: {
    searchPlaceholder: "Szukaj w bibliotece",
    searchLabel: "Szukaj w bibliotece",
    clearSearch: "Wyczyść wyszukiwanie",
    layoutGrid: "Siatka okładek",
    layoutList: "Widok listy",
    sortLabel: "Sortowanie",
    sortTitle: "Tytuł",
    sortRecent: "Ostatnio grane",
    sortPlaytime: "Czas gry",
  },

  units: {
    hour: "godz.",
    minute: "min",
    lessThanMinute: "<1 min",
    none: "—",
    never: "Nigdy nie grano",
  },

  common: {
    play: "Graj",
    cancel: "Anuluj",
    confirm: "Potwierdź",
    close: "Zamknij",
    back: "Wstecz",
    remove: "Usuń",
    save: "Zapisz",
    add: "Dodaj",
    retry: "Spróbuj ponownie",
    loading: "Wczytywanie",
    yes: "Tak",
    no: "Nie",
    none: "Brak",
    dismiss: "Zamknij powiadomienie",
  },

  engine: {
    unity: "Unity",
    godot: "Godot",
    unreal: "Unreal",
    gamemaker: "GameMaker",
    renpy: "Ren'Py",
    unknown: "Nieznany silnik",
  },

  gameType: {
    native: "Natywna",
    windows: "Windows",
    retro: "Retro",
    mod: "Mod",
  },

  gameStatus: {
    ready: "Gotowa",
    missing: "Brak plików",
  },

  candidateStatus: {
    pending: "Oczekuje",
    approved: "Zatwierdzony",
    rejected: "Odrzucony",
  },

  library: {
    emptyTitle: "Biblioteka jest pusta",
    emptyBody:
      "Dodaj folder, w którym trzymasz gry, zeskanuj go i zatwierdź to, co znajdzie skaner.",
    emptyAction: "Przejdź do Źródeł i importu",
    noResultsTitle: "Brak dopasowań",
    noResultsBody: "Żaden wpis nie pasuje do „{{query}}”.",
    noResultsAction: "Wyczyść wyszukiwanie",
    showing: "Wyświetlane: {{count}} / {{total}}",
    favoriteAdd: "Dodaj do ulubionych",
    favoriteRemove: "Usuń z ulubionych",
    openDetails: "Otwórz szczegóły",
    reveal: "Pokaż w menedżerze plików",
    remove: "Usuń z biblioteki",
    removeTitle: "Usunąć „{{title}}” z biblioteki?",
    removeBody:
      "Wpis znika tylko z biblioteki. Pliki na dysku zostają dokładnie tam, gdzie są — nic nie jest kasowane ani przenoszone.",
    removedToast: "Usunięto z biblioteki",
    removedToastBody: "„{{title}}” nie jest już na liście. Pliki pozostały nietknięte.",
    removeFailed: "Nie udało się usunąć wpisu",
    favoriteFailed: "Nie udało się zmienić ulubionych",
    table: {
      title: "Tytuł",
      type: "Typ",
      playtime: "Czas gry",
      lastPlayed: "Ostatnio grane",
      status: "Stan",
      tags: "Tagi",
      actions: "Akcje",
    },
  },

  import: {
    title: "Źródła i import",
    description:
      "Źródła to foldery, które Zen Launcher przeszukuje w poszukiwaniu gier. Nic nie trafia do biblioteki, dopóki tego nie zatwierdzisz.",
    sourcesTitle: "Foldery źródłowe",
    sourcesEmptyTitle: "Brak folderu źródłowego",
    sourcesEmpty:
      "Dodaj folder, w którym trzymasz gry, a potem przeskanuj go w poszukiwaniu wpisów.",
    addFolder: "Dodaj folder",
    addFolderDialog: "Wybierz folder do przeskanowania",
    scan: "Skanuj",
    rescan: "Skanuj ponownie",
    scanning: "Skanowanie",
    removeSource: "Usuń folder źródłowy",
    removeSourceTitle: "Usunąć folder źródłowy „{{path}}”?",
    removeSourceBody:
      "Zapominamy tylko o folderze. Kandydaci i wpisy w bibliotece zostają, a pliki na dysku nie są ruszane.",
    lastScan: "Ostatnie skanowanie: {{value}}",
    neverScanned: "Nigdy nie skanowano",
    sourceAdded: "Dodano folder źródłowy",
    sourceAddFailed: "Nie udało się dodać folderu źródłowego",
    sourceRemoved: "Usunięto folder źródłowy",
    sourceRemoveFailed: "Nie udało się usunąć folderu źródłowego",
    scanFailed: "Skanowanie nie powiodło się",
    scanRunning: "Skanowanie {{path}}",
    scanProgressWaiting: "Szukam folderów z grami…",
    scanProgressCurrent: "Sprawdzam {{path}}",
    progressFound: "Znalezieni kandydaci: {{count}}",
    scanFinished: "Skanowanie zakończone",
    scanFinishedBody: "Nowi kandydaci: {{count}}",
    autoScanNote: "Automatyczne skanowanie źródeł pojawi się z obserwatorem w M2.",
    candidatesTitle: "Kandydaci",
    candidatesDescription:
      "Przejrzyj to, co znalazł skaner. Popraw tytuł lub plik wykonywalny, a potem zatwierdź albo odrzuć.",
    tabPending: "Oczekujący ({{count}})",
    tabApproved: "Zatwierdzeni ({{count}})",
    tabRejected: "Odrzuceni ({{count}})",
    noPending: "Brak kandydatów do przejrzenia",
    noPendingBody:
      "Przeskanuj źródło lub dodaj folder — wszystko nowe, co znajdzie skaner, pojawi się tutaj.",
    noApproved: "Nic jeszcze nie zatwierdzono",
    noApprovedBody:
      "Zatwierdzeni kandydaci stali się wpisami biblioteki — czekają w zakładce Biblioteka.",
    noRejected: "Nic jeszcze nie odrzucono",
    noRejectedBody:
      "Odrzuceni kandydaci nie trafiają do biblioteki, a kolejne skanowanie może ich znaleźć ponownie.",
    fieldTitle: "Tytuł",
    fieldExecutable: "Plik wykonywalny",
    fieldEngine: "Silnik",
    confidence: "Pewność",
    evidence: "Przesłanki",
    suggestedPath: "Folder",
    missingExecutableHint:
      "Skaner nie znalazł tu pliku wykonywalnego. Wskaż go przed zatwierdzeniem.",
    approve: "Zatwierdź",
    reject: "Odrzuć",
    approveAll: "Zatwierdź wszystkie ({{count}})",
    rejectAll: "Odrzuć wszystkie ({{count}})",
    approveAllTitle: "Zatwierdzić wszystkich oczekujących ({{count}})?",
    approveAllBody:
      "Każdy kandydat trafi do biblioteki pod proponowanym tytułem i plikiem wykonywalnym. Kandydaci bez pliku wykonywalnego zostaną pominięci.",
    rejectAllTitle: "Odrzucić wszystkich oczekujących ({{count}})?",
    rejectAllBody:
      "Znikną z listy przeglądu. Pliki na dysku pozostaną nietknięte, a foldery można przeskanować ponownie.",
    approvedToast: "Dodano do biblioteki",
    approvedToastBody: "„{{title}}” jest gotowa.",
    rejectedToast: "Kandydat odrzucony",
    rejectedToastBody: "„{{title}}” nie trafi do biblioteki.",
    approveFailed: "Nie udało się zatwierdzić kandydata",
    rejectFailed: "Nie udało się odrzucić kandydata",
    bulkApproved: "Zatwierdzeni kandydaci: {{count}}",
    bulkRejected: "Odrzuceni kandydaci: {{count}}",
    bulkPartial: "Pominięci (brak pliku wykonywalnego): {{count}}",
    bulkFailed: "Niepowodzenia: {{count}}",
  },

  details: {
    backToLibrary: "Wróć do biblioteki",
    notFoundTitle: "Ten wpis zniknął",
    notFoundBody: "Nie ma go już w bibliotece.",
    play: "Graj",
    playBlockedType: "Uruchamianie wpisów typu {{type}} nie jest jeszcze obsługiwane.",
    playBlockedMissing:
      "Brakuje pliku wykonywalnego. Popraw ścieżkę w opcjach uruchamiania.",
    launchOptions: "Opcje uruchamiania",
    launchOptionsDescription:
      "Trafiają wprost do procesu — argumenty jako tablica, nigdy jako ciąg powłoki.",
    executable: "Plik wykonywalny",
    executableHint: "Pełna ścieżka do programu, który startuje grę.",
    executableRequired: "Wpis musi mieć ścieżkę do pliku wykonywalnego.",
    workDir: "Katalog roboczy",
    workDirHint: "Opcjonalny. Domyślnie folder, w którym znaleziono grę.",
    workDirPlaceholder: "Zostaw puste, aby użyć folderu instalacji",
    args: "Argumenty",
    argsHint:
      "Wolny tekst. Cudzysłowy łączą wartość w całość, np. -screen-width 1920 -name \"Gracz\".",
    argsPreview: "Rozpoznane argumenty",
    argsPreviewEmpty: "Brak argumentów",
    env: "Zmienne środowiskowe",
    envHint: "Jedna linia KEY=wartość. Linie zaczynające się od # są ignorowane.",
    envPreview: "Rozpoznane zmienne",
    envPreviewEmpty: "Brak zmiennych",
    saveOptions: "Zapisz opcje",
    revertChanges: "Przywróć",
    unsaved: "Niezapisane zmiany",
    optionsSaved: "Zapisano opcje uruchamiania",
    optionsSaveFailed: "Nie udało się zapisać opcji uruchamiania",
    notes: "Notatki",
    notesField: "Treść",
    notesHint: "Zapisują się automatycznie w trakcie pisania.",
    notesPlaceholder: "Wszystko, co warto o tej grze pamiętać…",
    notesSaving: "Zapisywanie…",
    notesSaved: "Zapisano",
    notesSaveFailed: "Notatki nie zostały zapisane",
    sessions: "Historia sesji",
    sessionsEmpty: "Nie zapisano jeszcze żadnej sesji.",
    sessionsDescription: "Dziesięć ostatnich sesji.",
    sessionDuration: "Czas trwania",
    sessionStarted: "Początek",
    sessionExit: "Kod wyjścia",
    sessionInProgress: "W trakcie",
    sessionExitOk: "Zamknięte poprawnie",
    reveal: "Pokaż w menedżerze plików",
    remove: "Usuń z biblioteki",
    factsTitle: "Wpis",
    installPath: "Folder instalacji",
    entryId: "Identyfikator",
    createdAt: "Dodano",
    updatedAt: "Zaktualizowano",
    tagsTitle: "Tagi",
    tagsEmpty: "Brak tagów",
    tagsNote: "Tagi są w M1 tylko do odczytu — edycja przyjdzie z M3.",
    launched: "Sesja rozpoczęta",
    launchedBody: "„{{title}}” działa.",
    launchFailed: "Nie udało się uruchomić gry",
    sessionEnded: "Sesja zakończona",
    sessionEndedBody: "„{{title}}” działała {{duration}}.",
    revealFailed: "Nie udało się otworzyć menedżera plików",
  },

  settings: {
    title: "Ustawienia",
    description: "Zapisywane tylko na tym komputerze — bez konta i telemetrii.",
    languageTitle: "Język",
    languageDescription: "Zmienia się od razu w całym interfejsie.",
    languageEn: "English",
    languagePl: "Polski",
    behaviourTitle: "Zachowanie okna",
    behaviourDescription: "Jak okno reaguje, gdy gra działa.",
    closeToTray: "Działaj w zasobniku po zamknięciu okna",
    closeToTrayHint:
      "Zamknięcie okna ukrywa je w zasobniku. Aby całkiem zamknąć program, wybierz „Zakończ” w menu zasobnika.",
    hideOnLaunch: "Ukryj okno przy starcie gry",
    hideOnLaunchHint: "Launcher schodzi z drogi, a sesja działa dalej.",
    storageTitle: "Dane",
    storageDescription:
      "Tylko do odczytu w M1 — ścieżki są ustalone przez dokument projektowy.",
    configPath: "Plik konfiguracji",
    dataPath: "Folder danych",
    storageNote:
      "Foldery okładek, zapisów i modów pojawią się razem ze swoimi milestone'ami; dziś w folderze danych leżą library.db i logi.",
    aboutTitle: "O programie",
    version: "Wersja",
    license: "Licencja",
    mode: "Tryb IPC",
    modeTauri: "Rdzeń Tauri",
    modeMock: "Mock (w pamięci)",
    modeMockHint:
      "Brak podłączonego rdzenia Rust: wszystko działa na adapterze w pamięci i nic nie trafia na dysk.",
    onboardingTitle: "Kreator konfiguracji",
    onboardingDescription:
      "Język, czcionka interfejsu, akcent, domyślny widok biblioteki oraz zachowanie okna podczas gry. Każdy wybór zapisuje się od razu, więc nie ma czego zatwierdzać.",
    onboardingRun: "Uruchom kreatora ponownie",
    settingsSaved: "Ustawienia zapisane",
    settingsSaveFailed: "Nie udało się zapisać ustawień",
    licenseName: "MIT",
  },

  onboarding: {
    kicker: "Pierwsze uruchomienie",
    stepCounter: "Krok {{current}} z {{total}}",
    railLabel: "Kroki konfiguracji",
    stepLanguage: "Język",
    stepAppearance: "Wygląd",
    stepLibrary: "Biblioteka",
    stepWindow: "Okno",
    stepFinish: "Gotowe",

    languageTitle: "Wybierz język",
    languageBody:
      "Cały interfejs przełączy się od razu, razem z tym kreatorem. Nic nie jest przypisane na stałe — język zmienisz w każdej chwili w Ustawieniach.",

    appearanceTitle: "Nadaj charakter",
    appearanceBody:
      "Domyślnie interfejs pisze Maple Mono, a akcent podkreśla to, co ma przyciągać wzrok: przyciski, obwódki fokusu, liczniki. Jedno i drugie możesz zmienić.",

    fontTitle: "Czcionka interfejsu",
    fontBody:
      "Obowiązuje w tekstach całej aplikacji. Nagłówki i tak pisze Space Grotesk.",
    fontMapleMono: "Maple Mono",
    fontMapleMonoHint:
      "Domyślna. Spokojna czcionka o stałej szerokości, z ligaturami programistycznymi.",
    fontInstrumentSans: "Instrument Sans",
    fontInstrumentSansHint: "Proporcjonalna i łagodniejsza — bez ligatur.",
    fontSystem: "Systemowa",
    fontSystemHint: "Ta, której używa Twój pulpit.",

    accentTitle: "Akcent",
    accentJade: "Jadeit",
    accentPlum: "Śliwka",
    accentAzure: "Lazur",
    accentEmber: "Żar",
    accentRose: "Róż",
    accentNeutral: "Grafit",

    previewTitle: "Podgląd",
    previewDisplay: "Ink & Jade",
    fontSample: "Zażółć gęślą jaźń",
    previewSample:
      "Zażółć gęślą jaźń. The quick brown fox jumps over the lazy dog.",
    previewMeta: "~/.local/share/zen-launcher/library.db",
    previewButton: "Graj",

    libraryTitle: "Jak ma się otwierać biblioteka?",
    libraryBody:
      "Widok, w którym wylądujesz po uruchomieniu. W nagłówku przełączysz go w każdej chwili.",
    libraryGrid: "Siatka okładek",
    libraryGridHint: "Duże okładki, trzy lub cztery w rzędzie.",
    libraryList: "Lista",
    libraryListHint: "Gęściej: tytuł, typ, czas gry, ostatnio grane.",

    windowTitle: "Gdy gra działa",
    windowBody:
      "Co launcher robi z własnym oknem. Oba przełączniki zmienisz później w Ustawieniach.",

    finishTitle: "Wszystko gotowe",
    finishBody: "Oto, co wybrałeś w tym kreatorze.",
    summaryLanguage: "Język",
    summaryFont: "Czcionka",
    summaryAccent: "Akcent",
    summaryLibrary: "Widok biblioteki",
    summaryTray: "Zamknięcie do zasobnika",
    summaryHideOnLaunch: "Ukrywanie przy starcie gry",
    finishNote:
      "Zapisane tylko na tym komputerze. Kreatora uruchomisz ponownie w Ustawieniach, gdy zechcesz wrócić do tych wyborów.",

    back: "Wstecz",
    next: "Dalej",
    finish: "Zaczynajmy",
    skip: "Pomiń",
    skipHint: "Pomiń konfigurację i zostań przy ustawieniach domyślnych.",
    footHint: "Wybory zapisują się na bieżąco.",
  },

  errors: {
    title: "Coś poszło nie tak",
    NOT_FOUND: "Nie znaleziono",
    IO: "Błąd pliku",
    DB: "Błąd bazy danych",
    VALIDATION: "Odrzucone",
    LAUNCH_FAILED: "Uruchomienie nie powiodło się",
    UNSUPPORTED: "Jeszcze nieobsługiwane",
    UNKNOWN: "Nieoczekiwany błąd",
    initFailed: "Nie udało się wczytać biblioteki",
  },

  parse: {
    unterminatedQuote: "Niedomknięty cudzysłów {{token}} — dokończ wartość albo go usuń.",
    invalidEnvLine: "Linia {{line}} nie jest w formacie KEY=wartość: {{text}}",
  },

  toasts: {
    libraryChanged: "Biblioteka zaktualizowana",
  },

  covers: {
    change: "Pobierz okładkę",
    chooseFile: "Wybierz plik…",
    fileDialogTitle: "Wybierz obraz okładki",
    fileFilter: "Obrazy",
    fileNote:
      "Obraz zostanie skopiowany do folderu Zen Launcher — wybrany plik zostaje tam, gdzie jest.",
    fileFailed: "Nie udało się użyć tego obrazu",
    dialogTitle: "Okładka",
    searchLabel: "Szukaj w sklepie Steam",
    searchHint:
      "Tytuł gry jest już wpisany — popraw go, jeśli sklep zna ją pod inną nazwą.",
    searchPlaceholder: "Tytuł gry",
    search: "Szukaj",
    retry: "Spróbuj ponownie",
    provider: "Steam",
    matchCount: "Wyniki: {{count}}",
    searchFailed: "Nie udało się połączyć ze sklepem",
    emptyTitle: "Brak wyników w sklepie",
    emptyBody:
      "Sklep nie ma nic dla „{{query}}”. Krótszy tytuł działa lepiej — możesz też wybrać obraz z tego komputera.",
    downloadFailed: "Nie udało się zapisać okładki",
    updated: "Okładka zaktualizowana",
    updatedBody: "„{{title}}” używa teraz wybranej grafiki.",
  },

  mods: {
    title: "Mody",
    hint: "Jaki loader jest w grze, gdzie trzyma mody i co już się tam znajduje.",
    factLoader: "Loader",
    factEngine: "Silnik",
    factModsDir: "Folder modów",
    noModsDir: "Jeszcze go nie ma",
    suggested: "Dla tego silnika pasuje {{loader}}",
    installed: "Zainstalowane",
    installedEmpty: "Nic tu jeszcze nie ma.",
    installedMore: "+{{count}} więcej",
    refresh: "Odczytaj folder gry ponownie",
    statusFailed: "Nie udało się odczytać folderu gry",
    retry: "Spróbuj ponownie",

    installIntro: "Ta gra nie ma jeszcze loadera.",
    installWarn:
      "Zen Launcher pobierze {{loader}} i rozpakuje go do {{path}} — folder gry zostanie zapisany.",
    install: "Zainstaluj {{loader}}",
    installTitle: "Zainstalować {{loader}} w folderze gry?",
    installBody:
      "Najnowsze wydanie {{loader}} zostanie pobrane z GitHuba i rozpakowane do „{{path}}”. Pliki, które już tam są, zostaną zachowane, ale folder gry zostanie zapisany.",
    installConfirm: "Zainstaluj {{loader}}",
    installNote:
      "Nic poza folderem gry nie zostanie ruszone, a wpis w bibliotece się nie zmieni.",
    installedToast: "{{loader}} zainstalowany",
    installFailed: "Nie udało się zainstalować loadera",

    dropLabel: "Przeciągnij tutaj archiwa z modami",
    dropHint:
      ".zip, .7z i .rar — każde zostanie rozpakowane do folderu modów, a potem przeniesione do kosza.",
    dropActive: "Puść, żeby zainstalować",
    dropBusy: "Instaluję {{name}}",
    dropNeedsDir:
      "Bez folderu modów nie ma gdzie rozpakować — najpierw zainstaluj loader.",
    dropIgnored: "Nie ma czego instalować",
    dropIgnoredBody: "Pominięte: {{count}} — instaluję tylko archiwa .zip, .7z i .rar.",
    chooseArchive: "Wybierz archiwum…",
    archiveDialogTitle: "Wybierz archiwum z modem",
    archiveFilter: "Archiwa modów",
    pickFailed: "Nie udało się otworzyć okna wyboru pliku",
    archiveInstalled: "Zainstalowano {{name}}",
    archiveInstalledBody: "Dodane wpisy w {{dir}}: {{count}}",
    archiveFailed: "Nie udało się zainstalować {{name}}",
    dropSummary: "Zainstalowane: {{ok}}, błędy: {{failed}}, pominięte: {{skipped}}",
    trashKept: "Nie udało się przenieść archiwum do kosza — zostało tam, gdzie było.",

    loader: {
      bepinex: "BepInEx",
      melonloader: "MelonLoader",
      doorstop: "Doorstop",
      none: "Brak",
    },
    engine: {
      "unity-mono": "Unity · Mono",
      "unity-il2cpp": "Unity · IL2CPP",
      unknown: "Nieznany silnik",
    },
    suggestedLoader: {
      bepinex5: "BepInEx 5",
      melonloader: "MelonLoader",
    },
  },
};
