import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

/** Obsidian reads manifest.json and versions.json; a mismatch breaks updates for some users. */
describe("release files", () => {
	const manifest = json("manifest.json");
	const lock = json("package-lock.json") as {
		version: string;
		packages: Record<string, { version?: string }>;
	};

	it("agree on the version", () => {
		expect(json("package.json").version).toBe(manifest.version);
		expect(lock.version).toBe(manifest.version);
		expect(lock.packages[""].version).toBe(manifest.version);
	});

	it("list the version with its minimum Obsidian version", () => {
		expect(json("versions.json")[manifest.version as string]).toBe(manifest.minAppVersion);
	});
});
