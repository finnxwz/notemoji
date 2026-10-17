import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	firstGrapheme,
	isEmojiLike,
	parseEmojiInput,
	sanitizeStoredEmoji,
} from "../src/emoji";

describe("firstGrapheme", () => {
	it("returns the whole sequence for multi code point emoji", () => {
		assert.equal(firstGrapheme("👨‍👩‍👧‍👦rest"), "👨‍👩‍👧‍👦");
		assert.equal(firstGrapheme("🇩🇪🇺🇸"), "🇩🇪");
		assert.equal(firstGrapheme("👍🏽!"), "👍🏽");
		assert.equal(firstGrapheme("1️⃣2"), "1️⃣");
		assert.equal(firstGrapheme("🏴󠁧󠁢󠁳󠁣󠁴󠁿x"), "🏴󠁧󠁢󠁳󠁣󠁴󠁿");
	});

	it("returns single characters for plain text", () => {
		assert.equal(firstGrapheme("abc"), "a");
		assert.equal(firstGrapheme("🚀🎉"), "🚀");
		assert.equal(firstGrapheme(""), "");
	});
});

describe("isEmojiLike", () => {
	it("accepts emoji and symbol clusters", () => {
		for (const value of [
			"🚀",
			"❤️",
			"❤",
			"☺️",
			"🇩🇪",
			"👍🏽",
			"👨‍👩‍👧‍👦",
			"1️⃣",
			"#️⃣",
			"🏴󠁧󠁢󠁳󠁣󠁴󠁿",
			"★",
			"→",
		]) {
			assert.equal(isEmojiLike(value), true, `expected ${JSON.stringify(value)} to be emoji-like`);
		}
	});

	it("rejects words, digits, punctuation and bare modifiers", () => {
		for (const value of ["", "a", "hello", "1", "42", ".", "!", "§", "é", "\u0301", "\uFE0F", "\u200D"]) {
			assert.equal(isEmojiLike(value), false, `expected ${JSON.stringify(value)} to be rejected`);
		}
	});
});

describe("parseEmojiInput", () => {
	it("treats empty and whitespace-only input as a removal", () => {
		for (const value of ["", "   ", "\n\t", "\u200B\uFEFF"]) {
			const parsed = parseEmojiInput(value);
			assert.equal(parsed.status, "empty");
			assert.equal(parsed.emoji, "");
		}
	});

	it("keeps multi code point sequences intact", () => {
		for (const value of ["🚀", "🇩🇪", "👍🏽", "👨‍👩‍👧‍👦", "1️⃣", "❤️", "❤", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"]) {
			const parsed = parseEmojiInput(value);
			assert.equal(parsed.status, "ok", `expected ${JSON.stringify(value)} to be accepted`);
			assert.equal(parsed.emoji, value);
			assert.equal(parsed.extra, false);
		}
	});

	it("trims surrounding whitespace and invisible characters", () => {
		const parsed = parseEmojiInput("  \uFEFF🚀 \u200B ");
		assert.equal(parsed.status, "ok");
		assert.equal(parsed.emoji, "🚀");
		assert.equal(parsed.extra, false);
	});

	it("uses the first emoji when several were entered", () => {
		const parsed = parseEmojiInput("🚀🎉");
		assert.equal(parsed.status, "ok");
		assert.equal(parsed.emoji, "🚀");
		assert.equal(parsed.extra, true);
		assert.notEqual(parsed.message, "");
	});

	it("rejects text that does not start with an emoji", () => {
		for (const value of ["hello", "hi 🚀", "note.md", "42 🚀", ". 🚀"]) {
			const parsed = parseEmojiInput(value);
			assert.equal(parsed.status, "invalid", `expected ${JSON.stringify(value)} to be invalid`);
			assert.equal(parsed.emoji, "");
			assert.notEqual(parsed.message, "");
		}
	});

	it("rejects bare modifiers and joiners", () => {
		for (const value of ["\uFE0F", "\u200D", "\u0301"]) {
			assert.equal(parseEmojiInput(value).status, "invalid");
		}
	});

	it("rejects absurdly long sequences instead of storing junk", () => {
		assert.equal(parseEmojiInput("👨‍".repeat(40) + "👨").status, "invalid");
	});
});

describe("sanitizeStoredEmoji", () => {
	it("normalises stored values", () => {
		assert.equal(sanitizeStoredEmoji("  🚀 "), "🚀");
		assert.equal(sanitizeStoredEmoji("👨‍👩‍👧‍👦"), "👨‍👩‍👧‍👦");
	});

	it("keeps the first emoji of a stored value that holds several", () => {
		assert.equal(sanitizeStoredEmoji("🚀🎉"), "🚀");
	});

	it("rejects anything that is not a usable emoji", () => {
		for (const value of [null, undefined, 42, true, {}, [], "hello", ""]) {
			assert.equal(sanitizeStoredEmoji(value), undefined);
		}
	});
});
