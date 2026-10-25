import {
	FRIENDLY_EMOJI,
	HOLIDAY_EMOJI,
	Season,
	SEASON_EMOJI,
	SENSITIVE_WORDS,
	SOUTHERN_TIME_ZONES,
	THEMES,
} from "./auto-emoji-themes";

/**
 * Picks the emoji for a new note ("themed random"): one that fits its name, a
 * date in its name or its folder, else a pleasant one, chosen by chance among
 * those its neighbours don't use yet.
 *
 * Free of DOM and Obsidian code so it can be unit tested; the source of
 * randomness is passed in.
 */

export type Hemisphere = "north" | "south";

export interface NewNote {
	/** The note's name without `.md`. */
	name: string;
	/** Its folder, then the folder above it; never the vault root. */
	folders: ReadonlyArray<{ name: string; icon?: string }>;
	/** Icons of the other notes, folders and files directly in the same folder. */
	neighbours: readonly string[];
	/** The latest automatic picks of this session. */
	recentPicks: readonly string[];
	/** For the seasons of a date in the name. */
	hemisphere: Hemisphere;
}

/** What the pick is based on; `fallback` when nothing about the note fits a theme. */
export type PickSource = "name" | "date" | "folder" | "fallback";

export interface AutoPick {
	emoji: string;
	source: PickSource;
}

/** U+FE0F, which makes a character render as emoji (❤ vs ❤️); ignored when comparing. */
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);

function bare(emoji: string): string {
	return emoji.split(VARIATION_SELECTOR).join("");
}

/** The emoji of a list in `auto-emoji-themes.ts`. */
export function splitEmoji(list: string): string[] {
	return list.split(/\s+/).filter((emoji) => emoji !== "");
}

/** The key words of a list in `auto-emoji-themes.ts`. */
export function splitKeyWords(list: string): string[] {
	return list
		.split(",")
		.map((word) => word.trim().replace(/\s+/g, " "))
		.filter((word) => word !== "");
}

/**
 * The words of a note or folder name, as key words are written: lower case,
 * without accents, numbering, emoji or punctuation ("01 - Café trip.md" →
 * "cafe", "trip"). Words in camel case stay one word: split, "MacBook" would
 * be about books and "TypeScript" about nothing.
 */
export function nameWords(name: string): string[] {
	return name
		.replace(/\.md$/i, "")
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.split(/[^\p{L}]+/u)
		.filter((word) => word !== "");
}

interface KeyWord {
	themeEmoji: readonly string[];
	/** The one obvious emoji of this key word, if it has one. */
	hit?: string;
}

interface Index {
	keyWords: Map<string, KeyWord>;
	/** Words in the longest key word. */
	longest: number;
	/** The theme a folder emoji stands for, by emoji without variation selector (see `getIndex`). */
	themeOf: Map<string, readonly string[]>;
	sensitive: Set<string>;
	/** Words in the longest sensitive word. */
	longestSensitive: number;
	friendly: readonly string[];
}

let index: Index | null = null;

function getIndex(): Index {
	if (index) return index;
	const keyWords = new Map<string, KeyWord>();
	/** The first emoji of each theme, which stands for it. */
	const symbols = new Map<string, readonly string[]>();
	/** Every theme each emoji is in. */
	const themesOf = new Map<string, Set<readonly string[]>>();
	let longest = 1;
	const addKeyWords = (list: string, keyWord: KeyWord) => {
		for (const word of splitKeyWords(list)) {
			if (!keyWords.has(word)) keyWords.set(word, keyWord);
			longest = Math.max(longest, word.split(" ").length);
		}
	};
	for (const theme of THEMES) {
		const themeEmoji = splitEmoji(theme.emoji);
		addKeyWords(theme.words, { themeEmoji });
		const hits = Object.entries(theme.hits ?? {});
		for (const [hit, words] of hits) addKeyWords(words, { themeEmoji, hit });
		if (!symbols.has(bare(themeEmoji[0]))) symbols.set(bare(themeEmoji[0]), themeEmoji);
		for (const emoji of [...themeEmoji, ...hits.map(([hit]) => hit)]) {
			const themes = themesOf.get(bare(emoji)) ?? new Set();
			themesOf.set(bare(emoji), themes.add(themeEmoji));
		}
	}
	// A folder emoji stands for the theme it is the first emoji of, else for
	// the only theme it is in; one in several themes (🏆: sport or goals?) is
	// no clue at all.
	const themeOf = new Map(symbols);
	for (const [emoji, themes] of themesOf) {
		if (!themeOf.has(emoji) && themes.size === 1) themeOf.set(emoji, [...themes][0]);
	}
	const sensitive = new Set(splitKeyWords(SENSITIVE_WORDS));
	const longestSensitive = Math.max(...[...sensitive].map((word) => word.split(" ").length));
	index = {
		keyWords,
		longest,
		themeOf,
		sensitive,
		longestSensitive,
		friendly: splitEmoji(FRIENDLY_EMOJI),
	};
	return index;
}

/** Whether a name has a word of sad or serious notes (see `SENSITIVE_WORDS`). */
export function isSensitive(name: string): boolean {
	const { sensitive, longestSensitive } = getIndex();
	const words = nameWords(name);
	for (let start = 0; start < words.length; start++) {
		for (
			let length = 1;
			length <= longestSensitive && start + length <= words.length;
			length++
		) {
			if (sensitive.has(words.slice(start, start + length).join(" "))) return true;
		}
	}
	return false;
}

/** The longest key word that starts at `words[start]`, with its number of words. */
function keyWordAt(
	words: readonly string[],
	start: number,
): { keyWord: KeyWord; length: number } | undefined {
	const { keyWords, longest } = getIndex();
	for (let length = Math.min(longest, words.length - start); length > 0; length--) {
		const keyWord = keyWords.get(words.slice(start, start + length).join(" "));
		if (keyWord) return { keyWord, length };
	}
	return undefined;
}

/**
 * The key word that decides the theme of a name: the first one with an
 * obvious emoji, which is more specific than the others ("Mom's birthday" →
 * 🎂), else the first one.
 */
function findKeyWord(name: string): KeyWord | undefined {
	const words = nameWords(name);
	let first: KeyWord | undefined;
	for (let start = 0; start < words.length; start++) {
		const found = keyWordAt(words, start);
		if (!found) continue;
		if (found.keyWord.hit !== undefined) return found.keyWord;
		first ??= found.keyWord;
		// Its words don't count again: a "cover letter" is no letter.
		start += found.length - 1;
	}
	return first;
}

/** A day and month that exist in some year; returns the month. */
function validMonth(month: string, day = "01"): number | undefined {
	const m = Number(month);
	const d = Number(day);
	return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? m : undefined;
}

/** The month of a week as in ISO 8601: week 1 has January 4th; a week counts for its Thursday. */
function monthOfWeek(year: number, week: number): number | undefined {
	if (week < 1 || week > 53) return undefined;
	const mondayOfWeek1 = 4 - ((new Date(Date.UTC(year, 0, 4)).getUTCDay() + 6) % 7);
	const thursday = new Date(Date.UTC(year, 0, mondayOfWeek1 + 3 + (week - 1) * 7));
	return thursday.getUTCMonth() + 1;
}

/**
 * The month (1–12) of a name that starts with a date, as daily, weekly,
 * monthly and unique notes are named: 2024-05-31, 2024.05.31, 20240531 (also
 * with the time, 202405311230), 31.05.2024, 2024-W22, 2024-05.
 */
export function monthOfDate(name: string): number | undefined {
	const text = name.replace(/^[^\p{L}\p{N}]+/u, "");
	let match = /^\d{4}([-.])(\d{2})\1(\d{2})(?!\d)/.exec(text);
	if (match) return validMonth(match[2], match[3]);
	match = /^\d{4}(\d{2})(\d{2})(?:\d{4}|\d{6})?(?!\d)/.exec(text);
	if (match) return validMonth(match[1], match[2]);
	match = /^(\d{2})\.(\d{2})\.\d{4}(?!\d)/.exec(text);
	if (match) return validMonth(match[2], match[1]);
	match = /^(\d{4})-?W(\d{2})(?!\d)/i.exec(text);
	if (match) return monthOfWeek(Number(match[1]), Number(match[2]));
	match = /^\d{4}-(\d{2})(?!\d)/.exec(text);
	return match ? validMonth(match[1]) : undefined;
}

/** Seasons of the northern hemisphere by month, starting with January. */
const NORTHERN_SEASONS: readonly Season[] = [
	"winter",
	"winter",
	"spring",
	"spring",
	"spring",
	"summer",
	"summer",
	"summer",
	"autumn",
	"autumn",
	"autumn",
	"winter",
];

/** Emoji for a date in `month` (1–12): its season's, plus its holiday's. */
export function seasonEmoji(month: number, hemisphere: Hemisphere): string[] {
	const season = NORTHERN_SEASONS[(month - 1 + (hemisphere === "south" ? 6 : 0)) % 12];
	return [...splitEmoji(SEASON_EMOJI[season]), ...splitEmoji(HOLIDAY_EMOJI[month] ?? "")];
}

/** The hemisphere of a time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). */
export function hemisphereOf(timeZone: string | undefined): Hemisphere {
	if (!timeZone) return "north";
	const south = SOUTHERN_TIME_ZONES.some((zone) =>
		zone.endsWith("/") ? timeZone.startsWith(zone) : timeZone === zone,
	);
	return south ? "south" : "north";
}

/**
 * One of the least used emoji of `pool`, by chance: first those no neighbour
 * uses, then those not among the latest automatic picks.
 */
function choose(pool: readonly string[], note: NewNote, random: () => number): string {
	const neighbours = new Map<string, number>();
	for (const icon of note.neighbours)
		neighbours.set(bare(icon), (neighbours.get(bare(icon)) ?? 0) + 1);
	const recent = new Set(note.recentPicks.map(bare));

	let least: string[] = [];
	let leastUses = Infinity;
	for (const emoji of pool) {
		// A neighbour's emoji weighs more than any recent pick.
		const uses = (neighbours.get(bare(emoji)) ?? 0) * 2 + (recent.has(bare(emoji)) ? 1 : 0);
		if (uses < leastUses) {
			least = [];
			leastUses = uses;
		}
		if (uses === leastUses) least.push(emoji);
	}
	return least[Math.min(least.length - 1, Math.floor(random() * least.length))];
}

/**
 * The emoji for a new note. The first source that fits wins:
 *
 * 1. a key word in its name (see `findKeyWord`): its obvious emoji ("pizza" →
 *    🍕) unless a neighbour has it, else one of its theme;
 * 2. a date its name starts with: the season (and holiday) of its month;
 * 3. its folder, else the folder above: a key word in the folder's name, or
 *    the folder's own emoji when that stands for a theme;
 * 4. the friendly emoji.
 *
 * `undefined` for a sad or serious note (its name or folder has a word of
 * `SENSITIVE_WORDS`): no emoji fits there.
 */
export function pickAutoEmoji(
	note: NewNote,
	random: () => number = Math.random,
): AutoPick | undefined {
	if ([note.name, ...note.folders.map((folder) => folder.name)].some(isSensitive)) {
		return undefined;
	}
	const keyWord = findKeyWord(note.name);
	if (keyWord) {
		const { hit } = keyWord;
		if (hit !== undefined && !note.neighbours.some((icon) => bare(icon) === bare(hit))) {
			return { emoji: hit, source: "name" };
		}
		return { emoji: choose(keyWord.themeEmoji, note, random), source: "name" };
	}

	const month = monthOfDate(note.name);
	if (month !== undefined) {
		return { emoji: choose(seasonEmoji(month, note.hemisphere), note, random), source: "date" };
	}

	for (const folder of note.folders) {
		const theme =
			findKeyWord(folder.name)?.themeEmoji ??
			(folder.icon === undefined ? undefined : getIndex().themeOf.get(bare(folder.icon)));
		if (theme) return { emoji: choose(theme, note, random), source: "folder" };
	}

	return { emoji: choose(getIndex().friendly, note, random), source: "fallback" };
}
