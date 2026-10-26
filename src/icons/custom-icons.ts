import { decodeBase64, isBase64 } from "./image-format";
import { isCustomIconId, uniqueIconId } from "./icon-value";

/** Formats custom icons are stored in. */
export const STORED_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
] as const;

export type StoredIconType = (typeof STORED_TYPES)[number];

/** A custom icon as stored in data.json: the image file, base64-encoded. */
export interface StoredIcon {
	type: StoredIconType;
	data: string;
	/** Other fields of the stored entry (a newer version's, e.g. a name), saved again as they are. */
	extra?: Record<string, unknown>;
}

/**
 * Room for custom icons and the copies of Obsidian icons in data.json,
 * counted as stored. Obsidian Sync (Standard plan) skips files over 5 MB, and
 * data.json also holds every emoji assignment, so the icons stay well below
 * that.
 */
export const ICON_STORAGE_LIMIT = 3 * 1024 * 1024;

/** Largest single icon as stored, so at least 50 icons always fit. */
export const MAX_ICON_SIZE = 60 * 1024;

export class CustomIconError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads the `customIcons` section of data.json leniently. Entries this
 * version can't use (e.g. a format or a kind of name added later) go to
 * `unreadable` as they are, so they are saved again unchanged; so do fields
 * it doesn't know in the entries it uses (`extra`).
 */
export function readCustomIcons(
	raw: unknown,
	unreadable: Record<string, unknown> = {},
): Map<string, StoredIcon> {
	const icons = new Map<string, StoredIcon>();
	if (!isRecord(raw)) return icons;
	for (const [id, entry] of Object.entries(raw)) {
		const { type, data, ...extra } = isRecord(entry) ? entry : {};
		if (
			isCustomIconId(id) &&
			(STORED_TYPES as readonly unknown[]).includes(type) &&
			typeof data === "string" &&
			isBase64(data)
		) {
			const icon: StoredIcon = { type: type as StoredIconType, data };
			if (Object.keys(extra).length > 0) icon.extra = extra;
			icons.set(id, icon);
		} else {
			// As an own property, also for a name like `__proto__`.
			Object.defineProperty(unreadable, id, {
				value: entry,
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
	}
	return icons;
}

/**
 * The user's own icons, kept inside data.json by name, so they sync together
 * with the emoji that use them. Items refer to an icon by its name only, so
 * an icon used a hundred times is stored once.
 *
 * Images are shown through `blob:` URLs created on first use. Always
 * displayed through `<img>` or CSS, which never run scripts inside SVGs.
 */
export class CustomIconLibrary {
	/** URL of each icon, with the data it was made from (sync may replace an icon). */
	private readonly urls = new Map<string, { data: string; url: string }>();

	/**
	 * @param icons the library in the current data (data.json may be reloaded)
	 * @param save persists data.json after a change
	 * @param reserved names taken by icons this version can't read
	 * @param shared room in data.json taken by other icons (the copies of Obsidian icons)
	 */
	constructor(
		private readonly icons: () => Map<string, StoredIcon>,
		private readonly save: () => void,
		private readonly reserved: () => Iterable<string> = () => [],
		private readonly shared: () => number = () => 0,
	) {}

	/** Names of all icons, sorted. */
	list(): string[] {
		return [...this.icons().keys()].sort((a, b) => a.localeCompare(b));
	}

	get(id: string): StoredIcon | undefined {
		return this.icons().get(id);
	}

	/** Whether the name belongs to an icon this version can't read (kept for a newer version). */
	isReserved(id: string): boolean {
		return [...this.reserved()].includes(id);
	}

	/** Number of icons and the room they take in data.json. */
	usage(): { count: number; bytes: number } {
		let bytes = 0;
		for (const icon of this.icons().values()) bytes += icon.data.length;
		return { count: this.icons().size, bytes };
	}

	/** URL for displaying an icon; `undefined` when the library has no such icon (anymore). */
	url(id: string): string | undefined {
		const icon = this.icons().get(id);
		const cached = this.urls.get(id);
		if (cached && icon && cached.data === icon.data) {
			// Same content after a reload: keep the new string, so the next check is instant.
			cached.data = icon.data;
			return cached.url;
		}
		if (cached) URL.revokeObjectURL(cached.url);
		this.urls.delete(id);
		if (!icon) return undefined;
		const url = URL.createObjectURL(new Blob([decodeBase64(icon.data)], { type: icon.type }));
		this.urls.set(id, { data: icon.data, url });
		return url;
	}

	/**
	 * Adds a prepared icon under a name made from `fileName`. An icon with the
	 * same image that is already stored is reused instead (`existing: true`).
	 */
	add(fileName: string, icon: StoredIcon): { id: string; existing: boolean } {
		const icons = this.icons();
		for (const [id, stored] of icons) {
			if (stored.type === icon.type && stored.data === icon.data) {
				return { id, existing: true };
			}
		}
		if (icon.data.length > MAX_ICON_SIZE) {
			throw new CustomIconError(`"${fileName}" is too large to store.`);
		}
		const { bytes } = this.usage();
		if (bytes + this.shared() + icon.data.length > ICON_STORAGE_LIMIT) {
			throw new CustomIconError(
				`There is no room left for "${fileName}": custom icons and the Obsidian icons you use share 3 MB. ` +
					"Delete icons you no longer need in Notemoji's settings.",
			);
		}
		const id = uniqueIconId(fileName, [...icons.keys(), ...this.reserved()]);
		icons.set(id, { type: icon.type, data: icon.data });
		this.save();
		return { id, existing: false };
	}

	/** Removes an icon. Returns false when there was no such icon. */
	remove(id: string): boolean {
		if (!this.icons().delete(id)) return false;
		this.release(id);
		this.save();
		return true;
	}

	/** Removes every icon. */
	removeAll(): void {
		if (this.icons().size === 0) return;
		this.icons().clear();
		this.releaseStale();
		this.save();
	}

	/** Frees the URLs of icons that were removed or replaced, e.g. after data.json was reloaded. */
	releaseStale(): void {
		for (const [id, cached] of [...this.urls]) {
			if (this.icons().get(id)?.data !== cached.data) this.release(id);
		}
	}

	/** Frees every URL (on unload). */
	dispose(): void {
		for (const id of [...this.urls.keys()]) this.release(id);
	}

	private release(id: string): void {
		const cached = this.urls.get(id);
		if (!cached) return;
		URL.revokeObjectURL(cached.url);
		this.urls.delete(id);
	}
}
