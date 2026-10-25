import { describe, expect, it } from "vitest";
import { findEditorLinks, LinkToken, markdownLinkTarget } from "../../src/display/editor-links";

type Part = string | [text: string, classes: string];

/** Text made of plain parts and tokens with classes, as Obsidian's editor parses it. */
function links(...parts: Part[]) {
	let text = "";
	const tokens: LinkToken[] = [];
	for (const part of parts) {
		const [chunk, classes] = typeof part === "string" ? [part, ""] : part;
		if (classes !== "") {
			tokens.push({
				from: text.length,
				to: text.length + chunk.length,
				classes: classes.split(" "),
			});
		}
		text += chunk;
	}
	return findEditorLinks(tokens, (from, to) => text.slice(Math.max(0, from), Math.max(0, to)));
}

const START: Part = ["[[", "formatting-link formatting-link-start"];
const END: Part = ["]]", "formatting-link formatting-link-end"];
const wiki = (target: string): Part[] => [START, [target, "hmd-internal-link"], END];
const aliased = (target: string, alias: string): Part[] => [
	START,
	[target, "hmd-internal-link link-has-alias"],
	["|", "hmd-internal-link link-alias-pipe"],
	[alias, "hmd-internal-link link-alias"],
	END,
];
/** `[text](url)` as CodeMirror's Markdown mode marks it. */
const markdown = (text: string, url: string): Part[] => [
	["[", "formatting formatting-link link"],
	[text, "link"],
	["]", "formatting formatting-link link"],
	["(", "formatting formatting-link-string string url"],
	[url, "string url"],
	[")", "formatting formatting-link-string string url"],
];

describe("findEditorLinks", () => {
	it("finds wikilinks, with the place right before the brackets", () => {
		expect(links("See ", ...wiki("Rome"), " and ", ...wiki("Trips/Paris#Day 1"))).toEqual([
			{ at: 4, linktext: "Rome" },
			{ at: 17, linktext: "Trips/Paris#Day 1" },
		]);
	});

	it("reads the target of aliased links, never the alias", () => {
		// The alias is the name of a note too: still one link, to the target.
		expect(links(...aliased("Trips/Rome", "Rome"))).toEqual([
			{ at: 0, linktext: "Trips/Rome" },
		]);
	});

	it("joins a target split into several tokens", () => {
		expect(
			links(START, ["Rome", "hmd-internal-link"], ["#Day 1", "hmd-internal-link"], END),
		).toEqual([{ at: 0, linktext: "Rome#Day 1" }]);
	});

	it("finds links right next to each other and at the very end", () => {
		expect(links(...wiki("A"), ...wiki("B"))).toEqual([
			{ at: 0, linktext: "A" },
			{ at: 5, linktext: "B" },
		]);
		expect(links("x ", START, ["A", "hmd-internal-link"])).toEqual([{ at: 2, linktext: "A" }]);
	});

	it("leaves out embeds", () => {
		expect(links("!", ...wiki("Rome"))).toEqual([]);
		expect(links("!", ...markdown("photo", "photo.png"))).toEqual([]);
	});

	it("reads the target of links in tables, where the pipe is escaped", () => {
		expect(
			links(
				START,
				["Rome\\", "hmd-internal-link link-has-alias"],
				["|", "hmd-internal-link link-alias-pipe"],
				["R", "hmd-internal-link link-alias"],
				END,
			),
		).toEqual([{ at: 0, linktext: "Rome" }]);
	});

	it("ignores link classes where the text is not a link", () => {
		// Not after `[[`, e.g. when another Obsidian version splits tokens differently.
		expect(links("[", ["Rome", "hmd-internal-link"], "]")).toEqual([]);
		expect(links([" ", "hmd-internal-link"])).toEqual([]);
		// A URL without `[text](` before it: a bare or angle-bracket link.
		expect(links(["https://example.com", "url"])).toEqual([]);
		expect(links("(", ["note.md", "string url"], ")")).toEqual([]);
	});

	it("finds Markdown links to notes, but not external ones", () => {
		// As written: the path is decoded where it is resolved.
		expect(links("Go ", ...markdown("there", "My%20note.md"))).toEqual([
			{ at: 3, linktext: "My%20note.md" },
		]);
		expect(links(...markdown("web", "https://example.com"))).toEqual([]);
		expect(links(...markdown("mail", "mailto:me@example.com"))).toEqual([]);
		expect(links(...markdown("app", "obsidian://open?file=A"))).toEqual([]);
	});

	it("never takes a `[` of something else for the start of a later link", () => {
		// `[foo]` before an image: the image's own `[` is marked as an image, not as a link.
		const bracketed: Part[] = [
			["[", "formatting formatting-link link"],
			["foo", "link"],
			["]", "formatting formatting-link link"],
		];
		const image: Part[] = [
			["!", "formatting formatting-image image image-marker"],
			["[", "formatting formatting-image image image-alt-text link"],
			["]", "formatting formatting-image image image-alt-text link"],
			["(", "formatting formatting-link-string string url"],
			["photo.png", "string url"],
			[")", "formatting formatting-link-string string url"],
		];
		expect(links(...bracketed, " and ", ...image)).toEqual([]);
		expect(links(...bracketed, ...image)).toEqual([]);
		expect(links(...bracketed, " and ", ...markdown("t", "note.md"))).toEqual([
			{ at: 10, linktext: "note.md" },
		]);
	});

	it("finds Markdown links with angle brackets", () => {
		expect(links(...markdown("t", "<My note.md>"))).toEqual([
			{ at: 0, linktext: "My note.md" },
		]);
		expect(
			links(
				["[", "formatting formatting-link link"],
				["t", "link"],
				["]", "formatting formatting-link link"],
				["(<", "formatting formatting-link-string string url"],
				["My note.md", "string url"],
				[">)", "formatting formatting-link-string string url"],
			),
		).toEqual([{ at: 0, linktext: "My note.md" }]);
	});

	it("reads parentheses inside angle brackets as part of the name, not as a title", () => {
		expect(links(...markdown("t", "<Trip (2)>"))).toEqual([{ at: 0, linktext: "Trip (2)" }]);
		expect(
			links(
				["[", "formatting formatting-link link"],
				["t", "link"],
				["]", "formatting formatting-link link"],
				["(<", "formatting formatting-link-string string url"],
				["Trip (2)", "string url"],
				[">)", "formatting formatting-link-string string url"],
			),
		).toEqual([{ at: 0, linktext: "Trip (2)" }]);
		// Outside them it is one.
		expect(links(...markdown("t", "Trip (2)"))).toEqual([{ at: 0, linktext: "Trip" }]);
	});
});

describe("markdownLinkTarget", () => {
	it("drops a title and angle brackets, and keeps the path as written", () => {
		expect(markdownLinkTarget("Trips/My%20trip.md")).toBe("Trips/My%20trip.md");
		expect(markdownLinkTarget('note.md "A title"')).toBe("note.md");
		expect(markdownLinkTarget("<Trip (2)>")).toBe("Trip (2)");
		expect(markdownLinkTarget("<My note.md>")).toBe("My note.md");
		expect(markdownLinkTarget("100%.md")).toBe("100%.md");
		expect(markdownLinkTarget("#Heading")).toBe("#Heading");
	});

	it("is undefined for external and empty links", () => {
		expect(markdownLinkTarget("https://example.com/a.md")).toBeUndefined();
		expect(markdownLinkTarget("file:///C:/notes/a.md")).toBeUndefined();
		expect(markdownLinkTarget(" ")).toBeUndefined();
		expect(markdownLinkTarget("<>")).toBeUndefined();
	});
});
