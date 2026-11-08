import * as fs from "fs";
import * as path from "path";
import { projectFiles, trackedFiles } from "./git";
import { clip } from "./redact";

/**
 * Deterministic repository analysis. Reads files as DATA only. Nothing here executes project code.
 */

export interface RepoFacts {
  root: string;
  name: string;
  description: string | null; // from package.json or README (untrusted, clipped)
  descriptionSource: string | null;
  languages: string[];
  frameworks: string[];
  packageManager: "npm" | "pnpm" | "yarn" | "bun" | "pip" | "poetry" | "uv" | "cargo" | "go" | null;
  lockfiles: string[];
  scripts: Record<string, string>; // package.json scripts (names + clipped commands)
  hasNodeModules: boolean;
  /** Number of dependencies + devDependencies in package.json (0 = nothing to install). */
  depCount?: number;
  nodeEngine: string | null;
  nvmrc: string | null;
  fileCount: number;
  sourceFileCount: number;
  testFileCount: number;
  testFiles: string[];
  todoCount: number;
  todos: { file: string; line: number; text: string }[];
  envExampleVars: string[];
  envFileVars: string[]; // NAMES only, never values
  envTracked: string[]; // .env files tracked by git (a leak risk)
  hasCI: boolean;
  deployConfigs: string[];
  docs: string[];
  hasClaudeMd: boolean;
  hasReadme: boolean;
  checklistItems: { text: string; done: boolean; file: string }[];
  isGit: boolean;
  topDirs: string[];
}

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "coverage", ".venv", "venv", "__pycache__", "target", ".turbo", ".cache", ".vscode-test", ".buildpilot", "vendor", "Pods", ".expo"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".kt", ".swift", ".rb", ".php", ".cs", ".vue", ".svelte", ".c", ".cpp", ".h"]);
const TEST_RE = /(^|[\\/])(__tests__|tests?|spec|e2e)[\\/]|\.(test|spec)\.[a-z]+$|(^|[\\/])test_[^\\/]+\.py$|_test\.(go|py)$/i;

export async function listFiles(root: string, cap = 20000): Promise<{ files: string[]; isGit: boolean }> {
  // tracked + untracked-but-not-ignored (vibe coders often never commit)
  const tracked = await projectFiles(root);
  if (tracked) {
    return { files: tracked.filter((f) => !f.split("/").some((p) => IGNORE_DIRS.has(p))).slice(0, cap), isGit: true };
  }
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (out.length >= cap) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= cap) return;
      if (e.isSymbolicLink()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) walk(path.join(dir, e.name), r);
      } else if (e.isFile()) out.push(r);
    }
  };
  walk(root, "");
  return { files: out, isGit: false };
}

function readText(file: string, max = 256 * 1024): string | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > max) return null;
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) return null; // binary
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

function parseEnvNames(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) names.add(m[1]!);
  }
  return [...names];
}

export async function analyzeRepo(root: string): Promise<RepoFacts> {
  const { files, isGit } = await listFiles(root);
  const has = (f: string): boolean => fs.existsSync(path.join(root, f));
  const facts: RepoFacts = {
    root,
    name: path.basename(root),
    description: null,
    descriptionSource: null,
    languages: [],
    frameworks: [],
    packageManager: null,
    lockfiles: [],
    scripts: {},
    hasNodeModules: has("node_modules"),
    nodeEngine: null,
    nvmrc: null,
    fileCount: files.length,
    sourceFileCount: 0,
    testFileCount: 0,
    testFiles: [],
    todoCount: 0,
    todos: [],
    envExampleVars: [],
    envFileVars: [],
    envTracked: [],
    hasCI: files.some((f) => f.startsWith(".github/workflows/") || f === ".gitlab-ci.yml" || f.startsWith(".circleci/")),
    deployConfigs: ["vercel.json", "netlify.toml", "fly.toml", "Dockerfile", "docker-compose.yml", "render.yaml", "app.yaml", "Procfile", "railway.json", "wrangler.toml", "wrangler.jsonc", "serverless.yml"].filter(has),
    docs: files.filter((f) => /\.(md|mdx)$/i.test(f) && !f.includes("node_modules") && f.split("/").length <= 3).slice(0, 40),
    hasClaudeMd: has("CLAUDE.md") || has(".claude/CLAUDE.md"),
    hasReadme: files.some((f) => /^readme(\.md)?$/i.test(f)),
    checklistItems: [],
    isGit,
    topDirs: [...new Set(files.filter((f) => f.includes("/")).map((f) => f.split("/")[0]!))].slice(0, 20),
  };

  for (const [lf, pm] of [["package-lock.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"], ["poetry.lock", "poetry"], ["uv.lock", "uv"], ["Cargo.lock", "cargo"], ["go.sum", "go"]] as const) {
    if (has(lf)) {
      facts.lockfiles.push(lf);
      facts.packageManager ??= pm;
    }
  }

  const pkgText = readText(path.join(root, "package.json"));
  const deps = new Set<string>();
  if (pkgText) {
    facts.languages.push("JavaScript/TypeScript");
    facts.packageManager ??= "npm";
    try {
      const pkg = JSON.parse(pkgText) as Record<string, unknown>;
      if (typeof pkg.name === "string") facts.name = clip(pkg.name, 80);
      if (typeof pkg.description === "string" && pkg.description.trim()) {
        facts.description = clip(pkg.description, 300);
        facts.descriptionSource = "package.json";
      }
      const scripts = pkg.scripts;
      if (scripts && typeof scripts === "object") {
        for (const [k, v] of Object.entries(scripts as Record<string, unknown>)) if (typeof v === "string") facts.scripts[clip(k, 60)] = clip(v, 200);
      }
      for (const key of ["dependencies", "devDependencies"]) {
        const d = pkg[key];
        if (d && typeof d === "object") for (const n of Object.keys(d as object)) deps.add(n);
      }
      const engines = pkg.engines as Record<string, unknown> | undefined;
      if (engines && typeof engines.node === "string") facts.nodeEngine = clip(engines.node, 40);
    } catch {
      /* invalid package.json is reported by the doctor */
    }
  }
  const nvm = readText(path.join(root, ".nvmrc"));
  if (nvm) facts.nvmrc = clip(nvm.trim(), 20);
  if (has("pyproject.toml") || has("requirements.txt")) {
    facts.languages.push("Python");
    facts.packageManager ??= "pip";
  }
  if (has("go.mod")) facts.languages.push("Go");
  if (has("Cargo.toml")) facts.languages.push("Rust");

  const fw: Array<[string, string]> = [
    ["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["@angular/core", "Angular"], ["vite", "Vite"], ["express", "Express"],
    ["fastify", "Fastify"], ["hono", "Hono"], ["electron", "Electron"], ["react-native", "React Native"], ["expo", "Expo"], ["prisma", "Prisma"],
    ["@prisma/client", "Prisma"], ["drizzle-orm", "Drizzle"], ["@supabase/supabase-js", "Supabase"], ["firebase", "Firebase"], ["stripe", "Stripe"],
    ["tailwindcss", "Tailwind"], ["@anthropic-ai/sdk", "Anthropic SDK"], ["openai", "OpenAI SDK"], ["googleapis", "Google APIs"], ["vitest", "Vitest"],
    ["jest", "Jest"], ["@playwright/test", "Playwright"], ["mocha", "Mocha"], ["cypress", "Cypress"],
  ];
  facts.depCount = deps.size;
  for (const [dep, label] of fw) if (deps.has(dep) && !facts.frameworks.includes(label)) facts.frameworks.push(label);
  const pyReq = readText(path.join(root, "requirements.txt")) ?? readText(path.join(root, "pyproject.toml")) ?? "";
  for (const [dep, label] of [["django", "Django"], ["flask", "Flask"], ["fastapi", "FastAPI"], ["pytest", "pytest"], ["streamlit", "Streamlit"]] as const) {
    if (new RegExp(`\\b${dep}\\b`, "i").test(pyReq)) facts.frameworks.push(label);
  }

  if (!facts.description) {
    const readme = files.find((f) => /^readme(\.md)?$/i.test(f));
    const text = readme ? readText(path.join(root, readme)) : null;
    if (text) {
      const para = text
        .split(/\n\s*\n/)
        .map((p) => p.replace(/<[^>]+>/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim())
        .find((p) => p && !p.startsWith("#") && !p.startsWith("[!") && !p.startsWith("```") && p.length > 30);
      if (para) {
        facts.description = clip(para.replace(/\s+/g, " "), 300);
        facts.descriptionSource = readme!;
      }
    }
  }

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (SOURCE_EXT.has(ext)) {
      facts.sourceFileCount++;
      if (TEST_RE.test(f)) {
        facts.testFileCount++;
        if (facts.testFiles.length < 50) facts.testFiles.push(f);
      }
    }
  }

  // TODO/FIXME scan over a bounded number of source files
  let scanned = 0;
  for (const f of files) {
    if (scanned > 1500 || facts.todos.length >= 60) break;
    if (!SOURCE_EXT.has(path.extname(f).toLowerCase()) || TEST_RE.test(f)) continue;
    const text = readText(path.join(root, f), 200 * 1024);
    scanned++;
    if (!text) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]*(.*)/.exec(lines[i]!);
      if (m) {
        facts.todoCount++;
        if (facts.todos.length < 60) facts.todos.push({ file: f, line: i + 1, text: clip(`${m[1]}: ${m[2]}`, 140) });
      }
    }
  }

  for (const ex of [".env.example", ".env.sample", ".env.template", ".env.local.example"]) {
    const t = readText(path.join(root, ex));
    if (t) facts.envExampleVars.push(...parseEnvNames(t));
  }
  facts.envExampleVars = [...new Set(facts.envExampleVars)];
  for (const ef of [".env", ".env.local", ".env.development"]) {
    const t = readText(path.join(root, ef));
    if (t) facts.envFileVars.push(...parseEnvNames(t));
  }
  facts.envFileVars = [...new Set(facts.envFileVars)];
  if (isGit) facts.envTracked = ((await trackedFiles(root)) ?? []).filter((f) => /(^|\/)\.env(\.[a-z]+)?$/i.test(f) && !/example|sample|template/i.test(f));

  for (const doc of facts.docs) {
    if (!/(prd|requirement|roadmap|todo|tasks|spec|plan|features)/i.test(doc)) continue;
    const t = readText(path.join(root, doc));
    if (!t) continue;
    for (const line of t.split("\n")) {
      const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/.exec(line);
      if (m && facts.checklistItems.length < 200) facts.checklistItems.push({ text: clip(m[2]!.trim(), 160), done: m[1] !== " ", file: doc });
    }
  }
  return facts;
}

/** High-confidence secret patterns only (low false-positive rate). Reports location, never the value. */
const SECRET_SCAN: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
  [/\bsk-(proj-)?[A-Za-z0-9_-]{32,}/, "OpenAI-style API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, "GitHub token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{20,}/, "Slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "Google API key"],
  [/\bsk_live_[A-Za-z0-9]{20,}/, "Stripe live secret key"],
  [/(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^:\s/]+:[^@\s]{6,}@(?!localhost|127\.0\.0\.1)/i, "database URL with password"],
];

export interface SecretFinding {
  file: string;
  line: number;
  kind: string;
  /** In a test/fixture/example path: often fake data, so reported separately and with lower severity. */
  likelyFixture: boolean;
}

const FIXTURE_RE = /(^|\/)(test|tests|__tests__|spec|fixtures?|examples?|mocks?|__mocks__)\/|\.(test|spec)\.[a-z]+$|example|sample/i;

export async function scanSecrets(root: string, maxFiles = 3000): Promise<SecretFinding[]> {
  const { files } = await listFiles(root);
  const out: SecretFinding[] = [];
  for (const f of files.slice(0, maxFiles)) {
    if (/\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|lock|lockb|min\.js|map)$/i.test(f) || /package-lock\.json$/.test(f)) continue;
    const text = readText(path.join(root, f), 512 * 1024);
    if (!text) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length && out.length < 100; i++) {
      for (const [re, kind] of SECRET_SCAN) {
        if (re.test(lines[i]!)) {
          out.push({ file: f, line: i + 1, kind, likelyFixture: FIXTURE_RE.test(f) });
          break;
        }
      }
    }
  }
  return out;
}
