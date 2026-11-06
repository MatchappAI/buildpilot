import * as fs from "fs";
import * as path from "path";
import { RepoFacts } from "./analyzer";
import { EvidenceItem, Severity } from "./types";

export interface DoctorCheck {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  plain: string;
  severity: Severity;
  evidence: EvidenceItem[];
}

/** Parse "v22.1.0" -> [22,1,0] */
function ver(v: string): number[] {
  return v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
}

/** Minimal semver-range check for the common engine forms: ">=18", "^20", "20.x", "18 || 20", "~20.1". */
export function satisfies(version: string, range: string): boolean | null {
  const v = ver(version);
  const alts = range.split("||").map((s) => s.trim()).filter(Boolean);
  if (alts.length === 0) return null;
  const one = (r: string): boolean | null => {
    const parts = r.split(/\s+/).filter(Boolean);
    let ok = true;
    for (const p of parts) {
      const m = /^(>=|<=|>|<|\^|~|=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(p);
      if (!m) return null;
      const op = m[1] ?? "=";
      const want = [Number(m[2]), m[3] && !/[x*]/.test(m[3]) ? Number(m[3]) : null, m[4] && !/[x*]/.test(m[4]) ? Number(m[4]) : null];
      const cmp = (): number => {
        for (let i = 0; i < 3; i++) {
          const w = want[i];
          if (w == null) return 0;
          if ((v[i] ?? 0) !== w) return (v[i] ?? 0) > w ? 1 : -1;
        }
        return 0;
      };
      const c = cmp();
      if (op === ">=") ok &&= c >= 0;
      else if (op === ">") ok &&= c > 0;
      else if (op === "<=") ok &&= c <= 0;
      else if (op === "<") ok &&= c < 0;
      else if (op === "^") ok &&= (v[0] === want[0]) && c >= 0;
      else if (op === "~") ok &&= (v[0] === want[0]) && (want[1] == null || v[1] === want[1]) && c >= 0;
      else ok &&= c === 0;
    }
    return ok;
  };
  let sawUnknown = false;
  for (const a of alts) {
    const r = one(a);
    if (r === true) return true;
    if (r === null) sawUnknown = true;
  }
  return sawUnknown ? null : false;
}

export function runDoctor(f: RepoFacts, nodeVersion: string | null): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const isNode = Object.keys(f.scripts).length > 0 || fs.existsSync(path.join(f.root, "package.json"));
  if (isNode) {
    try {
      JSON.parse(fs.readFileSync(path.join(f.root, "package.json"), "utf8"));
    } catch {
      checks.push({ key: "pkg-json-invalid", label: "package.json", status: "fail", severity: "blocker", detail: "package.json is not valid JSON", plain: "The file that lists your project's tools is broken, so nothing can install or run.", evidence: [{ kind: "observed", text: "JSON.parse failed", ref: "package.json" }] });
    }
    if (!nodeVersion) {
      checks.push({ key: "node-missing", label: "Node.js", status: "fail", severity: "blocker", detail: "node was not found on PATH", plain: "Node.js runs JavaScript projects. Install it from nodejs.org.", evidence: [{ kind: "observed", text: "`node --version` failed" }] });
    } else {
      const want = f.nodeEngine ?? f.nvmrc;
      if (want) {
        const s = satisfies(nodeVersion, f.nvmrc && !f.nodeEngine ? f.nvmrc.replace(/^v/, "") + (/\./.test(f.nvmrc) ? "" : ".x") : want);
        checks.push({
          key: "node-version",
          label: "Node.js version",
          status: s === true ? "ok" : s === false ? "fail" : "unknown",
          severity: s === false ? "high" : "info",
          detail: `installed ${nodeVersion}; project wants ${want}`,
          plain: s === false ? "Your project asks for a different Node.js version than the one installed. That causes confusing install and build errors." : "Node.js version looks compatible.",
          evidence: [{ kind: "observed", text: `node ${nodeVersion}; ${f.nodeEngine ? "engines.node" : ".nvmrc"} = ${want}` }],
        });
      } else {
        checks.push({ key: "node-version", label: "Node.js version", status: "ok", severity: "info", detail: `installed ${nodeVersion}; project does not pin a version`, plain: "Node.js is installed.", evidence: [{ kind: "observed", text: `node ${nodeVersion}` }] });
      }
    }
    checks.push(
      f.hasNodeModules
        ? { key: "deps-installed", label: "Dependencies", status: "ok", severity: "info", detail: "node_modules present", plain: "Project libraries are installed.", evidence: [{ kind: "observed", text: "node_modules exists" }] }
        : { key: "deps-installed", label: "Dependencies", status: "fail", severity: "high", detail: "node_modules missing", plain: "The libraries this project needs aren't installed yet, so it can't build or run. Run the install command.", evidence: [{ kind: "observed", text: "node_modules does not exist" }] },
    );
    const jsLocks = f.lockfiles.filter((l) => /package-lock|pnpm-lock|yarn\.lock|bun\.lock/.test(l));
    if (jsLocks.length > 1) {
      checks.push({ key: "multi-lockfiles", label: "Package manager", status: "warn", severity: "medium", detail: `multiple lockfiles: ${jsLocks.join(", ")}`, plain: "Two different install tools have been used. That can install different library versions on different machines. Pick one and delete the other lockfile.", evidence: jsLocks.map((l) => ({ kind: "observed" as const, text: `${l} exists`, ref: l })) });
    }
    for (const s of ["build", "test"]) {
      if (!f.scripts[s]) {
        checks.push({ key: `script-${s}`, label: `\`${s}\` script`, status: "warn", severity: s === "test" ? "medium" : "low", detail: `no "${s}" script in package.json`, plain: s === "test" ? "There's no standard command to run tests, so nobody (including AI agents) can easily check the code still works." : "There's no standard build command, so it's unclear how to produce a shippable version.", evidence: [{ kind: "observed", text: `package.json scripts has no "${s}"` }] });
      } else if (s === "test" && /no test specified/.test(f.scripts[s]!)) {
        checks.push({ key: "script-test", label: "`test` script", status: "warn", severity: "medium", detail: "test script is the npm placeholder", plain: "The test command is a placeholder that always fails. No tests are actually set up.", evidence: [{ kind: "observed", text: `scripts.test = ${f.scripts[s]}` }] });
      }
    }
  }
  if (f.envExampleVars.length > 0) {
    const missing = f.envExampleVars.filter((v) => !f.envFileVars.includes(v));
    checks.push(
      missing.length === 0
        ? { key: "env-vars", label: "Environment variables", status: "ok", severity: "info", detail: `all ${f.envExampleVars.length} names from .env.example are set in a local .env file`, plain: "All the settings the project expects are present (values not checked).", evidence: [{ kind: "observed", text: "names compared, values never read into BuildPilot" }] }
        : { key: "env-vars", label: "Environment variables", status: f.envFileVars.length === 0 ? "fail" : "warn", severity: "high", detail: `missing: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}`, plain: "Your app expects settings (like API keys) that aren't in your local .env file. Features that need them will fail.", evidence: [{ kind: "observed", text: `${missing.length} of ${f.envExampleVars.length} names from .env.example not found in .env files` }] },
    );
  }
  if (f.envTracked.length > 0) {
    checks.push({ key: "env-tracked", label: "Secrets in Git", status: "fail", severity: "blocker", detail: `tracked by git: ${f.envTracked.join(", ")}`, plain: "A file that usually holds passwords and API keys is saved in Git. If this code is shared or pushed, those secrets leak. Remove it from Git and rotate the keys.", evidence: f.envTracked.map((e) => ({ kind: "observed" as const, text: "tracked by git", ref: e })) });
  }
  return checks;
}
