import { describe, expect, it } from "vitest";
import {
	isCustomIconId,
	isFutureIconValue,
	isLucideName,
	normalizeIcon,
	parseIcon,
	uniqueIconId,
} from "../../src/icons/icon-value";

describe("parseIcon / normalizeIcon", () => {
	it("reads emoji and custom icons", () => {
		expect(parseIcon("🚀")).toEqual({ type: "emoji", emoji: "🚀" });
		expect(parseIcon("custom:rocket")).toEqual({ type: "custom", id: "rocket" });
		// Names from earlier builds kept their extension.
		expect(parseIcon("custom:rocket.svg")).toEqual({ type: "custom", id: "rocket.svg" });
		expect(normalizeIcon(" 🚀 ")).toBe("🚀");
		expect(normalizeIcon("custom:Logo 2")).toBe("custom:Logo 2");
	});

	it("reads Obsidian icons by their name", () => {
		expect(parseIcon("lucide:star")).toEqual({ type: "lucide", name: "star" });
		expect(parseIcon("lucide:arrow-up-right")).toEqual({
			type: "lucide",
			name: "arrow-up-right",
		});
		expect(parseIcon("lucide:dice-1")).toEqual({ type: "lucide", name: "dice-1" });
		expect(normalizeIcon("lucide:a-arrow-down")).toBe("lucide:a-arrow-down");
	});

	it("rejects anything unusable", () => {
		for (const value of [
			"hello",
			"",
			42,
			null,
			"custom:",
			"custom:../evil",
			"custom:sub/dir",
			"custom:.hidden",
			"custom: padded ",
			`custom:a${String.fromCodePoint(0x200b)}b`,
			"lucide:",
			"lucide:Star",
			"lucide:arrow--right",
			"lucide:-star",
			"lucide:arrow_right",
			"lucide: star",
			`lucide:${"a".repeat(101)}`,
			"phosphor:rocket",
		]) {
			expect(parseIcon(value), String(value)).toBeUndefined();
		}
	});
});

describe("isLucideName", () => {
	it("accepts the names Obsidian lists", () => {
		for (const name of ["star", "arrow-right", "a-arrow-down", "dice-1", "x".repeat(100)]) {
			expect(isLucideName(name), name).toBe(true);
		}
		for (const name of [
			"",
			"Star",
			"arrow_right",
			"-star",
			"star-",
			"a--b",
			"a b",
			"x".repeat(101),
		]) {
			expect(isLucideName(name), name).toBe(false);
		}
	});
});

describe("isFutureIconValue", () => {
	it("keeps values of another icon source or in a form this version doesn't know", () => {
		for (const value of ["phosphor:rocket", "lucide:Rocket", "custom:a/b", "lucide2:star"]) {
			expect(isFutureIconValue(value), value).toBe(true);
		}
	});

	it("but not values this version can show, or garbage", () => {
		for (const value of ["lucide:star", "custom:logo", "🚀", "hello", "Lucide:star", 4]) {
			expect(isFutureIconValue(value), String(value)).toBe(false);
		}
	});
});

describe("isCustomIconId", () => {
	it("accepts plain names only", () => {
		for (const id of ["a", "Logo", "my icon", "x-2", "logo.png", "Café", "日本"]) {
			expect(isCustomIconId(id), id).toBe(true);
		}
		for (const id of ["", "a/b", "a\\b", ".x", " a", "a ", "a:b", "x".repeat(101), "a\nb"]) {
			expect(isCustomIconId(id), id).toBe(false);
		}
	});
});

describe("uniqueIconId", () => {
	it("uses the file name without its extension, readable", () => {
		expect(uniqueIconId("Rocket.PNG", [])).toBe("Rocket");
		expect(uniqueIconId("my icon (final).svg", [])).toBe("my icon -final");
		expect(uniqueIconId("IMG_2034.jpeg", [])).toBe("IMG_2034");
		expect(uniqueIconId("noextension", [])).toBe("noextension");
		expect(uniqueIconId("archive.tar.gz", [])).toBe("archive-tar");
	});

	it("keeps letters of every script, also when decomposed", () => {
		expect(uniqueIconId(`Cafe${String.fromCodePoint(0x301)}.png`, [])).toBe("Café");
		expect(uniqueIconId("ロゴ.png", [])).toBe("ロゴ");
	});

	it("avoids taken names, ignoring case", () => {
		expect(uniqueIconId("rocket.png", ["Rocket", "rocket-2"])).toBe("rocket-3");
	});

	it("falls back for empty names and stays short", () => {
		expect(uniqueIconId("....png", [])).toBe("icon");
		expect(uniqueIconId(".png", [])).toBe("png");
		expect(uniqueIconId("🚀.png", [])).toBe("icon");
		expect(uniqueIconId(`${"x".repeat(200)}.png`, [])).toHaveLength(60);
		expect(isCustomIconId(uniqueIconId(`${"a ".repeat(40)}.png`, []))).toBe(true);
	});
});
