import { describe, expect, it } from "vitest";
import { en } from "./en";
import { pl } from "./pl";

/**
 * The two dictionaries are one contract with two spellings.
 *
 * `pl` is typed as `typeof en` with literals widened, so a *missing* key is
 * already a compile error; what types cannot see is an extra key, a renamed one,
 * or a translation whose `{{placeholder}}` no longer matches the call site. This
 * suite is the runtime half of that check.
 */

type Node = string | { [key: string]: Node };

/** Every leaf as a dotted path, e.g. `settings.modsLenient`. */
function leaves(value: Node, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "string" ? [`${prefix}${key}`] : leaves(child, `${prefix}${key}.`),
  );
}

function at(value: Node, path: string): string {
  let node: Node = value;
  for (const key of path.split(".")) {
    if (typeof node === "string") throw new Error(`No string at ${path}`);
    const child: Node | undefined = node[key];
    if (child === undefined) throw new Error(`No string at ${path}`);
    node = child;
  }
  if (typeof node !== "string") throw new Error(`No string at ${path}`);
  return node;
}

/** The `{{names}}` a string interpolates, sorted so order does not matter. */
function interpolationNames(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)]
    .map((match) => match[1])
    .sort();
}

/**
 * Words that mean "someone will finish this later".
 *
 * Checked against *values* only: `searchPlaceholder` is a key name and a
 * perfectly good one. Nothing a user can read may be one of these.
 */
const STUB_COPY =
  /placeholder|atrapa|lorem ipsum|dummy|to do|fixme|coming soon|\btbd\b|wkrótce|wkrotce|niebawem|zastępcz/i;

describe("translation dictionaries", () => {
  it("cover exactly the same keys", () => {
    expect(leaves(pl as Node).sort()).toEqual(leaves(en as Node).sort());
  });

  it("leave no string empty", () => {
    for (const [language, dictionary] of [
      ["en", en as Node],
      ["pl", pl as Node],
    ] as const) {
      for (const path of leaves(dictionary)) {
        expect(at(dictionary, path).trim(), `${language}: ${path}`).not.toBe("");
      }
    }
  });

  it("interpolate the same values in both languages", () => {
    for (const path of leaves(en as Node)) {
      expect(
        interpolationNames(at(pl as Node, path)),
        `pl: ${path}`,
      ).toEqual(interpolationNames(at(en as Node, path)));
    }
  });

  it("ship no placeholder copy", () => {
    for (const [language, dictionary] of [
      ["en", en as Node],
      ["pl", pl as Node],
    ] as const) {
      for (const path of leaves(dictionary)) {
        expect(at(dictionary, path), `${language}: ${path}`).not.toMatch(STUB_COPY);
      }
    }
  });
});
