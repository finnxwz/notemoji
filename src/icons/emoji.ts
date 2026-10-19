/**
 * Emoji validation.
 *
 * Any single grapheme cluster that the system can draw counts as an icon:
 * emoji including multi code point sequences (🇩🇪 👍🏽 ❤️ 1️⃣ 👨‍👩‍👧‍👦) and plain
 * symbols (★ → ✓). Letters, digits, punctuation and whitespace do not, so
 * values such as other plugins' icon names (`LiHome`) are never mistaken for an emoji.
 */

/** Invisible characters that are never a meaningful part of an icon. */
const INVISIBLE_CHARS = /[\u00AD\u200B\u2060\uFEFF]/g;

/** Core of an emoji: a pictographic character, a regional indicator or a keycap. */
const EMOJI_CORE = /[\p{Extended_Pictographic}\p{Regional_Indicator}]|[0-9#*]\uFE0F?\u20E3/u;

/** Characters that rule out a symbol icon: letters, digits, punctuation, spaces, controls. */
const FORBIDDEN_ICON_CHARS = /[\p{L}\p{N}\p{P}\p{Z}\p{C}]/u;

/** Combining marks, tested per character. */
const COMBINING_MARK = /^\p{M}$/u;

/**
 * True for a code point that only modifies a base character: joiner,
 * keycap, variation selectors, skin tones, tag characters, combining marks.
 */
function isEmojiPart(char: string): boolean {
	const codePoint = char.codePointAt(0) ?? 0;
	if ([0x200d, 0x20e3, 0xfe0e, 0xfe0f].includes(codePoint)) return true;
	if (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) return true;
	if (codePoint >= 0xe0020 && codePoint <= 0xe007f) return true;
	return COMBINING_MARK.test(char);
}

/** Longest sequence we are willing to store (safety net, not a restriction). */
export const MAX_EMOJI_LENGTH = 64;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function stripInvisible(text: string): string {
	return text.replace(INVISIBLE_CHARS, "");
}

/** The first grapheme cluster of `text`, so multi code point emoji stay whole. */
export function firstGrapheme(text: string): string {
	for (const { segment } of segmenter.segment(text)) return segment;
	return "";
}

/** True when `cluster` can be used as an icon (emoji or symbol). */
export function isEmojiLike(cluster: string): boolean {
	if (cluster === "" || cluster.length > MAX_EMOJI_LENGTH) return false;
	if (EMOJI_CORE.test(cluster)) return true;
	if ([...cluster].every(isEmojiPart)) return false;
	return !FORBIDDEN_ICON_CHARS.test(cluster);
}

export type EmojiParseResult =
	| { status: "empty"; emoji: ""; extra: false; message: "" }
	| { status: "ok"; emoji: string; extra: boolean; message: string }
	| { status: "invalid"; emoji: ""; extra: false; message: string };

/**
 * Parses user input (search field, paste). Never throws: anything that cannot
 * be used is reported as `invalid` with a message for the UI.
 */
export function parseEmojiInput(raw: string): EmojiParseResult {
	const cleaned = stripInvisible(raw).trim();
	if (cleaned === "") return { status: "empty", emoji: "", extra: false, message: "" };

	const cluster = firstGrapheme(cleaned);
	if (!isEmojiLike(cluster)) {
		return {
			status: "invalid",
			emoji: "",
			extra: false,
			message: "That does not look like an emoji.",
		};
	}

	const extra = cleaned.slice(cluster.length).trim() !== "";
	return {
		status: "ok",
		emoji: cluster,
		extra,
		message: extra ? "Only the first emoji is used." : "",
	};
}

/** Normalises a value read from data.json (lenient: keeps the first emoji). */
export function sanitizeStoredEmoji(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = parseEmojiInput(value);
	return parsed.status === "ok" ? parsed.emoji : undefined;
}

/** What a note's `icon` property holds, from Notemoji's point of view. */
export type IconValue =
	| { kind: "none" }
	| { kind: "emoji"; emoji: string }
	/** Something else, e.g. another plugin's icon name or a later `custom:` icon. Never touched silently. */
	| { kind: "other"; value: unknown };

/** Strict: only a value that is exactly one emoji counts. */
export function parseIconValue(value: unknown): IconValue {
	if (value === undefined || value === null) return { kind: "none" };
	if (typeof value !== "string") return { kind: "other", value };
	const parsed = parseEmojiInput(value);
	if (parsed.status === "empty") return { kind: "none" };
	if (parsed.status === "ok" && !parsed.extra) return { kind: "emoji", emoji: parsed.emoji };
	return { kind: "other", value };
}
