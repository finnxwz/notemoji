import type { App } from "obsidian";
import type { IconStore } from "./icon-store";
import type { FileExplorerView } from "./types";

/** Marker class of the emoji nodes owned by this plugin. */
const ICON_CLASS = "notemoji-icon";

/** Attribute storing the rendered emoji, used to skip needless DOM writes. */
const EMOJI_ATTRIBUTE = "data-notemoji-emoji";

/** Coalescing window for DOM mutations (ms). */
const SYNC_DELAY_MS = 50;

/**
 * Renders emoji icons in the file explorer.
 *
 * Obsidian has no public API for decorating file explorer items, so icons are
 * inserted as a small `<span>` directly before the `.tree-item-inner` element of
 * each rendered item, based on the file explorer view's `fileItems` map. The
 * emoji node is a sibling of the name element (not a child), which means
 * Obsidian's own title updates (renames, sort order, re-renders of the label)
 * leave it untouched.
 *
 * A single `MutationObserver` per file explorer container keeps the icons in
 * sync when Obsidian creates or re-creates items (expanding folders, adding
 * files, other plugins re-rendering the tree). Mutation bursts are coalesced
 * into one render pass, and the render pass itself is idempotent: it only
 * touches the DOM when an icon is missing, stale or no longer wanted.
 */
export class FileExplorerRenderer {
	private readonly app: App;
	private readonly store: IconStore;
	private readonly views = new Set<FileExplorerView>();
	private readonly observers = new Map<HTMLElement, MutationObserver>();
	private timer: number | null = null;
	private attachToken = 0;
	private disposed = false;

	constructor(app: App, store: IconStore) {
		this.app = app;
		this.store = store;
	}

	/** Connects to every open file explorer, renders icons and observes changes. */
	attach(): void {
		if (this.disposed) return;

		const token = ++this.attachToken;
		void this.resolveViews()
			.then((views) => {
				// A newer attach() call (or dispose()) won the race.
				if (this.disposed || token !== this.attachToken) return;

				this.views.clear();
				for (const view of views) this.views.add(view);
				this.observeContainers();
				this.sync();
			})
			.catch((error: unknown) => {
				console.error("[notemoji] Could not attach to the file explorer.", error);
			});
	}

	/** Queues a render pass; bursts of changes collapse into a single pass. */
	scheduleSync(): void {
		if (this.disposed) return;
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.sync();
		}, SYNC_DELAY_MS);
	}

	/** Stops observing, cancels pending work and removes all rendered icons. */
	dispose(): void {
		this.disposed = true;
		this.attachToken += 1;

		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}

		for (const container of this.observers.keys()) {
			for (const node of Array.from(container.querySelectorAll<HTMLElement>(`.${ICON_CLASS}`))) {
				node.remove();
			}
		}
		for (const observer of this.observers.values()) observer.disconnect();

		this.observers.clear();
		this.views.clear();
	}

	/** Resolves the file explorer views, loading them first when they are deferred. */
	private async resolveViews(): Promise<FileExplorerView[]> {
		const views: FileExplorerView[] = [];

		for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
			try {
				// Since Obsidian 1.7.2 views in the background can be deferred.
				if (typeof leaf.loadIfDeferred === "function") await leaf.loadIfDeferred();

				const view = leaf.view as unknown as FileExplorerView | null | undefined;
				if (view && view.containerEl) views.push(view);
			} catch (error) {
				console.error("[notemoji] Could not load a file explorer view.", error);
			}
		}

		return views;
	}

	/** Observes the current containers and drops observers of closed explorers. */
	private observeContainers(): void {
		const wanted = new Set<HTMLElement>();
		for (const view of this.views) {
			if (view.containerEl) wanted.add(view.containerEl);
		}

		for (const [container, observer] of [...this.observers]) {
			if (wanted.has(container)) continue;
			observer.disconnect();
			this.observers.delete(container);
		}

		for (const container of wanted) {
			if (this.observers.has(container)) continue;
			const observer = new MutationObserver(() => this.scheduleSync());
			observer.observe(container, { childList: true, subtree: true });
			this.observers.set(container, observer);
		}
	}

	/** Single render pass: adds missing icons and removes stale ones. */
	private sync(): void {
		if (this.disposed) return;

		const decorated = new Set<HTMLElement>();
		for (const [path, emoji] of this.store.entries()) {
			for (const view of this.views) {
				const item = view.fileItems?.[path];
				if (!item) continue;

				const titleEl = item.selfEl ?? item.titleEl;
				if (!titleEl) continue;

				this.applyIcon(titleEl, item.innerEl ?? item.titleInnerEl ?? null, emoji);
				decorated.add(titleEl);
			}
		}

		// Remove icon nodes that are not backed by data anymore: cleared emoji,
		// deleted items, or elements Obsidian re-created for an item.
		for (const container of this.observers.keys()) {
			for (const node of Array.from(container.querySelectorAll<HTMLElement>(`.${ICON_CLASS}`))) {
				const titleEl = node.parentElement;
				if (!titleEl || !decorated.has(titleEl)) node.remove();
			}
		}
	}

	/** Adds or updates the emoji node of a single file explorer item. */
	private applyIcon(titleEl: HTMLElement, innerEl: HTMLElement | null, emoji: string): void {
		const existing = this.findIconNode(titleEl);
		if (existing) {
			if (existing.getAttribute(EMOJI_ATTRIBUTE) === emoji) return;
			existing.textContent = emoji;
			existing.setAttribute(EMOJI_ATTRIBUTE, emoji);
			return;
		}

		// Built with Obsidian's own element helper. `createSpan` appends the node,
		// so it is moved to its final position right below.
		const iconEl = titleEl.createSpan({
			cls: ICON_CLASS,
			text: emoji,
			attr: { [EMOJI_ATTRIBUTE]: emoji, "aria-hidden": "true" },
		});

		// Keep the emoji immediately before the name, after the folder chevron.
		const anchor =
			innerEl && innerEl.parentElement === titleEl
				? innerEl
				: titleEl.querySelector<HTMLElement>(":scope > .tree-item-inner");

		if (anchor) titleEl.insertBefore(iconEl, anchor);
		else titleEl.appendChild(iconEl);
	}

	/** Returns the emoji node of a title element, if this plugin created one. */
	private findIconNode(titleEl: HTMLElement): HTMLElement | null {
		return titleEl.querySelector<HTMLElement>(`:scope > .${ICON_CLASS}`);
	}
}
