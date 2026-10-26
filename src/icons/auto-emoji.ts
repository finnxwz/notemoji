import { findEntry } from "../picker/catalog";
import {
	FRIENDLY_EMOJI,
	LANGUAGES,
	LanguageWords,
	NAMES_LEFT_OUT,
	THEMES,
	UNTITLED_NAMES,
} from "./auto-emoji-themes";

/**
 * Picks the emoji for a new note, from its name (English words, and those of
 * the language Obsidian runs in):
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
	/** The language Obsidian runs in (`getLanguage()`), e.g. "de"; English words always count. */
	language?: string;
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
 * The words of a note's name, as key words are compared: lower case, without
 * accents, numbering, emoji or punctuation, ß as ss ("01 - Café trip" →
 * "cafe", "trip"; "Fußball" and Swiss "Fussball" alike). Words in camel case
 * stay one word: split, "MacBook" would be about books and "TypeScript" about
 * nothing.
 */
export function nameWords(name: string): string[] {
	return name
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/ß/g, "ss")
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

const indexes = new Map<string, Index>();

/** The words of a language Obsidian reports ("de", "pt-BR" → "pt"), and their code. */
function languageWords(language: string | undefined): [string, LanguageWords] | undefined {
	if (language === undefined) return undefined;
	for (const code of [language, language.split("-")[0]]) {
		if (Object.hasOwn(LANGUAGES, code)) return [code, LANGUAGES[code]];
	}
	return undefined;
}

/** The words of `language` (only English when there are none) with their emoji. */
function getIndex(language: string | undefined): Index {
	const found = languageWords(language);
	const key = found?.[0] ?? "en";
	const words = found?.[1];
	const cached = indexes.get(key);
	if (cached) return cached;

	const exact = new Map<string, string>();
	const themes = new Map<string, readonly string[]>();
	let longest = 1;
	/** English words the other language gives another meaning, or none. */
	let skipped = new Set<string>();
	// Written like names, so lists may use capitals and accents ("Zahnärztin").
	const add = <T>(map: Map<string, T>, list: string, value: T) => {
		for (const word of splitKeyWords(list).map((entry) => nameWords(entry).join(" "))) {
			if (word === "" || map.has(word) || skipped.has(word)) continue;
			map.set(word, value);
			longest = Math.max(longest, word.split(" ").length);
		}
	};
	const themeEmoji = new Map(THEMES.map((theme) => [theme.id, splitEmoji(theme.emoji)]));
	const friendly = splitEmoji(FRIENDLY_EMOJI);
	const listed = new Set<string>(friendly);

	// The other language first: its meaning wins where a word is in both.
	if (words) {
		for (const [id, list] of Object.entries(words.themes)) {
			const emoji = themeEmoji.get(id);
			if (emoji) add(themes, list, emoji);
		}
		for (const [hit, list] of Object.entries(words.hits)) {
			add(exact, list, hit);
			listed.add(hit);
		}
		// English words don't count where this language has a meaning of its own.
		skipped = new Set([
			...exact.keys(),
			...themes.keys(),
			...splitKeyWords(words.notEnglish ?? "").map((word) => nameWords(word).join(" ")),
		]);
	}
	for (const theme of THEMES) {
		const emoji = themeEmoji.get(theme.id) ?? [];
		add(themes, theme.words, emoji);
		for (const [hit, list] of Object.entries(theme.hits ?? {})) {
			add(exact, list, hit);
			listed.add(hit);
		}
		for (const entry of emoji) listed.add(entry);
	}
	// The names of the listed emoji only: a name in the title is as obvious as
	// a hit, but the full list has emoji no note should get ("bomb" → 💣). Not
	// where a theme has the word (a name never turns "house" into 🏠 only), nor
	// names that are common words for other things ("turkey", "chicken").
	const leftOut = new Set(splitEmoji(NAMES_LEFT_OUT));
	for (const emoji of listed) {
		const name = findEntry(emoji)?.name;
		if (name === undefined || leftOut.has(emoji)) continue;
		if (!themes.has(nameWords(name).join(" "))) add(exact, name, emoji);
	}
	const index = { exact, themes, longest, friendly };
	indexes.set(key, index);
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
	const { exact, themes, longest, friendly } = getIndex(note.language);
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
