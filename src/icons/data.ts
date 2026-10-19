import { sanitizeStoredEmoji } from "./emoji";
import { IconStore } from "./icon-store";

/**
 * Everything Notemoji keeps in `.obsidian/plugins/notemoji/data.json`.
 *
 * Free of Obsidian imports so loading and migrating can be unit tested.
 * Loading never throws: anything unexpected falls back to defaults.
 */

/** Version of the file layout; version 1 files are still read. */
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
}

export const DEFAULT_SETTINGS: Readonly<NotemojiSettings> = {
	noteTitle: "off",
	showInTabs: true,
	showInViewHeader: true,
};

export interface PluginData {
	settings: NotemojiSettings;
	/** Emoji of notes, folders and files by vault path. */
	icons: IconStore;
	/** Recently used emoji, most recent first. */
	recent: string[];
}

/** Shape of data.json. */
export interface StoredData {
	version: number;
	settings: NotemojiSettings;
	icons: Record<string, string>;
	recent: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readSettings(raw: unknown): NotemojiSettings {
	const settings: NotemojiSettings = { ...DEFAULT_SETTINGS };
	if (!isRecord(raw)) return settings;

	if (raw.noteTitle === "off" || raw.noteTitle === "above" || raw.noteTitle === "inline") {
		settings.noteTitle = raw.noteTitle;
	}
	if (typeof raw.showInTabs === "boolean") settings.showInTabs = raw.showInTabs;
	if (typeof raw.showInViewHeader === "boolean") settings.showInViewHeader = raw.showInViewHeader;
	return settings;
}

function readRecent(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const recent: string[] = [];
	for (const value of raw) {
		const emoji = sanitizeStoredEmoji(value);
		if (emoji !== undefined && !recent.includes(emoji)) recent.push(emoji);
		if (recent.length === MAX_RECENT) break;
	}
	return recent;
}

/** Parses data.json of any version (or garbage) into usable plugin data. */
export function parseData(raw: unknown): PluginData {
	if (!isRecord(raw)) {
		return { settings: { ...DEFAULT_SETTINGS }, icons: new IconStore(), recent: [] };
	}
	return {
		settings: readSettings(raw.settings),
		// Accepts `{ icons: {…} }` (versions 1 and 2) and the early plain `{ path: emoji }` map.
		icons: IconStore.fromData(raw),
		recent: readRecent(raw.recent),
	};
}

export function serializeData(data: PluginData): StoredData {
	return {
		version: DATA_VERSION,
		settings: { ...data.settings },
		icons: data.icons.toRecord(),
		recent: [...data.recent],
	};
}

/** A new recent list with `emoji` in front, without duplicates. */
export function pushRecent(recent: readonly string[], emoji: string): string[] {
	return [emoji, ...recent.filter((entry) => entry !== emoji)].slice(0, MAX_RECENT);
}
