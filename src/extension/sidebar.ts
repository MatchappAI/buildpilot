import { randomBytes } from "crypto";
import * as vscode from "vscode";

export interface WebviewMessage {
  type: string;
  id?: number;
  [k: string]: unknown;
}

/**
 * Hosts the single BuildPilot page as an editor tab beside the terminal (no sidebar).
 * Strict CSP: only our bundled script/style, no remote content.
 */
export class BuildPilotPanel {
  private panel: vscode.WebviewPanel | null = null;
  private queue: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (m: WebviewMessage) => Promise<unknown>,
    private readonly extraRoots: vscode.Uri[] = [],
    private readonly onOpen: () => void = () => {},
  ) {}

  get visible(): boolean {
    return !!this.panel?.visible;
  }

  get isOpen(): boolean {
    return !!this.panel;
  }

  /** Webview-safe URI for a local file inside an allowed root (e.g. a Visual QA screenshot). */
  toUri(file: string): string | null {
    return this.panel ? this.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() : null;
  }

  show(preserveFocus = false): void {
    if (this.panel) {
      this.panel.reveal(undefined, preserveFocus);
      return;
    }
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    const panel = vscode.window.createWebviewPanel("buildpilot.page", "BuildPilot", { viewColumn: vscode.ViewColumn.Beside, preserveFocus }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media, ...this.extraRoots] });
    this.panel = panel;
    panel.iconPath = vscode.Uri.joinPath(media, "icon.png");
    const nonce = randomBytes(16).toString("base64");
    const w = panel.webview;
    const js = w.asWebviewUri(vscode.Uri.joinPath(media, "webview.js"));
    const css = w.asWebviewUri(vscode.Uri.joinPath(media, "webview.css"));
    w.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource}; style-src ${w.cspSource}; font-src ${w.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${css}"><title>BuildPilot</title></head>
<body><div id="app" aria-label="BuildPilot"><div class="loading">Starting BuildPilot…</div></div>
<script nonce="${nonce}" src="${js}"></script></body></html>`;
    w.onDidReceiveMessage(async (m: WebviewMessage) => {
      let result: unknown;
      let error: string | undefined;
      try {
        result = await this.onMessage(m);
      } catch (e) {
        error = (e as Error).message;
      }
      if (m.id !== undefined) void w.postMessage({ type: "reply", id: m.id, result, error });
    });
    panel.onDidDispose(() => (this.panel = null));
    for (const q of this.queue.splice(0)) void w.postMessage(q);
    this.onOpen();
  }

  post(msg: unknown): void {
    if (this.panel) void this.panel.webview.postMessage(msg);
    else {
      this.queue = this.queue.filter((q) => (q as { type?: string }).type !== (msg as { type?: string }).type);
      this.queue.push(msg);
    }
  }
}
