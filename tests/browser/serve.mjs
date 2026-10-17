/**
 * Tiny static file server for the browser harness. Serves `.test-build/`.
 * Usage: node tests/browser/serve.mjs [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".test-build");
const port = Number(process.argv[2] ?? 8730);

const server = createServer(async (request, response) => {
	const url = new URL(request.url ?? "/", "http://localhost");
	const relative = path.normalize(url.pathname).replace(/^[\\/]+/, "");
	const file = path.join(root, relative);

	try {
		const body = await readFile(file);
		const type = file.endsWith(".html")
			? "text/html; charset=utf-8"
			: "text/javascript; charset=utf-8";
		response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
		response.end(body);
	} catch {
		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end("not found");
	}
});

server.listen(port, "127.0.0.1", () => {
	console.log(`serving http://127.0.0.1:${port}/browser.html`);
});
