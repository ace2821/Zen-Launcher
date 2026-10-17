import { describe, expect, it } from "vitest";
import {
  parseArgs,
  parseEnvLines,
  stringifyArgs,
  stringifyEnv,
} from "./args";

describe("parseArgs", () => {
  it("splits on whitespace and keeps every token", () => {
    expect(parseArgs("-screen-width 1920 -fullscreen")).toEqual({
      value: ["-screen-width", "1920", "-fullscreen"],
      issue: null,
    });
    expect(parseArgs("")).toEqual({ value: [], issue: null });
    expect(parseArgs("   ")).toEqual({ value: [], issue: null });
  });

  it("keeps quoted values together, in both quote styles", () => {
    expect(parseArgs(`-name "Player One"`).value).toEqual(["-name", "Player One"]);
    expect(parseArgs(`--title 'A B C'`).value).toEqual(["--title", "A B C"]);
    // Quotes in the middle of a token do not split it.
    expect(parseArgs(`--flag=a"b c"`).value).toEqual(["--flag=ab c"]);
  });

  it("supports escapes inside double quotes and outside them", () => {
    expect(parseArgs(`"a\\"b"`).value).toEqual(['a"b']);
    expect(parseArgs(`"c:\\\\path"`).value).toEqual(["c:\\path"]);
    expect(parseArgs(`a\\ b`).value).toEqual(["a b"]);
  });

  it("keeps an intentionally empty argument", () => {
    expect(parseArgs(`--name ""`).value).toEqual(["--name", ""]);
  });

  it("reports an unterminated quote instead of silently swallowing it", () => {
    const result = parseArgs(`-name "Player One`);
    expect(result.value).toEqual(["-name", "Player One"]);
    expect(result.issue).toEqual({ kind: "unterminatedQuote", token: '"' });
    expect(parseArgs(`-name 'Player`).issue).toEqual({
      kind: "unterminatedQuote",
      token: "'",
    });
  });
});

describe("stringifyArgs", () => {
  it("quotes only what needs quoting", () => {
    expect(stringifyArgs(["-fullscreen", "1920"])).toBe("-fullscreen 1920");
    expect(stringifyArgs(["Player One"])).toBe(`"Player One"`);
    expect(stringifyArgs([""])).toBe(`""`);
    expect(stringifyArgs([])).toBe("");
  });

  it("round-trips through parseArgs", () => {
    const input = `-screen-width 1920 -name "Player One" --path "c:\\\\games"`;
    const parsed = parseArgs(input);
    expect(stringifyArgs(parsed.value)).toBe(input);
    expect(parseArgs(stringifyArgs(parsed.value)).value).toEqual(parsed.value);
  });
});

describe("parseEnvLines", () => {
  it("reads KEY=value lines, ignoring blanks and comments", () => {
    expect(
      parseEnvLines(
        ["# a comment", "", "SDL_VIDEODRIVER=x11", "MANGOHUD=1"].join("\n"),
      ),
    ).toEqual({
      value: { SDL_VIDEODRIVER: "x11", MANGOHUD: "1" },
      issue: null,
    });
  });

  it("accepts export, spaces and quoted values", () => {
    const result = parseEnvLines(`export WINEPREFIX = "/home/x/.wine"`);
    expect(result).toEqual({ value: { WINEPREFIX: "/home/x/.wine" }, issue: null });
    expect(parseEnvLines(`A=`).value).toEqual({ A: "" });
  });

  it("lets the last duplicate win", () => {
    expect(parseEnvLines("A=1\nA=2").value).toEqual({ A: "2" });
  });

  it("reports the offending line number", () => {
    const result = parseEnvLines("GOOD=1\nnot an assignment\nBAD=3");
    expect(result.issue).toEqual({
      kind: "invalidEnvLine",
      line: 2,
      text: "not an assignment",
    });
    // What parsed so far is still returned, so nothing is silently dropped.
    expect(result.value).toEqual({ GOOD: "1" });
  });
});

describe("stringifyEnv", () => {
  it("sorts keys and quotes only when needed", () => {
    expect(stringifyEnv({ ZED: "1", ALPHA: "two" })).toBe("ALPHA=two\nZED=1");
    expect(stringifyEnv({ A: "x y" })).toBe(`A="x y"`);
    expect(stringifyEnv({ A: "" })).toBe("A=");
  });

  it("round-trips through parseEnvLines", () => {
    const env = { SDL_VIDEODRIVER: "x11", MANGOHUD: "1", GREETING: "hello there" };
    expect(parseEnvLines(stringifyEnv(env)).value).toEqual(env);
  });
});
