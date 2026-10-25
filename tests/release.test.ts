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

	it("use a plain version, the newest in versions.json, as Obsidian expects", () => {
		const version = manifest.version as string;
		expect(version).toMatch(/^\d+\.\d+\.\d+$/);
		const parts = (value: string) => value.split(".").map(Number);
		const newer = (a: string, b: string) => {
			const [x, y] = [parts(a), parts(b)];
			const i = x.findIndex((part, index) => part !== y[index]);
			return i !== -1 && x[i] > y[i];
		};
		for (const listed of Object.keys(json("versions.json"))) {
			expect(newer(listed, version), listed).toBe(false);
		}
	});
});
