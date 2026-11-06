// Renders the page from YOUR real BuildPilot data (read-only) for a final visual check. Not used in tests.
import * as fs from "fs";
import * as path from "path";
import { Engine } from "../../src/core/engine";
import { pageData } from "../../src/core/page";
(async () => {
  const engine = new Engine();
  await engine.start();
  await engine.openProject(process.argv[2] ?? process.cwd());
  const st = engine.snapshot();
  const page = pageData(engine, st);
  const side = [];
  for (const b of await engine.extraBuilds()) { const c = await engine.buildChanges(b.dir, b.branch); side.push({ name: path.basename(b.dir), dir: b.dir, branch: b.branch, changed: c.files.length, unsaved: c.unsaved, commits: c.commits }); }
  const built = engine.prompt({ goal: "feature", request: "Add a contact form that emails me", planFirst: true }, st);
  engine.stop();
  fs.writeFileSync(path.join(__dirname, "fixture-real.json"), JSON.stringify({ state: st, built, scenarios: { "real-mine": { page: { ...page, side } } } }));
  console.log("real fixture written");
})();
