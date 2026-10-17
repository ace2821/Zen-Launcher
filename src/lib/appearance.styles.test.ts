// @vitest-environment node
/*
 * The stylesheets are read off disk, so this file runs in the Node environment:
 * under jsdom, `import.meta.url` is an `http://localhost/…` URL and `node:fs`
 * refuses it. Nothing here needs a DOM — the behaviour of `applyAppearance` is
 * covered in `appearance.test.ts`.
 *
 * Reading the text is also why these checks are not done with Vite's `?raw`
 * imports: Vitest stubs CSS contents (`test.css` defaults to false), so `?raw`
 * would hand back an empty string and the assertions below would quietly pass on
 * nothing.
 *
 * `@ts-expect-error` is this project's established way of reaching a Node builtin
 * without depending on `@types/node` — vite.config.ts does the same thing for the
 * same reason. A test file never enters the webview bundle, and app code still
 * cannot import `node:fs` without a type error.
 */
// @ts-expect-error type error without @types/node package
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENT_IDS, DEFAULT_ACCENT, FONT_IDS } from "./appearance";

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

/**
 * CSS with its comments removed. The files explain themselves in prose, and prose
 * that names a selector (jade pointing at the `[data-accent="jade"]` block it
 * deliberately does not have) is documentation, not a rule — the assertions below
 * are about rules.
 */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const TOKENS_CSS = stripComments(read("../styles/tokens.css"));
const FONTS_CSS = stripComments(read("../styles/fonts.css"));
const FONT_DIR = new URL("../assets/fonts/", import.meta.url);

/** The woff2 files that actually ship, by name. */
const vendoredFonts = (): string[] =>
  (readdirSync(FONT_DIR, { encoding: "utf8" }) as string[]).filter((name: string) =>
    name.endsWith(".woff2"),
  );

/**
 * Every stylesheet that *consumes* the theme — all of them except `fonts.css`, which
 * is where the faces are declared, so its `font-weight` lines describe the faces
 * rather than what the UI asks for.
 */
const appCss = (): { file: string; css: string }[] =>
  (
    readdirSync(new URL("../", import.meta.url), {
      recursive: true,
      encoding: "utf8",
    }) as string[]
  )
    .filter((file: string) => file.endsWith(".css") && !file.endsWith("fonts.css"))
    .map((file: string) => ({ file, css: read(`../${file}`) }));

/**
 * The whole appearance system is driven by string ids that TypeScript cannot check
 * across the boundary between `appearance.ts` and the stylesheets. These tests are
 * that check.
 */
describe("appearance ids ↔ stylesheets", () => {
  it("has a preset block for every accent id but the default", () => {
    for (const id of ACCENT_IDS) {
      if (id === DEFAULT_ACCENT) {
        // Jade is the `:root` fallback, so it must *not* have a block of its own.
        expect(TOKENS_CSS).not.toContain(`[data-accent="${id}"]`);
        expect(TOKENS_CSS).toContain("--accent: var(--jade-400)");
      } else {
        expect(TOKENS_CSS).toContain(`[data-accent="${id}"]`);
      }
    }
  });

  it("has a font block for every font id", () => {
    for (const id of FONT_IDS) {
      expect(TOKENS_CSS).toContain(`[data-font="${id}"]`);
    }
  });

  it("ships a Maple Mono face for every weight the UI asks for", () => {
    const used = new Set<string>();
    for (const { css } of appCss()) {
      for (const match of css.matchAll(/font-weight:\s*(\d{3})/g)) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);

    const faces = new Set(
      [...FONTS_CSS.matchAll(/font-family: "Maple Mono";[\s\S]*?font-weight: (\d{3});/g)].map(
        (match) => match[1],
      ),
    );
    // `font-synthesis-weight: none` is on `body`: a weight without a face would
    // render at the wrong weight instead of a faked one.
    for (const weight of used) {
      expect(faces, `no Maple Mono face for font-weight ${weight}`).toContain(weight);
    }

    expect(vendoredFonts().filter((name) => name.startsWith("maple-mono-")).sort()).toEqual([
      "maple-mono-latin-400.woff2",
      "maple-mono-latin-500.woff2",
      "maple-mono-latin-600.woff2",
      "maple-mono-latin-700.woff2",
    ]);
  });

  it("ships exactly the Space Grotesk weight the display type asks for", () => {
    // The display face is not user-selectable, so unlike Maple Mono it does not have
    // to cover every weight the app declares anywhere — only the weight the
    // `--font-display` sites themselves use. Vendoring the whole scale would ship
    // four files to use one of them.
    const displayWeights = new Set<string>();
    for (const { file, css } of appCss()) {
      for (const match of css.matchAll(/[^{}]+\{[^{}]*var\(--font-display\)[^{}]*\}/g)) {
        const weight = /font-weight:\s*(\d{3})/.exec(match[0]);
        expect(weight, `${file}: a display rule declares no font-weight`).not.toBeNull();
        // Tracking is inherited from `body`, where it is set for the *UI* face, so a
        // display rule that does not set its own would shift with the user's font
        // choice instead of staying put.
        expect(match[0], `${file}: a display rule declares no letter-spacing`).toMatch(
          /letter-spacing:/,
        );
        if (weight !== null) displayWeights.add(weight[1]);
      }
    }
    expect([...displayWeights]).toEqual(["500"]);

    const faces = [
      ...FONTS_CSS.matchAll(
        /font-family: "Space Grotesk";[\s\S]*?src: url\("([^"]+)"\)[^;]*;[\s\S]*?unicode-range:/g,
      ),
    ].map((match) => ({
      weight: /font-weight: (\d{3});/.exec(match[0])?.[1],
      file: match[1],
    }));
    expect(faces.map((face) => face.weight)).toEqual(["500", "500"]);
    expect(faces.map((face) => face.file).sort()).toEqual([
      "../assets/fonts/space-grotesk-latin-500.woff2",
      "../assets/fonts/space-grotesk-latin-ext-500.woff2",
    ]);

    // These subsets are genuinely disjoint (unlike Maple Mono's single file): Polish
    // diacritics live only in `latin-ext`, so both faces have to reach the browser or
    // headings lose ą/ć/ę/ł/ń/ś/ź/ż in Polish.
    expect(vendoredFonts().filter((name) => name.startsWith("space-grotesk-")).sort()).toEqual([
      "space-grotesk-latin-500.woff2",
      "space-grotesk-latin-ext-500.woff2",
    ]);
  });

  it("references only font files that exist, and ships none that it does not use", () => {
    // A renamed or deleted asset would silently fall back to a system face — the one
    // failure this suite can catch without a browser.
    const referenced = [...FONTS_CSS.matchAll(/url\("\.\.\/assets\/fonts\/([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(referenced.length).toBeGreaterThan(0);

    const vendored = vendoredFonts();
    for (const file of referenced) {
      expect(vendored, `styles/fonts.css points at a missing ${file}`).toContain(file);
    }
    for (const file of vendored) {
      expect(referenced, `${file} is vendored but never used`).toContain(file);
    }
  });
});
