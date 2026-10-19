import { describe, expect, it } from "vitest";
import {
	isCustomFileName,
	normalizeIcon,
	parseIcon,
	uniqueFileName,
} from "../../src/icons/icon-value";

describe("parseIcon / normalizeIcon", () => {
	it("reads emoji and custom icons", () => {
		expect(parseIcon("🚀")).toEqual({ type: "emoji", emoji: "🚀" });
		expect(parseIcon("custom:rocket.svg")).toEqual({ type: "custom", file: "rocket.svg" });
		expect(normalizeIcon(" 🚀 ")).toBe("🚀");
		expect(normalizeIcon("custom:Logo 2.PNG")).toBe("custom:Logo 2.PNG");
	});

	it("rejects anything unusable", () => {
		for (const value of [
			"hello",
			"",
			42,
			null,
			"custom:",
			"custom:../evil.png",
			"custom:sub/dir.png",
			"custom:script.js",
			"custom:.hidden.png",
			"lucide:rocket",
		]) {
			expect(parseIcon(value), String(value)).toBeUndefined();
		}
	});
});

describe("isCustomFileName", () => {
	it("accepts plain image file names only", () => {
		for (const name of ["a.png", "Logo.SVG", "my icon.webp", "x.jpeg", "y.gif"]) {
			expect(isCustomFileName(name), name).toBe(true);
		}
		for (const name of [
			"a",
			"a.txt",
			"a/b.png",
			"a\\b.png",
			".png",
			`${"x".repeat(100)}.png`,
		]) {
			expect(isCustomFileName(name), name).toBe(false);
		}
	});
});

describe("uniqueFileName", () => {
	it("keeps readable names and lower-cases the extension", () => {
		expect(uniqueFileName("Rocket.PNG", new Set())).toBe("Rocket.png");
		expect(uniqueFileName("my icon (final).svg", new Set())).toBe("my icon -final.svg");
	});

	it("avoids taken names, ignoring case", () => {
		expect(uniqueFileName("rocket.png", new Set(["Rocket.png", "rocket-2.png"]))).toBe(
			"rocket-3.png",
		);
	});

	it("rejects unsupported types and falls back for empty names", () => {
		expect(uniqueFileName("notes.txt", new Set())).toBeUndefined();
		expect(uniqueFileName("noextension", new Set())).toBeUndefined();
		expect(uniqueFileName("....png", new Set())).toBe("icon.png");
	});
});
