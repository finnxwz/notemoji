/**
 * Emoji helpers.
 *
 * The plugin intentionally ships no emoji database and no emoji assets: every
 * character that is supported by the operating system, the Electron renderer
 * and the active fonts can be used as an icon. These helpers only normalise and
 * validate user input so that a note or folder always stores a single, complete
 * emoji sequence.
 *
 * "Single" means a single grapheme cluster, so multi code point sequences such
 * as flags (🇩🇪), skin tone modifiers (👍🏽), variation selectors (❤️), keycaps
 * (1️⃣) and zero width joiner families (👨‍👩‍👧‍👦) stay intact.
 */

/** Invisible characters that are never a meaningful part of an icon. */
const INVISIBLE_CHARS = /[\u00AD\u200B\u2060\uFEFF]/g;

/** Core of an emoji: a pictographic character, a regional indicator or a keycap. */
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]|[0-9#*]\uFE0F?\u20E3/u;

/**
 * Characters that prevent an input from being used as an icon: letters, digits,
 * punctuation, whitespace and control characters.
 */
const FORBIDDEN_ICON_CHARS = /[\p{L}\p{N}\p{P}\p{Z}\p{C}]/u;

/** Combining marks, tested per character to avoid a misleading character class. */
const COMBINING_MARK = /\p{M}/u;

/** True for a single code point that is emoji part and needs a base character. */
function isEmojiPart(codePoint: number): boolean {
	// Zero width joiner, combining enclosing keycap, text and emoji variation selectors.
	if (
		codePoint === 0x200d ||
		codePoint === 0x20e3 ||
		codePoint === 0xfe0e ||
		codePoint === 0xfe0f
	) {
		return true;
	}
	// Skin tone modifiers.
	if (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) return true;
	// Tag characters, used by subdivision flags.
	if (codePoint >= 0xe0020 && codePoint <= 0xe007f) return true;
	// Combining marks without a base character.
	return COMBINING_MARK.test(String.fromCodePoint(codePoint));
}

/** True when a cluster consists only of emoji parts, i.e. has no base character. */
function isEmojiPartsOnly(cluster: string): boolean {
	if (cluster === "") return false;
	for (const character of cluster) {
		const codePoint = character.codePointAt(0);
		if (codePoint === undefined || !isEmojiPart(codePoint)) return false;
	}
	return true;
}

/**
 * Fallback pattern that matches a leading emoji sequence. Only used when
 * `Intl.Segmenter` is unavailable (it is present in every Obsidian version we
 * support), so tag sequences are matched best effort.
 */
const EMOJI_SEQUENCE = new RegExp(
	"^(?:" +
		"\\p{Regional_Indicator}{2}" +
		"|[0-9#*]\\uFE0F?\\u20E3" +
		"|\\p{Extended_Pictographic}\\uFE0F?" +
		"(?:\\p{Emoji_Modifier})?" +
		"(?:\\u200D\\p{Extended_Pictographic}\\uFE0F?(?:\\p{Emoji_Modifier})?)*" +
		"[\\u{E0020}-\\u{E007F}]*" +
		")",
	"u",
);

/** Longest emoji sequence we are willing to store (safety net, not a restriction). */
export const MAX_STORED_EMOJI_LENGTH = 64;

export type EmojiParseStatus = "empty" | "ok" | "invalid";

export interface EmojiParseResult {
	/** `empty`: nothing entered (remove), `ok`: usable emoji, `invalid`: rejected. */
	status: EmojiParseStatus;
	/** Normalised emoji; empty unless the status is `ok`. */
	emoji: string;
	/** True when the input contained more content after the first emoji. */
	extra: boolean;
	/** Hint for the UI; empty when there is nothing to report. */
	message: string;
}

interface GraphemeSegmenter {
	segment(input: string): Iterable<{ segment: string }>;
}

type GraphemeSegmenterConstructor = new (
	locales?: string | string[],
	options?: { granularity: "grapheme" },
) => GraphemeSegmenter;

const SegmenterConstructor = (Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor })
	.Segmenter;

/** Shared grapheme segmenter; `undefined` when `Intl.Segmenter` is unavailable. */
const graphemeSegmenter: GraphemeSegmenter | undefined = SegmenterConstructor
	? new SegmenterConstructor(undefined, { granularity: "grapheme" })
	: undefined;

function stripInvisible(text: string): string {
	return text.replace(INVISIBLE_CHARS, "");
}

/**
 * Returns the first grapheme cluster of `text`.
 *
 * Uses `Intl.Segmenter` whenever possible, so emoji sequences with skin tones,
 * variation selectors, regional indicators, keycaps and zero width joiners are
 * treated as one unit.
 */
export function firstGrapheme(text: string): string {
	if (text === "") return "";

	if (graphemeSegmenter) {
		for (const { segment } of graphemeSegmenter.segment(text)) return segment;
		return "";
	}

	const match = EMOJI_SEQUENCE.exec(text);
	if (match) return match[0];

	const codePoint = text.codePointAt(0);
	return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
}

/**
 * True when `cluster` can be used as an icon: either it contains an emoji base
 * character, or it consists solely of symbol characters (`★`, `→`, …).
 */
export function isEmojiLike(cluster: string): boolean {
	if (cluster.length === 0) return false;
	if (EMOJI_CORE.test(cluster)) return true;
	if (isEmojiPartsOnly(cluster)) return false;
	return !FORBIDDEN_ICON_CHARS.test(cluster);
}

/**
 * Parses raw user input from the emoji modal.
 *
 * Never throws; anything that cannot be used as an icon is reported as
 * `invalid` so the UI can explain the problem instead of storing junk.
 */
export function parseEmojiInput(raw: string): EmojiParseResult {
	const cleaned = stripInvisible(raw).trim();
	if (cleaned === "") {
		return { status: "empty", emoji: "", extra: false, message: "" };
	}

	const cluster = firstGrapheme(cleaned);
	if (cluster === "" || cluster.length > MAX_STORED_EMOJI_LENGTH || !isEmojiLike(cluster)) {
		return {
			status: "invalid",
			emoji: "",
			extra: false,
			message: "That does not look like an emoji. Enter a single emoji, for example 🚀.",
		};
	}

	const extra = stripInvisible(cleaned.slice(cluster.length)).trim() !== "";
	return {
		status: "ok",
		emoji: cluster,
		extra,
		message: extra ? "Only the first emoji is used." : "",
	};
}

/**
 * Normalises a value that was read from the plugin data file.
 * Returns `undefined` for anything that is not a usable emoji.
 */
export function sanitizeStoredEmoji(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = parseEmojiInput(value);
	return parsed.status === "ok" ? parsed.emoji : undefined;
}
