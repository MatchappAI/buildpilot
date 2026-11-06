import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildpilotHome } from "./hooks";

/**
 * Shell integration: BuildPilot appears in every new terminal (zsh/bash) and adds the `bp` command.
 * The rc file only gets a 3-line marked block that sources ~/.buildpilot/shell.sh, so it's easy to see,
 * update and remove. A backup of the rc file is saved before any change.
 */

const START = "# >>> BuildPilot >>>";
const END = "# <<< BuildPilot <<<";

export function shellScript(home = buildpilotHome()): string {
  const cli = path.join(home, "bin", "cli.js");
  return `# BuildPilot shell integration (managed by BuildPilot; remove with: bp shell uninstall)
bp() {
  if command -v node >/dev/null 2>&1 && [ -f "${cli}" ]; then
    node "${cli}" "$@"
  else
    echo "BuildPilot needs Node.js for the terminal view (https://nodejs.org). The VS Code panel works without it."
  fi
}
# Show the glance in interactive terminals only. Silence with: export BUILDPILOT_QUIET=1
case $- in
  *i*)
    if [ -z "$BUILDPILOT_QUIET" ] && [ -t 1 ] && command -v node >/dev/null 2>&1 && [ -f "${cli}" ]; then
      node "${cli}" glance 2>/dev/null
    fi
    ;;
esac
`;
}

export function rcFiles(): string[] {
  const home = os.homedir();
  const out = [path.join(home, ".zshrc")];
  const bashrc = path.join(home, ".bashrc");
  if (fs.existsSync(bashrc) || (process.env.SHELL ?? "").endsWith("bash")) out.push(bashrc);
  return out;
}

function block(home: string): string {
  return `${START}\n[ -f "${path.join(home, "shell.sh")}" ] && . "${path.join(home, "shell.sh")}"\n${END}\n`;
}

/** Copy the CLI (+ its wasm fallback) to a stable location so the shell never points at a versioned folder. */
export function installCliCopy(fromDir: string, home = buildpilotHome()): void {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  for (const f of ["cli.js", "sql-wasm.wasm"]) {
    const src = path.join(fromDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(bin, f));
  }
}

export function shellStatus(files = rcFiles()): { installed: boolean; files: string[] } {
  const withBlock = files.filter((f) => fs.existsSync(f) && fs.readFileSync(f, "utf8").includes(START));
  return { installed: withBlock.length > 0, files: withBlock };
}

export function installShell(cliDir: string, home = buildpilotHome(), files = rcFiles()): { changed: string[]; backups: string[] } {
  installCliCopy(cliDir, home);
  fs.writeFileSync(path.join(home, "shell.sh"), shellScript(home), { mode: 0o644 });
  const changed: string[] = [];
  const backups: string[] = [];
  for (const f of files) {
    const cur = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
    if (cur.includes(START)) continue;
    if (cur) {
      const b = path.join(home, "backups", `${path.basename(f)}.${Date.now()}.bak`);
      fs.mkdirSync(path.dirname(b), { recursive: true, mode: 0o700 });
      fs.copyFileSync(f, b);
      backups.push(b);
    }
    fs.writeFileSync(f, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}\n${block(home)}`);
    changed.push(f);
  }
  return { changed, backups };
}

export function uninstallShell(home = buildpilotHome(), files = rcFiles()): { changed: string[] } {
  const changed: string[] = [];
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const cur = fs.readFileSync(f, "utf8");
    const i = cur.indexOf(START);
    if (i < 0) continue;
    const j = cur.indexOf(END, i);
    if (j < 0) continue;
    let before = cur.slice(0, i);
    const after = cur.slice(j + END.length).replace(/^\n/, "");
    if (before.endsWith("\n\n")) before = before.slice(0, -1);
    fs.writeFileSync(f, before + after);
    changed.push(f);
  }
  fs.rmSync(path.join(home, "shell.sh"), { force: true });
  return { changed };
}
