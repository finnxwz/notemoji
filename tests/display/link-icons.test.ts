import { StreamLanguage } from "@codemirror/language";
import { EditorState, Extension } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MarkdownPostProcessorContext, MarkdownRenderChild } from "obsidian";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	EMOJI_ATTRIBUTE,
	IMAGE_ATTRIBUTE,
	MASK_ATTRIBUTE,
} from "../../src/display/emoji-attribute";
import type { IconSource } from "../../src/display/icon-source";
import { LINK_ICON_CLASS, LinkIcons, linkIconDecorations } from "../../src/display/link-icons";
import { createFakeApp, FakeApp } from "../fake-app";
import { editorInfoField, editorLivePreviewField } from "../obsidian";

let app: FakeApp;
let icons: Map<string, string>;
/** URLs of the pictures this device can show, by stored value. */
let pictures: Map<string, string>;
let enabled: boolean;
let links: LinkIcons;

const source: IconSource = {
	get: (path) => icons.get(path),
	url: (icon) =>
		pictures.get(icon.type === "custom" ? `custom:${icon.id}` : `lucide:${icon.name}`),
};

beforeEach(() => {
	app = createFakeApp({
		files: ["Index.md", "Rome.md", "Trips/Rome.md", "Trips/Paris.md", "Plan.pdf"],
	});
	icons = new Map([
		["Rome.md", "🏛️"],
		["Trips/Rome.md", "🍝"],
		["Trips/Paris.md", "🥐"],
		["Plan.pdf", "📄"],
	]);
	pictures = new Map();
	enabled = true;
	links = new LinkIcons(app.asApp, source, () => enabled);
});

afterEach(() => {
	links.dispose();
	document.body.empty();
});

// ------------------------------------------------------------------ reading view

/** What Obsidian passes to post-processors, as far as Notemoji uses it. */
const context = (sourcePath: string, addChild: (child: MarkdownRenderChild) => void) =>
	({ sourcePath, addChild }) as unknown as MarkdownPostProcessorContext;

/** A rendered part of a note (`<p>` with links), passed through the post-processor. */
function render(hrefs: string[], sourcePath = "Index.md") {
	const el = document.body.createDiv({ cls: "markdown-preview-section" }).createEl("p");
	const anchors = hrefs.map((href) =>
		el.createEl("a", { cls: "internal-link", text: href, attr: { "data-href": href, href } }),
	);
	const children: MarkdownRenderChild[] = [];
	links.postProcessor(
		el,
		context(sourcePath, (child) => {
			children.push(child);
			child.load();
		}),
	);
	return { el, anchors, children };
}

const iconOf = (anchor: HTMLElement) =>
	anchor.querySelector<HTMLElement>(`:scope > .${LINK_ICON_CLASS}`);
const emojiOf = (anchor: HTMLElement) => iconOf(anchor)?.getAttribute(EMOJI_ATTRIBUTE);

describe("reading view", () => {
	it("shows the linked note's emoji inside the link, as an empty element", () => {
		const { anchors } = render(["Trips/Paris"]);
		const icon = iconOf(anchors[0])!;
		expect(icon.getAttribute(EMOJI_ATTRIBUTE)).toBe("🥐");
		expect(icon.getAttribute("aria-hidden")).toBe("true");
		expect(icon.hasAttribute("aria-label")).toBe(false);
		// Drawn by CSS: copying the link copies its text only.
		expect(anchors[0].textContent).toBe("Trips/Paris");
		expect(anchors[0].firstChild).toBe(icon);
	});

	it("resolves links like Obsidian: subpaths, other files, the nearest of two names", () => {
		const { anchors } = render(
			["Paris#Day 1", "Paris#^block", "Plan.pdf", "Rome"],
			"Trips/Day.md",
		);
		expect(anchors.map(emojiOf)).toEqual(["🥐", "🥐", "📄", "🍝"]);
		expect(emojiOf(render(["Rome"], "Index.md").anchors[0])).toBe("🏛️");
	});

	it("shows nothing for unresolved links, links into the note itself and notes without emoji", () => {
		const { anchors } = render(["Nowhere", "#Heading", "Index"]);
		expect(anchors.map(iconOf)).toEqual([null, null, null]);
	});

	it("shows pictures, but nothing where a picture is missing on this device", () => {
		icons.set("Rome.md", "custom:logo");
		icons.set("Trips/Paris.md", "lucide:star");
		icons.set("Trips/Rome.md", "custom:not-synced-yet");
		pictures.set("custom:logo", "blob:logo");
		pictures.set("lucide:star", "blob:star");
		const { anchors } = render(["Rome", "Trips/Paris", "Trips/Rome"]);
		const [logo, star, missing] = anchors.map(iconOf);
		expect(logo?.getAttribute(IMAGE_ATTRIBUTE)).toBe("custom:logo");
		expect(logo?.style.getPropertyValue("--notemoji-image")).toBe('url("blob:logo")');
		expect(logo?.hasAttribute(MASK_ATTRIBUTE)).toBe(false);
		expect(star?.hasAttribute(MASK_ATTRIBUTE)).toBe(true);
		// In running text an empty space would look like a typo.
		expect(missing).toBeNull();
	});

	it("follows changes without re-rendering, and keeps icons that didn't change", () => {
		const { anchors } = render(["Rome", "Trips/Paris", "Trips/Rome"]);
		const unchanged = iconOf(anchors[0]);
		icons.set("Trips/Paris.md", "🗼");
		icons.delete("Trips/Rome.md");
		links.refresh();
		expect(anchors.map(emojiOf)).toEqual(["🏛️", "🗼", undefined]);
		expect(iconOf(anchors[0])).toBe(unchanged);
		expect(anchors[1].querySelectorAll(`.${LINK_ICON_CLASS}`)).toHaveLength(1);
	});

	it("follows files that were created, renamed or deleted", () => {
		const { anchors } = render(["Later"]);
		expect(iconOf(anchors[0])).toBeNull();
		app.vault.add("Later.md");
		icons.set("Later.md", "⏰");
		links.refresh();
		expect(emojiOf(anchors[0])).toBe("⏰");
	});

	it("turns on and off without re-rendering", () => {
		enabled = false;
		const { anchors } = render(["Rome"]);
		expect(iconOf(anchors[0])).toBeNull();
		enabled = true;
		links.refresh();
		expect(emojiOf(anchors[0])).toBe("🏛️");
		enabled = false;
		links.refresh();
		expect(iconOf(anchors[0])).toBeNull();
	});

	it("leaves parts alone once Obsidian unloaded them", () => {
		const { anchors, children } = render(["Rome"]);
		children[0].unload();
		icons.set("Rome.md", "🏟️");
		links.refresh();
		expect(emojiOf(anchors[0])).toBe("🏛️");
	});

	it("leaves the links of an embedded note to that note's own part", () => {
		const { el, anchors } = render(["Rome"], "Trips/Day.md");
		const embedded = el
			.createDiv({ cls: "markdown-embed" })
			.createEl("a", { cls: "internal-link", attr: { "data-href": "Rome" } });
		links.refresh();
		expect(emojiOf(anchors[0])).toBe("🍝");
		// Resolved from Trips/Day.md it would wrongly be Trips/Rome.md for a note elsewhere.
		expect(iconOf(embedded)).toBeNull();
	});

	it("skips parts without internal links", () => {
		const el = document.body.createEl("p", { text: "No links" });
		let added = 0;
		links.postProcessor(
			el,
			context("Index.md", () => (added += 1)),
		);
		expect(added).toBe(0);
	});

	it("resolves encoded paths of Markdown links", () => {
		app.vault.add("Trips/Day one.md");
		icons.set("Trips/Day one.md", "1️⃣");
		expect(emojiOf(render(["Trips/Day%20one.md"]).anchors[0])).toBe("1️⃣");
		expect(iconOf(render(["Trips/100%.md"]).anchors[0])).toBeNull();
	});

	it("resolves from where the note is now, after it was moved", () => {
		const { anchors } = render(["Rome"], "Trips/Paris.md");
		expect(emojiOf(anchors[0])).toBe("🍝");
		app.vault.rename("Trips/Paris.md", "Paris.md");
		links.refresh();
		expect(emojiOf(anchors[0])).toBe("🏛️");
	});

	it("keeps following links that were moved out of their part", () => {
		const { el, anchors } = render(["Rome"]);
		// Like Dataview, which unwraps the paragraph it rendered.
		el.parentElement!.append(...Array.from(el.childNodes));
		icons.set("Rome.md", "🏟️");
		links.refresh();
		expect(emojiOf(anchors[0])).toBe("🏟️");
	});

	it("removes icons on unload also where the part was never loaded", () => {
		const el = document.body.createEl("p");
		const anchor = el.createEl("a", { cls: "internal-link", attr: { "data-href": "Rome" } });
		links.postProcessor(
			el,
			context("Index.md", () => undefined),
		);
		expect(emojiOf(anchor)).toBe("🏛️");
		links.dispose();
		expect(iconOf(anchor)).toBeNull();
	});

	it("removes every icon when the plugin unloads", () => {
		const { anchors } = render(["Rome", "Trips/Paris"]);
		links.dispose();
		expect(anchors.map(iconOf)).toEqual([null, null]);
		expect(document.querySelectorAll(`.${LINK_ICON_CLASS}`)).toHaveLength(0);
	});
});

// ------------------------------------------------------------------ Live Preview

/**
 * A tiny stand-in for Obsidian's Markdown mode (HyperMD): wikilinks and
 * Markdown links, with the token classes Obsidian uses.
 */
const markdownLike = StreamLanguage.define<{ wiki: "target" | "alias" | null; md: string | null }>({
	startState: () => ({ wiki: null, md: null }),
	token(stream, state) {
		if (state.wiki !== null) {
			if (stream.match("]]")) {
				state.wiki = null;
				return "formatting-link formatting-link-end";
			}
			if (state.wiki === "target" && stream.match("|")) {
				state.wiki = "alias";
				return "hmd-internal-link link-alias-pipe";
			}
			stream.match(state.wiki === "target" ? /^[^|\]]+/ : /^[^\]]+/);
			return state.wiki === "target" ? "hmd-internal-link" : "hmd-internal-link link-alias";
		}
		if (state.md === "text") {
			if (stream.match("]")) {
				state.md = "paren";
				return "formatting formatting-link link";
			}
			stream.match(/^[^\]]+/);
			return "link";
		}
		if (state.md === "paren") {
			state.md = stream.match("(") ? "url" : null;
			if (state.md === "url") return "formatting formatting-link-string string url";
		}
		if (state.md === "url") {
			if (stream.match(")")) {
				state.md = null;
				return "formatting formatting-link-string string url";
			}
			stream.match(/^[^)]+/);
			return "string url";
		}
		if (stream.match("[[")) {
			state.wiki = "target";
			return "formatting-link formatting-link-start";
		}
		if (stream.match("[")) {
			state.md = "text";
			return "formatting formatting-link link";
		}
		if (!stream.match(/^[^[]+/)) stream.next();
		return null;
	},
	tokenTable: Object.fromEntries(
		[
			"formatting",
			"formatting-link",
			"formatting-link-start",
			"formatting-link-end",
			"formatting-link-string",
			"hmd-internal-link",
			"link-alias",
			"link-alias-pipe",
		].map((name) => [name, tags.meta]),
	),
});

function editorState(
	doc: string,
	options: { path?: string; livePreview?: boolean; extension?: Extension } = {},
) {
	const file = app.vault.getFileByPath(options.path ?? "Index.md");
	return EditorState.create({
		doc,
		extensions: [
			markdownLike,
			editorInfoField.init(() => ({ file })),
			editorLivePreviewField.init(() => options.livePreview ?? true),
			options.extension ?? [],
		],
	});
}

/** The icons Live Preview shows in `doc`: where, and the emoji drawn. */
function editorIcons(state: EditorState): Array<[number, string | null]> {
	const found: Array<[number, string | null]> = [];
	const decorations = linkIconDecorations(state, [{ from: 0, to: state.doc.length }], {
		enabled: () => enabled,
		iconOf: (linktext, sourcePath) => links.iconOf(linktext, sourcePath),
		url: (icon) => source.url(icon),
	});
	decorations.between(0, state.doc.length, (from, _to, decoration) => {
		const widget = decoration.spec.widget as WidgetType;
		found.push([from, widget.toDOM(undefined as never).getAttribute(EMOJI_ATTRIBUTE)]);
	});
	return found;
}

describe("Live Preview", () => {
	it("shows the emoji right before each link, by its target", () => {
		const doc = "Go to [[Trips/Paris|Paris]], [[Rome#History]] or [there](Trips/Rome.md).";
		expect(editorIcons(editorState(doc))).toEqual([
			[6, "🥐"],
			[29, "🏛️"],
			[49, "🍝"],
		]);
	});

	it("resolves from the note being edited", () => {
		expect(editorIcons(editorState("[[Rome]]", { path: "Trips/Paris.md" }))).toEqual([
			[0, "🍝"],
		]);
	});

	it("shows nothing for embeds, unresolved and external links", () => {
		const doc = "![[Rome]] [[Nowhere]] [[#Top]] [web](https://example.com)";
		expect(editorIcons(editorState(doc))).toEqual([]);
	});

	it("shows nothing in source mode or while turned off", () => {
		expect(editorIcons(editorState("[[Rome]]", { livePreview: false }))).toEqual([]);
		enabled = false;
		expect(editorIcons(editorState("[[Rome]]"))).toEqual([]);
	});

	it("updates a mounted editor when refreshed, and keeps unchanged icons", () => {
		const view = new EditorView({
			state: editorState("[[Rome]] and [[Trips/Paris]]", {
				extension: links.editorExtension,
			}),
			parent: document.body,
		});
		const shown = () =>
			Array.from(view.contentDOM.querySelectorAll(`.${LINK_ICON_CLASS}`), (el) =>
				el.getAttribute(EMOJI_ATTRIBUTE),
			);
		expect(shown()).toEqual(["🏛️", "🥐"]);
		const rome = view.contentDOM.querySelector(`.${LINK_ICON_CLASS}`);

		icons.set("Trips/Paris.md", "🗼");
		links.refresh();
		expect(shown()).toEqual(["🏛️", "🗼"]);
		expect(view.contentDOM.querySelector(`.${LINK_ICON_CLASS}`)).toBe(rome);

		// Typing elsewhere keeps the icons as they are.
		view.dispatch({ changes: { from: view.state.doc.length, insert: " more" } });
		expect(view.contentDOM.querySelector(`.${LINK_ICON_CLASS}`)).toBe(rome);
		enabled = false;
		links.refresh();
		expect(shown()).toEqual([]);
		view.destroy();
	});
});
