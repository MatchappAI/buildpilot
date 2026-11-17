// Realistic data for the live-UI runs: what a real day with Claude Code leaves behind, written as the hook events and
// status-line files Claude Code itself produces (same formats, same folders), with real timestamps (file times).
import fs from "fs"; import path from "path"; import { execFileSync } from "child_process";

export const IDS = {
  approve: "a1a1a1a1-0000-4000-8000-000000000001", // needs your OK (Bash rm)
  working: "b2b2b2b2-0000-4000-8000-000000000002", // running, checklist 2 of 5
  done: "c3c3c3c3-0000-4000-8000-000000000003",    // finished, tests passed, chat 78% full
  stopped: "d4d4d4d4-0000-4000-8000-000000000004", // blog: stopped mid-task 50 min ago
  errors: "e5e5e5e5-0000-4000-8000-000000000005",  // blog: 4 errors this hour
  quiet: "f6f6f6f6-0000-4000-8000-000000000006",   // quiet for 3 h
  ended: "a7a7a7a7-0000-4000-8000-000000000007",   // closed earlier today
};

function gitRepo(dir, files, env) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  const g = (...a) => execFileSync("git", a, { cwd: dir, env, stdio: "ignore" });
  if (!fs.existsSync(path.join(dir, ".git"))) g("init", "-q");
  g("add", "-A"); g("-c", "user.email=qa@example.com", "-c", "user.name=QA", "commit", "-qm", "init", "--allow-empty");
}

/** Seeds a temp HOME made by makeEnv(). Returns the folders and ids. Times are relative to now. */
export function seed(E, { limits5h = 84, limits7d = 41 } = {}) {
  const now = Date.now(); const min = 60_000;
  const shop = E.proj;
  const blog = path.join(E.home, "blog");
  gitRepo(shop, { "src/checkout.tsx": "export const Checkout = () => null;\n", "src/login.tsx": "export const Login = () => null;\n", "README.md": "# shop\n" }, E.env);
  gitRepo(blog, { "package.json": '{"name":"blog","scripts":{"test":"node -e 0"}}', "posts/hello.md": "# hello\n" }, E.env);
  const spool = path.join(E.home, ".buildpilot", "spool"); fs.mkdirSync(spool, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(path.join(spool, ".alive"))) fs.writeFileSync(path.join(spool, ".alive"), "");
  let n = 0;
  const ev = (agoMin, p) => { const f = path.join(spool, `evt.seed${String(++n).padStart(4, "0")}.json`); fs.writeFileSync(f, JSON.stringify(p)); const t = new Date(now - agoMin * min); fs.utimesSync(f, t, t); };
  const S = (id, cwd, agoMin, name, extra = {}) => ev(agoMin, { session_id: id, cwd, hook_event_name: name, transcript_path: path.join(E.home, ".claude/projects/x", `${id}.jsonl`), ...extra });
  const tool = (id, cwd, agoMin, tool_name, tool_input, extra = {}) => S(id, cwd, agoMin, "PostToolUse", { tool_name, tool_input, tool_response: {}, ...extra });

  // 1. needs your OK
  S(IDS.approve, shop, 40, "SessionStart", { source: "startup" });
  S(IDS.approve, shop, 39, "UserPromptSubmit", { prompt: "clean up the old build folders and make the build faster" });
  tool(IDS.approve, shop, 30, "Read", { file_path: path.join(shop, "package.json") });
  tool(IDS.approve, shop, 25, "Edit", { file_path: path.join(shop, "package.json") });
  S(IDS.approve, shop, 3, "PreToolUse", { tool_name: "Bash", tool_input: { command: "rm -rf dist build .cache" } });
  S(IDS.approve, shop, 3, "Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });

  // 2. working, with Claude's own checklist
  S(IDS.working, shop, 20, "SessionStart", { source: "startup" });
  S(IDS.working, shop, 19, "UserPromptSubmit", { prompt: "add a checkout page with Stripe test mode, then write tests for it" });
  S(IDS.working, shop, 18, "PreToolUse", { tool_name: "TodoWrite", tool_input: { todos: [
    { content: "Read the cart code", status: "completed", activeForm: "Reading the cart code" },
    { content: "Add the checkout page", status: "completed", activeForm: "Adding the checkout page" },
    { content: "Wire Stripe test mode", status: "in_progress", activeForm: "Wiring Stripe test mode" },
    { content: "Write tests", status: "pending", activeForm: "Writing tests" },
    { content: "Run the tests", status: "pending", activeForm: "Running the tests" }] } });
  for (let i = 0; i < 4; i++) tool(IDS.working, shop, 15 - i, "Edit", { file_path: path.join(shop, "src/checkout.tsx") });
  S(IDS.working, shop, 0.2, "PreToolUse", { tool_name: "Bash", tool_input: { command: "npm install stripe" } });

  // 3. finished, tests passed, chat getting full
  S(IDS.done, shop, 70, "SessionStart", { source: "startup" });
  S(IDS.done, shop, 69, "UserPromptSubmit", { prompt: "the login button does nothing on mobile" });
  tool(IDS.done, shop, 60, "Edit", { file_path: path.join(shop, "src/login.tsx") });
  tool(IDS.done, shop, 58, "Edit", { file_path: path.join(shop, "src/checkout.tsx") });
  tool(IDS.done, shop, 57, "Bash", { command: "npm test" }, { tool_response: { stdout: "Tests: 12 passed, 12 total", exit_code: 0 } });
  S(IDS.done, shop, 56, "Stop");

  // 4. blog: stopped mid-task (prompt, steps, then silence)
  S(IDS.stopped, blog, 95, "SessionStart", { source: "startup" });
  S(IDS.stopped, blog, 94, "UserPromptSubmit", { prompt: "move the blog posts to MDX and keep the old links working" });
  tool(IDS.stopped, blog, 60, "Edit", { file_path: path.join(blog, "posts/hello.md") });
  tool(IDS.stopped, blog, 50, "Read", { file_path: path.join(blog, "package.json") });

  // 5. blog: errors piling up
  S(IDS.errors, blog, 30, "SessionStart", { source: "startup" });
  S(IDS.errors, blog, 29, "UserPromptSubmit", { prompt: "fix the build, it fails on the RSS step" });
  for (let i = 0; i < 4; i++) S(IDS.errors, blog, 20 - i * 3, "PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "npm run build" }, error: `Error: Cannot find module 'feed' (attempt ${i + 1})` });
  S(IDS.errors, blog, 5, "Stop");

  // 6. quiet for 3 hours
  S(IDS.quiet, shop, 200, "SessionStart", { source: "startup" });
  S(IDS.quiet, shop, 199, "UserPromptSubmit", { prompt: "what does the cart reducer do?" });
  tool(IDS.quiet, shop, 190, "Read", { file_path: path.join(shop, "src/checkout.tsx") });
  S(IDS.quiet, shop, 185, "Stop");

  // 7. closed earlier today
  const midnightAgo = (now - new Date(now).setHours(0, 0, 0, 0)) / min;
  const e0 = Math.min(150, Math.max(4, midnightAgo - 1));
  S(IDS.ended, shop, e0, "SessionStart", { source: "startup" });
  S(IDS.ended, shop, e0 - 1, "UserPromptSubmit", { prompt: "update the README with setup steps" });
  tool(IDS.ended, shop, e0 - 2, "Edit", { file_path: path.join(shop, "README.md") });
  S(IDS.ended, shop, e0 - 3, "Stop");
  S(IDS.ended, shop, e0 - 3.5, "SessionEnd", { reason: "prompt_input_exit" });

  // Status line files (what Claude Code pipes to the status line): chat % full, cost, plan limits.
  const st = path.join(E.home, ".buildpilot", "status"); fs.mkdirSync(st, { recursive: true, mode: 0o700 });
  const reset5 = Math.round((now + 95 * min) / 1000), reset7 = Math.round((now + 3 * 86_400_000) / 1000);
  const status = (id, ctx, cost, agoMin) => { const f = path.join(st, `${id}.json`); fs.writeFileSync(f, JSON.stringify({ session_id: id, model: { id: "claude-sonnet-4-5", display_name: "Sonnet 4.5" }, context_window: { used_percentage: ctx, context_window_size: 200000, total_input_tokens: ctx * 2000 }, cost: { total_cost_usd: cost }, rate_limits: { five_hour: { used_percentage: limits5h, resets_at: reset5 }, seven_day: { used_percentage: limits7d, resets_at: reset7 } } })); const t = new Date(now - agoMin * min); fs.utimesSync(f, t, t); };
  status(IDS.approve, 34, 0.42, 3); status(IDS.working, 52, 1.1, 0.2); status(IDS.done, 78, 2.35, 56); status(IDS.stopped, 61, 0.9, 50); status(IDS.errors, 22, 0.31, 5);
  return { shop, blog, ids: IDS };
}
