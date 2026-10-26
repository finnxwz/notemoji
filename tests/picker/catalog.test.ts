import { describe, expect, it } from "vitest";
import { parseEmojiInput } from "../../src/icons/emoji";
import { findEntry, getCatalog, searchEmoji } from "../../src/picker/catalog";

const catalog = getCatalog();
const all = catalog.flatMap((category) => category.entries);
const top = (query: string, count = 3) =>
	searchEmoji(catalog, query)
		.slice(0, count)
		.map((entry) => entry.emoji);

describe("bundled catalog", () => {
	it("has the nine categories in order", () => {
		expect(catalog.map((category) => category.id)).toEqual([
			"smileys",
			"people",
			"nature",
			"food",
			"travel",
			"activities",
			"objects",
			"symbols",
			"flags",
		]);
	});

	it("only lists emoji the plugin accepts, without duplicates", () => {
		for (const entry of all) {
			const parsed = parseEmojiInput(entry.emoji);
			expect(parsed.status, entry.name).toBe("ok");
			expect(parsed.emoji, entry.name).toBe(entry.emoji);
			expect(parsed.extra, entry.name).toBe(false);
		}
		expect(new Set(all.map((entry) => entry.emoji)).size).toBe(all.length);
	});

	it("stops at Emoji 15.0", () => {
		expect(all.length).toBeGreaterThan(1800);
		// 🫨 (shaking face) is Emoji 15.0, 🙂‍↔️ (head shaking) is 15.1.
		expect(findEntry("🫨")).toBeDefined();
		expect(all.some((entry) => entry.name === "head shaking horizontally")).toBe(false);
	});
});

describe("searchEmoji", () => {
	it("ranks exact and prefix name matches first", () => {
		expect(top("rocket")[0]).toBe("🚀");
		expect(top("fire")[0]).toBe("🔥");
		expect(top("folder")[0]).toBe("📁");
	});

	it("finds emoji by keyword and shortcode", () => {
		expect(top("launch", 10)).toContain("🚀");
		expect(top(":tada:", 5)).toContain("🎉");
		expect(top("thumbsup", 5)).toContain("👍");
	});

	it("requires every word to match", () => {
		const results = searchEmoji(catalog, "red heart");
		expect(results[0]?.emoji).toBe("❤️");
		for (const entry of results) {
			expect(`${entry.name} ${entry.keywords.join(" ")}`).toMatch(/heart/);
		}
	});

	it("returns nothing for blank or unknown queries and respects the limit", () => {
		expect(searchEmoji(catalog, "   ")).toEqual([]);
		expect(searchEmoji(catalog, "qqqzzzxx")).toEqual([]);
		expect(searchEmoji(catalog, "face", 5)).toHaveLength(5);
	});
});

describe("findEntry", () => {
	it("finds names, also with or without the variation selector", () => {
		expect(findEntry("🚀")?.name).toBe("rocket");
		const heart = findEntry("❤️");
		expect(heart?.name).toBe("red heart");
		expect(findEntry(heart!.emoji.replace(String.fromCodePoint(0xfe0f), ""))).toBe(heart);
		expect(findEntry("★")).toBeUndefined();
	});
});
