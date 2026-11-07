// Regenerates every icon size from media/brand/mark.svg (needs Google Chrome for SVG rendering, and macOS sips).
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "media/brand");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.writeFileSync(path.join(dir, "render.html"), '<!doctype html><html><head><style>html,body{margin:0;background:transparent}img{display:block;width:1024px;height:1024px}</style></head><body><img src="mark.svg"></body></html>');
execFileSync(chrome, ["--headless=new", "--disable-gpu", `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "bp-brand-"))}`, "--hide-scrollbars", "--default-background-color=00000000", "--window-size=1024,1024", "--allow-file-access-from-files", `--screenshot=${path.join(dir, "icon-1024.png")}`, `file://${path.join(dir, "render.html")}`], { stdio: "ignore" });
for (const [s, out] of [[256, "media/brand/icon-256.png"], [128, "media/icon.png"], [32, "media/brand/favicon-32.png"], [256, "docs/assets/logo.png"]]) execFileSync("sips", ["-z", String(s), String(s), path.join(dir, "icon-1024.png"), "--out", path.join(root, out)], { stdio: "ignore" });
// Inline copy of the mark for the page and the license Worker (no file loading needed there).
const inner = fs.readFileSync(path.join(dir, "mark.svg"), "utf8").replace(/<\?xml[^>]*>/, "").replace(/\s*<!--[\s\S]*?-->/g, "").replace(/\n\s*/g, "").replace(/<svg[^>]*>/, "").replace("</svg>", "").replace(/id="bg"/g, 'id="bpg"').replace(/url\(#bg\)/g, "url(#bpg)");
fs.writeFileSync(path.join(dir, "mark.inline.txt"), inner);
console.log("brand icons regenerated");
