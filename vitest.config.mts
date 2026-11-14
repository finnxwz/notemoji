import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// The `obsidian` package only ships types, so tests run against a small fake.
		alias: { obsidian: fileURLToPath(new URL("tests/obsidian.ts", import.meta.url)) },
	},
	test: {
		environment: "happy-dom",
		include: ["tests/**/*.test.ts"],
	},
});
