import { RAW_EMOJI_CATEGORIES, RawEmojiCategory } from "./emoji-data";

/**
 * The searchable emoji list behind the picker. Free of Obsidian and DOM code
 * so parsing and ranking can be unit tested.
 */

export interface EmojiEntry {
	emoji: string;
	/** Lower case English name, e.g. "grinning face". */
	name: string;
	/** Lower case tags and shortcodes, e.g. "happy", "tada". */
	keywords: string[];
}

export interface EmojiCategory {
	id: string;
	label: string;
	/** Emoji shown on the category tab. */
	icon: string;
	entries: EmojiEntry[];
}

function parseCategories(raw: readonly RawEmojiCategory[]): EmojiCategory[] {
	return raw.map((category) => ({
		id: category.id,
		label: category.label,
		icon: category.icon,
		entries: category.rows
			.split("\n")
			.filter((row) => row !== "")
			.map((row) => {
				const [emoji = "", name = "", keywords = ""] = row.split("|");
				return { emoji, name, keywords: keywords === "" ? [] : keywords.split(";") };
			}),
	}));
}

/** U+FE0F, which makes a character render as emoji (❤ vs ❤️). */
const VARIATION_SELECTOR = String.fromCodePoint(0xfe0f);

let catalog: EmojiCategory[] | null = null;
let byEmoji: Map<string, EmojiEntry> | null = null;

/** The bundled catalog, parsed on first use. */
export function getCatalog(): EmojiCategory[] {
	catalog ??= parseCategories(RAW_EMOJI_CATEGORIES);
	return catalog;
}

let fingerprint: string | null = null;

/**
 * A short fingerprint of the emoji list (which emoji, in which order), so
 * caches built from it can tell when the list changed with an update.
 */
export function catalogFingerprint(): string {
	if (fingerprint === null) {
		let hash = 5381;
		let count = 0;
		for (const category of getCatalog()) {
			for (const entry of category.entries) {
				count += 1;
				for (let i = 0; i < entry.emoji.length; i++) {
					hash = ((hash << 5) + hash + entry.emoji.charCodeAt(i)) | 0;
				}
			}
		}
		fingerprint = `${count}-${(hash >>> 0).toString(36)}`;
	}
	return fingerprint;
}

/** Prepares the catalog and the name lookup ahead of time (e.g. while Obsidian is idle). */
export function warmUpCatalog(): void {
	findEntry("");
}

/** The catalog entry of an emoji, e.g. to show its name. */
export function findEntry(emoji: string): EmojiEntry | undefined {
	if (!byEmoji) {
		byEmoji = new Map();
		for (const category of getCatalog()) {
			for (const entry of category.entries) byEmoji.set(entry.emoji, entry);
		}
	}
	// Also match when the variation selector differs (❤ vs ❤️).
	const bare = emoji.split(VARIATION_SELECTOR).join("");
	return byEmoji.get(emoji) ?? byEmoji.get(bare) ?? byEmoji.get(bare + VARIATION_SELECTOR);
}

/** Lower score is better; `undefined` means no match. */
function scoreTerm(entry: EmojiEntry, term: string): number | undefined {
	if (entry.name === term) return 0;
	if (entry.name.startsWith(term)) return 1;
	if (entry.name.split(" ").some((word) => word.startsWith(term))) return 2;
	if (entry.keywords.includes(term)) return 3;
	if (entry.keywords.some((keyword) => keyword.startsWith(term))) return 4;
	if (entry.name.includes(term)) return 5;
	if (entry.keywords.some((keyword) => keyword.includes(term))) return 6;
	return undefined;
}

/**
 * Emoji whose name or keywords match every word of `query`, best matches
 * first, then in catalog (Unicode) order. Shortcodes like `:tada:` work too.
 */
export function searchEmoji(
	categories: readonly EmojiCategory[],
	query: string,
	limit = 200,
): EmojiEntry[] {
	const terms = query
		.toLowerCase()
		.replace(/^:|:$/g, "")
		.replace(/[_-]/g, " ")
		.split(/\s+/)
		.filter((term) => term !== "");
	if (terms.length === 0) return [];

	const results: Array<{ entry: EmojiEntry; score: number; order: number }> = [];
	let order = 0;
	for (const category of categories) {
		for (const entry of category.entries) {
			order += 1;
			let score = 0;
			for (const term of terms) {
				const termScore = scoreTerm(entry, term);
				if (termScore === undefined) {
					score = -1;
					break;
				}
				score += termScore;
			}
			if (score >= 0) results.push({ entry, score, order });
		}
	}

	results.sort((a, b) => a.score - b.score || a.order - b.order);
	return results.slice(0, limit).map((result) => result.entry);
}
