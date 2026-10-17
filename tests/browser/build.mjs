/**
 * Bundles the browser harness into `.test-build/browser.html` so it can be
 * opened in any Chromium based browser (or in Obsidian's own devtools).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const outDir = path.join(root, ".test-build");
const bundlePath = path.join(outDir, "browser-harness.js");
const htmlPath = path.join(outDir, "browser.html");

await mkdir(outDir, { recursive: true });

await build({
	entryPoints: [path.join(here, "harness.ts")],
	bundle: true,
	platform: "browser",
	format: "iife",
	target: "chrome100",
	outfile: bundlePath,
	logLevel: "warning",
});

const script = await readFile(bundlePath, "utf8");
const pluginStyles = await readFile(path.join(root, "styles.css"), "utf8");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>notemoji – file explorer renderer harness</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; margin: 16px; }
  #summary { font-size: 16px; font-weight: 600; }
  #summary.ok { color: #2e7d32; }
  #summary.bad { color: #c62828; }
  ul { padding-left: 1.2em; }
  li.ok { color: #2e7d32; }
  li.bad { color: #c62828; }
  #explorer, #visual { margin: 12px 0; padding: 8px; border: 1px dashed #ccc; max-width: 320px; }
  /* Metrics close to Obsidian's file explorer. */
  .tree-item-self {
    display: flex;
    align-items: center;
    padding: 2px 8px 2px 4px;
    min-height: 21px;
    font-size: 13px;
    border-radius: 4px;
    white-space: nowrap;
  }
  .tree-item-self:hover { background: #0000000d; }
  .tree-item-inner { flex-grow: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .tree-item-icon { display: flex; align-items: center; margin-right: 4px; color: #666; }
  .tree-item-children { padding-left: 16px; }
  ${pluginStyles}
</style>
</head>
<body>
<h1>notemoji renderer harness</h1>
<div id="summary">running…</div>
<ul id="results"></ul>
<h2>Simulated file explorer (after the test run)</h2>
<div id="explorer"></div>
<h2>Visual sample</h2>
<div id="visual"></div>
<script>
${script}
</script>
</body>
</html>
`;

await writeFile(htmlPath, html, "utf8");
console.log(htmlPath);
