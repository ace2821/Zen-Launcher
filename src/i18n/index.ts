import i18next, { type TOptions } from "i18next";
import { initReactI18next } from "react-i18next";
import type { Language } from "../lib/types";
import { en } from "./en";
import { pl } from "./pl";

export const LANGUAGES: readonly Language[] = ["en", "pl"];
export const DEFAULT_LANGUAGE: Language = "en";

const resources = {
  en: { translation: en },
  pl: { translation: pl },
};

/**
 * Initializes i18next exactly once. `initAsync: false` keeps the first render
 * synchronous, which matters for tests and for the pre-paint bootstrap in
 * `main.tsx`. The language is only a first guess — the persisted setting
 * replaces it as soon as the core answers.
 */
export function initI18n(language: Language = detectLanguage()): void {
  if (i18next.isInitialized) return;
  void i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...LANGUAGES],
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  });
  i18next.on("languageChanged", (next) => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = next;
    }
  });
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
}

/** Best-effort guess from the browser before the stored setting arrives. */
export function detectLanguage(): Language {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  const candidates = [
    ...(navigator.languages ?? []),
    navigator.language ?? "",
  ];
  for (const candidate of candidates) {
    const base = candidate.split("-")[0]?.toLowerCase() ?? "";
    if (isSupportedLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

export function isSupportedLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

export function setLanguage(language: Language): Promise<unknown> {
  return i18next.changeLanguage(language);
}

/** Translation outside React (store actions, non-component code). */
export function translate(key: string, options?: TOptions): string {
  return i18next.t(key, options);
}

export function currentLanguage(): Language {
  const language = i18next.language?.split("-")[0] ?? DEFAULT_LANGUAGE;
  return isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
}

export default i18next;
