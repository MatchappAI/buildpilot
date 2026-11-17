// A second (third, fourth…) BuildPilot process reading the same spool and database at the same time, like the window
// server, the menu-bar widget and `bp glance` do. argv: harness home ms
import { createRequire } from "module"; import path from "path";
const [harness, home, ms] = process.argv.slice(2);
const H = createRequire(import.meta.url)(harness);
const engine = new H.Engine({ home, light: true, claudeSettingsFile: path.join(home, "no-settings.json") });
await engine.start();
const reader = new H.SpoolReader(path.join(home, "spool"), engine["ingestor"], () => {});
const end = Date.now() + Number(ms); let n = 0, errors = 0;
while (Date.now() < end) {
  try { n += reader.drain(); H.setBuildName(engine, "aaaa0000-0000-4000-8000-000000000000", `p${process.pid} ${n}`); } catch (e) { errors++; console.error(String(e.message).slice(0, 200)); }
  await new Promise((r) => setTimeout(r, Math.random() * 3));
}
engine.stop();
console.log(JSON.stringify({ accepted: n, errors }));
