import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { IntegrationApi, loadOrCreateToken, rotateToken, sendWebhook } from "../core/api";
import { complete, ProviderConfig, refineRequest } from "../core/ai";
import { Alert, Engine, UiState } from "../core/engine";
import { restoreFiles, diffSinceCheckpoint } from "../core/git";
import { claudeSettingsPath, installHooks, uninstallHooks } from "../core/hooks";
import { GOALS, shellQuote } from "../core/prompts";
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
  const sidebar = new SidebarProvider(context.extensionUri, () => state(), (m) => handle(m));
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
    const isWin = process.platform === "win32";
    const shell = (vscode.env.shell || "").toLowerCase();
    if (isWin && (shell.includes("powershell") || shell.includes("pwsh"))) term.sendText(`claude (Get-Content -Raw '${file.replace(/'/g, "''")}')`);
    else if (isWin && !shell.includes("bash")) {
      // cmd.exe can't safely pass a multi-line argument: start Claude and let the user paste.
      await vscode.env.clipboard.writeText(prompt);
      term.sendText("claude");
      void vscode.window.showInformationMessage("Claude Code is starting. The prompt is on your clipboard: paste it with Ctrl+V.");
    } else term.sendText(`claude "$(cat ${shellQuote(file)})"`);
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
        const label = (await vscode.window.showInputBox({ prompt: "Checkpoint name (optional)", value: "before next change" })) ?? "checkpoint";
        try {
          const cp = await eng.checkpoint(label);
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
        if (!(await confirm(`Restore ${files.length} file(s) to the checkpoint?`, `${files.slice(0, 15).join("\n")}${files.length > 15 ? "\n…" : ""}\n\nThe current versions are saved in a new checkpoint first, so this can be undone. Other files are not touched.`, "Restore files"))) return;
        try {
          const r = await restoreFiles(root, String(m.sha), files);
          void vscode.window.showInformationMessage(`Restored ${r.restored.length} file(s). Safety checkpoint ${r.safety.sha.slice(0, 8)} saved.`);
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
        void vscode.window.showInformationMessage(n ? `Imported ${n} requirement(s) from your docs. Items checked in docs count as unverified until tests pass.` : "No new checklist items found in your docs.");
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
      `BuildPilot will add small background hooks to:\n${file}\n\nWhat they do: copy each Claude Code event (prompts, tool calls, errors) to a private folder on this computer (${eng.home}/spool). Nothing leaves your machine. They run in the background and never slow down or change Claude Code.\n\nYour existing settings are kept, a backup is saved first, and "Disconnect" removes them. Already-running Claude sessions pick them up after a restart.`,
      "Connect",
    );
    if (!ok) return;
    try {
      const r = installHooks(file, eng.home);
      eng.setClaudeSettingsFile(file);
      void vscode.window.showInformationMessage(r.changed ? `Connected. Start (or restart) Claude Code to see live sessions.${r.backup ? " Backup saved." : ""}` : "Already connected.");
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
    }
    push();
  });
  reg("buildpilot.uninstallHooks", async () => {
    const files = [claudeSettingsPath("user"), ...(eng.currentProject ? [claudeSettingsPath("project", eng.currentProject.root)] : [])];
    if (!(await confirm("Disconnect BuildPilot from Claude Code?", `Removes only BuildPilot's hooks from:\n${files.join("\n")}\nEverything else in those files stays. A backup is saved first.`, "Disconnect"))) return;
    for (const f of files) {
      try {
        if (fs.existsSync(f)) uninstallHooks(f, eng.home);
      } catch (e) {
        void vscode.window.showErrorMessage((e as Error).message);
      }
    }
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

  // ---------- lifecycle ----------
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
