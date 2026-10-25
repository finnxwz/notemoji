import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
	AutoPick,
	isSensitive,
	isUntitled,
	nameWords,
	pickAutoEmoji,
	splitEmoji,
	splitKeyWords,
} from "../../src/icons/auto-emoji";
import { FRIENDLY_EMOJI, THEMES, UNTITLED_NAMES } from "../../src/icons/auto-emoji-themes";
import { findEntry, getCatalog } from "../../src/picker/catalog";

const ZWJ = String.fromCodePoint(0x200d);
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);

function theme(id: string): string[] {
	const found = THEMES.find((entry) => entry.id === id);
	if (!found) throw new Error(`No theme ${id}`);
	return splitEmoji(found.emoji);
}

const friendly = splitEmoji(FRIENDLY_EMOJI);

/** Picks for a note named `name` in the vault root. */
function pick(name: string, random = () => 0, folders: string[] = []): AutoPick {
	const result = pickAutoEmoji({ name, folders }, random);
	if (!result) throw new Error(`No emoji for ${name}`);
	return result;
}

describe("lists", () => {
	const lists = [
		...THEMES.flatMap((entry) => [
			[`theme ${entry.id}`, splitEmoji(entry.emoji)] as const,
			[`hits of ${entry.id}`, Object.keys(entry.hits ?? {})] as const,
		]),
		["friendly", friendly] as const,
	];

	it("only has emoji of the picker's list, written as the list writes them", () => {
		for (const [name, emoji] of lists) {
			for (const entry of emoji)
				expect(findEntry(entry)?.emoji, `${entry} in ${name}`).toBe(entry);
		}
	});

	it("only has emoji of Emoji 12.0 or older, which Windows 10 and older phones can draw", () => {
		const emojibase = createRequire(import.meta.url)("emojibase-data/en/data.json") as Array<{
			emoji: string;
			version: number;
		}>;
		const bare = (emoji: string) => emoji.split(VARIATION_SELECTOR).join("");
		const versions = new Map(emojibase.map((entry) => [bare(entry.emoji), entry.version]));
		for (const [name, emoji] of lists) {
			for (const entry of emoji) {
				expect(versions.get(bare(entry)), `${entry} in ${name}`).toBeLessThanOrEqual(12);
			}
		}
	});

	it("has about 30 to 40 themes of 3 to 6 emoji each, without repeats", () => {
		expect(THEMES.length).toBeGreaterThanOrEqual(30);
		expect(THEMES.length).toBeLessThanOrEqual(40);
		for (const entry of THEMES) {
			const emoji = splitEmoji(entry.emoji);
			expect(emoji.length, entry.id).toBeGreaterThanOrEqual(3);
			expect(emoji.length, entry.id).toBeLessThanOrEqual(6);
			expect(new Set(emoji).size, entry.id).toBe(emoji.length);
		}
		expect(new Set(THEMES.map((entry) => entry.id)).size).toBe(THEMES.length);
	});

	it("writes key words as names are read, each in one theme only", () => {
		const seen = new Map<string, string>();
		for (const entry of THEMES) {
			const words = [
				...splitKeyWords(entry.words),
				...Object.values(entry.hits ?? {}).flatMap(splitKeyWords),
			];
			for (const word of words) {
				expect(nameWords(word).join(" "), `"${word}" in ${entry.id}`).toBe(word);
				expect(seen.get(word), `"${word}" in ${entry.id}`).toBeUndefined();
				seen.set(word, entry.id);
			}
		}
		expect(seen.size).toBeGreaterThan(500);
	});

	it("has about 45 emoji that suit any note: no faces, people, flags or sequences", () => {
		expect(friendly.length).toBeGreaterThanOrEqual(30);
		expect(friendly.length).toBeLessThanOrEqual(60);
		expect(new Set(friendly).size).toBe(friendly.length);
		const excluded = new Set(
			getCatalog().flatMap((category) =>
				category.entries
					.filter(
						(entry) =>
							["people", "flags"].includes(category.id) ||
							(category.id === "smileys" && entry.name.includes("face")),
					)
					.map((entry) => entry.emoji),
			),
		);
		for (const emoji of friendly) {
			expect(excluded.has(emoji), emoji).toBe(false);
			expect(emoji.includes(ZWJ), emoji).toBe(false);
		}
		for (const unwanted of ["💩", "🍆", "🍑", "🔫", "💣", "☠️", "💊", "🎈", "🎁", "🎉", "🦁"]) {
			expect(friendly).not.toContain(unwanted);
		}
	});
});

describe("isUntitled", () => {
	it("knows the name Obsidian gives a new note, in every language and numbered", () => {
		for (const name of UNTITLED_NAMES) {
			expect(isUntitled(name), name).toBe(true);
			expect(isUntitled(`${name} 3`), name).toBe(true);
		}
		// Persian writes it with an invisible joiner.
		expect(isUntitled(`بی${String.fromCodePoint(0x200c)}نام`)).toBe(true);
	});

	it("lists every name once and without invisible characters", () => {
		expect(new Set(UNTITLED_NAMES).size).toBe(UNTITLED_NAMES.length);
		for (const name of UNTITLED_NAMES) expect(name, name).not.toMatch(/\p{Cf}/u);
	});

	it("is false for real names", () => {
		for (const name of [
			"Untitled draft",
			"My untitled novel",
			"Unbenannte Notiz",
			"2024-01-02",
		]) {
			expect(isUntitled(name), name).toBe(false);
		}
	});
});

describe("nameWords", () => {
	it("drops the extension, numbering, emoji, punctuation and accents", () => {
		expect(nameWords("01 - Café trip.md")).toEqual(["cafe", "trip"]);
		expect(nameWords("1. Ideas")).toEqual(["ideas"]);
		expect(nameWords("10) Packing list!")).toEqual(["packing", "list"]);
		expect(nameWords("🍕 Pizza night")).toEqual(["pizza", "night"]);
		expect(nameWords("to-do, (draft)")).toEqual(["to", "do", "draft"]);
		expect(nameWords("Grandma’s recipes")).toEqual(["grandma", "s", "recipes"]);
	});

	it("keeps words in camel case together", () => {
		expect(nameWords("MacBook setup")).toEqual(["macbook", "setup"]);
		expect(nameWords("TypeScript")).toEqual(["typescript"]);
		expect(nameWords("ToDo")).toEqual(["todo"]);
	});
});

describe("obvious emoji", () => {
	it("come from a word with one clear emoji", () => {
		expect(pick("Pizza night")).toEqual({ emoji: "🍕", source: "exact" });
		expect(pick("Coffee with Sam").emoji).toBe("☕");
		expect(pick("dogs").emoji).toBe("🐕");
		expect(pick("Dentist appointment").emoji).toBe("🦷");
		expect(pick("Workout plan").emoji).toBe("💪");
		expect(pick("Packing list").emoji).toBe("🧳");
	});

	it("come from the name of a listed emoji in the title", () => {
		expect(pick("Brain dump").emoji).toBe("🧠");
		expect(pick("Memo").emoji).toBe("📝");
		expect(pick("Mountain trip").emoji).toBe("⛰️");
	});

	it("only from listed emoji, never any emoji of the picker", () => {
		expect(pick("Bomb").source).toBe("fallback");
		expect(pick("Pineapple").source).toBe("fallback");
	});

	it("beat a theme word anywhere in the name; of two, the first wins", () => {
		expect(pick("Pizza with the team").emoji).toBe("🍕");
		expect(pick("Team meeting with pizza").emoji).toBe("🍕");
		expect(pick("Coffee and cake").emoji).toBe("☕");
	});

	it("leave hotels out of 🏨, which Windows draws like a hospital", () => {
		expect(theme("travel")).not.toContain("🏨");
		expect(pick("Hotel list").emoji).toBe(`🛎${VARIATION_SELECTOR}`);
	});
});

describe("theme words", () => {
	it("give one of the theme's emoji by chance", () => {
		const travel = theme("travel");
		const seen = new Set<string>();
		for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
			const result = pick("Trip to Paris", () => random);
			expect(result.source).toBe("theme");
			seen.add(result.emoji);
		}
		expect([...seen]).toEqual(travel);
	});

	it("only match whole words, never parts of words", () => {
		for (const name of ["Catalogue", "Scatter plot", "Carpet", "Artichoke", "Seasons"]) {
			expect(pick(name).source, name).toBe("fallback");
		}
	});

	it("leave out words that often mean something else", () => {
		// Maps of content (MOCs), MacBooks and German bosses (Chef) are no trips, books or cooking.
		for (const name of ["Map of Content", "Maps", "MacBook", "Chef"]) {
			expect(pick(name).source, name).toBe("fallback");
		}
		expect(theme("tech")).toContain(pick("TypeScript notes").emoji);
		expect(theme("meetings")).not.toContain(pick("Retro games").emoji);
		// A chicken coop is no dinner.
		expect(pick("Chicken coop").emoji).not.toBe("🍗");
	});

	it("count a phrase as one: a cover letter is no letter", () => {
		expect(theme("work")).toContain(pick("Cover letter for Acme").emoji);
	});

	it("ignore the folders, which only matter for sad or serious notes", () => {
		expect(pick("Untitled", () => 0, ["Recipes"]).source).toBe("fallback");
	});
});

describe("sad or serious notes", () => {
	it("get no emoji", () => {
		for (const name of [
			"Mom's funeral",
			"Death of my father",
			"Divorce papers",
			"Cancer treatment",
			"Miscarriage",
			"Grandpa passed away",
			"Eating disorder",
			"Suicidal thoughts",
			"Feeling depressed",
			"Bad mood",
			"School shooting",
			"Pet loss",
			"Self-harm",
			"Divorced parents",
			"In memoriam",
			"RIP Bella",
		]) {
			expect(isSensitive(name), name).toBe(true);
			expect(pickAutoEmoji({ name, folders: [] }), name).toBeUndefined();
		}
	});

	it("also in a sad or serious folder, however far up", () => {
		expect(pickAutoEmoji({ name: "Today", folders: ["10", "2024", "Grief journal"] })).toBe(
			undefined,
		);
	});

	it("are found by whole words, leaving out words with other common meanings", () => {
		for (const name of ["Weight loss", "Terminal commands", "Die Reise", "Deadline", "Diet"]) {
			expect(isSensitive(name), name).toBe(false);
		}
	});
});

describe("notes nothing fits", () => {
	it("get an emoji that suits any note, by chance", () => {
		for (const random of [0, 0.3, 0.7, 0.99]) {
			const result = pick("Q3 summary", () => random);
			expect(result.source).toBe("fallback");
			expect(friendly).toContain(result.emoji);
		}
		expect(pick("Q3 summary", () => 0).emoji).toBe(friendly[0]);
		expect(pick("Q3 summary", () => 0.999).emoji).toBe(friendly.at(-1));
	});
});
