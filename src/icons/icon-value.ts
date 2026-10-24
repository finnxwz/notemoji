import { sanitizeStoredEmoji } from "./emoji";

/**
 * What an item's stored value means.
 *
 * - An emoji (or symbol), stored as-is: `"🚀"`.
 * - A custom icon from the library in data.json, by its name: `"custom:rocket"`.
 * - One of Obsidian's own icons (Lucide), by its name: `"lucide:arrow-right"`.
 *
 * Kept free of Obsidian imports so it can be unit tested.
 */
export type Icon =
	| { type: "emoji"; emoji: string }
	| { type: "custom"; id: string }
	| { type: "lucide"; name: string };

/** An icon shown as a picture rather than as text. */
export type ImageIcon = Exclude<Icon, { type: "emoji" }>;

export const CUSTOM_PREFIX = "custom:";
export const LUCIDE_PREFIX = "lucide:";

/** Longest name of a custom icon made from an upload's file name. */
const MAX_ID_LENGTH = 60;

/**
 * A plain file name with one of the given extensions: no folders, not hidden,
 * not too long. Used for the emoji font files Notemoji stores.
 */
export function isPlainFileName(name: string, extensions: readonly string[]): boolean {
	if (name.length === 0 || name.length > 100) return false;
	if (/[/\\:*?"<>|]/.test(name) || name.startsWith(".") || !name.includes(".")) return false;
	return extensions.includes(name.slice(name.lastIndexOf(".") + 1).toLowerCase());
}

/**
 * The name of a custom icon, which is also its key in the library. Read
 * leniently (names from older builds kept their extension, like `logo.png`),
 * but never anything that could pass as a path or hide characters.
 */
export function isCustomIconId(id: string): boolean {
	if (id.length === 0 || id.length > 100 || id !== id.trim() || id.startsWith(".")) return false;
	return !/[/\\:*?"<>|\p{C}]/u.test(id);
}

export function customValue(id: string): string {
	return CUSTOM_PREFIX + id;
}

/**
 * The name of one of Obsidian's icons, as Obsidian lists it without the
 * `lucide-` prefix: lower case words joined by single hyphens (`arrow-right`).
 */
export function isLucideName(name: string): boolean {
	return name.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function lucideValue(name: string): string {
	return LUCIDE_PREFIX + name;
}

/** Reads a stored value; `undefined` for anything that is not a usable icon. */
export function parseIcon(value: unknown): Icon | undefined {
	if (typeof value === "string" && value.startsWith(CUSTOM_PREFIX)) {
		const id = value.slice(CUSTOM_PREFIX.length);
		return isCustomIconId(id) ? { type: "custom", id } : undefined;
	}
	if (typeof value === "string" && value.startsWith(LUCIDE_PREFIX)) {
		const name = value.slice(LUCIDE_PREFIX.length);
		return isLucideName(name) ? { type: "lucide", name } : undefined;
	}
	const emoji = sanitizeStoredEmoji(value);
	return emoji === undefined ? undefined : { type: "emoji", emoji };
}

/**
 * A value written by a newer version: another icon source (`phosphor:rocket`)
 * or a custom or Obsidian icon in a form this version doesn't know. Kept in
 * data.json, so saving with this version never loses it, but not shown.
 */
export function isFutureIconValue(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= 200 &&
		/^[a-z][a-z0-9-]*:\S/.test(value) &&
		parseIcon(value) === undefined &&
		!/\p{C}/u.test(value)
	);
}

/** The canonical string to store for a value, or `undefined` when it is not usable. */
export function normalizeIcon(value: unknown): string | undefined {
	const icon = parseIcon(value);
	if (!icon) return undefined;
	if (icon.type === "emoji") return icon.emoji;
	return icon.type === "custom" ? customValue(icon.id) : lucideValue(icon.name);
}

/**
 * A readable, unique name for an uploaded image: the file name without its
 * extension (the stored format may differ), anything unusual replaced, and
 * `-2`, `-3`, … appended when it is taken (ignoring case).
 */
export function uniqueIconId(fileName: string, taken: Iterable<string>): string {
	const dot = fileName.lastIndexOf(".");
	const base =
		(dot > 0 ? fileName.slice(0, dot) : fileName)
			.normalize("NFC")
			.replace(/[^\p{L}\p{M}\p{N} _-]+/gu, "-")
			.replace(/\s+/g, " ")
			.replace(/^[\s-]+|[\s-]+$/g, "")
			.slice(0, MAX_ID_LENGTH)
			.trim() || "icon";
	const lowerTaken = new Set([...taken].map((id) => id.toLowerCase()));
	for (let index = 1; ; index += 1) {
		const id = index === 1 ? base : `${base}-${index}`;
		if (!lowerTaken.has(id.toLowerCase())) return id;
	}
}
