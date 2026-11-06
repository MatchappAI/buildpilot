import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { IntegrationApi, loadOrCreateToken, rotateToken, sendWebhook } from "../core/api";
import { complete, ProviderConfig, refineRequest } from "../core/ai";
import { pocketLink } from "./pocketLink";
import { installCliCopy, installShell, shellStatus, uninstallShell } from "../core/shell";
import { Alert, Engine, UiState } from "../core/engine";
import { restoreFiles, diffSinceCheckpoint } from "../core/git";
import { claudeSettingsPath, installHooks, installStatusline, uninstallHooks, uninstallStatusline } from "../core/hooks";
import { isLocalUrl } from "../core/checks";
import { GOALS } from "../core/prompts";
import { launchPlan } from "./launch";
import { GoalType } from "../core/types";
import { SidebarProvider, WebviewMessage } from "./sidebar";

let engine: Engine | null = null;
let api: IntegrationApi | null = null;

const cfg = () => vscode.workspace.getConfiguration("buildpilot");

export async function activate(context: vscode.ExtensionContext): Promise<{ engine: () => Engine | null }> {
  const output = vscode.window.createOutputChannel("BuildPilot");
  context.subscriptions.push(output);
  const log = (m: string) => output.appendLine(`[${new Date().toISOString()}] ${m}`);

  const eng = new Engine();
  engine = eng;
  const sidebar = new SidebarProvider(context.extensionUri, () => state(), (m) => handle(m), [vscode.Uri.file(path.join(eng.home, "visual"))]);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("buildpilot.main", sidebar, { webviewOptions: { retainContextWhenHidden: true } }));

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = "buildpilot.focus";
  context.subscriptions.push(status);

  let cached: UiState | null = null;
  let pending: NodeJS.Timeout | null = null;
  const state = (): UiState | null => {
    if (!engine?.store) return null;
    cached = engine.snapshot();
    return cached;
  };
  const push = () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const st = state();
      if (st) {
        sidebar.post({ type: "state", state: st, settings: uiSettings() });
        updateStatus(st);
      }
    }, 150);
  };
  const uiSettings = () => ({
    beginner: cfg().get<boolean>("beginnerMode", true),
    trusted: vscode.workspace.isTrusted,
    aiProvider: cfg().get<string>("ai.provider", "none"),
    aiModel: cfg().get<string>("ai.model", ""),
    apiEnabled: cfg().get<boolean>("integrationApi.enabled", false),
    apiAddress: api?.address ?? null,
    apiAllowLan: cfg().get<boolean>("integrationApi.allowLan", false),
    notifications: cfg().get<string>("notifications", "important"),
    platform: process.platform,
    home: eng.home,
    shellInstalled: shellStatus().installed,
    openWithTerminal: cfg().get<boolean>("openWithTerminal", true),
    pocketUrl: api ? pocketLink(api.address, cfg().get<number>("integrationApi.port", 47821), cfg().get<boolean>("integrationApi.allowLan", false)) : null,
    screenshotUri: (() => {
      const shot = cached?.visual?.screenshot;
      return shot && fs.existsSync(shot) ? sidebar.toUri(shot) : null;
    })(),
  });

  const updateStatus = (st: UiState) => {
    if (!st.project) {
      status.hide();
      return;
    }
    const live = st.out.sessions.filter((s) => !s.endedAt && st.generatedAt - s.lastEventAt < 3600_000);
    const waiting = live.filter((s) => s.displayStatus === "awaiting_approval" || s.displayStatus === "blocked").length;
    const running = live.filter((s) => s.displayStatus === "running").length;
    const icon = waiting ? "$(bell-dot)" : st.out.health.level === "blocked" ? "$(error)" : st.out.health.level === "attention" ? "$(warning)" : "$(pulse)";
    status.text = `${icon} BuildPilot${running ? ` · ${running} working` : ""}${waiting ? ` · ${waiting} waiting` : ""}`;
    status.tooltip = `${st.out.health.label}${st.out.next ? `\nNext: ${st.out.next.title}` : ""}`;
    status.show();
  };

  try {
    await eng.start();
    log(`Engine started. Data: ${eng.home}`);
  } catch (e) {
    log(`Engine failed to start: ${(e as Error).message}`);
    void vscode.window.showErrorMessage(`BuildPilot couldn't start: ${(e as Error).message}`);
  }
  eng.on("changed", push);
  eng.on("alert", (a: Alert) => void onAlert(a));
  context.subscriptions.push({ dispose: () => eng.stop() });

  const onAlert = async (a: Alert) => {
    log(`alert: ${a.title} - ${a.message}`);
    const mode = cfg().get<string>("notifications", "important");
    if (mode !== "off" && a.level !== "info") {
      const fn = a.level === "error" ? vscode.window.showErrorMessage : vscode.window.showWarningMessage;
      void fn(`BuildPilot: ${a.title}`, "Show").then((c) => c && vscode.commands.executeCommand("buildpilot.focus"));
    }
    const hook = await context.secrets.get("buildpilot.webhookUrl");
    if (hook) {
      try {
        await sendWebhook(hook, a, eng.currentProject?.name ?? "project");
      } catch (e) {
        log(`webhook failed: ${(e as Error).message}`);
      }
    }
  };

  const openWorkspaceProject = async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length || !eng.store) return push();
    const remembered = context.workspaceState.get<string>("buildpilot.projectRoot");
    const root = remembered && folders.some((f) => remembered.startsWith(f.uri.fsPath)) && fs.existsSync(remembered) ? remembered : folders[0]!.uri.fsPath;
    try {
      await eng.openProject(root);
    } catch (e) {
      log(`open project failed: ${(e as Error).message}`);
    }
    push();
  };

  // ---------- integration API ----------
  const startApi = async () => {
    await api?.stop();
    api = null;
    if (!cfg().get<boolean>("integrationApi.enabled", false)) return push();
    const token = loadOrCreateToken(eng.home);
    const host = cfg().get<boolean>("integrationApi.allowLan", false) ? "0.0.0.0" : "127.0.0.1";
    const port = cfg().get<number>("integrationApi.port", 47821);
    const next = new IntegrationApi(eng, { port, host, token });
    try {
      await next.start();
      api = next;
      log(`Integration API listening on ${host}:${port}`);
    } catch (e) {
      void vscode.window.showErrorMessage(`BuildPilot Integration API couldn't start on port ${port}: ${(e as Error).message}`);
    }
    push();
  };
  context.subscriptions.push({ dispose: () => void api?.stop() });

  // ---------- actions ----------
  const confirm = async (message: string, detail: string, ok: string): Promise<boolean> =>
    (await vscode.window.showWarningMessage(message, { modal: true, detail }, ok)) === ok;

  const requireTrust = (what: string): boolean => {
    if (vscode.workspace.isTrusted) return true;
    void vscode.window.showWarningMessage(`BuildPilot won't ${what} in a Restricted Mode workspace. Trust the folder first.`, "Manage Workspace Trust").then((c) => c && vscode.commands.executeCommand("workbench.trust.manage"));
    return false;
  };

  const providerConfig = async (): Promise<ProviderConfig> => {
    const kind = cfg().get<string>("ai.provider", "none") as ProviderConfig["kind"];
    const model = cfg().get<string>("ai.model", "") || (kind === "anthropic" ? "claude-sonnet-5-5" : "qwen2.5:7b");
    return { kind, model, apiKey: kind === "anthropic" ? await context.secrets.get("buildpilot.anthropicKey") : undefined, baseUrl: cfg().get<string>("ai.ollamaUrl", "http://127.0.0.1:11434") };
  };

  const sendToClaude = async (prompt: string) => {
    const root = eng.currentProject?.root;
    if (!root) return;
    if (!requireTrust("start Claude Code")) return;
    const preview = prompt.length > 400 ? prompt.slice(0, 400) + "…" : prompt;
    if (!(await confirm("Start a new Claude Code session with this prompt?", `Opens a terminal in ${root} and runs \`claude\` with your prompt. Claude Code will still ask before risky actions.\n\n${preview}`, "Start Claude Code"))) return;
    const dir = path.join(eng.home, "prompts");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `prompt-${Date.now()}.md`);
    fs.writeFileSync(file, prompt, { mode: 0o600 });
    const term = vscode.window.createTerminal({ name: "Claude · BuildPilot", cwd: root });
    term.show();
    const plan = launchPlan(file, process.platform, vscode.env.shell || "");
    if (plan.kind === "paste") {
      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage("Claude Code is starting. The prompt is on your clipboard: paste it with Ctrl+V.");
    }
    term.sendText(plan.text);
    eng.store.run("INSERT INTO approvals (project_id, action, detail, approved_at) VALUES (?, 'start_claude', ?, ?)", [eng.currentProject!.id, prompt.slice(0, 300), Date.now()]);
  };

  async function handle(m: WebviewMessage): Promise<unknown> {
    const st = cached ?? state();
    switch (m.type) {
      case "ready":
        push();
        return;
      case "goals":
        return GOALS;
      case "analyze":
        await eng.analyze();
        return;
      case "selectProject":
        return vscode.commands.executeCommand("buildpilot.selectProject");
      case "installHooks":
        return vscode.commands.executeCommand("buildpilot.installHooks");
      case "uninstallHooks":
        return vscode.commands.executeCommand("buildpilot.uninstallHooks");
      case "runScript": {
        const name = String(m.script);
        if (!requireTrust("run project scripts")) return;
        const pm = st?.facts?.packageManager ?? "npm";
        const cmd = name === "install" ? `${pm} install` : `${pm} run ${name}`;
        const body = name === "install" ? "Downloads and installs the libraries listed in package.json." : `Runs: ${st?.facts?.scripts[name] ?? "(script)"}`;
        if (!(await confirm(`Run \`${cmd}\`?`, `${body}\n\nIt runs in ${eng.currentProject?.root} with a time limit. The result is saved as evidence.`, "Run"))) return;
        try {
          const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `BuildPilot: ${cmd}` }, () => eng.runScript(name));
          void vscode.window.showInformationMessage(`${cmd} ${r.passed ? "passed ✓" : `failed (exit ${r.exitCode})`}`);
        } catch (e) {
          void vscode.window.showErrorMessage((e as Error).message);
        }
        return;
      }
      case "checkpoint": {
        if (!st?.facts?.isGit) return void vscode.window.showWarningMessage("Checkpoints need Git. Ask Prompt Studio to set up Git first.");
        if (!(await confirm("Save a checkpoint?", "Saves a snapshot of every file (including uncommitted and new files) as a private Git ref. Your branch, staging area and files are NOT changed.", "Save checkpoint"))) return;
        const label = await vscode.window.showInputBox({ prompt: "Checkpoint name (optional). Press Escape to cancel.", value: "before next change" });
        if (label === undefined) return;
        try {
          const cp = await eng.checkpoint(label.trim() || "checkpoint");
          void vscode.window.showInformationMessage(`Checkpoint saved (${cp.sha.slice(0, 8)}).`);
        } catch (e) {
          void vscode.window.showErrorMessage(`Checkpoint failed: ${(e as Error).message}`);
        }
        return;
      }
      case "checkpointDiff": {
        const root = eng.currentProject?.root;
        if (!root) return [];
        return diffSinceCheckpoint(root, String(m.sha));
      }
      case "rollback": {
        const root = eng.currentProject?.root;
        const files = (m.files as string[]) ?? [];
        if (!root || files.length === 0) return;
        if (!requireTrust("change files")) return;
        if (!(await confirm(`Restore ${files.length === 1 ? "1 file" : `${files.length} files`} to the checkpoint?`, `${files.slice(0, 15).join("\n")}${files.length > 15 ? "\n…" : ""}\n\nThe current versions are saved in a new checkpoint first, so this can be undone. Other files are not touched.`, "Restore files"))) return;
        try {
          const r = await restoreFiles(root, String(m.sha), files);
          void vscode.window.showInformationMessage(`Restored ${r.restored.length === 1 ? "1 file" : `${r.restored.length} files`}. Safety checkpoint ${r.safety.sha.slice(0, 8)} saved.`);
          await eng.analyze();
        } catch (e) {
          void vscode.window.showErrorMessage(`Restore failed: ${(e as Error).message}`);
        }
        return;
      }
      case "buildPrompt":
        return eng.prompt({ goal: m.goal as GoalType, request: String(m.request ?? ""), mustNotChange: String(m.mustNotChange ?? ""), extraAcceptance: String(m.acceptance ?? "").split("\n"), beginner: !!m.beginner, planFirst: m.planFirst as boolean | undefined });
      case "copy":
        await vscode.env.clipboard.writeText(String(m.text));
        void vscode.window.setStatusBarMessage("$(check) Copied", 2000);
        return;
      case "sendToClaude":
        return sendToClaude(String(m.text));
      case "refine": {
        const pc = await providerConfig();
        if (pc.kind === "none") {
          const c = await vscode.window.showInformationMessage("AI refinement needs a provider (your Anthropic API key or a local Ollama model). BuildPilot's prompts work without it.", "Open Settings");
          if (c) void vscode.commands.executeCommand("workbench.action.openSettings", "buildpilot.ai");
          return null;
        }
        const text = String(m.text);
        const where = pc.kind === "anthropic" ? "Anthropic's API (billed to your API key)" : `your local Ollama at ${pc.baseUrl}`;
        if (!(await confirm(`Send this prompt to ${where}?`, `Only the prompt text shown in Prompt Studio (${text.length} characters) is sent: no source files. Model: ${pc.model}.`, "Send"))) return null;
        try {
          const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "BuildPilot: refining prompt…" }, () => complete(pc, refineRequest(text)));
          log(`AI refine: ${r.provider}/${r.model} in=${r.inputTokens ?? "?"} out=${r.outputTokens ?? "?"}`);
          return { text: r.text, usage: { input: r.inputTokens, output: r.outputTokens, model: r.model } };
        } catch (e) {
          void vscode.window.showErrorMessage((e as Error).message);
          return null;
        }
      }
      case "openFile": {
        const root = eng.currentProject?.root;
        if (!root) return;
        const [file, line] = String(m.path).split(/:(?=\d+$)/);
        const abs = path.isAbsolute(file!) ? file! : path.join(root, file!);
        try {
          const doc = await vscode.workspace.openTextDocument(abs);
          const ln = Math.max(0, Number(line ?? 1) - 1);
          await vscode.window.showTextDocument(doc, { selection: new vscode.Range(ln, 0, ln, 0), preview: true });
        } catch {
          void vscode.window.showWarningMessage(`Can't open ${abs}`);
        }
        return;
      }
      case "addRequirement":
        eng.addRequirement(String(m.title), String(m.acceptance ?? ""));
        return;
      case "updateRequirement":
        eng.updateRequirement(String(m.id), m.patch as never);
        return;
      case "deleteRequirement":
        eng.deleteRequirement(String(m.id));
        return;
      case "importChecklist": {
        const n = eng.importChecklist();
        void vscode.window.showInformationMessage(n ? `Imported ${n === 1 ? "1 requirement" : `${n} requirements`} from your docs. Items checked in docs count as unverified until tests pass.` : "No new checklist items found in your docs.");
        return;
      }
      case "addDecision":
        eng.addDecision(String(m.title), String(m.detail ?? ""));
        return;
      case "deleteDecision":
        eng.deleteDecision(Number(m.id));
        return;
      case "setNote":
        eng.setNote(String(m.key), String(m.value));
        return;
      case "dismiss":
        eng.dismiss(String(m.key), 24);
        return;
      case "handoff":
        return eng.handoff();
      case "saveHandoff": {
        const root = eng.currentProject?.root;
        if (!root || !requireTrust("write files")) return;
        const file = path.join(root, ".buildpilot", "HANDOFF.md");
        if (!(await confirm("Save the handoff into your project?", `Writes ${path.relative(root, file)} (BuildPilot's own file; your docs aren't touched). Add .buildpilot/ to .gitignore if you don't want it committed.`, "Save"))) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, eng.handoff());
        await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
        return;
      }
      case "claudeMd": {
        const draft = eng.claudeMdDraft();
        if (!draft) return;
        // Never overwrite: open as an unsaved document for the user to review and save.
        const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: draft });
        await vscode.window.showTextDocument(doc);
        void vscode.window.showInformationMessage(st?.facts?.hasClaudeMd ? "Draft opened. You already have a CLAUDE.md, so copy anything useful into it." : "Draft opened. Review it, then save it as CLAUDE.md in your project root.");
        return;
      }
      case "settings":
        return vscode.commands.executeCommand("workbench.action.openSettings", "buildpilot");
      case "setBeginner":
        await cfg().update("beginnerMode", !!m.value, vscode.ConfigurationTarget.Global);
        return;
      case "demo":
        return vscode.commands.executeCommand(m.on ? "buildpilot.loadDemo" : "buildpilot.clearDemo");
      case "deleteProjectData":
        return vscode.commands.executeCommand("buildpilot.deleteProjectData");
      case "deleteAllData":
        return vscode.commands.executeCommand("buildpilot.deleteAllData");
      case "apiToggle":
        await cfg().update("integrationApi.enabled", !!m.value, vscode.ConfigurationTarget.Global);
        return;
      case "copyApiToken":
        await vscode.env.clipboard.writeText(loadOrCreateToken(eng.home));
        void vscode.window.showInformationMessage("Integration token copied. Treat it like a password.");
        return;
      case "rotateApiToken":
        rotateToken(eng.home);
        await startApi();
        void vscode.window.showInformationMessage("New integration token created. Old one no longer works.");
        return;
      case "setWebhook":
        return vscode.commands.executeCommand("buildpilot.setWebhook");
      case "testWebhook": {
        const hook = await context.secrets.get("buildpilot.webhookUrl");
        if (!hook) return void vscode.window.showInformationMessage("No notification URL set.");
        try {
          await sendWebhook(hook, { key: "test", level: "info", title: "Test from BuildPilot", message: eng.brief() }, eng.currentProject?.name ?? "project");
          void vscode.window.showInformationMessage("Test notification sent.");
        } catch (e) {
          void vscode.window.showErrorMessage(`Notification failed: ${(e as Error).message}`);
        }
        return;
      }
      case "hasWebhook":
        return !!(await context.secrets.get("buildpilot.webhookUrl"));
      case "audit": {
        if (!requireTrust("run a dependency audit")) return;
        const tool = st?.facts?.languages.includes("Python") && !st.facts.lockfiles.includes("package-lock.json") ? "pip-audit" : "npm audit --json";
        if (!(await confirm(`Check dependencies for known vulnerabilities?`, `Runs \`${tool}\` in ${eng.currentProject?.root}. It sends your dependency list (names and versions, not your code) to the public registry's advisory service.`, "Run audit"))) return;
        try {
          const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "BuildPilot: checking dependencies…" }, () => eng.audit());
          void vscode.window.showInformationMessage(r.ok ? `Audit done: ${r.counts.critical} critical, ${r.counts.high} high, ${r.counts.moderate} moderate.` : `Audit couldn't run: ${r.error}`);
        } catch (e) {
          void vscode.window.showErrorMessage((e as Error).message);
        }
        return;
      }
      case "visualCheck": {
        const url = String(m.url ?? st?.appUrl.url ?? "").trim();
        if (!url || !isLocalUrl(url)) return void vscode.window.showWarningMessage("Enter your app's local address, e.g. http://localhost:3000");
        await cfg().update("visualQa.url", url, vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global).then(undefined, () => undefined);
        try {
          const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `BuildPilot: opening ${url}…` }, () => eng.visualCheck(url));
          void vscode.window.showInformationMessage(`Visual check: ${r.note}`);
        } catch (e) {
          void vscode.window.showErrorMessage((e as Error).message);
        }
        return;
      }
      case "startApp": {
        const script = st?.facts?.scripts.dev ? "dev" : st?.facts?.scripts.start ? "start" : null;
        if (!script) return void vscode.window.showWarningMessage("No dev or start script found in package.json.");
        if (!requireTrust("start your app")) return;
        const pm = st?.facts?.packageManager ?? "npm";
        if (!(await confirm(`Start your app with \`${pm} run ${script}\`?`, "Opens a visible terminal so you can see and stop it (Ctrl+C). BuildPilot then checks the page when it's up.", "Start app"))) return;
        const term = vscode.window.createTerminal({ name: "App · BuildPilot", cwd: eng.currentProject?.root });
        term.show(true);
        term.sendText(`${pm} run ${script}`);
        const url = st?.appUrl.url;
        if (!url) return;
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            await fetch(url, { signal: AbortSignal.timeout(1500) });
            await eng.visualCheck(url);
            void vscode.window.showInformationMessage(`App is up at ${url}. Visual check saved.`);
            return;
          } catch {
            /* not up yet */
          }
        }
        void vscode.window.showWarningMessage(`The app didn't answer at ${url} within 90 s. Check the terminal, or set the right address.`);
        return;
      }
      case "openScreenshot": {
        const shot = st?.visual?.screenshot;
        if (shot) await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(shot));
        return;
      }
      case "worktree": {
        if (!requireTrust("create a worktree")) return;
        const sid = String(m.sessionId ?? "");
        if (!(await confirm("Give one session its own copy of the code?", "Creates a Git worktree, a separate folder on a new branch next to your project, and opens a terminal there. Your current folder, branch and files are not changed. Then stop the overlapping session and continue it in the new terminal with the handoff prompt.", "Create worktree"))) return;
        try {
          const label = await vscode.window.showInputBox({ prompt: "Short name for this line of work. Press Escape to cancel.", value: sid.startsWith("demo-") ? "demo" : "parallel" });
          if (label === undefined) return;
          const w = await eng.createWorktree(label.trim() || "parallel");
          const term = vscode.window.createTerminal({ name: `Worktree · ${path.basename(w.dir)}`, cwd: w.dir });
          term.show();
          await vscode.env.clipboard.writeText(eng.prompt({ goal: "handoff", request: "Continue where the previous session left off, in this separate worktree." }).text);
          void vscode.window.showInformationMessage(`Worktree ready on branch ${w.branch}. A handoff prompt is on your clipboard: run \`claude\` in the new terminal and paste it.`);
        } catch (e) {
          void vscode.window.showErrorMessage(`Worktree failed: ${(e as Error).message}`);
        }
        return;
      }
      case "explainSession": {
        const pc = await providerConfig();
        if (pc.kind === "none") {
          const c = await vscode.window.showInformationMessage("AI explanations need a provider (your Anthropic API key or a local Ollama model).", "Open Settings");
          if (c) void vscode.commands.executeCommand("workbench.action.openSettings", "buildpilot.ai");
          return null;
        }
        const digest = eng.sessionDigest(String(m.sessionId));
        const where = pc.kind === "anthropic" ? "Anthropic's API (billed to your API key)" : `your local Ollama at ${pc.baseUrl}`;
        if (!(await confirm(`Send this session's activity log to ${where}?`, `Sends the redacted event list BuildPilot recorded (${digest.length} characters: tool names, commands, file names, error messages). No file contents. Model: ${pc.model}.`, "Explain"))) return null;
        try {
          const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "BuildPilot: explaining session…" }, () =>
            complete(pc, ["In 5 short bullets for a non-engineer: what was this Claude Code session trying to do, what happened, what went wrong (if anything), and the single best next step. Say when you're unsure.", "<project_data>", digest, "</project_data>"].join("\n")),
          );
          return r.text;
        } catch (e) {
          void vscode.window.showErrorMessage((e as Error).message);
          return null;
        }
      }
      case "shell":
        return vscode.commands.executeCommand(m.on ? "buildpilot.installShell" : "buildpilot.uninstallShell");
      case "openWithTerminal":
        await cfg().update("openWithTerminal", !!m.value, vscode.ConfigurationTarget.Global);
        return;
      case "statusline":
        return vscode.commands.executeCommand(m.on ? "buildpilot.installStatusline" : "buildpilot.uninstallStatusline");
      case "copyPocketLink": {
        const s2 = uiSettings();
        if (!s2.pocketUrl) return;
        const ok = await confirm("Copy a Pocket link that includes your token?", "Anyone with this link (on a network that can reach your computer) can read your BuildPilot status. Send it only to your own phone. You can make a new token anytime.", "Copy link");
        if (!ok) return;
        await vscode.env.clipboard.writeText(`${s2.pocketUrl}#t=${loadOrCreateToken(eng.home)}`);
        void vscode.window.showInformationMessage("Pocket link copied. Open it on your phone.");
        return;
      }
    }
    return undefined;
  }

  // ---------- commands ----------
  const reg = (id: string, fn: (...a: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("buildpilot.focus", () => vscode.commands.executeCommand("buildpilot.main.focus"));
  reg("buildpilot.refresh", () => eng.analyze());
  reg("buildpilot.selectProject", async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const items: (vscode.QuickPickItem & { root?: string })[] = folders.map((f) => ({ label: f.name, description: f.uri.fsPath, root: f.uri.fsPath }));
    items.push({ label: "$(folder-opened) Choose another folder…" });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Which project should BuildPilot supervise?" });
    if (!pick) return;
    let root = pick.root;
    if (!root) {
      const uri = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: "Supervise this project" });
      root = uri?.[0]?.fsPath;
    }
    if (!root) return;
    await context.workspaceState.update("buildpilot.projectRoot", root);
    await eng.openProject(root);
  });
  reg("buildpilot.installHooks", async () => {
    const scope = await vscode.window.showQuickPick(
      [
        { label: "All my projects", description: "Recommended", detail: `Adds BuildPilot hooks to ${claudeSettingsPath("user")}`, scope: "user" as const },
        { label: "Only this project", detail: "Adds them to .claude/settings.local.json in this project (not committed)", scope: "project" as const },
      ],
      { placeHolder: "Where should BuildPilot watch Claude Code sessions?" },
    );
    if (!scope) return;
    if (scope.scope === "project" && !eng.currentProject) return void vscode.window.showWarningMessage("Open a project first.");
    const file = claudeSettingsPath(scope.scope, eng.currentProject?.root);
    const ok = await confirm(
      "Connect BuildPilot to Claude Code?",
      `BuildPilot will add small background hooks to:\n${file}\n\nWhat they do: copy each Claude Code event (prompts, tool calls, errors) to a private folder on this computer (${eng.home}/spool). Nothing leaves your machine. They run in the background and never slow down or change Claude Code.\n\nYour existing settings are kept, a backup is saved first, and "Disconnect" removes them. Open Claude Code sessions pick them up on their next action (verified with Claude Code 2.1.318); restart one if it doesn't appear.`,
      "Connect",
    );
    if (!ok) return;
    try {
      const r = installHooks(file, eng.home);
      eng.setClaudeSettingsFile(file);
      void vscode.window.showInformationMessage(r.changed ? `Connected. Claude Code sessions will appear as soon as they do something.${r.backup ? " Backup saved." : ""}` : "Already connected.", "Also show context %").then((c) => c && vscode.commands.executeCommand("buildpilot.installStatusline"));
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
    }
    push();
  });
  reg("buildpilot.installStatusline", async () => {
    const file = claudeSettingsPath("user");
    const ok = await confirm(
      "Show exact context and limits from Claude Code?",
      `Claude Code passes context-window %, estimated cost and rate-limit % to its status line. BuildPilot installs a small status-line script in ${file} that saves those numbers locally.\n\nIf you already have a status line, it keeps running and still shows exactly as before (BuildPilot chains it). A backup is saved, and "Remove" restores your original.`,
      "Turn on",
    );
    if (!ok) return;
    try {
      const r = installStatusline(file, eng.home);
      void vscode.window.showInformationMessage(r.changed ? `Done.${r.chained ? " Your existing status line is preserved." : ""} New or resumed Claude Code sessions will report context %.` : "Already on.");
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
    }
    push();
  });
  reg("buildpilot.uninstallStatusline", async () => {
    try {
      const r = uninstallStatusline(claudeSettingsPath("user"), eng.home);
      void vscode.window.showInformationMessage(r.changed ? "Status line restored to what you had before." : "Nothing to remove.");
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
    }
    push();
  });
  reg("buildpilot.uninstallHooks", async () => {
    const files = [claudeSettingsPath("user"), ...(eng.currentProject ? [claudeSettingsPath("project", eng.currentProject.root)] : [])];
    if (!(await confirm("Disconnect BuildPilot from Claude Code?", `Removes only BuildPilot's hooks (and its status line, restoring yours) from:\n${files.join("\n")}\nEverything else in those files stays. A backup is saved first.`, "Disconnect"))) return;
    try {
      uninstallStatusline(claudeSettingsPath("user"), eng.home);
    } catch {
      /* reported below if the file is broken */
    }
    let removed = false;
    for (const f of files) {
      try {
        if (fs.existsSync(f) && uninstallHooks(f, eng.home).changed) removed = true;
      } catch (e) {
        void vscode.window.showErrorMessage((e as Error).message);
      }
    }
    void vscode.window.showInformationMessage(removed ? "Disconnected. Your other Claude Code settings are unchanged." : "BuildPilot wasn't connected, so nothing changed.");
    push();
  });
  reg("buildpilot.newPrompt", () => {
    void vscode.commands.executeCommand("buildpilot.main.focus");
    sidebar.post({ type: "navigate", tab: "prompts" });
  });
  reg("buildpilot.copyHandoff", async () => {
    await vscode.env.clipboard.writeText(eng.handoff());
    void vscode.window.showInformationMessage("Handoff copied. Paste it into a new Claude Code session.");
  });
  reg("buildpilot.checkpoint", () => handle({ type: "checkpoint" }));
  reg("buildpilot.runTests", () => handle({ type: "runScript", script: "test" }));
  reg("buildpilot.audit", () => handle({ type: "audit" }));
  reg("buildpilot.visualCheck", () => handle({ type: "visualCheck" }));
  reg("buildpilot.loadDemo", () => {
    try {
      eng.loadDemo();
      void vscode.window.showInformationMessage("Demo sessions loaded. They're labelled DEMO and never trigger notifications. Remove them anytime.");
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
    }
  });
  reg("buildpilot.clearDemo", () => eng.clearDemo());
  reg("buildpilot.setAnthropicKey", async () => {
    const key = await vscode.window.showInputBox({ prompt: "Anthropic API key (stored in VS Code's secure storage, used only when you click Refine)", password: true, ignoreFocusOut: true });
    if (key === undefined) return;
    if (key.trim() === "") await context.secrets.delete("buildpilot.anthropicKey");
    else await context.secrets.store("buildpilot.anthropicKey", key.trim());
    void vscode.window.showInformationMessage(key.trim() ? "API key saved." : "API key removed.");
  });
  reg("buildpilot.setWebhook", async () => {
    const url = await vscode.window.showInputBox({
      prompt: "Notification URL for phone, glasses, Slack or Discord (https). Leave empty to turn off.",
      placeHolder: "https://ntfy.sh/your-private-topic  ·  https://hooks.slack.com/…",
      ignoreFocusOut: true,
    });
    if (url === undefined) return;
    if (!url.trim()) {
      await context.secrets.delete("buildpilot.webhookUrl");
      void vscode.window.showInformationMessage("Outside notifications turned off.");
    } else {
      try {
        const u = new URL(url.trim());
        if (u.protocol !== "https:") throw new Error("must be https");
      } catch (e) {
        return void vscode.window.showErrorMessage(`Invalid URL: ${(e as Error).message}`);
      }
      const ok = await confirm("Send BuildPilot alerts to this URL?", `Only short alerts (e.g. "Claude needs your approval", "Tests failing") and your project name are sent: never code. You can turn it off anytime.\n\n${url.trim()}`, "Turn on");
      if (!ok) return;
      await context.secrets.store("buildpilot.webhookUrl", url.trim());
      void vscode.window.showInformationMessage("Notifications on. Use 'Send test' to check.");
    }
    push();
  });
  reg("buildpilot.deleteProjectData", async () => {
    const p = eng.currentProject;
    if (!p) return;
    if (!(await confirm(`Delete BuildPilot's data for ${p.name}?`, "Removes session history, requirements, decisions, notes and test results BuildPilot stored for this project. Your project files and Git history are not touched.", "Delete"))) return;
    eng.store.deleteProjectData(p.id);
    eng.store.flush();
    push();
  });
  reg("buildpilot.deleteAllData", async () => {
    if (!(await confirm("Delete ALL BuildPilot data?", `Clears everything in ${eng.home}/buildpilot.db for all projects. Hooks stay connected unless you disconnect them.`, "Delete everything"))) return;
    eng.store.deleteAll();
    eng.store.flush();
    await eng.openProject(eng.currentProject?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? eng.home).catch(() => undefined);
    push();
  });
  reg("buildpilot.showBrief", () => vscode.window.showInformationMessage(eng.brief()));
  reg("buildpilot.installShell", async () => {
    const ok = await confirm(
      "Show BuildPilot in every terminal?",
      "Adds a 3-line block to your ~/.zshrc (and ~/.bashrc if you use bash). Every new terminal then shows a short BuildPilot summary (Claude sessions, what needs you, limits, next step) and you get the `bp` command. A backup is saved first. Silence it anytime with `export BUILDPILOT_QUIET=1`, or remove it here.",
      "Turn on",
    );
    if (!ok) return;
    try {
      const r = installShell(path.join(context.extensionPath, "dist"), eng.home);
      void vscode.window.showInformationMessage(r.changed.length ? "Done. Open a new terminal to see BuildPilot. Type `bp` for details." : "Already on.");
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
    }
    push();
  });
  reg("buildpilot.uninstallShell", () => {
    const r = uninstallShell(eng.home);
    void vscode.window.showInformationMessage(r.changed.length ? "Removed from your terminal startup files." : "Nothing to remove.");
    push();
  });
  // Keep the terminal CLI current after upgrades.
  try {
    if (shellStatus().installed) installCliCopy(path.join(context.extensionPath, "dist"), eng.home);
  } catch {
    /* non-fatal */
  }
  // `bp open` → vscode://buildpilot-local.buildpilot/open?folder=...
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        const folder = new URLSearchParams(uri.query).get("folder");
        const inWorkspace = !folder || (vscode.workspace.workspaceFolders ?? []).some((f) => folder === f.uri.fsPath || folder.startsWith(f.uri.fsPath + path.sep));
        if (folder && !inWorkspace && fs.existsSync(folder)) {
          await context.globalState.update("buildpilot.focusOnStart", Date.now());
          await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folder), { forceNewWindow: true });
          return;
        }
        if (folder && eng.currentProject?.root !== folder && fs.existsSync(folder)) await eng.openProject(folder);
        await vscode.commands.executeCommand("buildpilot.main.focus");
      },
    }),
  );
  const focusRequested = context.globalState.get<number>("buildpilot.focusOnStart");
  if (focusRequested && Date.now() - focusRequested < 120_000) {
    void context.globalState.update("buildpilot.focusOnStart", undefined);
    setTimeout(() => void vscode.commands.executeCommand("buildpilot.main.focus"), 800);
  }
  // Open BuildPilot alongside every new terminal (without stealing focus from the terminal).
  const revealBeside = async (term?: vscode.Terminal) => {
    if (!cfg().get<boolean>("openWithTerminal", true) || sidebar.visible) return;
    await vscode.commands.executeCommand("workbench.view.extension.buildpilot");
    if (term) term.show(false);
  };
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => {
      if (t.name.includes("BuildPilot")) return; // our own terminals already have context
      void revealBeside(t);
    }),
  );
  // Also when a NEW Claude Code session starts in this project.
  let knownSessions = new Set<string>();
  eng.on("changed", () => {
    if (!eng.currentProject || !eng.store) return;
    const ids = eng.sessionsForProject(eng.currentProject.id, 10).filter((s) => !s.endedAt && Date.now() - s.startedAt < 60_000).map((s) => s.id);
    const fresh = ids.filter((id) => !knownSessions.has(id) && !id.startsWith("demo-"));
    knownSessions = new Set([...knownSessions, ...ids]);
    if (fresh.length) void revealBeside(vscode.window.activeTerminal);
  });
  reg("buildpilot.walkthrough", () => vscode.commands.executeCommand("workbench.action.openWalkthrough", "buildpilot-local.buildpilot#buildpilot.start", false));
  // First run: open the walkthrough once.
  if (!context.globalState.get<boolean>("buildpilot.welcomed")) {
    void context.globalState.update("buildpilot.welcomed", true);
    setTimeout(() => void vscode.commands.executeCommand("buildpilot.walkthrough"), 1500);
  }

  // ---------- lifecycle ----------
  const applyUrlSetting = () => (eng.appUrlOverride = cfg().get<string>("visualQa.url", ""));
  applyUrlSetting();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("buildpilot.visualQa") && applyUrlSetting()));
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => void openWorkspaceProject()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => push()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("buildpilot.integrationApi")) void startApi();
      if (e.affectsConfiguration("buildpilot")) push();
    }),
  );
  let saveTimer: NodeJS.Timeout | null = null;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void eng.refreshGit(), 1500);
    }),
  );
  // Re-derive time-based statuses (e.g. "no activity for 10 min") without new events.
  const tick = setInterval(push, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(tick) });

  if (eng.store) {
    await openWorkspaceProject();
    await startApi();
  }
  return { engine: () => engine };
}

export function deactivate(): void {
  void api?.stop();
  engine?.stop();
  engine = null;
}
