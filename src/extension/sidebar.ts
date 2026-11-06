import { randomBytes } from "crypto";
import * as vscode from "vscode";

export interface WebviewMessage {
  type: string;
  id?: number;
  [k: string]: unknown;
}

/** Hosts the single BuildPilot webview. Strict CSP: only our bundled script/style, no remote content. */
export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private queue: unknown[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly _getState: () => unknown,
    private readonly onMessage: (m: WebviewMessage) => Promise<unknown>,
    private readonly extraRoots: vscode.Uri[] = [],
  ) {}

  /** Webview-safe URI for a local file inside an allowed root (e.g. a Visual QA screenshot). */
  get visible(): boolean {
    return !!this.view?.visible;
  }

  toUri(file: string): string | null {
    return this.view ? this.view.webview.asWebviewUri(vscode.Uri.file(file)).toString() : null;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media, ...this.extraRoots] };
    const nonce = randomBytes(16).toString("base64");
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.js"));
    const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "webview.css"));
    const codicons = view.webview.asWebviewUri(vscode.Uri.joinPath(media, "codicon.css"));
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${view.webview.cspSource}; style-src ${view.webview.cspSource}; font-src ${view.webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="${codicons}"><link rel="stylesheet" href="${css}"><title>BuildPilot</title></head>
<body><div id="app" role="application" aria-label="BuildPilot"><div class="loading">Starting BuildPilot…</div></div>
<script nonce="${nonce}" src="${js}"></script></body></html>`;
    view.webview.onDidReceiveMessage(async (m: WebviewMessage) => {
      let result: unknown;
      let error: string | undefined;
      try {
        result = await this.onMessage(m);
      } catch (e) {
        error = (e as Error).message;
      }
      if (m.id !== undefined) void view.webview.postMessage({ type: "reply", id: m.id, result, error });
    });
    view.onDidDispose(() => (this.view = null));
    for (const q of this.queue.splice(0)) void view.webview.postMessage(q);
  }

  post(msg: unknown): void {
    if (this.view) void this.view.webview.postMessage(msg);
    else {
      this.queue = this.queue.filter((q) => (q as { type?: string }).type !== (msg as { type?: string }).type);
      this.queue.push(msg);
    }
  }
}
