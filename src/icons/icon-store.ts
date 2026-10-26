import { isFutureIconValue, normalizeIcon } from "./icon-value";

/** A stored path as-is: names may start or end with spaces, so nothing is trimmed. */
function normalizeStoredPath(key: string): string | undefined {
	if (key.trim() === "" || key.includes("\u0000")) return undefined;
	return key;
}

/**
 * In-memory map of vault paths to emoji: the `icons` section of data.json.
 *
 * Kept deliberately free of Obsidian imports so the rename/cleanup rules can be
 * unit tested without a vault. All mutating methods report whether they changed
 * anything, so callers only save and re-render when it matters.
 */
export class IconStore {
	private readonly icons = new Map<string, string>();

	get size(): number {
		return this.icons.size;
	}

	get(path: string): string | undefined {
		if (path === "") return undefined;
		return this.icons.get(path);
	}

	/** Assigns an emoji or custom icon to a path. Returns true when the stored value changed. */
	set(path: string, value: string): boolean {
		if (path === "") return false;
		const icon = normalizeIcon(value);
		if (icon === undefined || this.icons.get(path) === icon) return false;
		this.icons.set(path, icon);
		return true;
	}

	/** Removes every entry whose value matches. Returns the affected paths. */
	removeWhere(matches: (value: string) => boolean): string[] {
		const removed: string[] = [];
		for (const [path, value] of [...this.icons]) {
			if (!matches(value)) continue;
			this.icons.delete(path);
			removed.push(path);
		}
		return removed;
	}

	/** Removes the emoji of a single path. Returns true when something was removed. */
	remove(path: string): boolean {
		if (path === "") return false;
		return this.icons.delete(path);
	}

	/**
	 * Moves icons after a rename or move.
	 *
	 * Handles files (exact path) and folders (path plus every descendant), which
	 * makes a single method enough for `vault.on("rename")`.
	 */
	rename(oldPath: string, newPath: string): boolean {
		if (oldPath === "" || newPath === "" || oldPath === newPath) return false;

		const moves: Array<[string, string]> = [];
		const exact = this.icons.get(oldPath);
		if (exact !== undefined) {
			this.icons.delete(oldPath);
			moves.push([newPath, exact]);
		}

		const prefix = `${oldPath}/`;
		for (const [key, value] of [...this.icons]) {
			if (key.startsWith(prefix)) {
				this.icons.delete(key);
				moves.push([newPath + key.slice(oldPath.length), value]);
			}
		}

		for (const [key, value] of moves) this.icons.set(key, value);
		return moves.length > 0;
	}

	/**
	 * Drops every icon whose path no longer exists in the vault. Returns the
	 * removed paths so callers can log or persist the cleanup.
	 */
	prune(exists: (path: string) => boolean): string[] {
		const removed: string[] = [];
		for (const key of [...this.icons.keys()]) {
			if (!exists(key)) {
				this.icons.delete(key);
				removed.push(key);
			}
		}
		return removed;
	}

	entries(): IterableIterator<[string, string]> {
		return this.icons.entries();
	}

	toRecord(): Record<string, string> {
		// Not by assignment: a folder named `__proto__` would change the object's prototype.
		return Object.fromEntries(this.icons);
	}

	/**
	 * Rebuilds a store from plugin data.
	 *
	 * Anything unexpected (missing data, wrong types, invalid emoji, empty keys)
	 * is skipped instead of throwing, so a damaged data file never breaks the
	 * plugin. A plain `{ "path": "emoji" }` object is accepted as well as the
	 * versioned `{ version, icons }` shape.
	 */
	static fromData(raw: unknown): IconStore {
		const store = new IconStore();
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return store;

		const container = raw as Record<string, unknown>;
		const candidate =
			container.icons !== null &&
			typeof container.icons === "object" &&
			!Array.isArray(container.icons)
				? (container.icons as Record<string, unknown>)
				: container;

		for (const [key, value] of Object.entries(candidate)) {
			const path = normalizeStoredPath(key);
			if (path === undefined) continue;
			// Values of newer versions are kept, so saving here never loses them.
			const icon = normalizeIcon(value) ?? (isFutureIconValue(value) ? value : undefined);
			if (icon === undefined) continue;
			store.icons.set(path, icon);
		}
		return store;
	}
}
