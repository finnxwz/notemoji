import { findEntry } from "../picker/catalog";
import { FRIENDLY_EMOJI, THEMES, UNTITLED_NAMES } from "./auto-emoji-themes";

/**
 * Picks the emoji for a new note, from its name:
 *
 * 1. a word with one obvious emoji ("pizza" → 🍕), or the name of an emoji of
 *    the lists ("guitar" → 🎸): that emoji;
 * 2. a key word of a theme ("trip"): one of the theme's emoji, by chance;
 * 3. otherwise one that suits any note, by chance.
 *
 * Free of DOM and Obsidian code so it can be unit tested; the source of
 * randomness is passed in.
 */

export interface NewNote {
	/** The note's name without `.md`. */
	name: string;
}

/** What the pick is based on; `fallback` when nothing in the name fits. */
export type PickSource = "exact" | "theme" | "fallback";

export interface AutoPick {
	emoji: string;
	source: PickSource;
}

/** Without invisible format characters (U+200C and the like), lower case. */
function comparable(name: string): string {
	return name
		.replace(/\p{Cf}/gu, "")
		.trim()
		.toLowerCase();
}

let untitledNames: ReadonlySet<string> | undefined;

/**
 * Whether a note still has the name Obsidian gave it when it was made
 * ("Untitled", "Untitled 2", "Unbenannt" …), so its real name is still to come.
 */
export function isUntitled(name: string): boolean {
	untitledNames ??= new Set(UNTITLED_NAMES.map(comparable));
	return untitledNames.has(comparable(name.replace(/ \d+$/, "")));
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

interface Index {
	/** Words and phrases with their one emoji: obvious hits, then emoji names. */
	exact: Map<string, string>;
	/** Key words of themes with their theme's emoji. */
	themes: Map<string, readonly string[]>;
	/** Words in the longest word or phrase of `exact` and `themes`. */
	longest: number;
	friendly: readonly string[];
}

let index: Index | null = null;

function getIndex(): Index {
	if (index) return index;
	const exact = new Map<string, string>();
	const themes = new Map<string, readonly string[]>();
	let longest = 1;
	const add = <T>(map: Map<string, T>, word: string, value: T) => {
		if (map.has(word)) return;
		map.set(word, value);
		longest = Math.max(longest, word.split(" ").length);
	};
	const friendly = splitEmoji(FRIENDLY_EMOJI);
	const listed = new Set<string>(friendly);
	for (const theme of THEMES) {
		const themeEmoji = splitEmoji(theme.emoji);
		for (const word of splitKeyWords(theme.words)) add(themes, word, themeEmoji);
		for (const [hit, words] of Object.entries(theme.hits ?? {})) {
			for (const word of splitKeyWords(words)) add(exact, word, hit);
			listed.add(hit);
		}
		for (const emoji of themeEmoji) listed.add(emoji);
	}
	// The names of the listed emoji only: a name in the title is as obvious as
	// a hit, but the full list has emoji no note should get ("bomb" → 💣).
	for (const emoji of listed) {
		const name = findEntry(emoji)?.name;
		if (name !== undefined) add(exact, nameWords(name).join(" "), emoji);
	}
	index = { exact, themes, longest, friendly };
	return index;
}

/** The phrases of up to `longest` words that start at `words[start]`, longest first. */
function* phrasesAt(
	words: readonly string[],
	start: number,
	longest: number,
): Generator<{ phrase: string; length: number }> {
	for (let length = Math.min(longest, words.length - start); length > 0; length--) {
		yield { phrase: words.slice(start, start + length).join(" "), length };
	}
}

function pickFrom(pool: readonly string[], random: () => number): string {
	return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * The emoji for a new note (see the top of this file). An obvious emoji
 * anywhere in the name beats a theme ("Pizza with the team" → 🍕); of two of
 * a kind, the first in the name wins.
 */
export function pickAutoEmoji(note: NewNote, random: () => number = Math.random): AutoPick {
	const { exact, themes, longest, friendly } = getIndex();
	const words = nameWords(note.name);
	let theme: readonly string[] | undefined;
	for (let start = 0; start < words.length; start++) {
		for (const { phrase, length } of phrasesAt(words, start, longest)) {
			const emoji = exact.get(phrase);
			if (emoji !== undefined) return { emoji, source: "exact" };
			const themeEmoji = themes.get(phrase);
			if (!themeEmoji) continue;
			theme ??= themeEmoji;
			// Its words don't count again: a "cover letter" is no letter.
			start += length - 1;
			break;
		}
	}
	if (theme) return { emoji: pickFrom(theme, random), source: "theme" };
	return { emoji: pickFrom(friendly, random), source: "fallback" };
}
