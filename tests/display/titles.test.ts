import type { TFile as RealTFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotemojiSettings } from "../../src/data";
import { EMOJI_ATTRIBUTE, MASK_ATTRIBUTE } from "../../src/display/emoji-attribute";
import { TitleDecorations } from "../../src/display/titles";
import { createFakeApp, FakeApp } from "../fake-app";
import { FileView, MarkdownView, TFile, View, WorkspaceLeaf } from "../obsidian";

interface Opened {
	leaf: WorkspaceLeaf;
	tabTitleEl: HTMLElement;
	headerTitleEl: HTMLElement;
	/** Editing and reading view titles; empty for non-Markdown files. */
	inlineTitles: HTMLElement[];
}

let app: FakeApp;
let icons: Map<string, string>;
let picked: string[];
let titles: TitleDecorations;

const settings = (overrides: Partial<NotemojiSettings> = {}): NotemojiSettings => ({
	noteTitle: "above",
	showInTabs: true,
	showInViewHeader: true,
	showInLinks: false,
	emojiStyle: "system",
	emojiFont: "",
	autoEmoji: false,
	...overrides,
});

/** Opens `path` in a tab with Obsidian's markup for tab, view header and inline titles. */
function open(path: string, options: { root?: unknown; deferred?: boolean } = {}): Opened {
	const leaf = new WorkspaceLeaf(app.asApp);
	leaf.root = options.root ?? app.workspace.rootSplit;
	const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
	const tabTitleEl = document.body
		.createDiv({ cls: "workspace-tab-header-inner" })
		.createDiv({ cls: "workspace-tab-header-inner-title", text: name });
	Object.assign(leaf, { tabHeaderInnerTitleEl: tabTitleEl });

	const file = app.vault.add(path) as TFile;
	const isNote = path.endsWith(".md");
	const view: View = options.deferred
		? new View(leaf)
		: isNote
			? new MarkdownView(leaf)
			: new FileView(leaf);
	if (view instanceof FileView) view.file = file;
	if (options.deferred) leaf.state = { file: path };
	leaf.view = view;
	document.body.appendChild(view.containerEl);

	const headerTitleEl = view.containerEl
		.createDiv({ cls: "view-header" })
		.createDiv({ cls: "view-header-title-container" })
		.createDiv({ cls: "view-header-title", text: name });

	const inlineTitles: HTMLElement[] = [];
	if (isNote && !options.deferred) {
		const sizerEl = view.containerEl
			.createDiv({ cls: "cm-scroller" })
			.createDiv({ cls: "cm-sizer" });
		inlineTitles.push(sizerEl.createDiv({ cls: "inline-title", text: name }));
		const contentEl = sizerEl.createDiv({ cls: "cm-contentContainer" });
		// An embedded note brings its own inline title, which must be left alone.
		contentEl
			.createDiv({ cls: "markdown-embed" })
			.createDiv({ cls: "inline-title", text: "Embedded" });
		const headerEl = view.containerEl
			.createDiv({ cls: "markdown-preview-sizer" })
			.createDiv({ cls: "mod-header" });
		inlineTitles.push(headerEl.createDiv({ cls: "inline-title", text: name }));
	}

	app.workspace.leaves.push(leaf);
	return { leaf, tabTitleEl, headerTitleEl, inlineTitles };
}

const attr = (el: Element) => el.getAttribute(EMOJI_ATTRIBUTE);
const iconAbove = (titleEl: HTMLElement) => {
	const previous = titleEl.previousElementSibling as HTMLElement | null;
	return previous?.hasClass("notemoji-title-icon") ? previous : null;
};
const decorated = () => document.querySelectorAll(`[${EMOJI_ATTRIBUTE}]`).length;
const aboveIcons = () => document.querySelectorAll(".notemoji-title-icon").length;

/** Image URL of each custom icon and Obsidian icon; tests change them to simulate sync. */
let urlOf: (id: string) => string | undefined;
let lucideUrlOf: (name: string) => string | undefined;

beforeEach(() => {
	document.body.empty();
	urlOf = (id) => `app://icons/${id}`;
	lucideUrlOf = (name) => `blob:lucide-${name}`;
	app = createFakeApp();
	icons = new Map([
		["Notes/Rocket.md", "🚀"],
		["doc.pdf", "📄"],
	]);
	picked = [];
	titles = new TitleDecorations(
		app.asApp,
		{
			get: (path) => icons.get(path),
			url: (icon) => (icon.type === "custom" ? urlOf(icon.id) : lucideUrlOf(icon.name)),
		},
		(file: RealTFile) => picked.push(file.path),
	);
});

describe("note title", () => {
	it("shows a large emoji above both inline titles", () => {
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		for (const titleEl of note.inlineTitles) {
			expect(iconAbove(titleEl)?.textContent).toBe("🚀");
			expect(attr(titleEl)).toBeNull();
		}
		expect(aboveIcons()).toBe(2);
	});

	it("opens the picker for the note when the large emoji is clicked", () => {
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		const button = iconAbove(note.inlineTitles[0])!.querySelector("button")!;
		const mousedown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		button.dispatchEvent(mousedown);
		expect(mousedown.defaultPrevented).toBe(true);
		button.click();
		expect(picked).toEqual(["Notes/Rocket.md"]);
	});

	it("draws the inline emoji without touching the title text", () => {
		const note = open("Notes/Rocket.md");
		titles.sync(settings({ noteTitle: "inline" }));
		for (const titleEl of note.inlineTitles) {
			expect(attr(titleEl)).toBe("🚀");
			expect(titleEl.textContent).toBe("Rocket");
		}
		expect(aboveIcons()).toBe(0);
	});

	it("leaves notes without an emoji, embeds and other modes alone", () => {
		const plain = open("Plain.md");
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		expect(plain.inlineTitles.map(iconAbove)).toEqual([null, null]);
		expect(
			document.querySelector(".markdown-embed .inline-title")?.previousElementSibling,
		).toBeNull();

		titles.sync(settings({ noteTitle: "off" }));
		expect(aboveIcons()).toBe(0);
		expect(note.inlineTitles.map(attr)).toEqual([null, null]);
	});

	it("is idempotent and updates in place", () => {
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		const icon = iconAbove(note.inlineTitles[0]);
		titles.sync(settings());
		icons.set("Notes/Rocket.md", "🛰️");
		titles.sync(settings());
		expect(aboveIcons()).toBe(2);
		expect(iconAbove(note.inlineTitles[0])).toBe(icon);
		expect(icon?.textContent).toBe("🛰️");
	});

	it("follows a switch to another file in the same tab", () => {
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		(note.leaf.view as MarkdownView).file = app.vault.add("Other.md") as TFile;
		titles.sync(settings());
		expect(aboveIcons()).toBe(0);
	});
});

describe("tab and view header titles", () => {
	it("decorates any file type", () => {
		const note = open("Notes/Rocket.md");
		const pdf = open("doc.pdf");
		titles.sync(settings());
		expect([attr(note.tabTitleEl), attr(note.headerTitleEl)]).toEqual(["🚀", "🚀"]);
		expect([attr(pdf.tabTitleEl), attr(pdf.headerTitleEl)]).toEqual(["📄", "📄"]);
		expect(pdf.tabTitleEl.textContent).toBe("doc.pdf");
	});

	it("covers deferred tabs and skips sidebar tab titles", () => {
		const deferred = open("Notes/Rocket.md", { deferred: true });
		const sidebar = open("doc.pdf", { root: app.workspace.rightSplit });
		titles.sync(settings());
		expect(attr(deferred.tabTitleEl)).toBe("🚀");
		expect(attr(sidebar.tabTitleEl)).toBeNull();
		expect(attr(sidebar.headerTitleEl)).toBe("📄");
	});

	it("can be turned off separately", () => {
		const note = open("Notes/Rocket.md");
		titles.sync(settings({ showInTabs: false }));
		expect([attr(note.tabTitleEl), attr(note.headerTitleEl)]).toEqual([null, "🚀"]);
		titles.sync(settings({ showInViewHeader: false }));
		expect([attr(note.tabTitleEl), attr(note.headerTitleEl)]).toEqual(["🚀", null]);
	});

	it("removes emoji that were removed", () => {
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		icons.delete("Notes/Rocket.md");
		titles.sync(settings());
		expect(decorated()).toBe(0);
		expect(note.tabTitleEl.textContent).toBe("Rocket");
	});
});

describe("custom icons", () => {
	it("shows images above the title and through a CSS variable elsewhere", () => {
		icons.set("Notes/Rocket.md", "custom:logo.svg");
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		const img = iconAbove(note.inlineTitles[0])?.querySelector("img");
		expect(img?.getAttribute("src")).toBe("app://icons/logo.svg");
		for (const el of [note.tabTitleEl, note.headerTitleEl]) {
			expect(el.getAttribute("data-notemoji-image")).toBe("custom:logo.svg");
			expect(el.getAttribute(EMOJI_ATTRIBUTE)).toBeNull();
			expect(el.style.getPropertyValue("--notemoji-image")).toContain("app://icons/logo.svg");
			expect(el.textContent).toBe("Rocket");
		}

		titles.sync(settings({ noteTitle: "inline" }));
		expect(note.inlineTitles[0].getAttribute("data-notemoji-image")).toBe("custom:logo.svg");

		icons.set("Notes/Rocket.md", "🚀");
		titles.sync(settings());
		expect(note.tabTitleEl.getAttribute("data-notemoji-image")).toBeNull();
		expect(note.tabTitleEl.style.getPropertyValue("--notemoji-image")).toBe("");
		expect(attr(note.tabTitleEl)).toBe("🚀");
	});

	it("keeps the space of a missing icon and updates when sync brings or replaces it", () => {
		icons.set("Notes/Rocket.md", "custom:logo");
		urlOf = () => undefined;
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		expect(note.tabTitleEl.getAttribute("data-notemoji-image")).toBe("custom:logo");
		expect(note.tabTitleEl.style.getPropertyValue("--notemoji-image")).toBe("");
		expect(iconAbove(note.inlineTitles[0])?.querySelector("img")?.hasClass("is-missing")).toBe(
			true,
		);

		urlOf = () => "blob:logo-1";
		titles.sync(settings());
		expect(note.tabTitleEl.style.getPropertyValue("--notemoji-image")).toContain("blob:logo-1");
		expect(iconAbove(note.inlineTitles[0])?.querySelector("img")?.getAttribute("src")).toBe(
			"blob:logo-1",
		);

		urlOf = () => "blob:logo-2";
		titles.sync(settings());
		expect(note.tabTitleEl.style.getPropertyValue("--notemoji-image")).toContain("blob:logo-2");
		expect(iconAbove(note.inlineTitles[0])?.querySelector("img")?.getAttribute("src")).toBe(
			"blob:logo-2",
		);
	});

	it("draws Obsidian icons as a mask in the title's colour", () => {
		icons.set("Notes/Rocket.md", "lucide:star");
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		const mask = iconAbove(note.inlineTitles[0])?.querySelector<HTMLElement>(".notemoji-mask");
		expect(mask?.style.getPropertyValue("--notemoji-image")).toBe('url("blob:lucide-star")');
		for (const el of [note.tabTitleEl, note.headerTitleEl]) {
			expect(el.getAttribute("data-notemoji-image")).toBe("lucide:star");
			expect(el.hasAttribute(MASK_ATTRIBUTE)).toBe(true);
			expect(el.style.getPropertyValue("--notemoji-image")).toBe('url("blob:lucide-star")');
			expect(attr(el)).toBeNull();
			expect(el.textContent).toBe("Rocket");
		}

		titles.sync(settings({ noteTitle: "inline" }));
		expect(note.inlineTitles[0].hasAttribute(MASK_ATTRIBUTE)).toBe(true);

		icons.set("Notes/Rocket.md", "custom:logo");
		titles.sync(settings());
		expect(note.tabTitleEl.hasAttribute(MASK_ATTRIBUTE)).toBe(false);
		expect(note.tabTitleEl.getAttribute("data-notemoji-image")).toBe("custom:logo");

		icons.set("Notes/Rocket.md", "lucide:star");
		titles.sync(settings());
		titles.dispose();
		expect(note.tabTitleEl.hasAttribute(MASK_ATTRIBUTE)).toBe(false);
		expect(note.tabTitleEl.hasAttribute("data-notemoji-image")).toBe(false);
	});

	it("keeps the space of an Obsidian icon it can't draw, without filling it", () => {
		icons.set("Notes/Rocket.md", "lucide:rocket");
		lucideUrlOf = () => undefined;
		const note = open("Notes/Rocket.md");
		titles.sync(settings());
		expect(note.tabTitleEl.getAttribute("data-notemoji-image")).toBe("lucide:rocket");
		// The mask is only set with a picture: without one it would fill the space with colour.
		expect(note.tabTitleEl.hasAttribute(MASK_ATTRIBUTE)).toBe(false);
		expect(
			iconAbove(note.inlineTitles[0])
				?.querySelector(".notemoji-mask")
				?.hasClass("is-missing"),
		).toBe(true);

		lucideUrlOf = () => "blob:rocket-1";
		titles.sync(settings());
		expect(note.tabTitleEl.hasAttribute(MASK_ATTRIBUTE)).toBe(true);
		expect(note.tabTitleEl.style.getPropertyValue("--notemoji-image")).toContain(
			"blob:rocket-1",
		);
	});

	it("removes the image decoration on dispose", () => {
		icons.set("doc.pdf", "custom:logo.svg");
		const pdf = open("doc.pdf");
		titles.sync(settings());
		titles.dispose();
		expect(pdf.tabTitleEl.getAttribute("data-notemoji-image")).toBeNull();
		expect(pdf.tabTitleEl.style.getPropertyValue("--notemoji-image")).toBe("");
	});
});

describe("dispose", () => {
	it("removes everything it added", () => {
		open("Notes/Rocket.md");
		open("doc.pdf");
		titles.sync(settings());
		titles.dispose();
		expect(decorated()).toBe(0);
		expect(aboveIcons()).toBe(0);
	});

	it("survives leaves without views or markup", () => {
		const leaf = new WorkspaceLeaf(app.asApp);
		leaf.root = app.workspace.rootSplit;
		app.workspace.leaves.push(leaf);
		expect(() => titles.sync(settings())).not.toThrow();
	});
});

it("never touches anything when nothing has an emoji", () => {
	icons.clear();
	open("Notes/Rocket.md");
	const before = document.body.innerHTML;
	const spy = vi.spyOn(Element.prototype, "setAttribute");
	titles.sync(settings());
	expect(spy).not.toHaveBeenCalledWith(EMOJI_ATTRIBUTE, expect.anything());
	expect(document.body.innerHTML).toBe(before);
	spy.mockRestore();
});
