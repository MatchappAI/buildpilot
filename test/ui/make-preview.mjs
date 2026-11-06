// Builds standalone HTML previews of the real webview bundle with VS Code-like theme tokens, for screenshots.
import * as fs from "fs";
import * as path from "path";
const dir = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(dir, "../..");
const fx = JSON.parse(fs.readFileSync(path.join(dir, "fixture.json"), "utf8"));
const themes = {
  dark: { "--vscode-foreground": "#cccccc", "--vscode-sideBar-background": "#181818", "--vscode-editorWidget-background": "#202020", "--vscode-descriptionForeground": "#9d9d9d", "--vscode-widget-border": "#313131", "--vscode-button-background": "#0078d4", "--vscode-button-foreground": "#ffffff", "--vscode-button-hoverBackground": "#026ec1", "--vscode-button-secondaryBackground": "#313131", "--vscode-button-secondaryForeground": "#cccccc", "--vscode-textLink-foreground": "#4daafc", "--vscode-focusBorder": "#0078d4", "--vscode-input-background": "#313131", "--vscode-input-foreground": "#cccccc", "--vscode-input-border": "#3c3c3c", "--vscode-badge-background": "#616161", "--vscode-badge-foreground": "#f8f8f8", "--vscode-textCodeBlock-background": "#2b2b2b", "--vscode-textBlockQuote-background": "#2b2b2b", "--vscode-editor-background": "#1f1f1f", "--vscode-testing-iconPassed": "#73c991", "--vscode-testing-iconFailed": "#f14c4c", "--vscode-editorWarning-foreground": "#cca700", "--vscode-editorInfo-foreground": "#3794ff", "--vscode-font-family": "-apple-system, BlinkMacSystemFont, sans-serif", "--vscode-font-size": "13px", "--vscode-editor-font-family": "Menlo, monospace", "--vscode-panelTitle-activeBorder": "#0078d4" },
  light: { "--vscode-foreground": "#3b3b3b", "--vscode-sideBar-background": "#f8f8f8", "--vscode-editorWidget-background": "#ffffff", "--vscode-descriptionForeground": "#717171", "--vscode-widget-border": "#e5e5e5", "--vscode-button-background": "#005fb8", "--vscode-button-foreground": "#ffffff", "--vscode-button-hoverBackground": "#0258a8", "--vscode-button-secondaryBackground": "#e5e5e5", "--vscode-button-secondaryForeground": "#3b3b3b", "--vscode-textLink-foreground": "#005fb8", "--vscode-focusBorder": "#005fb8", "--vscode-input-background": "#ffffff", "--vscode-input-foreground": "#3b3b3b", "--vscode-input-border": "#cecece", "--vscode-badge-background": "#cccccc", "--vscode-badge-foreground": "#3b3b3b", "--vscode-textCodeBlock-background": "#f0f0f0", "--vscode-textBlockQuote-background": "#f2f2f2", "--vscode-editor-background": "#ffffff", "--vscode-testing-iconPassed": "#388a34", "--vscode-testing-iconFailed": "#e51400", "--vscode-editorWarning-foreground": "#bf8803", "--vscode-editorInfo-foreground": "#1a85ff", "--vscode-font-family": "-apple-system, BlinkMacSystemFont, sans-serif", "--vscode-font-size": "13px", "--vscode-editor-font-family": "Menlo, monospace", "--vscode-panelTitle-activeBorder": "#005fb8" },
};
const settings = { beginner: true, trusted: true, aiProvider: "none", aiModel: "", apiEnabled: true, apiAddress: "http://127.0.0.1:47821", apiAllowLan: false, notifications: "important", platform: "darwin", home: "~/.buildpilot" };
for (const [theme, vars] of Object.entries(themes)) {
  for (const tab of ["overview", "sessions", "supervisor", "prompts", "memory", "connect"]) {
    const open = tab === "sessions" ? { "sess:demo-a1b2c3": true } : {};
    const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${root}/media/codicon.css"><link rel="stylesheet" href="${root}/media/webview.css">
<style>body{width:340px;border-right:1px solid #444;min-height:100vh}#app{height:auto!important}:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}</style></head><body><div id="app"></div>
<script>
const FX = ${JSON.stringify(fx)}; const SETTINGS = ${JSON.stringify(settings)};
let st = { tab: ${JSON.stringify(tab)}, open: ${JSON.stringify(open)}, goal: "integration", request: "Make my Gmail integration work perfectly", mustNotChange: "", acceptance: "", planFirst: true };
window.acquireVsCodeApi = () => ({ getState: () => st, setState: (s) => { st = s; }, postMessage: (m) => {
  const reply = (result) => setTimeout(() => window.postMessage({ type: "reply", id: m.id, result }, "*"), 0);
  if (m.type === "goals") reply(FX.goals);
  else if (m.type === "ready") { window.postMessage({ type: "state", state: FX.state, settings: SETTINGS }, "*"); ${tab === "prompts" ? "setTimeout(() => document.querySelector('[data-act=build]')?.click(), 100);" : ""} }
  else if (m.type === "buildPrompt") reply(FX.built);
  else reply(null);
}});
</script><script src="${root}/media/webview.js"></script></body></html>`;
    fs.writeFileSync(path.join(dir, `preview-${theme}-${tab}.html`), html);
  }
}
console.log("previews written");
