/**
 * Free-text ⇄ structured conversions for the launch-options editor.
 *
 * Parsers return machine-readable errors; the view maps them to localized text
 * so nothing user-facing leaks out of `src/lib`.
 */

export type ParseIssue =
  | { kind: "unterminatedQuote"; token: string }
  | { kind: "invalidEnvLine"; line: number; text: string };

export interface ParseResult<T> {
  value: T;
  issue: ParseIssue | null;
}

/**
 * Shell-like tokenizer: whitespace separates arguments, single quotes are
 * literal, double quotes allow `\"` and `\\` escapes.
 */
export function parseArgs(input: string): ParseResult<string[]> {
  const args: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;

  const flush = () => {
    if (started) args.push(current);
    current = "";
    started = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quote === "'") {
      if (character === "'") quote = null;
      else current += character;
      continue;
    }

    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === "\\" && index + 1 < input.length) {
        const next = input[index + 1];
        if (next === '"' || next === "\\") {
          current += next;
          index += 1;
        } else {
          current += character;
        }
      } else current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      flush();
    } else if (character === "\\" && index + 1 < input.length) {
      current += input[index + 1];
      started = true;
      index += 1;
    } else {
      current += character;
      started = true;
    }
  }

  if (quote !== null) {
    flush();
    return {
      value: args,
      issue: { kind: "unterminatedQuote", token: quote === '"' ? '"' : "'" },
    };
  }

  flush();
  return { value: args, issue: null };
}

/** Inverse of `parseArgs`; only quotes what needs quoting. */
export function stringifyArgs(args: readonly string[]): string {
  return args
    .map((argument) => {
      if (argument.length === 0) return '""';
      if (!/[\s"'\\]/.test(argument)) return argument;
      return `"${argument.replace(/(["\\])/g, "\\$1")}"`;
    })
    .join(" ");
}

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * `KEY=value` lines; blank lines and `#` comments are ignored, surrounding
 * double quotes are stripped, last duplicate wins.
 */
export function parseEnvLines(input: string): ParseResult<Record<string, string>> {
  const env: Record<string, string> = {};
  const lines = input.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const match = ENV_LINE.exec(raw);
    if (!match) {
      return {
        value: env,
        issue: { kind: "invalidEnvLine", line: index + 1, text: trimmed },
      };
    }

    let value = match[2];
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
    }
    env[match[1]] = value;
  }

  return { value: env, issue: null };
}

export function stringifyEnv(env: Readonly<Record<string, string>>): string {
  return Object.keys(env)
    .sort()
    .map((key) => {
      const value = env[key];
      if (value === "" ) return `${key}=`;
      if (!/[\s#"\\]/.test(value) && ENV_KEY.test(key)) return `${key}=${value}`;
      return `${key}="${value.replace(/(["\\])/g, "\\$1")}"`;
    })
    .join("\n");
}
