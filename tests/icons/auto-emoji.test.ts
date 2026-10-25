import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
	AutoPick,
	hemisphereOf,
	isSensitive,
	isUntitled,
	monthOfDate,
	nameWords,
	NewNote,
	pickAutoEmoji,
	seasonEmoji,
	splitEmoji,
	splitKeyWords,
} from "../../src/icons/auto-emoji";
import {
	FRIENDLY_EMOJI,
	HOLIDAY_EMOJI,
	SEASON_EMOJI,
	THEMES,
	UNTITLED_NAMES,
} from "../../src/icons/auto-emoji-themes";
import { findEntry, getCatalog } from "../../src/picker/catalog";

const ZWJ = String.fromCodePoint(0x200d);
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);

function theme(id: string): string[] {
	const found = THEMES.find((entry) => entry.id === id);
	if (!found) throw new Error(`No theme ${id}`);
	return splitEmoji(found.emoji);
}

const friendly = splitEmoji(FRIENDLY_EMOJI);

/** Picks for a note named `name` in the vault root, with nothing around it. */
function pick(name: string, note: Partial<NewNote> = {}, random = () => 0): AutoPick {
	const result = pickAutoEmoji(
		{ name, folders: [], neighbours: [], recentPicks: [], hemisphere: "north", ...note },
		random,
	);
	if (!result) throw new Error(`No emoji for ${name}`);
	return result;
}

describe("lists", () => {
	const lists = [
		...THEMES.flatMap((entry) => [
			[`theme ${entry.id}`, splitEmoji(entry.emoji)] as const,
			[`hits of ${entry.id}`, Object.keys(entry.hits ?? {})] as const,
		]),
		...Object.entries(SEASON_EMOJI).map(
			([season, list]) => [season, splitEmoji(list)] as const,
		),
		...Object.entries(HOLIDAY_EMOJI).map(([month, list]) => [month, splitEmoji(list)] as const),
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

	it("has about 30 to 40 themes of 10 to 20 emoji each, without repeats", () => {
		expect(THEMES.length).toBeGreaterThanOrEqual(30);
		expect(THEMES.length).toBeLessThanOrEqual(40);
		for (const entry of THEMES) {
			const emoji = splitEmoji(entry.emoji);
			expect(emoji.length, entry.id).toBeGreaterThanOrEqual(10);
			expect(emoji.length, entry.id).toBeLessThanOrEqual(20);
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

	it("keeps holiday emoji out of the season lists", () => {
		const holidays = Object.values(HOLIDAY_EMOJI).flatMap(splitEmoji);
		for (const list of Object.values(SEASON_EMOJI)) {
			for (const emoji of holidays) expect(splitEmoji(list)).not.toContain(emoji);
		}
	});

	it("has about 160 friendly emoji: no faces, people, body parts, flags or sequences", () => {
		expect(friendly.length).toBeGreaterThanOrEqual(140);
		expect(friendly.length).toBeLessThanOrEqual(180);
		expect(new Set(friendly).size).toBe(friendly.length);
		// Hearts are in the smileys too; their faces are not wanted.
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
		for (const unpleasant of ["💩", "🍆", "🍑", "🔫", "💣", "☠️", "💊", "🩸", "☯️", "☮️"]) {
			expect(friendly).not.toContain(unpleasant);
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

describe("key words in the name", () => {
	it("give a theme", () => {
		expect(pick("Trip to Rome")).toEqual({ emoji: theme("travel")[0], source: "name" });
		expect(theme("music")).toContain(pick("Band rehearsal").emoji);
		expect(theme("tasks")).toContain(pick("ToDo").emoji);
		expect(theme("tasks")).toContain(pick("Things to-do").emoji);
	});

	it("only match whole words, never parts of words", () => {
		for (const name of [
			"Catalogue",
			"Scatter plot",
			"Carpet",
			"Artichoke",
			"Pineapple",
			"Seasons",
		]) {
			expect(pick(name).source, name).toBe("fallback");
		}
		// "teacher" is a key word itself; the "tea" in it is not.
		expect(theme("learning")).toContain(pick("Teacher").emoji);
	});

	it("leave out words that often mean something else", () => {
		// Maps of content (MOCs), MacBooks and German bosses (Chef) are no trips, books or cooking.
		for (const name of ["Map of Content", "Maps", "MacBook", "Chef"]) {
			expect(pick(name).source, name).toBe("fallback");
		}
		expect(theme("tech")).toContain(pick("TypeScript notes").emoji);
		// A bank by the river is no bank account: "bank" is a key word, not a clear hit.
		expect(pick("River bank", {}, () => 0.99).emoji).not.toBe("🏦");
		expect(theme("meetings")).not.toContain(pick("Retro games").emoji);
		// A chicken coop is no dinner.
		expect(pick("Chicken coop").emoji).not.toBe("🍗");
	});

	it("take the obvious emoji of a clear hit", () => {
		expect(pick("Pizza night").emoji).toBe("🍕");
		expect(pick("Coffee with Sam").emoji).toBe("☕");
		expect(pick("My cat").emoji).toBe("🐈");
		expect(pick("dogs").emoji).toBe("🐕");
		expect(pick("Piano lessons").emoji).toBe("🎹");
		expect(pick("Lunar New Year").emoji).toBe("🧧");
	});

	it("prefer a clear hit to other key words, but never inside a longer key word", () => {
		expect(pick("Mom's birthday").emoji).toBe("🎂");
		expect(pick("Weekly pizza night").emoji).toBe("🍕");
		expect(theme("work")).toContain(pick("Cover letter for Acme").emoji);
	});

	it("give a clear hit's theme when a neighbour already has it", () => {
		const result = pick("Pizza", { neighbours: ["🍕", "📁"] });
		expect(result.source).toBe("name");
		expect(result.emoji).not.toBe("🍕");
		expect(theme("food")).toContain(result.emoji);
	});

	it("win over a date and the folder", () => {
		expect(pick("2024-07-01 Pizza", { folders: [{ name: "Travel" }] }).emoji).toBe("🍕");
	});
});

describe("variety", () => {
	const travel = theme("travel");

	it("prefers emoji no neighbour uses", () => {
		const free = travel[5];
		const neighbours = travel.filter((emoji) => emoji !== free);
		for (const random of [0, 0.5, 0.99]) {
			expect(pick("Trip", { neighbours }, () => random).emoji).toBe(free);
		}
	});

	it("then emoji that are not among the latest automatic picks", () => {
		const neighbours = travel.slice(2);
		expect(pick("Trip", { neighbours, recentPicks: [travel[0]] }).emoji).toBe(travel[1]);
	});

	it("takes one of the least used when every emoji is used", () => {
		const neighbours = [...travel, ...travel.filter((emoji) => emoji !== travel[3])];
		expect(pick("Trip", { neighbours }, () => 0.7).emoji).toBe(travel[3]);
		// Neighbours count first; the latest picks only decide between equals.
		expect(pick("Trip", { neighbours, recentPicks: [travel[3]] }).emoji).toBe(travel[3]);
	});

	it("compares emoji with and without the variation selector", () => {
		const neighbours = travel.slice(1).map((emoji) => emoji.split(VARIATION_SELECTOR).join(""));
		expect(pick("Trip", { neighbours }, () => 0.9).emoji).toBe(travel[0]);
	});

	it("picks by the random number among the candidates", () => {
		expect(pick("Trip", {}, () => 0).emoji).toBe(travel[0]);
		expect(pick("Trip", {}, () => 0.999).emoji).toBe(travel.at(-1));
		const random = () => 0.42;
		expect(pick("Trip", {}, random)).toEqual(pick("Trip", {}, random));
	});
});

describe("dates", () => {
	it("read the month of daily, weekly, monthly and unique note names", () => {
		expect(monthOfDate("2024-05-31")).toBe(5);
		expect(monthOfDate("2024.05.31")).toBe(5);
		expect(monthOfDate("20240531")).toBe(5);
		expect(monthOfDate("202405311230")).toBe(5);
		expect(monthOfDate("31.05.2024")).toBe(5);
		expect(monthOfDate("2024-05")).toBe(5);
		expect(monthOfDate("2024-05-31 Friday")).toBe(5);
		expect(monthOfDate("📅 2024-05-31")).toBe(5);
	});

	it("read weeks as in ISO 8601", () => {
		expect(monthOfDate("2024-W01")).toBe(1);
		expect(monthOfDate("2024-W22")).toBe(5);
		expect(monthOfDate("2020-W53")).toBe(12);
		// Week 1 of 2026 starts on Monday, 29 December 2025.
		expect(monthOfDate("2026-W01")).toBe(1);
		expect(monthOfDate("2024-W54")).toBeUndefined();
	});

	it("ignore names that are not dates", () => {
		for (const name of [
			"2024",
			"2024-13",
			"2024-13-01",
			"2024-05-32",
			"123456789",
			"2024-0531",
			"Q2 2024",
			"Notes 2024-05-31",
		]) {
			expect(monthOfDate(name), name).toBeUndefined();
		}
	});

	it("give the season of the month, in both hemispheres", () => {
		const summer = splitEmoji(SEASON_EMOJI.summer);
		const winter = splitEmoji(SEASON_EMOJI.winter);
		expect(seasonEmoji(7, "north")).toEqual(summer);
		expect(seasonEmoji(7, "south")).toEqual(winter);
		expect(seasonEmoji(3, "north")).toEqual(splitEmoji(SEASON_EMOJI.spring));
		expect(seasonEmoji(3, "south")).toEqual(splitEmoji(SEASON_EMOJI.autumn));

		const north = pick("2024-07-14");
		expect(north.source).toBe("date");
		expect(summer).toContain(north.emoji);
		expect(winter).toContain(pick("2024-07-14", { hemisphere: "south" }).emoji);
	});

	it("keep holiday emoji to their months", () => {
		expect(seasonEmoji(12, "north")).toContain("🎄");
		expect(seasonEmoji(12, "south")).toContain("🎄");
		expect(seasonEmoji(12, "south")).toContain("☀️");
		expect(seasonEmoji(10, "north")).toContain("🎃");
		for (const month of [1, 9, 11]) {
			expect(seasonEmoji(month, "north")).not.toContain("🎄");
			expect(seasonEmoji(month, "north")).not.toContain("🎃");
		}
	});

	it("win over the folder", () => {
		expect(pick("2024-01-02", { folders: [{ name: "Recipes" }] }).source).toBe("date");
	});
});

describe("hemisphereOf", () => {
	it("knows time zones of the southern hemisphere", () => {
		for (const zone of [
			"Australia/Sydney",
			"Pacific/Auckland",
			"America/Argentina/Buenos_Aires",
			"America/Sao_Paulo",
			"America/Santiago",
			"Africa/Johannesburg",
			"NZ",
			// Old names that browsers still report.
			"America/Mendoza",
			"America/Catamarca",
			"America/Jujuy",
			"America/Coyhaique",
			// South of the equator, if only just.
			"America/Recife",
			"America/Manaus",
			"Asia/Jakarta",
			"Africa/Kinshasa",
			"Pacific/Tahiti",
		]) {
			expect(hemisphereOf(zone), zone).toBe("south");
		}
	});

	it("counts everything else as north", () => {
		for (const zone of [
			"Europe/Berlin",
			"America/New_York",
			"Asia/Tokyo",
			"UTC",
			"Australia",
			"",
		]) {
			expect(hemisphereOf(zone), zone).toBe("north");
		}
		expect(hemisphereOf(undefined)).toBe("north");
	});
});

describe("folders", () => {
	it("give the theme of a key word in their name", () => {
		const result = pick("Untitled", { folders: [{ name: "Recipes" }] });
		expect(result.source).toBe("folder");
		expect(theme("food")).toContain(result.emoji);
	});

	it("give the theme their emoji stands for", () => {
		const byIcon = (icon: string) => pick("Untitled", { folders: [{ name: "Stuff", icon }] });
		expect(theme("drinks")).toContain(byIcon("🍷").emoji);
		// The first emoji of a theme stands for it, also when other themes have it too.
		expect(theme("garden")).toContain(byIcon("🌱").emoji);
		expect(theme("goals")).toContain(byIcon("🎯").emoji);
		expect(theme("planning")).toContain(byIcon("📅").emoji);
		// Others in several themes say nothing: is 🏆 about sport or goals?
		for (const icon of ["🏆", "📦", "📁", "📌"])
			expect(byIcon(icon).source, icon).toBe("fallback");
		// Also an emoji stored without the variation selector.
		expect(theme("travel")).toContain(
			pick("Untitled", { folders: [{ name: "B", icon: "✈" }] }).emoji,
		);
	});

	it("prefer a key word in their name to their emoji", () => {
		expect(theme("food")).toContain(
			pick("Untitled", { folders: [{ name: "Recipes", icon: "📚" }] }).emoji,
		);
	});

	it("use the folder above when the folder fits nothing", () => {
		const folders = [{ name: "2024" }, { name: "Travel" }];
		expect(theme("travel")).toContain(pick("Untitled", { folders }).emoji);
	});

	it("are ignored with an emoji outside the themes or a custom icon", () => {
		for (const icon of ["🦖", "custom:logo", "lucide:rocket"]) {
			expect(pick("Untitled", { folders: [{ name: "Stuff", icon }] }).source, icon).toBe(
				"fallback",
			);
		}
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
			const note = { name, folders: [], neighbours: [], recentPicks: [] };
			expect(pickAutoEmoji({ ...note, hemisphere: "north" }), name).toBeUndefined();
		}
		const inFolder = { folders: [{ name: "Grief journal" }], neighbours: [], recentPicks: [] };
		expect(
			pickAutoEmoji({ name: "Untitled", ...inFolder, hemisphere: "north" }),
		).toBeUndefined();
	});

	it("are found in any folder above, though only the nearest two give a theme", () => {
		const note = { neighbours: [], recentPicks: [], hemisphere: "north" } as const;
		const folders = [{ name: "10" }, { name: "2024" }, { name: "Grief journal" }];
		expect(pickAutoEmoji({ name: "Untitled", folders, ...note })).toBeUndefined();
		const travel = [{ name: "10" }, { name: "2024" }, { name: "Travel" }];
		expect(pickAutoEmoji({ name: "Untitled", folders: travel, ...note })?.source).toBe(
			"fallback",
		);
	});

	it("are found by whole words, leaving out words with other common meanings", () => {
		for (const name of ["Weight loss", "Terminal commands", "Die Reise", "Deadline", "Diet"]) {
			expect(isSensitive(name), name).toBe(false);
		}
	});
});

describe("fallback", () => {
	it("is one of the friendly emoji", () => {
		for (const random of [0, 0.3, 0.7, 0.99]) {
			const result = pick("Untitled", {}, () => random);
			expect(result.source).toBe("fallback");
			expect(friendly).toContain(result.emoji);
		}
		expect(pick("Untitled").emoji).toBe(friendly[0]);
	});

	it("has nothing festive, which would be out of place on a serious note", () => {
		for (const emoji of ["🎈", "🎁", "🎀", "🎠", "🎡", "🎉"])
			expect(friendly).not.toContain(emoji);
		// Nor emoji with other meanings online.
		for (const emoji of ["🍉", "🌽", "🐮"]) expect(friendly).not.toContain(emoji);
	});

	it("avoids the neighbours' emoji too", () => {
		expect(pick("Untitled", { neighbours: [friendly[0]] }).emoji).toBe(friendly[1]);
	});
});
