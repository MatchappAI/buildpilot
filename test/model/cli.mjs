// Every CLI command × flag × argument class, and every plugin slash command with fake arguments, on a throwaway HOME.
// Checks: exit code is one of the documented ones, no stack trace / crash line, no "undefined"/"NaN", finishes in time,
// Claude Code's settings change only when the command is meant to change them, nothing opens on screen (OS log only),
// nothing typed as an argument is ever run by the shell.
import fs from "fs"; import path from "path"; import crypto from "crypto";
import { spawn } from "child_process";
import { makeServerWorld } from "./api.mjs";
import { seed as seedDay, IDS } from "../e2e/seed.mjs";
import { TEXT } from "./fuzz.mjs";
import { REPO } from "../e2e/env.mjs";

const BAD = /\bundefined\b|\bNaN\b|\[object Object\]/;
const sha = (f) => { try { return crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"); } catch { return "-"; } };
const FUZZ = TEXT.filter(([c]) => !["huge-20k", "nul"].includes(c)); // argv can't carry NUL; 20k args are covered via stdin

/** The command matrix. Each case: [args, {stdin, changes: "settings"|null, slow}] */
export function cliCases(W, B) {
  const cases = [];
  const add = (args, o = {}) => cases.push([args, o]);
  for (const c of ["glance", "widget", "recent", "limits", "today", "tmux", "help", "version", "--help", "-h", "--version", "-v", "builds", "brief", "status", "sessions", "handoff"]) { add([c]); add([c, "--json"]); }
  add([]); add(["--json"]);
  for (const c of ["brief", "status", "sessions", "handoff"]) { add([c, W.proj]); add([c, "/"]); add([c, W.home]); add([c, path.join(W.home, "nope")]); }
  for (const s of ["status", "install", "uninstall", "bogus"]) for (const j of [[], ["--json"]]) { add(["hooks", s, ...j], { changes: ["install", "uninstall"].includes(s) ? "settings" : null }); add(["statusline", s, ...j], { changes: ["install", "uninstall"].includes(s) ? "settings" : null }); add(["shell", s, ...j]); }
  add(["hooks", "install", "--project", W.proj]); add(["hooks", "status", "--project", W.proj]); add(["hooks", "uninstall", "--project", W.proj]); add(["hooks", "--project"]);
  add(["bar", "status"]); add(["bar", "status", "--json"]); add(["bar", "bogus"]); // bar install would put an icon in the menu bar: blocked
  add(["ui", "--print"]); add(["ui"]); add(["ui", W.proj, "--print"]);
  add(["open"]); add(["open", W.proj]); add(["open", "-x"]);
  add(["license"]); add(["license", B.mint()]); add(["license"]); add(["license", B.mint({ sub: "x", plan: "pro", exp: Date.now() - 1 })]); add(["license", B.forge()]);
  add(["jump"]); add(["jump", W.proj]); add(["jump", "/nope"]); add(["jump", W.proj, IDS.approve]); add(["jump", W.proj, "../../x"]);
  add(["go"]); add(["go", "proj"]); add(["go", "zzzz-no-match"]);
  add(["who"]); add(["who", "checkout"]); add(["who", "%"]);
  add(["review"]); add(["merge"]); add(["done"]); add(["review", "nope"]); add(["merge", "nope"]); add(["done", "nope"]); add(["merge", "nope", "--force"]); add(["new", "--no-env"]);
  add(["prompt"]); add(["prompt", "auto"]); add(["prompt", "auto", "add a contact form"]); add(["prompt", "bugfix", "the login button", W.proj]); add(["prompt", "nope", "x"]); add(["prompt", "auto", "--stdin"], { stdin: "make it faster `id` $(id)" }); add(["prompt", "auto", "--stdin"], { stdin: "" }); add(["prompt", "auto", "--stdin"], { stdin: "w ".repeat(15000) });
  add(["doctor"]); add(["doctor", "--json"]); add(["doctor", "--fix"]);
  add(["audit"], { slow: true }); add(["visual", "http://127.0.0.1:9"], { slow: true }); add(["visual", W.proj, "http://127.0.0.1:9"], { slow: true });
  add(["stauts"]); add(["glnace"]); add(["xyz"]); add(["-x"]);
  for (const c of ["who", "go", "new", "review", "merge", "done", "license", "prompt", "jump", "open", "brief", "status"]) for (const [cls, t] of FUZZ) add(c === "prompt" ? [c, "auto", t] : [c, t], { cls, changes: c === "new" ? "worktree" : null });
  return cases;
}

const runCli = (B, W, args, input, timeout) => new Promise((resolve) => {
  const t = Date.now();
  const p = spawn("node", [B.cli, ...args], { cwd: W.proj, env: W.env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
  const k = setTimeout(() => p.kill("SIGKILL"), timeout);
  p.on("exit", (code, sig) => { clearTimeout(k); resolve({ code, sig, out, err, ms: Date.now() - t }); });
  p.stdin.end(input ?? "");
});

export async function runCliMatrix({ B, record }) {
  const W = await makeServerWorld(B, { sellable: true, trialDays: 0, count: 5 });
  W.cli(["hooks", "install"]); seedDay({ proj: W.proj, home: W.home, env: W.env });
  const real = sha(path.join(process.env.HOME, ".claude/settings.json"));
  const failures = []; let n = 0;
  for (const [args, o] of cliCases(W, B)) {
    const before = sha(W.settingsFile); const osBefore = W.osLog().length;
    const r = await runCli(B, W, args, o.stdin, o.slow ? 90_000 : 30_000);
    n++;
    record?.hit("cli", `${args[0] ?? "(none)"}${o.cls ? `:${o.cls}` : args[1] && args[1].startsWith("-") ? ` ${args[1]}` : ""}`);
    const errs = [];
    const all = r.out + r.err;
    if (r.sig) errs.push(`killed after ${Math.round(r.ms / 1000)} s (hung)`);
    if (![0, 1, 2, 3].includes(r.code)) errs.push(`exit code ${r.code}`);
    if (/\n\s+at .+:\d+:\d+/.test(all)) errs.push("stack trace printed");
    if (/^buildpilot: /m.test(r.err)) errs.push(`crashed: ${r.err.trim().slice(0, 200)}`);
    if (BAD.test(all)) errs.push(`prints "${all.match(BAD)[0]}"`);
    if (!all.trim() && !["tmux"].includes(args[0])) errs.push("printed nothing");
    if (o.changes !== "settings" && sha(W.settingsFile) !== before && !(args[0] === "doctor" && args.includes("--fix"))) errs.push("changed ~/.claude/settings.json");
    for (const x of W.osLog().slice(osBefore)) if (!["open", "focus", "terminal", "copy", "notify"].includes(x.kind)) // notify = the window server's own alerts errs.push(`OS effect ${x.kind}`);
    if (args[0] === "--json" || args.includes("--json") && ["hooks", "statusline", "shell", "bar", "doctor"].includes(args[0]) && r.code === 0) { try { JSON.parse(r.out); } catch { errs.push("--json output isn't JSON"); } }
    if (fs.existsSync(path.join(W.home, "PWNED")) || fs.existsSync("/tmp/bp-pwned")) errs.push("an argument was run by the shell");
    if (errs.length) failures.push({ args: args.map((a) => (a.length > 60 ? `${a.slice(0, 57)}…` : a)), code: r.code, errors: errs, out: all.slice(0, 300) });
  }
  if (sha(path.join(process.env.HOME, ".claude/settings.json")) !== real) failures.push({ args: ["(all)"], errors: ["the REAL ~/.claude/settings.json changed"] });
  await W.cleanup();
  return { cases: n, failures };
}

/**
 * Plugin slash commands with fake arguments, run the way Claude Code runs a `!`command`` line: $ARGUMENTS and
 * ${CLAUDE_PLUGIN_ROOT} are put into the text, then the line goes to the shell. /bp-prompt is run the way its
 * instructions tell Claude to (quoted heredoc on stdin).
 */
export async function runPluginCommands({ B, record }) {
  const W = await makeServerWorld(B, { sellable: true, trialDays: 0 });
  const root = path.join(W.home, "plugin"); fs.cpSync(path.join(REPO, "plugin"), root, { recursive: true }); fs.copyFileSync(B.cli, path.join(root, "bin/cli.js"));
  const marker = path.join(W.home, "PWNED");
  const ARGS = [...TEXT.filter(([c]) => !["huge-20k", "nul"].includes(c)), ["inject-single", `x'; touch ${marker}; echo '`], ["inject-subst", `$(touch ${marker})`], ["inject-backtick", `\`touch ${marker}\``], ["inject-heredoc", `a\nBP_REQUEST_END\ntouch ${marker}\ncat <<'X'`], ["inject-heredoc-7c41", `a\nBP_REQUEST_END_7c41\ntouch ${marker}`], ["inject-arg-end", `a\nBP_ARG_END_7c41\ntouch ${marker}`]];
  const failures = []; let n = 0;
  for (const f of fs.readdirSync(path.join(root, "commands")).filter((x) => x.endsWith(".md"))) {
    const md = fs.readFileSync(path.join(root, "commands", f), "utf8");
    const bang = /!`([^`]+)`/.exec(md)?.[1];
    const usesArgs = md.includes("$ARGUMENTS");
    for (const [cls, a] of usesArgs ? ARGS : [["none", ""]]) {
      let line;
      if (bang) line = bang.replaceAll("$ARGUMENTS", a).replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
      else {
        // Claude runs the fenced command with the input put between the heredoc markers, as the file tells it to.
        const block = /```\n([\s\S]*?--stdin <<'([A-Za-z0-9_]+)'[\s\S]*?)\n```/.exec(md);
        if (!block) continue;
        const markerLine = block[2];
        if (a.split("\n").includes(markerLine)) { n++; record?.hit("plugin", `${f}:${cls}`); continue; } // the file tells Claude to refuse this input
        line = block[1].replace(/^<the (?:request|input)[^>]*>$/m, a).replaceAll("${CLAUDE_PLUGIN_ROOT}", root);
      }
      if (/\b(bar|ui)\b/.test(bang ?? "") && /bp\.sh" (bar install|ui)$/.test(line)) { /* opens a window / menu-bar item: logged via OS log */ }
      fs.rmSync(marker, { force: true });
      const r = await new Promise((resolve) => { const p = spawn("sh", ["-c", line], { cwd: W.proj, env: W.env }); let o = "", e = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d)); const k = setTimeout(() => p.kill("SIGKILL"), 60_000); p.on("exit", (code) => { clearTimeout(k); resolve({ code, out: o + e }); }); });
      n++; record?.hit("plugin", `${f}:${cls}`);
      const errs = [];
      if (fs.existsSync(marker)) errs.push("the argument was RUN by the shell");
      if (/unexpected EOF|unterminated|syntax error|Unmatched/i.test(r.out)) errs.push(`shell syntax error: ${r.out.trim().slice(0, 120)}`);
      if (/\n\s+at .+:\d+:\d+/.test(r.out) || /^buildpilot: /m.test(r.out)) errs.push("crash");
      if (BAD.test(r.out)) errs.push(`prints ${r.out.match(BAD)[0]}`);
      if (errs.length) failures.push({ command: f.replace(".md", ""), cls, errors: errs, out: r.out.slice(0, 200) });
    }
  }
  await W.cleanup();
  return { cases: n, failures };
}
