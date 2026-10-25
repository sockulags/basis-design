import path from "node:path";

/** Node's path functions for one system: `path.win32`, `path.posix` or this one's. */
type PlatformPath = typeof path;

/*
 * Which shell commands only read, and what they read. Codex asks before every command it runs on Windows (Basis'
 * Codex home has no sandbox there, server/codex.ts), reads included; Basis approves a command without asking only
 * when it can tell from the command line alone that nothing in it writes, runs other programs or reads outside the
 * places the agent may read. This is deliberately strict: a command it does not fully understand is not approved,
 * and the user is asked as before. So only plain words, quotes and a few operators are understood, only listed
 * programs with listed options, and every argument that may name a file is returned to be checked.
 */

/** A command Basis may run unasked once every path it reads is allowed. */
export interface ReadOnlyCommand {
  /** Absolute paths the command reads or lists, its working folder first. */
  reads: string[];
  /** Absolute paths of programs it starts by path (the shell Codex wraps it in); they must not be the agent's own files. */
  programs: string[];
}

/**
 * What `command`, run in `cwd`, reads, or null when it may do anything else. `command` is the command line of a
 * Codex approval request: an argument list joined with POSIX quoting, usually a shell with a script
 * (`"…\pwsh.exe" -Command 'Get-Content a.ts'`, `bash -lc '…'`), sometimes with the shell's name taken off by the
 * ACP adapter. `paths` resolves paths; tests pass `path.win32` or `path.posix`.
 */
export function readOnlyCommand(command: string, cwd: string, paths: PlatformPath = path): ReadOnlyCommand | null {
  if (!paths.isAbsolute(cwd)) return null;
  const outer = posixTokens(command);
  const words = outer?.every(isArg) ? outer.map((arg) => arg.values[0]!) : null;
  const shell = words ? shellOf(words) : null;
  let commands: Arg[][] | null;
  let programs: string[] = [];
  if (shell) {
    const tokens = shell.kind === "pwsh" ? psTokens(shell.script) : posixTokens(shell.script);
    commands = tokens && split(tokens);
    if (shell.program !== null) {
      if (!paths.isAbsolute(shell.program)) return null;
      programs = [shell.program];
    }
    if (commands) return collect(commands, shell.kind, shell.legacy, cwd, paths, programs);
    return null;
  }
  // No shell in front: a plain argument list, or a POSIX script whose `bash -lc` the adapter removed together with
  // the quotes around it. The single quotes inside such a script were written as '"'"' and cannot be read back.
  if (command.includes(`'"'"'`)) return null;
  commands = outer && split(outer);
  return commands ? collect(commands, "posix", false, cwd, paths, programs) : null;
}

/**
 * Whether Basis may approve a Codex approval request for a command without asking: its raw input is the command
 * and its working folder and nothing else (no network access or extra sandbox permissions), the command only reads,
 * and everything it reads is `readable`, while the shell it starts by path is not (so it is none of the agent's own
 * files). `cwd` is the folder Codex runs in when the request names none.
 */
export function isApprovableRead(
  rawInput: unknown,
  cwd: string,
  readable: (target: string) => boolean,
  paths: PlatformPath = path,
): boolean {
  if (!rawInput || typeof rawInput !== "object") return false;
  const { command, cwd: folder = cwd, ...rest } = rawInput as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof command !== "string" || typeof folder !== "string") return false;
  const found = readOnlyCommand(command, folder, paths);
  return found !== null && found.reads.every(readable) && !found.programs.some(readable);
}

/**
 * Whether Basis may approve a shell command Claude Code asks about without asking the user. Claude Code runs its own
 * read-only commands in its working directories unasked, but asks for some that only read, above all a `cd` into a
 * folder followed by git (its guard against a repo's git config running programs). Its raw input is the Bash tool's:
 * the command and a description or timeout, nothing else (not in the background). Its shell keeps the folder it was
 * left in between commands, which the request does not say, so the command must begin with `cd` to an absolute
 * folder that exists, followed by `&&`; the rest runs there and must only read what is `readable`. Git Bash on
 * Windows takes `C:/…` and `/c/…` as such a folder. A wildcard is allowed where it can only expand to names in a
 * readable folder, for programs that only read whatever it expands to (globFolder). Simple loops and variables are written out first (expandVariables). A
 * later `cd` to an existing absolute folder moves the rest there; when `&&` or `||` may skip it, what follows
 * could run in either folder, so its paths must be readable from both.
 */
export function isApprovableClaudeRead(
  rawInput: unknown,
  readable: (target: string) => boolean,
  isFolder: (target: string) => boolean,
  paths: PlatformPath = path,
): boolean {
  if (!rawInput || typeof rawInput !== "object") return false;
  const { command, description, timeout, ...rest } = rawInput as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof command !== "string") return false;
  if (description !== undefined && typeof description !== "string") return false;
  if (timeout !== undefined && typeof timeout !== "number") return false;
  const read = posixTokens(command, true);
  const tokens = read && expandVariables(read);
  const [cd, folder, and] = tokens ?? [];
  if (!cd || !isArg(cd) || cd.quoted || cd.values[0] !== "cd") return false;
  if (!folder || !isArg(folder) || folder.glob || !and || isArg(and) || and.op !== "&&") return false;
  const folderOf = (arg: Arg | undefined) => {
    const target = arg && !arg.glob ? gitBashPath(arg.values[0]!, paths) : "";
    return paths.isAbsolute(target) && plainPath(target, paths) && isFolder(target) ? paths.resolve(target) : null;
  };
  const first = folderOf(folder);
  const commands = first ? chain(tokens!.slice(3)) : null;
  if (!first || !commands) return false;
  // The folders the shell may be in at each command, and every path read from any of them.
  let cwds = [first];
  const reads = [first];
  for (const [index, { op, args }] of commands.entries()) {
    if (args[0]!.values[0] === "cd" && !args[0]!.quoted) {
      const target = args.length === 2 ? folderOf(args[1]) : null;
      if (!target) return false;
      reads.push(target);
      // In a pipeline it runs in a subshell and moves nothing; after && or || it may not run at all.
      if (op === "|" || commands[index + 1]?.op === "|") continue;
      cwds = op === ";" ? [target] : [...new Set([...cwds, target])];
      continue;
    }
    // A wildcard expands to names in one folder, so the command is checked as if it named that folder, which must
    // be readable too (also where grep takes the word for its pattern).
    if (args.some((arg) => arg.glob) && (args[0]!.glob || !GLOB_PROGRAMS.has(args[0]!.values[0]!))) return false;
    const globbed = args.filter((arg) => arg.glob).map((arg) => globFolder(arg.values[0]!));
    if (globbed.some((folder) => folder === null)) return false;
    const found = posixCommand(
      args.map((arg) => (arg.glob ? { ...arg, values: [globFolder(arg.values[0]!)!], glob: false } : arg)),
    );
    if (!found) return false;
    for (const target of [...found, ...(globbed as string[])].map((item) => gitBashPath(item, paths))) {
      if (!plainPath(target, paths)) return false;
      reads.push(...cwds.map((cwd) => paths.resolve(cwd, target)));
    }
    reads.push(...cwds);
  }
  return reads.every(readable);
}

/** Programs whose arguments may hold a wildcard: whatever names it expands to, they only read them. */
const GLOB_PROGRAMS = new Set(["ls", "cat", "head", "tail", "wc", "grep"]);

/**
 * The folder whose names a wildcard word expands to, or null when it could expand to anything else. It must begin
 * with a plain character that is no `-`, so no name it expands to is taken as an option, and no part from the first
 * wildcard on may begin with a dot, since `.*` matches `..` in some shells and a later `..` climbs back out.
 */
function globFolder(word: string): string | null {
  if (/^[-*?[\]]/.test(word) || word.includes("\\")) return null;
  const parts = word.split("/");
  const first = parts.findIndex((part) => /[*?[\]]/.test(part));
  if (parts.slice(first).some((part) => part.startsWith("."))) return null;
  if (first === 0) return ".";
  return parts.slice(0, first).join("/") || "/";
}

/** Git Bash on Windows writes a drive as `/c/…`, which is `C:/…` there. */
function gitBashPath(target: string, paths: PlatformPath): string {
  const drive = paths.sep === "\\" ? /^\/([A-Za-z])(?=\/|$)/.exec(target) : null;
  return drive ? `${drive[1]!.toUpperCase()}:${target.slice(2) || "/"}` : target;
}

/** The commands of a POSIX script with the separator before each (`;` for the first), or null for an empty one. */
function chain(tokens: Token[]): { op: Op; args: Arg[] }[] | null {
  const commands: { op: Op; args: Arg[] }[] = [{ op: ";", args: [] }];
  for (const token of tokens) {
    if (isArg(token)) commands.at(-1)!.args.push(token);
    else commands.push({ op: token.op, args: [] });
  }
  return commands.every((command) => command.args.length > 0) ? commands : null;
}

/** One argument: its values (more than one for a PowerShell array, `a, b`), and how it was written. */
interface Arg {
  values: string[];
  /** It began with a quote, so PowerShell never takes it as a parameter name. */
  quoted: boolean;
  /** Some part of it was quoted (PowerShell only). */
  quotes?: boolean;
  /** It holds an unquoted wildcard, which a shell or a cmdlet may expand into other names. */
  glob: boolean;
  /** Nothing in it was quoted, escaped or expanded, so the shell may take it as a keyword (POSIX, with variables). */
  literal?: boolean;
  /** The variable it sets, when it begins with an unquoted `NAME=` (POSIX, with variables). */
  assigns?: string;
}

/** Statement and pipeline separators; every command on either side is checked the same way. */
type Token = Arg | { op: Op };
/** `&&` and `||` are told apart from `;` in POSIX scripts, where they decide whether a `cd` runs. */
type Op = ";" | "|" | "&&" | "||";

const isArg = (token: Token): token is Arg => "values" in token;

type Dialect = "pwsh" | "posix";

interface Shell {
  kind: Dialect;
  /** The shell's own path when it was given as one, null for a bare name. */
  program: string | null;
  script: string;
  /** Windows PowerShell 5.1, which passes arguments to programs in its old way and follows links when recursing. */
  legacy: boolean;
}

const PWSH = new Set(["pwsh", "pwsh.exe", "powershell", "powershell.exe"]);
const POSIX_SHELLS = new Set(["bash", "sh", "zsh"]);
const PWSH_FLAGS = new Set(["-noprofile", "-nologo", "-noninteractive"]);

/** The shell and script of `shell [flags] -Command script` or `bash -lc script`, or null for anything else. */
function shellOf(words: string[]): Shell | null {
  if (words.length < 3) return null;
  const first = words[0]!;
  const name = first.split(/[\\/]/).pop()!.toLowerCase();
  const program = /[\\/]/.test(first) ? first : null;
  const flags = words.slice(1, -2).map((word) => word.toLowerCase());
  const run = words.at(-2)!.toLowerCase();
  const script = words.at(-1)!;
  if (PWSH.has(name)) {
    if (!flags.every((flag) => PWSH_FLAGS.has(flag)) || (run !== "-command" && run !== "-c")) return null;
    return { kind: "pwsh", program, script, legacy: name.startsWith("powershell") };
  }
  if (POSIX_SHELLS.has(name)) {
    if (flags.some((flag) => flag !== "-l") || !/^-l?c$|^-cl$/.test(run)) return null;
    return { kind: "posix", program, script, legacy: false };
  }
  return null;
}

/** Splits tokens into commands at `;`, `|`, `&&` and `||`, or null when a command is empty. */
function split(tokens: Token[]): Arg[][] | null {
  const commands: Arg[][] = [[]];
  for (const token of tokens) {
    if (isArg(token)) commands.at(-1)!.push(token);
    else commands.push([]);
  }
  return commands.every((command) => command.length > 0) ? commands : null;
}

/** Only printable ASCII: PowerShell takes typographic quotes and dashes for quotes and dashes. */
const PLAIN = /^[\x20-\x7e]*$/;

/** What may follow a `$` for the shell to expand it; before anything else (`"a$"`, `"$|"`) it is a plain `$`. */
const EXPANDS = /^[A-Za-z0-9_{([@*#?$!-]/;

/** Where a variable stood in a word, until expandVariables puts in its value; input never holds these characters. */
const [MARK_START, MARK_END] = [String.fromCharCode(1), String.fromCharCode(2)];
const variableMark = (name: string) => `${MARK_START}${name}${MARK_END}`;
const VARIABLE_MARK = new RegExp(`${MARK_START}([A-Za-z_]\\w*)${MARK_END}`, "g");

/** The name of the variable `$NAME` or `${NAME}` at `at`, and where it ends, or null for any other expansion. */
function variableAt(text: string, at: number): { name: string; last: number } | null {
  const braced = text[at + 1] === "{";
  const match = (braced ? /^\{([A-Za-z_]\w*)\}/ : /^([A-Za-z_]\w*)/).exec(text.slice(at + 1));
  return match ? { name: match[1]!, last: at + match[0].length } : null;
}

/**
 * POSIX shell words: single quotes, double quotes without expansions, backslash escapes, `;`, `|`, `&&`, `||` and
 * the redirections that only drop or merge errors (`2>/dev/null`, `2>&1`). Null for anything that expands, runs a
 * subshell, redirects into a file or starts a comment. With `variables`, `$NAME` and `${NAME}` are kept as marks
 * for expandVariables, and words say whether they are literal and what they assign.
 */
export function posixTokens(text: string, variables = false): Token[] | null {
  if (!PLAIN.test(text.replace(/\t/g, " "))) return null;
  const tokens: Token[] = [];
  let word = null as string | null;
  let quoted = false;
  let glob = false;
  let literal = true;
  /** The word as far as it is literal, to find `NAME=` at its start. */
  let prefix = "";
  const end = () => {
    if (word !== null) {
      const arg: Arg = { values: [word], quoted, glob };
      if (variables) {
        arg.literal = literal;
        const assigns = /^([A-Za-z_]\w*)=/.exec(prefix)?.[1];
        if (assigns) arg.assigns = assigns;
      }
      tokens.push(arg);
    }
    word = null;
    quoted = false;
    glob = false;
    literal = true;
    prefix = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === " " || char === "\t") {
      end();
    } else if (char === "'") {
      const close = text.indexOf("'", i + 1);
      if (close === -1) return null;
      if (word === null) quoted = true;
      literal = false;
      word = (word ?? "") + text.slice(i + 1, close);
      i = close;
    } else if (char === '"') {
      let value = "";
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j += 1) {
        const inner = text[j]!;
        if (inner === "$" && variables && EXPANDS.test(text[j + 1] ?? "")) {
          const found = variableAt(text, j);
          if (!found) return null;
          value += variableMark(found.name);
          j = found.last;
          continue;
        }
        if (inner === "`" || (inner === "$" && EXPANDS.test(text[j + 1] ?? ""))) return null;
        if (inner === "\\" && j + 1 < text.length && '"\\$`'.includes(text[j + 1]!)) {
          j += 1;
          value += text[j];
        } else value += inner;
      }
      if (j >= text.length) return null;
      if (word === null) quoted = true;
      literal = false;
      word = (word ?? "") + value;
      i = j;
    } else if (char === "\\") {
      if (i + 1 >= text.length) return null;
      i += 1;
      if (word === null) quoted = true;
      literal = false;
      word = (word ?? "") + text[i];
    } else if (char === "$" && variables) {
      const found = variableAt(text, i);
      if (!found) return null;
      literal = false;
      word = (word ?? "") + variableMark(found.name);
      i = found.last;
    } else if (char === ";") {
      end();
      tokens.push({ op: ";" });
    } else if (char === "|" || char === "&") {
      const double = text[i + 1] === char;
      if (char === "&" && !double) return null;
      end();
      tokens.push({ op: double ? (char === "&" ? "&&" : "||") : "|" });
      if (double) i += 1;
    } else if (char === ">" || char === "<") {
      const drop = word === "2" && !quoted ? /^>(?:&1|\s*\/dev\/null)(?=$|[\s;|&])/.exec(text.slice(i)) : null;
      if (!drop) return null;
      word = null;
      prefix = "";
      i += drop[0].length - 1;
    } else if ("$`(){}".includes(char)) {
      return null;
    } else if ((char === "#" || char === "~") && word === null) {
      return null;
    } else {
      if ("*?[]".includes(char)) glob = true;
      if (literal) prefix += char;
      word = (word ?? "") + char;
    }
  }
  end();
  return tokens;
}

/** A value Basis lets a variable hold: a plain word, which the shell neither splits nor expands where it is used. */
const PLAIN_VALUE = /^[A-Za-z0-9._/\\:@+,=%-]+$/;
/** Words that begin or continue a compound command where a command begins; only `for … in … do … done` is known. */
const RESERVED = new Set([
  "for",
  "in",
  "do",
  "done",
  "while",
  "until",
  "if",
  "then",
  "elif",
  "else",
  "fi",
  "case",
  "esac",
  "select",
  "function",
  "time",
  "!",
]);

/**
 * Tokens from `posixTokens(text, true)` with their variables written out, or null for a variable or loop it cannot
 * follow exactly. A statement `NAME=value` sets a variable for the words after it; `for NAME in words; do body;
 * done` becomes the body once per word, with NAME set to that word. Values must be plain words (PLAIN_VALUE), so a
 * variable stands for exactly its value, quoted or not. Variables not set in the command (the environment's),
 * nested loops and other compound commands are refused. What comes out is checked like any other command.
 */
function expandVariables(tokens: Token[]): Token[] | null {
  const variables = new Map<string, string>();
  const out: Token[] = [];
  const expand = (arg: Arg): Arg | null => {
    let unset = false;
    const values = arg.values.map((value) =>
      value.replace(VARIABLE_MARK, (_, name: string) => {
        const found = variables.get(name);
        if (found === undefined) unset = true;
        return found ?? "";
      }),
    );
    return unset ? null : { values, quoted: arg.quoted, glob: arg.glob };
  };
  const keyword = (token: Token | undefined, name: string) =>
    token !== undefined && isArg(token) && token.literal === true && token.values[0] === name;
  const semicolon = (token: Token | undefined) => token !== undefined && !isArg(token) && token.op === ";";
  let i = 0;
  let start = true;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (!isArg(token)) {
      out.push(token);
      start = true;
      i += 1;
      continue;
    }
    if (start && keyword(token, "for")) {
      const name = tokens[i + 1];
      if (!name || !isArg(name) || !name.literal || !/^[A-Za-z_]\w*$/.test(name.values[0]!)) return null;
      if (!keyword(tokens[i + 2], "in")) return null;
      const items: string[] = [];
      let j = i + 3;
      for (; j < tokens.length && isArg(tokens[j]!); j += 1) {
        const item = expand(tokens[j] as Arg);
        if (!item || item.glob || !PLAIN_VALUE.test(item.values[0]!)) return null;
        items.push(item.values[0]!);
      }
      if (items.length === 0 || !semicolon(tokens[j]) || !keyword(tokens[j + 1], "do")) return null;
      const first = j + 2;
      let done = first;
      for (; done < tokens.length; done += 1) {
        const word = tokens[done]!;
        const begins = done === first || !isArg(tokens[done - 1]!);
        if (begins && isArg(word) && word.literal && RESERVED.has(word.values[0]!)) {
          if (word.values[0] === "done") break;
          return null;
        }
      }
      if (done >= tokens.length || done === first || !semicolon(tokens[done - 1])) return null;
      const body = tokens.slice(first, done - 1);
      for (const [index, item] of items.entries()) {
        variables.set(name.values[0]!, item);
        if (index > 0) out.push({ op: ";" });
        for (const part of body) {
          const expanded = isArg(part) ? expand(part) : part;
          if (!expanded) return null;
          out.push(expanded);
        }
      }
      variables.delete(name.values[0]!);
      i = done + 1;
      if (i < tokens.length && isArg(tokens[i]!)) return null;
      start = false;
      continue;
    }
    if (start && token.assigns !== undefined) {
      // Only an assignment of its own, not one in front of a command, which sets that command's environment.
      const next = tokens[i + 1];
      if (next !== undefined && (isArg(next) || next.op === "|")) return null;
      const value = expand(token)?.values[0]!.slice(token.assigns.length + 1);
      if (value === undefined || !PLAIN_VALUE.test(value)) return null;
      variables.set(token.assigns, value);
      // The separator after it goes with it.
      i += 2;
      continue;
    }
    if (start && token.literal && RESERVED.has(token.values[0]!)) return null;
    const expanded = expand(token);
    if (!expanded) return null;
    out.push(expanded);
    start = false;
    i += 1;
  }
  return out;
}

/**
 * PowerShell in argument mode: single quotes (`''` for a quote), double quotes without expansions (`""` for a
 * quote), arrays (`a, b`), `;`, `|`, `&&`, `||`, and dropping errors (`2>$null`, `2>&1`). Null for variables,
 * subexpressions, script blocks, splatting, type literals, escapes, comments, the call operator and redirections
 * into files.
 */
export function psTokens(text: string): Token[] | null {
  if (!PLAIN.test(text.replace(/\t/g, " "))) return null;
  const tokens: Token[] = [];
  let current = null as Arg | null;
  let value = null as string | null;
  /** After a comma, the next value belongs to the same argument. */
  let more = false;
  const endValue = () => {
    if (value === null) return;
    if (current) current.values.push(value);
    value = null;
  };
  const end = () => {
    endValue();
    if (current && !more) {
      tokens.push(current);
      current = null;
    }
  };
  const start = (isQuoted: boolean) => {
    if (value !== null) return;
    if (!current) current = { values: [], quoted: isQuoted, glob: false };
    more = false;
    value = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === " " || char === "\t") {
      end();
    } else if (char === "'" || char === '"') {
      start(true);
      current!.quotes = true;
      let literal = "";
      let j = i + 1;
      for (; j < text.length; j += 1) {
        if (text[j] === char) {
          if (text[j + 1] !== char) break;
          j += 1;
        } else if (char === '"' && (text[j] === "$" || text[j] === "`")) return null;
        literal += text[j];
      }
      if (j >= text.length) return null;
      value = (value ?? "") + literal;
      i = j;
    } else if (char === ",") {
      if (value === null || more) return null;
      endValue();
      more = true;
    } else if (char === ";" || char === "|" || char === "&") {
      const double = text[i + 1] === char;
      if (char === "&" && !double) return null;
      if (more) return null;
      end();
      tokens.push({ op: double || char === ";" ? ";" : "|" });
      if (double) i += 1;
    } else if (char === ">") {
      const drop = value === "2" && current?.values.length === 0 && !current.quoted && !more;
      const match = drop ? /^>(?:&1|\s*\$null)(?=$|[\s;|&])/.exec(text.slice(i)) : null;
      if (!match) return null;
      current = null;
      value = null;
      i += match[0].length - 1;
    } else if ("$`@(){}[]<#".includes(char)) {
      return null;
    } else {
      start(false);
      if (char === "*" || char === "?") current!.glob = true;
      value += char;
    }
  }
  if (more) return null;
  end();
  // The stop-parsing token hands the rest of the line to the program as it is, expanding %variables%.
  if (tokens.some((token) => isArg(token) && token.values.includes("--%"))) return null;
  return tokens;
}

/** The working folder and every path the commands read, resolved, or null when one of them is not a read. */
function collect(
  commands: Arg[][],
  dialect: Dialect,
  legacy: boolean,
  cwd: string,
  paths: PlatformPath,
  programs: string[],
): ReadOnlyCommand | null {
  const reads = [paths.resolve(cwd)];
  for (const command of commands) {
    const found = dialect === "pwsh" ? psCommand(command, legacy) : posixCommand(command);
    if (!found) return null;
    for (const target of found) {
      if (!plainPath(target, paths)) return null;
      reads.push(paths.resolve(cwd, target));
    }
  }
  return { reads, programs };
}

/**
 * A path Basis can check by resolving it: no wildcards, no home folder (`~`), no UNC or device path, no drive-relative
 * path, and no colon but a drive's, which also rules out alternate data streams and PowerShell's other drives
 * (`env:`, `HKLM:`, `FileSystem::`).
 */
function plainPath(target: string, paths: PlatformPath): boolean {
  if (target === "" || /[*?[\]"]/.test(target) || target.startsWith("~")) return false;
  if (/^[\\/]{2}/.test(target)) return false;
  const drive = paths.sep === "\\" && /^[A-Za-z]:[\\/]/.test(target);
  const rest = drive ? target.slice(2) : target;
  if (rest.includes(":")) return false;
  // Windows drops dots and spaces at the end of a name, so `.. ` and `...` would be read as `..` there.
  return rest.split(/[\\/]/).every((part) => part === "." || part === ".." || !/[. ]$/.test(part));
}

/* PowerShell cmdlets that only read, with the parameters Basis understands. */

interface Cmdlet {
  /** Parameters whose values are paths it reads. */
  paths?: string[];
  /** Parameters that take a value that is not a path. */
  values?: string[];
  /** Name filters, which must not name folders. */
  filters?: string[];
  switches?: string[];
  /** Where positional arguments go, in order; any further ones are taken as paths. */
  positions?: string[];
}

const PATHS = ["path", "literalpath", "pspath", "lp"];
const COMMON = { values: ["erroraction", "ea", "warningaction", "wa"], switches: ["verbose"] };

const CMDLETS: Record<string, Cmdlet> = {
  "get-content": {
    paths: PATHS,
    values: ["totalcount", "first", "head", "tail", "last", "readcount", "encoding", "delimiter"],
    switches: ["raw", "force"],
    positions: ["path"],
  },
  "get-childitem": {
    paths: PATHS,
    values: ["depth", "attributes"],
    filters: ["filter", "include", "exclude"],
    switches: ["recurse", "force", "name", "file", "directory", "hidden", "system", "readonly"],
    positions: ["path", "filter"],
  },
  "select-string": {
    paths: ["path", "literalpath"],
    values: ["pattern", "encoding", "context", "culture"],
    filters: ["include", "exclude"],
    switches: ["simplematch", "casesensitive", "notmatch", "allmatches", "list", "quiet", "raw", "noemphasis"],
    positions: ["pattern", "path"],
  },
  "test-path": {
    paths: ["path", "literalpath"],
    values: ["pathtype"],
    filters: ["filter", "include", "exclude"],
    switches: ["isvalid"],
    positions: ["path"],
  },
  "get-item": {
    paths: PATHS,
    filters: ["filter", "include", "exclude"],
    switches: ["force"],
    positions: ["path"],
  },
  "resolve-path": { paths: ["path", "literalpath"], switches: ["relative"], positions: ["path"] },
  "get-location": {},
  "select-object": {
    values: ["first", "last", "skip", "skiplast", "index", "property", "expandproperty", "excludeproperty"],
    switches: ["unique"],
    positions: ["property"],
  },
  "sort-object": {
    values: ["property", "top", "bottom"],
    switches: ["descending", "unique", "casesensitive"],
    positions: ["property"],
  },
  "measure-object": {
    values: ["property"],
    switches: ["line", "word", "character", "sum", "average", "maximum", "minimum", "ignorewhitespace"],
    positions: ["property"],
  },
  "format-table": { values: ["property"], switches: ["autosize", "wrap", "hidetableheaders"], positions: ["property"] },
  "format-list": { values: ["property"], positions: ["property"] },
  "out-string": { values: ["width"], switches: ["stream"] },
};

/** PowerShell's own aliases on Windows for the cmdlets above. */
const ALIASES: Record<string, string> = {
  cat: "get-content",
  gc: "get-content",
  type: "get-content",
  ls: "get-childitem",
  dir: "get-childitem",
  gci: "get-childitem",
  sls: "select-string",
  gi: "get-item",
  rvpa: "resolve-path",
  pwd: "get-location",
  gl: "get-location",
  select: "select-object",
  sort: "sort-object",
  measure: "measure-object",
  ft: "format-table",
  fl: "format-list",
};

/** The paths one PowerShell command reads, or null when it is not one of the reads above. */
function psCommand(args: Arg[], legacy: boolean): string[] | null {
  const [head, ...rest] = args;
  if (!head || head.quoted || head.values.length !== 1) return null;
  const name = head.values[0]!.toLowerCase();
  if (!/^[a-z][a-z0-9.-]*$/.test(name)) return null;
  const native = name.replace(/\.exe$/, "");
  if (native === "rg" || native === "git") {
    const words: string[] = [];
    for (const arg of rest) {
      const word = arg.values[0]!;
      // Arrays reach programs as separate arguments, and quotes and empty arguments get lost or merged on the way.
      if (arg.values.length !== 1 || arg.glob || !nativeSafe(word, legacy)) return null;
      words.push(word);
    }
    return native === "rg" ? rgReads(words) : gitReads(words);
  }
  const cmdlet = CMDLETS[ALIASES[name] ?? name];
  if (!cmdlet) return null;
  // Windows PowerShell 5.1 follows links into other folders when it recurses.
  return cmdletReads(cmdlet, rest, legacy && (name === "get-childitem" || ALIASES[name] === "get-childitem"));
}

/** An argument PowerShell passes to a program unchanged, also in its old way of quoting (Windows PowerShell 5.1). */
function nativeSafe(word: string, legacy: boolean): boolean {
  if (word === "" || word.includes('"')) return false;
  if (/\s/.test(word) && word.endsWith("\\")) return false;
  return !(legacy && /\s/.test(word));
}

function cmdletReads(cmdlet: Cmdlet, args: Arg[], noRecurse: boolean): string[] | null {
  const kind = (name: string): "path" | "value" | "filter" | "switch" | null => {
    if (cmdlet.paths?.includes(name)) return "path";
    if (cmdlet.values?.includes(name) || COMMON.values.includes(name)) return "value";
    if (cmdlet.filters?.includes(name)) return "filter";
    if (cmdlet.switches?.includes(name) || COMMON.switches.includes(name)) return "switch";
    return null;
  };
  const reads: string[] = [];
  const bound = new Set<string>();
  const positional: Arg[] = [];
  const take = (name: string, arg: Arg): boolean => {
    const type = kind(name);
    if (type === "path") {
      if (arg.glob) return false;
      reads.push(...arg.values);
    } else if (type === "filter") {
      if (arg.values.some((value) => /[\\/:]|\.\./.test(value))) return false;
    } else if (type !== "value") return false;
    bound.add(name);
    return true;
  };
  let named = true;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    const text = arg.values[0]!;
    if (!named || arg.quoted || !text.startsWith("-") || arg.values.length !== 1) {
      positional.push(arg);
      continue;
    }
    if (text === "--") {
      named = false;
      continue;
    }
    // Whether PowerShell takes `-'Path'` or `-Path:'x'` as a parameter is not worth guessing.
    if (arg.quotes) return null;
    const match = /^-([a-z][a-z0-9]*)(?::(.*))?$/i.exec(text);
    if (!match) return null;
    const name = match[1]!.toLowerCase();
    if (noRecurse && (name === "recurse" || name === "depth")) return null;
    const type = kind(name);
    if (type === null) return null;
    if (type === "switch") {
      if (match[2] !== undefined) return null;
      bound.add(name);
      continue;
    }
    let value: Arg;
    if (match[2] !== undefined) {
      if (match[2] === "") return null;
      value = { values: [match[2]], quoted: false, glob: /[*?]/.test(match[2]) };
    } else {
      const next = args[i + 1];
      if (!next || (!next.quoted && next.values[0]!.startsWith("-"))) return null;
      value = next;
      i += 1;
    }
    if (!take(name, value)) return null;
  }
  const slots = (cmdlet.positions ?? []).filter((name) => !bound.has(name));
  for (const [index, arg] of positional.entries()) {
    const slot = slots[index];
    if (slot ? !take(slot, arg) : arg.glob) return null;
    if (!slot) reads.push(...arg.values);
  }
  return reads;
}

/* Programs, for POSIX shells and from PowerShell. */

/** The paths one POSIX command reads, or null when it is not one Basis knows to only read. */
function posixCommand(args: Arg[]): string[] | null {
  if (args.some((arg) => arg.glob)) return null;
  const [name, ...words] = args.map((arg) => arg.values[0]!);
  switch (name) {
    case "cat":
      return flagReads(words, { short: "nbsvAETetu" });
    case "head":
    case "tail":
      return flagReads(words, { short: "qv", shortValues: "nc", longValues: ["lines", "bytes"], numeric: true });
    case "wc":
      return flagReads(words, { short: "lwcmL", long: ["lines", "words", "bytes", "chars"] });
    case "ls":
      return flagReads(words, {
        short: "alhRrtS1dFAGip",
        long: ["all", "almost-all", "human-readable", "recursive", "reverse"],
        longValues: ["color", "sort"],
      });
    case "pwd":
      return words.length === 0 ? [] : null;
    case "echo":
      return [];
    case "sort":
      // Not -o (writes its output to a file), -T (temporary files) or --compress-program.
      return flagReads(words, { short: "bdfgiMhnRrVcCsuz", shortValues: "kt" });
    case "uniq": {
      // A second name is the file uniq writes to.
      const reads = flagReads(words, { short: "cdDiuz", shortValues: "fsw" });
      return reads && reads.length <= 1 ? reads : null;
    }
    case "sed":
      return sedReads(words);
    case "diff":
      // Not -l (pipes through pr), -S, -X or --exclude-from (read a list from a file), --from-file or --to-file.
      return flagReads(words, {
        short: "abBdEiNpqrstTuwyZ",
        shortValues: "CUxW",
        long: [
          "brief",
          "report-identical-files",
          "recursive",
          "new-file",
          "text",
          "ignore-case",
          "ignore-all-space",
          "ignore-space-change",
          "ignore-blank-lines",
          "ignore-tab-expansion",
          "ignore-trailing-space",
          "strip-trailing-cr",
          "side-by-side",
          "minimal",
          "unified",
          "context",
          "color",
        ],
        longValues: ["unified", "context", "color", "exclude", "label", "width"],
      });
    case "grep":
      return flagReads(words, GREP);
    case "rg":
      return rgReads(words);
    case "git":
      return gitReads(words);
    case "find":
      return findReads(words);
    default:
      return null;
  }
}

interface Flags {
  /** Short options without a value, as one string of letters. */
  short?: string;
  /** Short options that take a value, attached (`-n5`) or as the next word. */
  shortValues?: string;
  long?: string[];
  /** Long options with a value, `--name=value` or `--name value`. */
  longValues?: string[];
  /** `-5`, as head and tail take it. */
  numeric?: boolean;
  /** The first positional argument is a pattern, unless one of these options gave the pattern. */
  pattern?: string[];
  /** Options after which every positional argument is a path, also the first (rg --files). */
  pathsOnly?: string[];
}

const GREP: Flags = {
  short: "rnilLcvwxEFohHsqIza",
  shortValues: "eABCm",
  long: [
    "recursive",
    "line-number",
    "ignore-case",
    "files-with-matches",
    "files-without-match",
    "count",
    "invert-match",
    "word-regexp",
    "line-regexp",
    "extended-regexp",
    "fixed-strings",
    "only-matching",
    "no-filename",
    "with-filename",
    "no-messages",
    "quiet",
    "color",
    "colour",
  ],
  longValues: ["include", "exclude", "exclude-dir", "color", "colour", "regexp", "context", "max-count"],
  pattern: ["e", "regexp"],
};

/**
 * ripgrep's options that only change what it searches for or how it prints. Left out on purpose: `--pre` (runs a
 * program on every file), `-z` (runs decompressors), `-L` (follows links out of the folder), `-f` and
 * `--ignore-file` (read a file named by the option), `--hostname-bin` and `--type-add`.
 */
const RG: Flags = {
  short: "niSsFwxvlcouNUPHIqap0",
  shortValues: "gtTABCmdeMrE",
  long: [
    "line-number",
    "ignore-case",
    "smart-case",
    "case-sensitive",
    "fixed-strings",
    "word-regexp",
    "line-regexp",
    "invert-match",
    "files-with-matches",
    "files-without-match",
    "count",
    "count-matches",
    "only-matching",
    "files",
    "hidden",
    "no-ignore",
    "no-ignore-vcs",
    "no-ignore-dot",
    "no-ignore-parent",
    "no-ignore-global",
    "unrestricted",
    "no-heading",
    "heading",
    "no-line-number",
    "column",
    "json",
    "vimgrep",
    "multiline",
    "multiline-dotall",
    "pcre2",
    "trim",
    "with-filename",
    "no-filename",
    "quiet",
    "stats",
    "null",
    "no-messages",
    "text",
    "pretty",
    "no-config",
    "byte-offset",
    "passthru",
    "type-list",
    "max-columns-preview",
  ],
  longValues: [
    "glob",
    "iglob",
    "type",
    "type-not",
    "after-context",
    "before-context",
    "context",
    "max-count",
    "max-depth",
    "regexp",
    "color",
    "sort",
    "sortr",
    "max-columns",
    "max-filesize",
    "replace",
    "encoding",
    "context-separator",
  ],
  pattern: ["e", "regexp"],
  pathsOnly: ["files", "type-list"],
};

function rgReads(words: string[]): string[] | null {
  return flagReads(words, RG);
}

/** The positional arguments that name paths, or null for an option outside `flags`. */
function flagReads(words: string[], flags: Flags): string[] | null {
  const positional: string[] = [];
  const given = new Set<string>();
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    if (word === "--") {
      positional.push(...words.slice(i + 1));
      break;
    }
    if (word === "-" || !word.startsWith("-")) {
      positional.push(word);
      continue;
    }
    if (word.startsWith("--")) {
      const [name, value] = word.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (value !== undefined) {
        if (!flags.longValues?.includes(name)) return null;
      } else if (flags.long?.includes(name)) {
        // A switch.
      } else if (flags.longValues?.includes(name)) {
        if (i + 1 >= words.length) return null;
        i += 1;
      } else return null;
      given.add(name);
      continue;
    }
    if (flags.numeric && /^-\d+$/.test(word)) continue;
    for (let j = 1; j < word.length; j += 1) {
      const letter = word[j]!;
      given.add(letter);
      if (flags.short?.includes(letter)) continue;
      if (!flags.shortValues?.includes(letter)) return null;
      // The rest of the word is the value, or else the next word.
      if (j === word.length - 1) {
        if (i + 1 >= words.length) return null;
        i += 1;
      }
      break;
    }
  }
  const pathsOnly = flags.pathsOnly?.some((name) => given.has(name));
  const hasPattern = flags.pattern && !pathsOnly && !flags.pattern.some((name) => given.has(name));
  return hasPattern ? positional.slice(1) : positional;
}

/**
 * `sed` that only prints: `-n`, `-E` and `-r`, scripts given with `-e` or as the first word, and the files after
 * them. Never `-i` (edits the files in place) or `-f` (reads the script from a file); the scripts themselves are
 * checked by sedScript.
 */
function sedReads(words: string[]): string[] | null {
  const scripts: string[] = [];
  const positional: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    if (word === "--") {
      positional.push(...words.slice(i + 1));
      break;
    }
    if (/^-[nEr]*e$/.test(word) || word === "--expression") {
      if (i + 1 >= words.length) return null;
      i += 1;
      scripts.push(words[i]!);
    } else if (word.startsWith("--expression=")) {
      scripts.push(word.slice("--expression=".length));
    } else if (/^-[nEr]+$/.test(word) || ["--quiet", "--silent", "--regexp-extended"].includes(word)) {
      // Options that only change what is printed or how patterns are read.
    } else if (word.startsWith("-") && word !== "-") {
      return null;
    } else positional.push(word);
  }
  if (scripts.length === 0) {
    const script = positional.shift();
    if (script === undefined) return null;
    scripts.push(script);
  }
  return scripts.every(sedScript) ? positional : null;
}

/**
 * A sed script of commands that print, delete lines from the output, quit or substitute: `p`, `d`, `q`, `=` and
 * `s/a/b/` with the flags `g`, `p`, `i`, `I` and a number, each after an optional address or range, separated by
 * `;`. Never `w` (writes a file), `r` (reads one), `e` (runs a command) or the `w` and `e` flags of `s`.
 */
function sedScript(script: string): boolean {
  let i = 0;
  /** Past a pattern or replacement up to its closing delimiter; false when there is none. */
  const delimited = (delimiter: string): boolean => {
    for (; i < script.length; i += 1) {
      if (script[i] === "\\") i += 1;
      else if (script[i] === delimiter) {
        i += 1;
        return true;
      }
    }
    return false;
  };
  /** Past an address (a line number, `$`, `/regex/` or `\cregexc`), if one stands here. */
  const address = (): boolean => {
    const char = script[i];
    if (char === undefined) return true;
    if (/\d/.test(char)) {
      while (i < script.length && /\d/.test(script[i]!)) i += 1;
      return true;
    }
    if (char === "$") {
      i += 1;
      return true;
    }
    if (char === "/") {
      i += 1;
      return delimited("/");
    }
    if (char === "\\") {
      const delimiter = script[i + 1];
      if (delimiter === undefined || delimiter === "\\") return false;
      i += 2;
      return delimited(delimiter);
    }
    return true;
  };
  for (;;) {
    while (i < script.length && (script[i] === " " || script[i] === ";")) i += 1;
    if (i >= script.length) return true;
    if (!address()) return false;
    if (script[i] === ",") {
      i += 1;
      if (!address()) return false;
    }
    if (script[i] === "!") i += 1;
    const command = script[i];
    i += 1;
    if (command === "s") {
      const delimiter = script[i];
      if (delimiter === undefined || delimiter === "\\" || delimiter === " ") return false;
      i += 1;
      if (!delimited(delimiter) || !delimited(delimiter)) return false;
      while (i < script.length && /[gpiI0-9]/.test(script[i]!)) i += 1;
    } else if (command === undefined || !"pdq=".includes(command)) return false;
    if (i < script.length && script[i] !== ";" && script[i] !== " ") return false;
  }
}

/** `find` with tests that only filter and print; never `-exec`, `-delete`, `-fprint` or following links. */
function findReads(words: string[]): string[] | null {
  const VALUE = ["-name", "-iname", "-path", "-ipath", "-wholename", "-iwholename", "-type", "-maxdepth", "-mindepth"];
  const VALUE_MORE = ["-size", "-mtime", "-mmin", "-atime", "-regex", "-iregex"];
  const ALONE = ["-print", "-print0", "-empty", "-not", "-o", "-or", "-a", "-and", "-prune", "-true", "-false"];
  const ALONE_MORE = ["-depth", "-readable", "!", "(", ")"];
  let i = 0;
  if (words[0] === "-P") i = 1;
  const starts: string[] = [];
  for (; i < words.length && !/^[-!()]/.test(words[i]!); i += 1) starts.push(words[i]!);
  for (; i < words.length; i += 1) {
    const word = words[i]!;
    if (VALUE.includes(word) || VALUE_MORE.includes(word)) {
      if (i + 1 >= words.length) return null;
      i += 1;
    } else if (!ALONE.includes(word) && !ALONE_MORE.includes(word)) return null;
  }
  return starts;
}

const GIT_READS = new Set(["status", "diff", "log", "show", "ls-files"]);
const GIT_GLOBAL = new Set(["--no-optional-locks", "--no-pager", "-P"]);
/** Options of the read subcommands that write a file, read one named by the option, or run another program. */
const GIT_REFUSED =
  /^(?:--output(?:[=-]|$)|--no-index$|--ext-diff$|-O|-X|--exclude-from|--contents?(?:=|$)|--ignore-revs-file|--show-signature)/;

/**
 * `git status`, `diff`, `log`, `show` and `ls-files`. Their other arguments are revisions or paths inside the repository; a
 * `rev:path` names a file in git's history, everything else is checked as a path.
 */
function gitReads(words: string[]): string[] | null {
  let i = 0;
  while (i < words.length && GIT_GLOBAL.has(words[i]!)) i += 1;
  if (!GIT_READS.has(words[i] ?? "")) return null;
  const reads: string[] = [];
  let paths = false;
  for (const word of words.slice(i + 1)) {
    if (paths) {
      reads.push(word);
    } else if (word === "--") {
      paths = true;
    } else if (word.startsWith("-")) {
      if (GIT_REFUSED.test(word)) return null;
    } else {
      const object = /^([A-Za-z0-9_.~^@{}/-]{2,}):(.*)$/.exec(word);
      if (object) {
        const [, revision, file] = object;
        if (/(^|\/)\.\.(\/|$)/.test(revision!) || /^[\\/]|\\|(^|\/)\.\.(\/|$)/.test(file!)) return null;
      } else reads.push(word);
    }
  }
  return reads;
}
