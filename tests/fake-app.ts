/**
 * Builds a fake Obsidian `App` with an in-memory vault, metadata cache and
 * workspace. Mutations go through helpers that emit the same
 * events Obsidian would (`rename`, `delete`, …).
 */
import type { App as RealApp } from "obsidian";
import { Events, TAbstractFile, TFile, TFolder, WorkspaceLeaf } from "./obsidian";

export interface FakeAppOptions {
	/** File paths; parent folders are created automatically. Folders may be listed too. */
	files?: string[];
	activeFile?: string;
}

export class FakeVault extends Events {
	readonly configDir = ".obsidian";
	readonly items = new Map<string, TAbstractFile>();
	readonly root = new TFolder("/");

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return path === "/" ? this.root : (this.items.get(path) ?? null);
	}
	getFileByPath(path: string): TFile | null {
		const file = this.items.get(path);
		return file instanceof TFile ? file : null;
	}
	getMarkdownFiles(): TFile[] {
		return this.getFiles().filter((file) => file.extension === "md");
	}
	getFiles(): TFile[] {
		return [...this.items.values()].filter((item): item is TFile => item instanceof TFile);
	}
	getAllLoadedFiles(): TAbstractFile[] {
		return [this.root, ...this.items.values()];
	}
	getRoot(): TFolder {
		return this.root;
	}

	/** Adds a file or folder (by trailing `/` or missing extension) without events. */
	add(path: string): TAbstractFile {
		const existing = this.items.get(path);
		if (existing) return existing;
		const isFolder = !/\.[^/]+$/.test(path);
		const item = isFolder ? new TFolder(path) : new TFile(path);
		const slash = path.lastIndexOf("/");
		const parent = slash > 0 ? (this.add(path.slice(0, slash)) as TFolder) : this.root;
		item.parent = parent;
		parent.children.push(item);
		this.items.set(path, item);
		return item;
	}

	/** Renames/moves like Obsidian: updates descendants, then emits one `rename`. */
	rename(oldPath: string, newPath: string): TAbstractFile {
		const item = this.items.get(oldPath);
		if (!item) throw new Error(`No item at ${oldPath}`);
		for (const [path, entry] of [...this.items]) {
			if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
			this.items.delete(path);
			entry.path = newPath + path.slice(oldPath.length);
			entry.name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
			this.items.set(entry.path, entry);
		}
		this.trigger("rename", item, oldPath);
		return item;
	}

	/** Deletes like Obsidian: removes descendants, then emits one `delete`. */
	remove(path: string): TAbstractFile {
		const item = this.items.get(path);
		if (!item) throw new Error(`No item at ${path}`);
		for (const key of [...this.items.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) this.items.delete(key);
		}
		this.trigger("delete", item);
		return item;
	}
}

/** Only its events matter to Notemoji (`changed` re-renders note titles). */
export class FakeMetadataCache extends Events {}

export class FakeWorkspace extends Events {
	readonly leftSplit = {};
	readonly rightSplit = {};
	readonly rootSplit = {};
	readonly leaves: WorkspaceLeaf[] = [];
	layoutReady = true;
	activeFile: TFile | null = null;

	getActiveFile(): TFile | null {
		return this.activeFile;
	}
	onLayoutReady(callback: () => unknown): void {
		callback();
	}
	getLeavesOfType(type: string): WorkspaceLeaf[] {
		return this.leaves.filter((leaf) => leaf.view.getViewType() === type);
	}
	iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void {
		for (const leaf of this.leaves) callback(leaf);
	}
}

export interface FakeApp {
	vault: FakeVault;
	metadataCache: FakeMetadataCache;
	workspace: FakeWorkspace;
	/** The same object, typed as the real `App` for passing into plugin code. */
	asApp: RealApp;
}

export function createFakeApp(options: FakeAppOptions = {}): FakeApp {
	const vault = new FakeVault();
	const metadataCache = new FakeMetadataCache();
	const workspace = new FakeWorkspace();

	for (const path of options.files ?? []) vault.add(path);
	if (options.activeFile) workspace.activeFile = vault.add(options.activeFile) as TFile;

	const app = { vault, metadataCache, workspace } as FakeApp;
	app.asApp = app as unknown as RealApp;
	return app;
}

/** Waits for queued microtasks and short timers (debounced renders). */
export function flush(ms = 0): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
