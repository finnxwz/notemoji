import { isLucideName, lucideValue, parseIcon } from "./icon-value";

/**
 * Obsidian's own icons (Lucide), as icons for notes, folders and files.
 *
 * Devices run different Obsidian versions, whose icon sets differ: names are
 * added, renamed or removed, and drawings change. So a copy of every icon in
 * use is kept in data.json (`libraryIcons`, by value: `lucide:star` → SVG),
 * and every device draws that copy: the same icon everywhere, also where
 * Obsidian lacks the name.
 *
 * Free of Obsidian imports (its icon functions are passed in), so it can be
 * unit tested.
 */

/** Prefix of Obsidian's ids for its Lucide icons (`lucide-star`). */
const LUCIDE_ID_PREFIX = "lucide-";

/** Longest copy accepted; Lucide icons are well below 2 KB. */
export const MAX_LIBRARY_ICON_SIZE = 10 * 1024;

/** Obsidian's icon functions, as Notemoji uses them. */
export interface IconApi {
	getIcon(iconId: string): SVGSVGElement | null;
	getIconIds(): string[];
}

/** Obsidian's id of one of its icons, for `setIcon` and `getIcon`. */
export function lucideIconId(name: string): string {
	return LUCIDE_ID_PREFIX + name;
}

/** The names of Obsidian's own icons among all registered ids (`lucide-star` → `star`), sorted. */
export function lucideNames(ids: readonly string[]): string[] {
	const names = new Set<string>();
	for (const id of ids) {
		if (!id.startsWith(LUCIDE_ID_PREFIX)) continue;
		const name = id.slice(LUCIDE_ID_PREFIX.length);
		if (isLucideName(name)) names.add(name);
	}
	return [...names].sort();
}

/** An icon's name in plain words: `arrow-right` → "arrow right". */
export function lucideLabel(name: string): string {
	return name.split("-").join(" ");
}

/**
 * Icon names that have every word of `query` as the start of one of their
 * words ("arrow r" finds `arrow-right`): the exact name first, then names
 * with fewer words, in the order given.
 */
export function searchLucide(names: readonly string[], query: string, limit = 200): string[] {
	const terms = query
		.toLowerCase()
		.split(/[\s_-]+/)
		.filter((term) => term !== "");
	if (terms.length === 0) return [];
	const exact = terms.join("-");
	const results: Array<{ name: string; rank: number }> = [];
	for (const name of names) {
		const words = name.split("-");
		if (!terms.every((term) => words.some((word) => word.startsWith(term)))) continue;
		results.push({ name, rank: name === exact ? 0 : words.length });
	}
	// Stable: names of the same rank keep their order.
	results.sort((a, b) => a.rank - b.rank);
	return results.slice(0, limit).map((result) => result.name);
}

/** A stored copy this version can show: SVG markup of a sensible size. */
export function isLibraryIconSvg(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= MAX_LIBRARY_ICON_SIZE &&
		/^<svg[\s>/]/.test(value)
	);
}

/** An icon as drawn by Obsidian, as markup to store; its classes only mean something inside Obsidian. */
export function svgMarkup(svg: SVGSVGElement): string {
	const copy = svg.cloneNode(true) as SVGSVGElement;
	copy.removeAttribute("class");
	return new XMLSerializer().serializeToString(copy);
}

/**
 * Reads the `libraryIcons` section of data.json leniently. Entries this
 * version can't use (another icon source, a form added later) go to
 * `unreadable` as they are, so they are saved again unchanged.
 */
export function readLibraryIcons(
	raw: unknown,
	unreadable: Record<string, unknown> = {},
): Map<string, string> {
	const copies = new Map<string, string>();
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return copies;
	for (const [value, svg] of Object.entries(raw)) {
		if (parseIcon(value)?.type === "lucide" && isLibraryIconSvg(svg)) {
			copies.set(value, svg);
		} else {
			// As an own property, also for a name like `__proto__`.
			Object.defineProperty(unreadable, value, {
				value: svg,
				enumerable: true,
				writable: true,
				configurable: true,
			});
		}
	}
	return copies;
}

/**
 * The copies of Obsidian's icons in data.json, and how to show them.
 *
 * Icons are shown through `blob:` URLs of their SVG, never inline: the copies
 * come from synced data, and images never run scripts. A copy is never
 * replaced, only added where it is missing and dropped once unused, so two
 * devices with different Obsidian versions don't keep swapping their drawings.
 */
export class LibraryIcons {
	/** URL of each icon by name, with the markup it was made from (sync may bring a copy). */
	private readonly urls = new Map<string, { svg: string; url: string }>();
	/** This device's drawing of each icon asked for; Obsidian's icons don't change while it runs. */
	private readonly drawings = new Map<string, string | undefined>();
	private names: string[] | null = null;

	/**
	 * @param copies the copies in the current data, by value (data.json may be reloaded)
	 * @param save persists data.json after a change
	 * @param reserved values whose copy is in a form this version can't read (kept for a newer version)
	 * @param api Obsidian's icon functions
	 */
	constructor(
		private readonly copies: () => Map<string, string>,
		private readonly save: () => void,
		private readonly reserved: () => Iterable<string>,
		private readonly api: IconApi,
	) {}

	/** Names of every icon this device's Obsidian has, sorted. */
	list(): readonly string[] {
		this.names ??= lucideNames(this.api.getIconIds());
		return this.names;
	}

	/** URL for showing an icon: its copy, else this device's own; `undefined` when there is neither. */
	url(name: string): string | undefined {
		return this.urlOf(name, this.markupOf(name));
	}

	/** URL of an icon's copy; `undefined` when there is none. */
	storedUrl(name: string): string | undefined {
		const svg = this.copies().get(lucideValue(name));
		return svg === undefined ? undefined : this.urlOf(name, svg);
	}

	/** Number of copies and the room they take in data.json. */
	usage(): { count: number; bytes: number } {
		let bytes = 0;
		for (const svg of this.copies().values()) bytes += svg.length;
		return { count: this.copies().size, bytes };
	}

	/** Stores a copy of an icon that was picked here, unless there is one. */
	keep(name: string): void {
		if (this.add(lucideValue(name), new Set(this.reserved()))) this.save();
	}

	/**
	 * Keeps the copies in step with the icons in use (after loading, and after
	 * sync brought changes): drops copies no longer in use and adds missing
	 * ones this device can draw. Saves when something changed.
	 */
	update(inUse: ReadonlySet<string>): void {
		let changed = false;
		const copies = this.copies();
		for (const value of [...copies.keys()]) {
			if (inUse.has(value)) continue;
			copies.delete(value);
			changed = true;
		}
		const reserved = new Set(this.reserved());
		for (const value of inUse) {
			if (this.add(value, reserved)) changed = true;
		}
		if (!changed) return;
		this.releaseStale();
		this.save();
	}

	/** Frees the URLs of icons whose copy was removed, replaced or added, e.g. after data.json was reloaded. */
	releaseStale(): void {
		for (const [name, cached] of [...this.urls]) {
			if (this.markupOf(name) !== cached.svg) this.release(name);
		}
	}

	/** Frees every URL (on unload). */
	dispose(): void {
		for (const name of [...this.urls.keys()]) this.release(name);
	}

	/** Adds the copy of an Obsidian icon value if there is none yet. Returns whether it added one. */
	private add(value: string, reserved: ReadonlySet<string>): boolean {
		const icon = parseIcon(value);
		if (icon?.type !== "lucide" || this.copies().has(value) || reserved.has(value))
			return false;
		const svg = this.drawing(icon.name);
		if (svg === undefined) return false;
		this.copies().set(value, svg);
		return true;
	}

	/** What an icon is shown from: its copy, else this device's drawing. */
	private markupOf(name: string): string | undefined {
		return this.copies().get(lucideValue(name)) ?? this.drawing(name);
	}

	/** This device's drawing of an icon, as stored; `undefined` when its Obsidian has no such icon. */
	private drawing(name: string): string | undefined {
		if (!this.drawings.has(name)) {
			const svg = this.api.getIcon(lucideIconId(name));
			const markup = svg ? svgMarkup(svg) : undefined;
			this.drawings.set(name, isLibraryIconSvg(markup) ? markup : undefined);
		}
		return this.drawings.get(name);
	}

	private urlOf(name: string, svg: string | undefined): string | undefined {
		const cached = this.urls.get(name);
		if (cached && cached.svg === svg) {
			// Same content after a reload: keep the new string, so the next check is instant.
			cached.svg = svg;
			return cached.url;
		}
		this.release(name);
		if (svg === undefined) return undefined;
		const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
		this.urls.set(name, { svg, url });
		return url;
	}

	private release(name: string): void {
		const cached = this.urls.get(name);
		if (!cached) return;
		URL.revokeObjectURL(cached.url);
		this.urls.delete(name);
	}
}
