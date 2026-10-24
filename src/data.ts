import { readCustomIcons, StoredIcon } from "./icons/custom-icons";
import { IconStore } from "./icons/icon-store";
import { isFutureIconValue, LUCIDE_PREFIX, normalizeIcon, parseIcon } from "./icons/icon-value";
import { readLibraryIcons } from "./icons/library-icons";
import { findEmojiSet, isFontFileName } from "./style/emoji-sets";

/**
 * Everything Notemoji keeps in `.obsidian/plugins/notemoji/data.json`.
 *
 * Free of Obsidian imports so loading and migrating can be unit tested.
 * Loading never throws: anything unexpected falls back to defaults.
 */

/**
 * Version of the file layout; every older one is still read.
 *
 * Changes must stay compatible: add new entries instead of changing or
 * removing existing ones (entries a version doesn't know are kept when it
 * saves, see `UnknownData`). Increase the version only for a change older
 * versions can't handle: they then stop saving instead of damaging the data.
 */
export const DATA_VERSION = 2;

/** How many recently used emoji the picker remembers. */
export const MAX_RECENT = 24;

export type NoteTitleMode = "off" | "above" | "inline";

export interface NotemojiSettings {
	/** Emoji at the note's inline title: large above it, inline before it, or not at all. */
	noteTitle: NoteTitleMode;
	/** Emoji in front of tab titles. */
	showInTabs: boolean;
	/** Emoji in front of the title in the view header (top bar). */
	showInViewHeader: boolean;
	/** `system`, `file` (own font file) or the id of a downloadable emoji set. */
	emojiStyle: string;
	/** File name of your own emoji font (used with `emojiStyle: "file"`), or "". */
	emojiFont: string;
	/** Gives notes made on this device an emoji that fits their name or folder. */
	autoEmoji: boolean;
}

export const DEFAULT_SETTINGS: Readonly<NotemojiSettings> = {
	noteTitle: "off",
	showInTabs: true,
	showInViewHeader: false,
	emojiStyle: "system",
	emojiFont: "",
	autoEmoji: false,
};

/** Which version of Notemoji wrote the data. */
export type DataSource =
	/** No data.json yet (or nothing readable in it). */
	| "none"
	/** Notemoji 1.x, which keeps only the emoji and drops everything else when it saves. */
	| "old"
	| "current"
	/** A newer version with a changed format: this version must not save over it. */
	| "newer";

/**
 * Parts of data.json this version doesn't understand, kept as they are and
 * written back on save, so a newer version's data survives this one.
 */
export interface UnknownData {
	/** Top-level entries. */
	top: Record<string, unknown>;
	/** Settings this version doesn't know, or values it can't use (e.g. a newer emoji style). */
	settings: Record<string, unknown>;
	/** Custom icons in a form this version can't read. */
	customIcons: Record<string, unknown>;
	/** Copies of icons from another icon source, or in a form this version can't read. */
	libraryIcons: Record<string, unknown>;
}

export interface PluginData {
	settings: NotemojiSettings;
	/** Emoji of notes, folders and files by vault path. */
	icons: IconStore;
	/** Recently used emoji and custom icons, most recent first. */
	recent: string[];
	/** The user's own icons by name; items refer to them as `custom:<name>`. */
	customIcons: Map<string, StoredIcon>;
	/**
	 * A copy (SVG) of each of Obsidian's icons in use, by value (`lucide:star`),
	 * so every device draws the same icon, whatever its Obsidian version has.
	 */
	libraryIcons: Map<string, string>;
	unknown: UnknownData;
	source: DataSource;
}

/** Shape of data.json. */
export interface StoredData {
	version: number;
	settings: Record<string, unknown>;
	icons: Record<string, string>;
	recent: string[];
	libraryIcons: Record<string, unknown>;
	/** Last, so the small, readable parts stay at the top of the file. */
	customIcons: Record<string, unknown>;
	[key: string]: unknown;
}

const KNOWN_TOP = new Set([
	"version",
	"settings",
	"icons",
	"recent",
	"libraryIcons",
	"customIcons",
]);

/**
 * An entry in `icons` that only versions from 2.0 on keep: 1.x drops keys
 * with a null character. Obsidian Sync merges conflicting copies of a JSON
 * file key by key, which can combine a 2.x file with the `icons` of a 1.x
 * copy; without this marker those icons would pass as current.
 */
export const ICONS_MARKER = `${String.fromCodePoint(0)}notemoji`;

/** Sets a property as the object's own, also for keys like `__proto__`. */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
	Object.defineProperty(target, key, {
		value,
		enumerable: true,
		writable: true,
		configurable: true,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function emptyUnknown(): UnknownData {
	return { top: {}, settings: {}, customIcons: {}, libraryIcons: {} };
}

function readSettings(raw: unknown, unknown: UnknownData): NotemojiSettings {
	const settings: NotemojiSettings = { ...DEFAULT_SETTINGS };
	if (!isRecord(raw)) return settings;

	if (raw.noteTitle === "off" || raw.noteTitle === "above" || raw.noteTitle === "inline") {
		settings.noteTitle = raw.noteTitle;
	}
	if (typeof raw.showInTabs === "boolean") settings.showInTabs = raw.showInTabs;
	if (typeof raw.showInViewHeader === "boolean") settings.showInViewHeader = raw.showInViewHeader;
	if (typeof raw.autoEmoji === "boolean") settings.autoEmoji = raw.autoEmoji;
	if (typeof raw.emojiFont === "string" && isFontFileName(raw.emojiFont)) {
		settings.emojiFont = raw.emojiFont;
	}
	const style = raw.emojiStyle;
	if (
		typeof style === "string" &&
		(style === "system" || style === "file" || findEmojiSet(style))
	) {
		settings.emojiStyle = style;
	} else if (style === undefined && settings.emojiFont !== "") {
		// Saved before emoji styles existed: an own font file was the only option.
		settings.emojiStyle = "file";
	}

	// Anything not used as read is kept for the version that wrote it.
	for (const [key, value] of Object.entries(raw)) {
		if (value !== undefined && settings[key as keyof NotemojiSettings] !== value) {
			setOwn(unknown.settings, key, value);
		}
	}
	return settings;
}

function readRecent(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const recent: string[] = [];
	for (const value of raw) {
		const icon = normalizeIcon(value) ?? (isFutureIconValue(value) ? value : undefined);
		if (icon !== undefined && !recent.includes(icon)) recent.push(icon);
		if (recent.length === MAX_RECENT) break;
	}
	return recent;
}

function sourceOf(raw: Record<string, unknown>): DataSource {
	const { version } = raw;
	if (typeof version === "number") {
		if (version > DATA_VERSION) return "newer";
		if (version < DATA_VERSION) return "old";
		// Current, unless its emoji came from a 1.x copy (see ICONS_MARKER).
		return isRecord(raw.icons) && !Object.hasOwn(raw.icons, ICONS_MARKER) ? "old" : "current";
	}
	// Without a version: hand-written, or the early plain `{ path: emoji }` map.
	if (["settings", "recent", "customIcons", "libraryIcons"].some((key) => key in raw)) {
		return "current";
	}
	return Object.keys(raw).length === 0 ? "none" : "old";
}

/** Parses data.json of any version (or garbage) into usable plugin data. */
export function parseData(raw: unknown): PluginData {
	const unknown = emptyUnknown();
	if (!isRecord(raw)) {
		return {
			settings: { ...DEFAULT_SETTINGS },
			icons: new IconStore(),
			recent: [],
			customIcons: new Map(),
			libraryIcons: new Map(),
			unknown,
			source: "none",
		};
	}
	// The early plain `{ path: emoji }` map has no other entries to keep.
	if (isRecord(raw.icons)) {
		for (const [key, value] of Object.entries(raw)) {
			if (!KNOWN_TOP.has(key)) setOwn(unknown.top, key, value);
		}
	}
	return {
		settings: readSettings(raw.settings, unknown),
		// Accepts `{ icons: {…} }` (versions 1 and 2) and the early plain `{ path: emoji }` map.
		icons: IconStore.fromData(raw),
		recent: readRecent(raw.recent),
		customIcons: readCustomIcons(raw.customIcons, unknown.customIcons),
		libraryIcons: readLibraryIcons(raw.libraryIcons, unknown.libraryIcons),
		unknown,
		source: sourceOf(raw),
	};
}

export function serializeData(data: PluginData): StoredData {
	const { unknown } = data;
	return {
		...unknown.top,
		version: DATA_VERSION,
		settings: { ...unknown.settings, ...settingsToSave(data) },
		icons: { [ICONS_MARKER]: "", ...data.icons.toRecord() },
		recent: [...data.recent],
		libraryIcons: { ...unknown.libraryIcons, ...Object.fromEntries(data.libraryIcons) },
		customIcons: {
			...unknown.customIcons,
			...Object.fromEntries(
				[...data.customIcons].map(([id, icon]) => [
					id,
					{ type: icon.type, data: icon.data },
				]),
			),
		},
	};
}

/** Settings as saved: values kept for a newer version stay unless they were changed here. */
function settingsToSave(data: PluginData): Partial<NotemojiSettings> {
	const settings: Partial<NotemojiSettings> = { ...data.settings };
	for (const key of Object.keys(data.unknown.settings)) {
		delete settings[key as keyof NotemojiSettings];
	}
	return settings;
}

/**
 * Repairs data.json after Notemoji 1.x saved over it (a device that was not
 * updated yet). 1.x keeps only the emoji: it drops the settings, the recent
 * list, custom icons, copies of Obsidian icons and every `custom:` or
 * `lucide:` assignment, trims paths, and may hold an outdated copy of the
 * emoji. So:
 *
 * - sections in the file (`raw`) are used: besides the emoji of 1.x, Obsidian
 *   Sync may have merged in newer sections of a 2.x copy (see ICONS_MARKER);
 *   sections missing from it come from `known` (the data before);
 * - emoji of the file win, except over custom icons and values of newer
 *   versions, which 1.x can't have seen (it can only hold an older emoji);
 * - emoji missing from the file are restored: a removal on the outdated
 *   device comes back, which is easier to undo than a lost emoji.
 *
 * Whether an emoji of 1.x is a change or an outdated copy can't be told
 * apart; the newer write wins.
 */
export function repairAfterOldVersion(raw: unknown, known: PluginData): PluginData {
	const old = parseData(raw);
	const inFile = (key: string) => isRecord(raw) && Object.hasOwn(raw, key);

	const icons = IconStore.fromData({ icons: known.icons.toRecord() });
	const trimmed = new Map<string, string>();
	for (const [path] of known.icons.entries()) trimmed.set(path.trim(), path);
	for (const [path, value] of old.icons.entries()) {
		// 1.x trims paths: " a.md" comes back as "a.md".
		const target = known.icons.get(path) === undefined ? (trimmed.get(path) ?? path) : path;
		const current = known.icons.get(target);
		if (current !== undefined && parseIcon(current)?.type !== "emoji") continue;
		icons.set(target, value);
	}

	const settingsInFile = inFile("settings");
	const customIconsInFile = inFile("customIcons");
	const libraryIconsInFile = inFile("libraryIcons");
	return {
		settings: settingsInFile ? old.settings : known.settings,
		icons,
		recent: inFile("recent") ? old.recent : known.recent,
		customIcons: customIconsInFile ? old.customIcons : known.customIcons,
		libraryIcons: libraryIconsInFile ? old.libraryIcons : known.libraryIcons,
		unknown: {
			top: { ...known.unknown.top, ...old.unknown.top },
			settings: settingsInFile ? old.unknown.settings : known.unknown.settings,
			customIcons: customIconsInFile ? old.unknown.customIcons : known.unknown.customIcons,
			libraryIcons: libraryIconsInFile
				? old.unknown.libraryIcons
				: known.unknown.libraryIcons,
		},
		source: "current",
	};
}

/**
 * Combines changes made here that are not saved yet (`base`, what was on
 * disk, → `local`) with a newer file (`remote`): entries changed here win,
 * all others come from the file. Works on saved data, entry by entry.
 */
export function mergeChanges(base: StoredData, local: StoredData, remote: StoredData): StoredData {
	const merged: StoredData = { ...remote };
	for (const key of ["settings", "icons", "libraryIcons", "customIcons"] as const) {
		merged[key] = mergeEntries(base[key], local[key], remote[key]) as never;
	}
	if (!same(base.recent, local.recent)) merged.recent = local.recent;
	return merged;
}

function mergeEntries(
	base: Record<string, unknown>,
	local: Record<string, unknown>,
	remote: Record<string, unknown>,
): Record<string, unknown> {
	const entries = new Map(Object.entries(remote));
	for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
		const before = Object.hasOwn(base, key) ? base[key] : undefined;
		const after = Object.hasOwn(local, key) ? local[key] : undefined;
		if (same(before, after)) continue;
		if (after === undefined) entries.delete(key);
		else entries.set(key, after);
	}
	return Object.fromEntries(entries);
}

function same(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The Obsidian icons in use, whose copies are kept: those of items and of the
 * recent list, and any found in data of a newer version, which may use them
 * in places this version doesn't know.
 */
export function libraryIconsInUse(data: PluginData): Set<string> {
	const used = new Set<string>();
	const pending: unknown[] = [data.unknown.top, data.unknown.settings, ...data.recent];
	for (const [, value] of data.icons.entries()) pending.push(value);
	// Without recursion: data of a newer version may be nested deeply.
	while (pending.length > 0) {
		const value = pending.pop();
		if (typeof value === "string") {
			if (value.startsWith(LUCIDE_PREFIX) && parseIcon(value)) used.add(value);
		} else if (value !== null && typeof value === "object") {
			for (const child of Object.values(value)) pending.push(child);
		}
	}
	return used;
}

/** A new recent list with `emoji` in front, without duplicates. */
export function pushRecent(recent: readonly string[], emoji: string): string[] {
	return [emoji, ...recent.filter((entry) => entry !== emoji)].slice(0, MAX_RECENT);
}
