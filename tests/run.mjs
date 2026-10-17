/**
 * Bundles the TypeScript tests (they import the plugin's pure modules) and runs
 * them with the Node test runner. Keeps the project dependency free: esbuild is
 * the only tool involved.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outfile = path.join(root, ".test-build", "tests.mjs");

await build({
	entryPoints: [path.join(here, "index.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node20",
	outfile,
	logLevel: "warning",
});

const child = spawn(process.execPath, ["--test", outfile], { stdio: "inherit" });

child.on("error", (error) => {
	console.error(error);
	process.exit(1);
});

child.on("close", (code) => {
	process.exit(code ?? 1);
});
