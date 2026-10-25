import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";
import { isApprovableClaudeRead, isApprovableRead, readOnlyCommand } from "../server/commands.ts";

const PWSH = String.raw`"C:\\Users\\lucas\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe"`;
const WS = String.raw`C:\ws`;

/** A PowerShell script as Codex sends it on Windows: its shell's path and the script in POSIX quotes. */
function pwsh(script: string): string {
  return `${PWSH} -Command '${script.replace(/'/g, `'"'"'`)}'`;
}

/** What a PowerShell script in C:\ws reads, or null when it is not approved. */
function windows(script: string): string[] | null {
  return readOnlyCommand(pwsh(script), WS, path.win32)?.reads ?? null;
}

/** What a POSIX command line in /ws reads, or null. */
function posix(command: string): string[] | null {
  return readOnlyCommand(command, "/ws", path.posix)?.reads ?? null;
}

/** Paths inside C:\ws, as the reads list them (the working folder first). */
const inWs = (...names: string[]) => [WS, ...names.map((name) => path.win32.join(WS, name))];
const inPosixWs = (...names: string[]) => ["/ws", ...names.map((name) => path.posix.join("/ws", name))];

describe("readOnlyCommand in PowerShell", () => {
  test("reads the commands Codex sent in a real design turn", () => {
    assert.deepEqual(windows("Get-Content AGENTS.md"), inWs("AGENTS.md"));
    assert.deepEqual(windows("rg --files components"), inWs("components"));
    assert.deepEqual(
      windows("Get-Content components/index.ts, components/Button.tsx, components/Button.module.css"),
      inWs("components/index.ts", "components/Button.tsx", "components/Button.module.css"),
    );
    assert.deepEqual(windows("rg -n --hidden -g '!.basis/snapshots/**' -g '!.git/**' danger ."), inWs("."));
    assert.deepEqual(windows("git --no-optional-locks status --short"), inWs());
    assert.deepEqual(windows("git log -1 --format=fuller"), inWs());
  });

  test("takes Codex's quoting of a script with single and double quotes", () => {
    // The adapter's real command line for an rg call: double quotes around the script, '"'"' around its quotes.
    const command = `${PWSH} -Command "rg -n --hidden -g '"'!.basis/snapshots/**'"' danger ."`;
    assert.deepEqual(readOnlyCommand(command, WS, path.win32)?.reads, inWs("."));
    assert.deepEqual(windows(`Select-String -Pattern 'it''s' -Path a.css`), inWs("a.css"));
  });

  test("returns the shell's own path as a program, to be checked by the caller", () => {
    assert.deepEqual(readOnlyCommand(pwsh("Get-Content a"), WS, path.win32)?.programs, [
      String.raw`C:\Users\lucas\AppData\Local\Microsoft\WindowsApps\pwsh.exe`,
    ]);
    assert.deepEqual(readOnlyCommand("pwsh -NoProfile -Command 'Get-Content a'", WS, path.win32)?.programs, []);
    assert.equal(readOnlyCommand(String.raw`tools\pwsh.exe -Command 'Get-Content a'`, WS, path.win32), null);
  });

  test("knows the aliases, parameters and pipelines of reads", () => {
    assert.deepEqual(windows("cat a.ts; type b.ts; gc -Raw c.ts"), inWs("a.ts", "b.ts", "c.ts"));
    assert.deepEqual(windows("Get-Content -Path a.ts -TotalCount 40"), inWs("a.ts"));
    assert.deepEqual(windows("Get-Content -LiteralPath:a.ts -Tail 5"), inWs("a.ts"));
    assert.deepEqual(windows("Get-ChildItem -Recurse -File components -Filter *.tsx"), inWs("components"));
    assert.deepEqual(windows("ls components; dir; gci -Name views"), inWs("components", "views"));
    assert.deepEqual(
      windows("Select-String -Path components/Button.tsx -Pattern danger"),
      inWs("components/Button.tsx"),
    );
    assert.deepEqual(windows("Select-String danger components/Button.tsx"), inWs("components/Button.tsx"));
    assert.deepEqual(windows("Get-Content a.ts | Select-String -SimpleMatch 'var(--'"), inWs("a.ts"));
    assert.deepEqual(
      windows("Get-ChildItem -Recurse components | Select-Object -ExpandProperty FullName | Sort-Object"),
      inWs("components"),
    );
    assert.deepEqual(windows("Get-Content a.ts | Measure-Object -Line"), inWs("a.ts"));
    assert.deepEqual(windows("Get-Content a.ts -ErrorAction SilentlyContinue"), inWs("a.ts"));
    assert.deepEqual(
      windows("Test-Path patterns && Get-Content patterns/index.ts"),
      inWs("patterns", "patterns/index.ts"),
    );
    assert.deepEqual(windows("Get-Content missing.ts 2>$null"), inWs("missing.ts"));
    assert.deepEqual(windows("rg danger components 2>&1"), inWs("components"));
    assert.deepEqual(windows(String.raw`Get-Content C:\repo\src\theme.css`), [WS, String.raw`C:\repo\src\theme.css`]);
  });

  test("leaves a pattern out of the paths, and checks the paths after it", () => {
    assert.deepEqual(windows("rg -n 'color: var' components"), inWs("components"));
    assert.deepEqual(windows("rg -e danger -e primary components patterns"), inWs("components", "patterns"));
    assert.deepEqual(windows("rg -nC2 danger components"), inWs("components"));
    assert.deepEqual(windows("Select-String -Path a.css, b.css 'font: bold'"), inWs("a.css", "b.css"));
  });

  test("reads git's history and working tree", () => {
    assert.deepEqual(windows("git diff -- components/Button.tsx"), inWs("components/Button.tsx"));
    assert.deepEqual(windows("git show HEAD:components/Button.tsx"), inWs());
    assert.deepEqual(windows("git log --oneline -n 5 -- views"), inWs("5", "views"));
  });

  test("asks for commands chained to anything that is not a read", () => {
    assert.equal(windows("Get-Content a; Remove-Item b"), null);
    assert.equal(windows("Get-Content a && rm -r b"), null);
    assert.equal(windows("Get-Content a || npm install"), null);
    assert.equal(windows("Get-Content x | Set-Content y"), null);
    assert.equal(windows("Get-Content x | Out-File y"), null);
    assert.equal(windows("Get-Content x | Tee-Object y"), null);
    assert.equal(windows("Get-ChildItem | ForEach-Object { Remove-Item $_ }"), null);
    assert.equal(windows("Get-ChildItem | Where-Object Name -like x"), null);
    assert.equal(windows("node -e 'require(1)'"), null);
    assert.equal(windows("npx tsc"), null);
    assert.equal(windows(String.raw`.\rg.exe danger`), null);
    assert.equal(windows(String.raw`C:\tools\rg.exe danger`), null);
    assert.equal(windows("'Get-Content' a"), null);
    assert.equal(windows("Microsoft.PowerShell.Management\\Get-Content a"), null);
  });

  test("asks for redirection into files", () => {
    assert.equal(windows("rg foo > out"), null);
    assert.equal(windows("rg foo >> out"), null);
    assert.equal(windows("Get-Content a 2> errors.txt"), null);
    assert.equal(windows("Get-Content a *> all.txt"), null);
    assert.equal(windows("Get-Content a 2>&1 > out"), null);
    assert.equal(windows("Get-Content a2>$null"), null);
    assert.equal(windows("Get-Content < a"), null);
  });

  test("asks for variables, subexpressions, script blocks and escapes", () => {
    assert.equal(windows("Get-Content $env:USERPROFILE/.ssh/id_rsa"), null);
    assert.equal(windows("Get-Content ${env:USERPROFILE}"), null);
    assert.equal(windows('Get-Content "$HOME/.gitconfig"'), null);
    assert.equal(windows("Get-Content $(Remove-Item x)"), null);
    assert.equal(windows('Get-Content "$(Remove-Item x)"'), null);
    assert.equal(windows("Get-Content (Remove-Item x)"), null);
    assert.equal(windows("Get-Content @(Remove-Item x)"), null);
    assert.equal(windows("Get-Content @args"), null);
    assert.equal(windows("Get-Content a `; Remove-Item b"), null);
    assert.equal(windows('Get-Content "a`"; Remove-Item b'), null);
    assert.equal(windows("& Remove-Item x"), null);
    assert.equal(windows(". ./profile.ps1"), null);
    assert.equal(windows("[IO.File]::ReadAllText('x')"), null);
    assert.equal(windows("Get-Content a # comment"), null);
    assert.equal(windows("git log --% & calc"), null);
    assert.equal(windows("Get-Content a\nRemove-Item b"), null);
  });

  test("asks for typographic quotes and dashes, which PowerShell reads as quotes and dashes", () => {
    assert.equal(windows("Get-Content 'a\u2019; Remove-Item b; \u2018'"), null);
    assert.equal(windows("Get-Content \u2013Path a"), null);
  });

  test("resolves paths outside for the caller to refuse, and asks for paths it cannot resolve", () => {
    assert.deepEqual(windows(String.raw`Get-Content ..\..\Windows\win.ini`), [WS, String.raw`C:\Windows\win.ini`]);
    assert.equal(windows(String.raw`Get-Content \\server\share\secret.txt`), null);
    assert.equal(windows("Get-Content //server/share/secret.txt"), null);
    assert.equal(windows(String.raw`Get-Content \\?\C:\secret.txt`), null);
    assert.equal(windows("Get-Content ~/.ssh/id_rsa"), null);
    assert.equal(windows("Get-Content env:USERPROFILE"), null);
    assert.equal(windows(String.raw`Get-ChildItem HKLM:\Software`), null);
    assert.equal(windows(String.raw`Get-Content FileSystem::C:\secret.txt`), null);
    assert.equal(windows("Get-Content C:secret.txt"), null);
    assert.equal(windows("Get-Content a.txt:hidden"), null);
    assert.equal(windows("Get-Content '.. /secret.txt'"), null);
    assert.equal(windows(String.raw`Get-Content ...\secret.txt`), null);
    assert.equal(windows("Get-Content *.css"), null);
    assert.equal(windows("Get-Content '*.css'"), null);
    assert.equal(windows("Get-Content components/[id].tsx"), null);
    assert.equal(windows("rg danger ../*"), null);
    assert.equal(windows("Get-ChildItem -Filter ..\\*"), null);
    assert.equal(windows("Get-ChildItem . ../x"), null);
  });

  test("checks the paths an array or a parameter names, wherever they stand", () => {
    assert.deepEqual(windows(String.raw`Select-String -Path a.css, C:\secret.txt danger`), [
      WS,
      path.win32.join(WS, "a.css"),
      String.raw`C:\secret.txt`,
    ]);
    assert.deepEqual(windows(String.raw`rg danger C:\Users`), [WS, String.raw`C:\Users`]);
    assert.deepEqual(windows(String.raw`git diff -- ..\outside`), [WS, String.raw`C:\outside`]);
  });

  test("asks for parameters and options it does not know", () => {
    assert.equal(windows("Get-Content -Wait log.txt"), null);
    assert.equal(windows("Get-Content -Stream hidden a.txt"), null);
    assert.equal(windows("Get-Content -Pa a.txt"), null);
    assert.equal(windows("Get-ChildItem -FollowSymlink -Recurse"), null);
    assert.equal(windows("Get-Content -'Encoding' x"), null);
    assert.equal(windows("Get-Content -Path"), null);
    assert.equal(windows("rg --pre ./run.sh danger"), null);
    assert.equal(windows("rg --pre=./run.sh danger"), null);
    assert.equal(windows("rg -z danger"), null);
    assert.equal(windows("rg -L danger"), null);
    assert.equal(windows("rg -f patterns.txt"), null);
    assert.equal(windows("rg --ignore-file x danger"), null);
    assert.equal(windows("git -c core.pager=calc log"), null);
    assert.equal(windows("git -C ../other log"), null);
    assert.equal(windows("git --git-dir=../other/.git log"), null);
    assert.equal(windows("git diff --output=out.txt"), null);
    assert.equal(windows("git diff --no-index ../a ../b"), null);
    assert.equal(windows("git diff --ext-diff"), null);
    assert.equal(windows("git log --show-signature"), null);
    assert.equal(windows("git checkout ."), null);
    assert.equal(windows("git branch new"), null);
    assert.equal(windows("git show HEAD:../outside"), null);
  });

  test("asks for arguments PowerShell may pass to a program differently than they are written", () => {
    assert.equal(windows(`rg 'a" C:\\secret "b' .`), null);
    assert.equal(windows("rg '' ."), null);
    assert.equal(windows("rg danger a,b"), null);
    assert.equal(windows("rg -g *.css danger"), null);
    const legacy = (script: string) =>
      readOnlyCommand(pwsh(script).replace(PWSH, "powershell.exe"), WS, path.win32)?.reads ?? null;
    assert.equal(legacy("rg 'font weight' ."), null);
    assert.equal(legacy("Get-ChildItem -Recurse"), null);
    assert.deepEqual(legacy("Get-Content a"), inWs("a"));
  });

  test("asks for other shells and ways of running PowerShell", () => {
    assert.equal(readOnlyCommand(`${PWSH} -EncodedCommand ZQBjAGgAbwA=`, WS, path.win32), null);
    assert.equal(readOnlyCommand(`${PWSH} -File x.ps1`, WS, path.win32), null);
    assert.equal(readOnlyCommand(`${PWSH} -ExecutionPolicy Bypass -Command 'Get-Content a'`, WS, path.win32), null);
    assert.equal(readOnlyCommand(`${PWSH} -Command 'Get-Content a' extra`, WS, path.win32), null);
    assert.equal(readOnlyCommand("cmd /c type a.txt", WS, path.win32), null);
    assert.equal(readOnlyCommand(pwsh("Get-Content a"), "ws", path.win32), null);
  });
});

describe("readOnlyCommand in POSIX shells", () => {
  test("reads with bash -lc, and with the shell taken off by the adapter", () => {
    assert.deepEqual(posix("bash -lc 'cat components/Button.tsx'"), inPosixWs("components/Button.tsx"));
    assert.deepEqual(posix("/bin/zsh -lc 'rg -n danger components'"), inPosixWs("components"));
    assert.deepEqual(posix("cat components/Button.tsx"), inPosixWs("components/Button.tsx"));
    assert.deepEqual(posix(`rg -n "font weight" components | head -n 20`), inPosixWs("components"));
    assert.deepEqual(posix("ls -la components && wc -l a b"), inPosixWs("components", "a", "b"));
    assert.deepEqual(posix("grep -rn danger components 2>/dev/null"), inPosixWs("components"));
    assert.deepEqual(posix("find components -name '*.tsx' -type f"), inPosixWs("components"));
    assert.deepEqual(posix("git status --short; git diff"), inPosixWs());
    assert.deepEqual(posix("tail -5 a"), inPosixWs("a"));
    assert.deepEqual(posix("rg --files"), inPosixWs());
  });

  test("reads with sed, sort, uniq, echo and git ls-files", () => {
    assert.deepEqual(posix("sed -n 1p a"), inPosixWs("a"));
    assert.deepEqual(posix("sed -n '1,40p;/^export/p' a b"), inPosixWs("a", "b"));
    assert.deepEqual(posix("git ls-files | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -60"), inPosixWs());
    assert.deepEqual(posix("sed -E -e 's/a+/b/g' -e '$d' a"), inPosixWs("a"));
    assert.deepEqual(posix("sed -ne 's#x#y#p' a"), inPosixWs("a"));
    assert.deepEqual(posix("sort -t , -k 2 a"), inPosixWs("a"));
    assert.deepEqual(posix("echo; echo -n done"), inPosixWs());
    assert.deepEqual(posix("git ls-files apps/login packages"), inPosixWs("apps/login", "packages"));
    assert.deepEqual(posix(String.raw`git ls-files | grep -iE "\.(css|scss)$|theme"`), inPosixWs());
  });

  test("asks for sed, sort and uniq that write, read scripts or run commands", () => {
    assert.equal(posix("sed -i 's/a/b/' a"), null);
    assert.equal(posix("sed --in-place 's/a/b/' a"), null);
    assert.equal(posix("sed -f script a"), null);
    assert.equal(posix("sed 'w out' a"), null);
    assert.equal(posix("sed '1w out' a"), null);
    assert.equal(posix("sed 's/a/b/w out' a"), null);
    assert.equal(posix("sed 's/a/b/e' a"), null);
    assert.equal(posix("sed 'e rm -rf b' a"), null);
    assert.equal(posix("sed 'r secret' a"), null);
    assert.equal(posix("sed 's/a/b' a"), null);
    assert.equal(posix("sed"), null);
    assert.equal(posix("sort -o out a"), null);
    assert.equal(posix("sort --output=out a"), null);
    assert.equal(posix("sort --compress-program=sh a"), null);
    assert.equal(posix("uniq a out"), null);
    assert.equal(posix("git ls-files -X list"), null);
    assert.equal(posix("git ls-files --exclude-from=list"), null);
  });

  test("asks for chained commands that are not reads", () => {
    assert.equal(posix("cat a; rm -rf b"), null);
    assert.equal(posix("cat a && rm -rf b"), null);
    assert.equal(posix("cat a || curl x"), null);
    assert.equal(posix("cat a | sh"), null);
    assert.equal(posix("cat a | tee b"), null);
    assert.equal(posix("cat a & rm b"), null);
    assert.equal(posix("cat a |& tee b"), null);
    assert.equal(posix("bash -lc 'cat a; rm -rf b'"), null);
    assert.equal(posix("FOO=1 cat a"), null);
    assert.equal(posix("env cat a"), null);
    assert.equal(posix("xargs cat < list"), null);
  });

  test("asks for redirection, expansion and subshells", () => {
    assert.equal(posix("rg foo > out"), null);
    assert.equal(posix("rg foo >> out"), null);
    assert.equal(posix("rg foo 2> out"), null);
    assert.equal(posix("rg foo &> out"), null);
    assert.equal(posix("cat < a"), null);
    assert.equal(posix("cat $(rm -rf b)"), null);
    assert.equal(posix("cat `rm -rf b`"), null);
    assert.equal(posix('cat "$(rm -rf b)"'), null);
    assert.equal(posix('cat "`rm -rf b`"'), null);
    assert.equal(posix("cat $HOME/.ssh/id_rsa"), null);
    assert.equal(posix("cat ${HOME}"), null);
    assert.equal(posix('cat "$HOME"'), null);
    assert.equal(posix('cat "${HOME}"'), null);
    assert.equal(posix('cat "$(id)"'), null);
    assert.equal(posix('cat "$1"'), null);
    assert.deepEqual(posix('grep "a$" a'), inPosixWs("a"));
    assert.equal(posix("cat ~/.ssh/id_rsa"), null);
    assert.equal(posix("cat ../*"), null);
    assert.equal(posix("cat {a,b}"), null);
    assert.equal(posix("(cat a)"), null);
    assert.equal(posix("cat a # b"), null);
    assert.equal(posix("cat 'a"), null);
    assert.equal(posix("cat a\nrm b"), null);
  });

  test("asks for options that write, run programs or follow links", () => {
    assert.equal(posix("find . -exec rm {} ;"), null);
    assert.equal(posix("find . -name x -exec cat '{}' \\;"), null);
    assert.equal(posix("find . -delete"), null);
    assert.equal(posix("find . -fprint out"), null);
    assert.equal(posix("find -L . -name x"), null);
    assert.equal(posix("grep -R danger ."), null);
    assert.equal(posix("grep -f patterns.txt ."), null);
    assert.equal(posix("tail -f log"), null);
    assert.equal(posix("ls -L"), null);
  });

  test("resolves paths outside for the caller to refuse", () => {
    assert.deepEqual(posix("cat ../../etc/passwd"), ["/ws", "/etc/passwd"]);
    assert.deepEqual(posix("cat /etc/passwd"), ["/ws", "/etc/passwd"]);
    assert.deepEqual(posix("grep -rn root /etc"), ["/ws", "/etc"]);
    assert.equal(posix("cat //server/share"), null);
  });

  test("asks for a script whose quotes the adapter could not keep", () => {
    // `bash -lc 'cat '"'"'a b'"'"''` with `bash -lc` and the outer quotes removed.
    assert.equal(posix(`cat '"'"'a b'"'"'`), null);
  });
});

describe("isApprovableRead", () => {
  const REPO = String.raw`C:\repo`;
  const inside = (root: string, target: string) => {
    const relative = path.win32.relative(root, target);
    return !relative.startsWith("..") && !path.win32.isAbsolute(relative);
  };
  const readable = (target: string) => inside(WS, target) || inside(REPO, target);
  const approved = (rawInput: unknown) => isApprovableRead(rawInput, WS, readable, path.win32);

  test("approves a read in the workspace or the linked repo", () => {
    assert.equal(approved({ command: pwsh("Get-Content AGENTS.md"), cwd: WS }), true);
    assert.equal(approved({ command: pwsh(String.raw`rg -n primary C:\repo\src`), cwd: WS }), true);
    assert.equal(approved({ command: pwsh("Get-Content src/theme.css"), cwd: REPO }), true);
    assert.equal(approved({ command: pwsh("Get-ChildItem") }), true);
  });

  test("asks for a read outside, from outside, or by a shell inside", () => {
    assert.equal(approved({ command: pwsh(String.raw`Get-Content ..\secret.txt`), cwd: WS }), false);
    assert.equal(approved({ command: pwsh(String.raw`Get-Content C:\Users\lucas\.ssh\id_rsa`), cwd: WS }), false);
    assert.equal(approved({ command: pwsh("Get-ChildItem"), cwd: String.raw`C:\Users` }), false);
    const shell = String.raw`"C:\\ws\\components\\pwsh.exe" -Command 'Get-Content a'`;
    assert.equal(approved({ command: shell, cwd: WS }), false);
  });

  test("asks when the request wants more than running the command", () => {
    assert.equal(approved({ command: pwsh("Get-Content a"), cwd: WS, url: "https://example.com" }), false);
    assert.equal(approved({ command: pwsh("Get-Content a"), cwd: WS, additionalPermissions: {} }), false);
    assert.equal(approved({ cwd: WS }), false);
    assert.equal(approved("Get-Content a"), false);
    assert.equal(approved(null), false);
  });
});

describe("isApprovableClaudeRead", () => {
  const REPO = String.raw`C:\repo`;
  const inside = (root: string, target: string) => {
    const relative = path.win32.relative(root, target);
    return !relative.startsWith("..") && !path.win32.isAbsolute(relative);
  };
  const readable = (target: string) => inside(WS, target) || inside(REPO, target);
  const folders = new Set([WS, REPO, String.raw`C:\repo\packages`, String.raw`C:\Users`].map((f) => f.toLowerCase()));
  const isFolder = (target: string) => folders.has(path.win32.resolve(target).toLowerCase());
  const approved = (command: string, extra: Record<string, unknown> = {}) =>
    isApprovableClaudeRead({ command, description: "Look around", ...extra }, readable, isFolder, path.win32);

  test("approves the commands Claude asked about while surveying a linked repo", () => {
    assert.equal(
      approved(
        `cd "C:/repo" && ls -la && git ls-files | grep -v node_modules | head -300 | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -60`,
      ),
      true,
    );
    assert.equal(
      approved(
        String.raw`cd "C:/repo" && head -c 2500 README.md; echo; git ls-files apps/login apps/admin packages | grep -v "\.test\." ; git ls-files | grep -iE "\.(css|scss)$|tailwind|theme|tokens"`,
      ),
      true,
    );
    assert.equal(
      approved("cd C:/repo/packages && cat a/README.md ../apps/login/src/login.css", { timeout: 5000 }),
      true,
    );
    assert.equal(approved(`cd "C:/ws" && git log --oneline -5`), true);
  });

  test("writes out loops over plain words and variables set in the command", () => {
    // The loop Claude asked about while comparing the design with the template.
    assert.equal(
      approved(
        `cd "C:/ws" && for f in components/Button.specimen.tsx components/Display.specimen.tsx; do echo "== $f"; diff -w -B .basis/template/$f $f; done`,
      ),
      true,
    );
    assert.equal(approved(`cd C:/repo && W="C:/ws"; diff a.css "$W/a.css" && diff -u b.css \${W}/b.css`), true);
    assert.equal(approved("cd C:/repo && for f in a b; do head -5 $f; done; ls"), true);
    assert.equal(approved("cd C:/repo && D=src && for f in a b; do cat $D/$f; done"), true);
  });

  test("asks for variables and loops it cannot follow exactly", () => {
    // Set outside the command, so its value is unknown.
    assert.equal(approved("cd C:/repo && cat $HOME/x"), false);
    assert.equal(approved(`cd C:/repo && cat "$1"`), false);
    // The loop variable is unset again after the loop.
    assert.equal(approved("cd C:/repo && for f in a; do cat $f; done; cat $f"), false);
    // Values that the shell would split, expand or take as a wildcard.
    assert.equal(approved(`cd C:/repo && W="a b"; cat $W`), false);
    assert.equal(approved("cd C:/repo && W=~/x; cat $W"), false);
    assert.equal(approved("cd C:/repo && for f in src/*.css; do cat $f; done"), false);
    assert.equal(approved(`cd C:/repo && for f in "a b"; do cat $f; done`), false);
    // An assignment in front of a command sets its environment, not the shell's.
    assert.equal(approved("cd C:/repo && W=x cat a"), false);
    assert.equal(approved("cd C:/repo && W=x | cat a"), false);
    // A quoted or escaped name is no assignment, a quoted keyword no keyword.
    assert.equal(approved(`cd C:/repo && W"x"=a; cat $Wx`), false);
    assert.equal(approved(`cd C:/repo && "for" f in a; do cat $f; done`), false);
    // Nested loops, other compound commands and subshells.
    assert.equal(approved("cd C:/repo && for f in a; do for g in b; do cat $f$g; done; done"), false);
    assert.equal(approved("cd C:/repo && while true; do cat a; done"), false);
    assert.equal(approved("cd C:/repo && if true; then cat a; fi"), false);
    assert.equal(approved("cd C:/repo && for f in a; do d=$(diff $f b); done"), false);
    assert.equal(approved("cd C:/repo && for f in a b; do cat $f; done extra"), false);
    assert.equal(approved("cd C:/repo && for f in a b; do cat $f done"), false);
    assert.equal(approved("cd C:/repo && for f in a b do cat $f; done"), false);
    assert.equal(approved("cd C:/repo && diff -l a b"), false);
  });

  test("follows a later cd, and checks paths from every folder the shell may be in", () => {
    // What Claude asked while designing a view: the workspace first, then the product repo.
    assert.equal(
      approved(
        String.raw`cd "C:/ws" && sed -n 36,180p patterns/DataTable.tsx; grep -n "@container\|data-label\|::before" patterns/DataTable.module.css patterns/AppShell.module.css; cd "C:/repo" && grep -n -B3 -A40 "<AppShell" apps/admin/web/src/App.tsx | head -90; grep -n -A12 "nav: {" apps/admin/web/src/i18n.ts | head -16`,
      ),
      true,
    );
    // After `;` the cd always runs, so the next path is read in the repo only.
    assert.equal(approved("cd C:/ws && ls; cd C:/repo && cat package.json"), true);
    // After && the cd may be skipped: the path must be readable from both folders; both are, here.
    assert.equal(approved("cd C:/ws && ls && cd C:/repo; cat a"), true);
    // ...but a path that leaves one of them is not.
    assert.equal(approved("cd C:/ws && ls || cd C:/repo/packages; cat ../x"), false);
    // A cd in a pipeline moves nothing: what follows still runs in the first folder.
    assert.equal(approved("cd C:/repo/packages && cd C:/Users | ls; cat ../x"), false);
    // A later cd must name an existing absolute folder that may be read, alone.
    assert.equal(approved("cd C:/ws && cd C:/Users && ls"), false);
    assert.equal(approved("cd C:/ws && cd C:/repo/missing && ls"), false);
    assert.equal(approved("cd C:/ws && cd ../repo && ls"), false);
    assert.equal(approved("cd C:/ws && cd C:/repo C:/ws && ls"), false);
    assert.equal(approved(`cd C:/ws && "cd" C:/repo && ls`), false);
  });

  test("asks without a cd into an existing folder first, since the shell's folder is unknown", () => {
    assert.equal(approved("git ls-files"), false);
    assert.equal(approved("ls -la && cd C:/repo && git ls-files"), false);
    assert.equal(approved("cd repo && git ls-files"), false);
    assert.equal(approved("cd C:/repo/missing && git ls-files"), false);
    assert.equal(approved("cd C:/repo; git ls-files"), false);
    assert.equal(approved("cd C:/repo || git ls-files"), false);
    assert.equal(approved("cd C:/repo &&"), false);
    assert.equal(approved("cd C:/re* && ls"), false);
  });

  test("asks for reads outside, and for anything but reads", () => {
    assert.equal(approved("cd C:/Users && ls"), false);
    assert.equal(approved("cd C:/repo && cat ../secret.txt"), false);
    assert.equal(approved("cd C:/repo && cat C:/Users/lucas/.ssh/id_rsa"), false);
    assert.equal(approved("cd C:/repo && git ls-files > list.txt"), false);
    assert.equal(approved("cd C:/repo && rm -rf src"), false);
    assert.equal(approved("cd C:/repo && W=C:/Users; cat $W/x"), false);
    assert.equal(approved("cd C:/repo && for f in a ../../secret; do cat $f; done"), false);
    assert.equal(approved("cd C:/repo && for f in a b; do rm $f; done"), false);
  });

  test("takes Git Bash's /c/… for the drive", () => {
    assert.equal(approved("cd /c/repo && git ls-files . | head -60"), true);
    assert.equal(approved("cd /c/repo/packages && cat /c/ws/a.css"), true);
    assert.equal(approved("cd /c/Users && ls"), false);
    assert.equal(approved("cd /c/repo && cat /c/Users/lucas/.ssh/id_rsa"), false);
    assert.equal(approved("cd /d/repo && ls"), false);
  });

  test("approves wildcards that only list names in a readable folder", () => {
    // What Claude asked while bringing in a linked repo's views.
    assert.equal(
      approved(
        "cd /c/repo/packages && git ls-files . | head -60; ls tickets; ls tickets/*/; ls tickets/*/runs/*/ 2>/dev/null | head -30",
      ),
      true,
    );
    assert.equal(approved("cd C:/repo && wc -l src/*.css && grep -n color src/*/theme.ts"), true);
    assert.equal(approved("cd C:/repo && head -5 a*"), true);
    // Names it expands to could be taken for options, or reach outside.
    assert.equal(approved("cd C:/repo && ls *"), false);
    assert.equal(approved("cd C:/repo && head -n*"), false);
    assert.equal(approved("cd C:/repo && ls ../*"), false);
    assert.equal(approved("cd C:/repo/packages && ls ../../*"), false);
    assert.equal(approved("cd C:/repo && cat src/.*"), false);
    assert.equal(approved("cd C:/repo && cat src/*/../../../x"), false);
    assert.equal(approved("cd C:/repo && cat /c/Users/*/x"), false);
    // Only programs that read whatever it expands to: uniq writes to a second name, git and find are not listed.
    assert.equal(approved("cd C:/repo && uniq src/*"), false);
    assert.equal(approved("cd C:/repo && git ls-files src/*"), false);
    assert.equal(approved("cd C:/repo && c*t a"), false);
  });

  test("approves a wildcard in an option's value, and letters beyond ASCII", () => {
    // What Claude asked while bringing a Swedish UI's texts into a design.
    assert.equal(
      approved(
        String.raw`cd "C:/repo" && grep -rn "message:" packages/cli/src --include=*.ts | grep -i "plan\|läser\|tittar\|skriver" | head -20; grep -rn "\"job\.\|progress" packages/studio/src/messages/sv.ts | sed -n '1,40p' | grep -v "^\s*$" | head -40`,
      ),
      true,
    );
    assert.equal(approved("cd C:/repo && cat src/Översikt.tsx"), true);
    // An option's value in another folder, an option grep does not know, and typographic quotes or dashes.
    assert.equal(approved("cd C:/repo && grep -rn a --include=../*.ts"), false);
    assert.equal(approved("cd C:/repo && grep -rn a --pre=*.sh"), false);
    assert.equal(approved("cd C:/repo && cat \u201ca\u201d"), false);
    assert.equal(approved("cd C:/repo && grep \u2013r a"), false);
  });

  test("asks when the request wants more than running the command", () => {
    assert.equal(approved("cd C:/repo && ls", { run_in_background: true }), false);
    assert.equal(approved("cd C:/repo && ls", { dangerouslyDisableSandbox: true }), false);
    assert.equal(approved("cd C:/repo && ls", { timeout: "soon" }), false);
    assert.equal(isApprovableClaudeRead("cd C:/repo && ls", readable, isFolder, path.win32), false);
    assert.equal(isApprovableClaudeRead(null, readable, isFolder, path.win32), false);
  });
});
