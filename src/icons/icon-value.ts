import { sanitizeStoredEmoji } from "./emoji";

/**
 * What an item's stored value means.
 *
 * - An emoji (or symbol), stored as-is: `"🚀"`.
 * - A custom icon from the plugin's icon folder: `"custom:rocket.svg"`.
 *
 * Kept free of Obsidian imports so it can be unit tested.
 */
export type Icon = { type: "emoji"; emoji: string } | { type: "custom"; file: string };

export const CUSTOM_PREFIX = "custom:";

/** Image types accepted as custom icons (always shown through `<img>`, so SVG scripts never run). */
export const CUSTOM_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"] as const;

/**
 * A plain file name with one of the given extensions: no folders, not hidden,
 * not too long. Used for every file name Notemoji stores (icons, fonts).
 */
export function isPlainFileName(name: string, extensions: readonly string[]): boolean {
	if (name.length === 0 || name.length > 100) return false;
	if (/[/\\:*?"<>|]/.test(name) || name.startsWith(".") || !name.includes(".")) return false;
	return extensions.includes(name.slice(name.lastIndexOf(".") + 1).toLowerCase());
}

/** A custom icon's file name in the icon folder. */
export function isCustomFileName(name: string): boolean {
	return isPlainFileName(name, CUSTOM_EXTENSIONS);
}

export function customValue(file: string): string {
	return CUSTOM_PREFIX + file;
}

/** Reads a stored value; `undefined` for anything that is not a usable icon. */
export function parseIcon(value: unknown): Icon | undefined {
	if (typeof value === "string" && value.startsWith(CUSTOM_PREFIX)) {
		const file = value.slice(CUSTOM_PREFIX.length);
		return isCustomFileName(file) ? { type: "custom", file } : undefined;
	}
	const emoji = sanitizeStoredEmoji(value);
	return emoji === undefined ? undefined : { type: "emoji", emoji };
}

/** The canonical string to store for a value, or `undefined` when it is not usable. */
export function normalizeIcon(value: unknown): string | undefined {
	const icon = parseIcon(value);
	if (!icon) return undefined;
	return icon.type === "emoji" ? icon.emoji : customValue(icon.file);
}

/**
 * A safe, unique file name for an uploaded image: keeps the name readable,
 * replaces anything unusual, and appends `-2`, `-3`, … when it is taken.
 */
export function uniqueFileName(original: string, taken: ReadonlySet<string>): string | undefined {
	const dot = original.lastIndexOf(".");
	const extension = dot > 0 ? original.slice(dot + 1).toLowerCase() : "";
	if (!(CUSTOM_EXTENSIONS as readonly string[]).includes(extension)) return undefined;

	const base =
		original
			.slice(0, dot)
			.replace(/[^\p{L}\p{N} _-]+/gu, "-")
			.replace(/\s+/g, " ")
			.replace(/^[\s.-]+|[\s.-]+$/g, "")
			.slice(0, 60) || "icon";
	const lowerTaken = new Set([...taken].map((name) => name.toLowerCase()));
	for (let index = 1; ; index += 1) {
		const name = `${base}${index === 1 ? "" : `-${index}`}.${extension}`;
		if (!lowerTaken.has(name.toLowerCase())) return name;
	}
}
