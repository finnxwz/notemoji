import * as language from "@codemirror/language";
import { syntaxTree } from "@codemirror/language";
import { EditorState, Extension, RangeSetBuilder, StateEffect } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import type { NodeProp } from "@lezer/common";
import {
	App,
	editorInfoField,
	editorLivePreviewField,
	getLinkpath,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
} from "obsidian";
import { parseIcon } from "../icons/icon-value";
import { findEditorLinks, LinkToken } from "./editor-links";
import { setIconAttributes } from "./emoji-attribute";
import { IconSource, IconUrl, renderKey } from "./icon-source";

export const LINK_ICON_CLASS = "notemoji-link-icon";

/** Coalescing window for updates (ms); renames and sync come in bursts. */
const REFRESH_DELAY_MS = 30;

/** The rendered key of each icon element, so unchanged icons are left alone. */
const renderedKeys = new WeakMap<HTMLElement, string>();

/**
 * The element an icon next to a link is drawn on: empty, drawn by CSS from
 * its attributes (like the title emoji), so the emoji is never part of the
 * text: not copied, not searched, not read out (`aria-hidden`).
 */
export function createLinkIconEl(value: string, url: IconUrl): HTMLElement {
	const el = createSpan({ cls: LINK_ICON_CLASS, attr: { "aria-hidden": "true" } });
	setIconAttributes(el, value, url);
	renderedKeys.set(el, renderKey(value, url));
	return el;
}

/**
 * The emoji of the linked note next to internal links in notes, when turned
 * on: in reading view (also hover previews, embedded notes, and the tables
 * and callouts of Live Preview, which are rendered like reading view) and in
 * Live Preview's text. Updates live when icons, files or the setting change.
 */
export class LinkIcons {
	/** Rendered parts of notes that contain links (reading view). */
	private readonly sections = new Set<LinkSection>();
	/** Live Preview editors. */
	private readonly editors = new Set<EditorView>();
	private timer: number | null = null;
	private disposed = false;

	/** The Live Preview part; registered once, it shows nothing while turned off. */
	readonly editorExtension: Extension;

	constructor(
		private readonly app: App,
		private readonly source: IconSource,
		private readonly enabled: () => boolean,
	) {
		this.editorExtension = linkIconsExtension({
			enabled,
			iconOf: (linktext, sourcePath) => this.iconOf(linktext, sourcePath),
			url: (icon) => this.source.url(icon),
			editors: this.editors,
		});
	}

	/**
	 * The icon to show next to a link in the note at `sourcePath`, resolved as
	 * Obsidian resolves the link; `undefined` for none.
	 */
	iconOf(linktext: string, sourcePath: string): string | undefined {
		const path = getLinkpath(linktext);
		// `[[#heading]]` points into the note itself.
		if (path === "") return undefined;
		const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
		if (!file) return undefined;
		const value = this.source.get(file.path);
		const icon = parseIcon(value);
		if (value === undefined || icon === undefined) return undefined;
		// In running text an empty space would look like a typo, so a picture
		// missing on this device (not synced yet) shows nothing at all.
		if (icon.type !== "emoji" && this.source.url(icon) === undefined) return undefined;
		return value;
	}

	/** The Markdown post-processor: every rendered part of a note passes through it. */
	readonly postProcessor = (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		if (this.disposed || !el.querySelector("a.internal-link")) return;
		// Also while turned off, so turning it on shows icons without re-rendering.
		const section = new LinkSection(el, ctx.sourcePath, this, this.sections);
		// Right away: some renderers of other plugins never load their children.
		section.update();
		ctx.addChild(section);
	};

	/** Updates every link shown, soon (changes come in bursts). */
	scheduleRefresh(): void {
		if (this.disposed) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.refresh();
		}, REFRESH_DELAY_MS);
	}

	/** Updates every link shown: icons, files or the setting changed. */
	refresh(): void {
		if (this.disposed) return;
		for (const section of this.sections) section.update();
		refreshEditors(this.editors);
	}

	/** Removes every icon shown in reading view (the editor extension goes with the plugin). */
	dispose(): void {
		this.disposed = true;
		if (this.timer !== null) window.clearTimeout(this.timer);
		for (const section of this.sections) section.clear();
		this.sections.clear();
	}

	/** Shows, updates or removes the icon of one link in reading view. */
	showIcon(anchor: HTMLElement, sourcePath: string): void {
		const existing = anchor.querySelector<HTMLElement>(`:scope > .${LINK_ICON_CLASS}`);
		const linktext = anchor.getAttribute("data-href") ?? anchor.getAttribute("href") ?? "";
		const value =
			this.disposed || !this.enabled() ? undefined : this.iconOf(linktext, sourcePath);
		if (value === undefined) {
			existing?.remove();
			return;
		}
		const url: IconUrl = (icon) => this.source.url(icon);
		if (existing && renderedKeys.get(existing) === renderKey(value, url)) return;
		const el = createLinkIconEl(value, url);
		// Inside the link, so a click on the emoji opens it and hovering previews it.
		if (existing) existing.replaceWith(el);
		else anchor.prepend(el);
	}
}

/** A rendered part of a note with links; Obsidian unloads it when the part goes away. */
class LinkSection extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private readonly sourcePath: string,
		private readonly links: LinkIcons,
		private readonly sections: Set<LinkSection>,
	) {
		super(containerEl);
	}

	onload(): void {
		this.sections.add(this);
		this.update();
	}

	onunload(): void {
		this.sections.delete(this);
	}

	update(): void {
		for (const anchor of this.anchors()) this.links.showIcon(anchor, this.sourcePath);
	}

	clear(): void {
		for (const anchor of this.anchors()) {
			anchor.querySelector(`:scope > .${LINK_ICON_CLASS}`)?.remove();
		}
	}

	/** The links of this part; those of a note embedded here belong to that note's own part. */
	private anchors(): HTMLElement[] {
		const embed = this.containerEl.closest(".markdown-embed");
		return Array.from(this.containerEl.querySelectorAll<HTMLElement>("a.internal-link")).filter(
			(anchor) => anchor.closest(".markdown-embed") === embed,
		);
	}
}

// ------------------------------------------------------------------ Live Preview

/** What the Live Preview part needs from the plugin. */
export interface EditorLinkIcons {
	enabled(): boolean;
	/** The icon to show next to a link in the note at `sourcePath`; `undefined` for none. */
	iconOf(linktext: string, sourcePath: string): string | undefined;
	url: IconUrl;
	/** Filled with the editors showing link icons, so they can be refreshed. */
	editors: Set<EditorView>;
}

/** Tells an editor to look at its links again: icons, files or the setting changed. */
const refreshEffect = StateEffect.define<null>();

function refreshEditors(editors: Iterable<EditorView>): void {
	for (const view of editors) view.dispatch({ effects: refreshEffect.of(null) });
}

/**
 * The classes of a syntax token. Obsidian's version of @codemirror/language
 * keeps them in `tokenClassNodeProp`; the token's name has them too, joined
 * by `_` (`hmd-internal-link_link-has-alias`).
 */
const tokenClassProp = (language as Record<string, unknown>).tokenClassNodeProp as
	NodeProp<string> | undefined;

class LinkIconWidget extends WidgetType {
	constructor(
		private readonly value: string,
		private readonly key: string,
		private readonly url: IconUrl,
	) {
		super();
	}

	/** Same icon, same element: typing never redraws the icons. */
	eq(other: LinkIconWidget): boolean {
		return other.key === this.key;
	}

	toDOM(): HTMLElement {
		return createLinkIconEl(this.value, this.url);
	}
}

/** The icons of the links in `ranges` (the visible part of the note). */
export function linkIconDecorations(
	state: EditorState,
	ranges: readonly { from: number; to: number }[],
	links: Omit<EditorLinkIcons, "editors">,
): DecorationSet {
	// Not in source mode: there the brackets are shown, and icons in front would be noise.
	if (!links.enabled() || !state.field(editorLivePreviewField, false)) return Decoration.none;
	const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
	const tree = syntaxTree(state);
	const slice = (from: number, to: number) =>
		state.doc.sliceString(Math.max(0, from), Math.min(state.doc.length, to));
	const builder = new RangeSetBuilder<Decoration>();
	let last = -1;
	for (const { from, to } of ranges) {
		const tokens: LinkToken[] = [];
		tree.iterate({
			from,
			to,
			enter: (node) => {
				const classes =
					(tokenClassProp && node.type.prop(tokenClassProp)) ??
					node.name.replace(/_/g, " ");
				tokens.push({ from: node.from, to: node.to, classes: classes.split(" ") });
			},
		});
		for (const link of findEditorLinks(tokens, slice)) {
			// A link reaching into the next visible range is found once.
			if (link.at <= last) continue;
			const value = links.iconOf(link.linktext, sourcePath);
			if (value === undefined) continue;
			last = link.at;
			const widget = new LinkIconWidget(value, renderKey(value, links.url), links.url);
			// Before the link, also before other plugins' widgets at the same place.
			builder.add(link.at, link.at, Decoration.widget({ widget, side: -1 }));
		}
	}
	return builder.finish();
}

/**
 * The emoji of linked notes in Live Preview, as widgets before each link.
 * Rebuilt for the visible part of the note when it changes, scrolls, is
 * parsed further (long notes are parsed in the background) or switches
 * between Live Preview and source mode, and when refreshed from outside.
 */
function linkIconsExtension(links: EditorLinkIcons): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(private readonly view: EditorView) {
				links.editors.add(view);
				this.decorations = linkIconDecorations(view.state, view.visibleRanges, links);
			}

			update(update: ViewUpdate): void {
				if (
					update.docChanged ||
					update.viewportChanged ||
					syntaxTree(update.state) !== syntaxTree(update.startState) ||
					update.state.field(editorLivePreviewField, false) !==
						update.startState.field(editorLivePreviewField, false) ||
					update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)))
				) {
					this.decorations = linkIconDecorations(
						update.state,
						update.view.visibleRanges,
						links,
					);
				}
			}

			destroy(): void {
				links.editors.delete(this.view);
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
