import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileExplorerRenderer } from "../../src/display/file-explorer";
import { IconStore } from "../../src/icons/icon-store";
import { createFakeApp, flush } from "../fake-app";
import { View, WorkspaceLeaf } from "../obsidian";

/** Waits longer than the renderer's coalescing window. */
const settle = () => flush(80);

interface Item {
	root: HTMLElement;
	selfEl: HTMLElement;
	innerEl?: HTMLElement;
}

/** Mirrors Obsidian's file explorer: `fileItems` (path → item) plus `tree-item` markup. */
class FakeExplorer {
	readonly fileItems: Record<string, Item> = {};
	readonly containerEl = document.body.createDiv({ cls: "nav-files-container" });

	add(
		path: string,
		kind: "file" | "folder" = "file",
		parent: HTMLElement = this.containerEl,
	): Item {
		const root = parent.createDiv({ cls: `tree-item nav-${kind}` });
		const selfEl = root.createDiv({ cls: `tree-item-self nav-${kind}-title` });
		if (kind === "folder") selfEl.createDiv({ cls: "tree-item-icon collapse-icon" });
		const innerEl = selfEl.createDiv({
			cls: "tree-item-inner",
			text: path.slice(path.lastIndexOf("/") + 1),
		});
		const item = { root, selfEl, innerEl };
		this.fileItems[path] = item;
		return item;
	}

	/** Obsidian moves the `fileItems` entries of a renamed item and its descendants. */
	move(oldPath: string, newPath: string): void {
		for (const key of Object.keys(this.fileItems)) {
			if (key !== oldPath && !key.startsWith(`${oldPath}/`)) continue;
			this.fileItems[newPath + key.slice(oldPath.length)] = this.fileItems[key];
			delete this.fileItems[key];
		}
	}

	icons(): HTMLElement[] {
		return Array.from(this.containerEl.querySelectorAll<HTMLElement>(".notemoji-icon"));
	}
}

function iconOf(item: Item): HTMLElement | null {
	return item.selfEl.querySelector(":scope > .notemoji-icon");
}

let explorer: FakeExplorer;
let store: IconStore;
let renderer: FileExplorerRenderer;

beforeEach(() => {
	document.body.empty();
	explorer = new FakeExplorer();
	store = new IconStore();

	const app = createFakeApp();
	const leaf = new WorkspaceLeaf(app.asApp);
	const view = new View(leaf);
	Object.assign(view, { containerEl: explorer.containerEl, fileItems: explorer.fileItems });
	view.getViewType = () => "file-explorer";
	leaf.view = view;
	app.workspace.leaves.push(leaf);

	renderer = new FileExplorerRenderer(app.asApp, {
		get: (path) => store.get(path),
		entries: () => store.entries(),
		url: (file) => `app://icons/${file}`,
	});
});

afterEach(() => renderer.dispose());

describe("file explorer", () => {
	it("renders icons after the chevron and before the name", async () => {
		const folder = explorer.add("Projects", "folder");
		const note = explorer.add("Projects/Website.md");
		const plain = explorer.add("Plain.md");
		store.set("Projects", "📁");
		store.set("Projects/Website.md", "🚀");

		renderer.attach();
		await settle();

		expect(iconOf(folder)?.textContent).toBe("📁");
		expect(folder.selfEl.children[0].hasClass("collapse-icon")).toBe(true);
		expect(iconOf(folder)?.nextElementSibling).toBe(folder.innerEl);
		expect(iconOf(note)?.nextElementSibling).toBe(note.innerEl);
		expect(iconOf(plain)).toBeNull();
		expect(plain.selfEl.children.length).toBe(1);
	});

	it("is idempotent and survives label updates", async () => {
		const note = explorer.add("A.md");
		store.set("A.md", "🎉");
		renderer.attach();
		renderer.attach();
		await settle();
		note.innerEl!.textContent = "Renamed.md";
		await settle();

		expect(explorer.icons()).toHaveLength(1);
		expect(iconOf(note)?.textContent).toBe("🎉");
	});

	it("follows renames of folders and their descendants", async () => {
		const folder = explorer.add("Projects", "folder");
		const note = explorer.add("Projects/A.md");
		store.set("Projects", "📁");
		store.set("Projects/A.md", "🚀");
		renderer.attach();
		await settle();

		// Obsidian updates the explorer first, then reports the rename.
		explorer.move("Projects", "Work");
		renderer.scheduleSync();
		await settle();
		store.rename("Projects", "Work");
		renderer.scheduleSync();
		await settle();

		expect(iconOf(folder)?.textContent).toBe("📁");
		expect(iconOf(note)?.textContent).toBe("🚀");
		expect(explorer.icons()).toHaveLength(2);
	});

	it("decorates items Obsidian adds or re-creates later", async () => {
		store.set("New.md", "✨");
		renderer.attach();
		await settle();

		const first = explorer.add("New.md");
		await settle();
		expect(iconOf(first)?.textContent).toBe("✨");

		first.root.remove();
		const replacement = explorer.add("New.md");
		await settle();
		expect(iconOf(replacement)?.textContent).toBe("✨");
		expect(explorer.icons()).toHaveLength(1);
	});

	it("updates in place and removes without leaving placeholders", async () => {
		const note = explorer.add("A.md");
		store.set("A.md", "🚀");
		renderer.attach();
		await settle();
		const node = iconOf(note);

		store.set("A.md", "🛰️");
		renderer.scheduleSync();
		await settle();
		expect(iconOf(note)).toBe(node);
		expect(node?.textContent).toBe("🛰️");

		store.remove("A.md");
		renderer.scheduleSync();
		await settle();
		expect(iconOf(note)).toBeNull();
		expect(note.selfEl.children.length).toBe(1);
	});

	it("handles items without a name element", async () => {
		const odd = explorer.add("Odd.md");
		odd.innerEl!.remove();
		delete odd.innerEl;
		store.set("Odd.md", "🌀");
		renderer.attach();
		await settle();
		expect(iconOf(odd)?.textContent).toBe("🌀");
	});

	it("shows custom icons as images and switches between kinds in place", async () => {
		const note = explorer.add("A.md");
		store.set("A.md", "custom:logo.svg");
		renderer.attach();
		await settle();
		const img = iconOf(note)?.querySelector("img");
		expect(img?.getAttribute("src")).toBe("app://icons/logo.svg");
		expect(iconOf(note)?.nextElementSibling).toBe(note.innerEl);

		store.set("A.md", "🚀");
		renderer.scheduleSync();
		await settle();
		expect(iconOf(note)?.querySelector("img")).toBeNull();
		expect(iconOf(note)?.textContent).toBe("🚀");
	});

	it("removes every icon on dispose", async () => {
		explorer.add("A.md");
		store.set("A.md", "🚀");
		renderer.attach();
		await settle();
		renderer.dispose();
		expect(explorer.icons()).toHaveLength(0);
	});
});
