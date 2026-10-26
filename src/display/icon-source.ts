import { ImageIcon, parseIcon } from "../icons/icon-value";

/** What every renderer needs: the icon of a path, and how to show icons drawn as pictures. */
export interface IconSource {
	/** The stored icon of a vault path (emoji, `custom:<name>` or `lucide:<name>`), if any. */
	get(path: string): string | undefined;
	/**
	 * URL of the picture of a custom icon or an Obsidian icon; `undefined` when
	 * it can't be shown (deleted, not synced yet, or unknown to this device).
	 */
	url(icon: ImageIcon): string | undefined;
}

/** Resolves a custom icon or an Obsidian icon to the URL of its picture. */
export type IconUrl = (icon: ImageIcon) => string | undefined;

/** CSS variable with the picture CSS draws: an Obsidian icon's mask, or a custom icon at titles. */
export const IMAGE_VARIABLE = "--notemoji-image";

/**
 * What a rendered icon depends on: its value, and for pictures also their
 * URL, which changes when sync replaces a custom icon, brings a missing one or
 * a copy of an Obsidian icon. Renderers re-render only when this changes.
 */
export function renderKey(value: string, url: IconUrl): string {
	const icon = parseIcon(value);
	return icon === undefined || icon.type === "emoji" ? value : `${value}\n${url(icon) ?? ""}`;
}

/** Shows an icon inside `el`: the emoji as text, a custom image, or an Obsidian icon. */
export function renderIcon(el: HTMLElement, value: string, url: IconUrl): void {
	const icon = parseIcon(value);
	el.empty();
	if (icon === undefined || icon.type === "emoji") {
		el.setText(icon?.emoji ?? "");
		return;
	}
	const src = url(icon);
	if (icon.type === "lucide") {
		// Its picture is a mask filled with the text colour, so it follows the
		// theme (light or dark) like Obsidian's own icons do.
		const maskEl = el.createSpan({ cls: "notemoji-mask" });
		if (src === undefined) maskEl.addClass("is-missing");
		else maskEl.setCssProps({ [IMAGE_VARIABLE]: `url(${JSON.stringify(src)})` });
		return;
	}
	const img = el.createEl("img", {
		cls: "notemoji-image",
		attr: { alt: "", draggable: "false" },
	});
	// A missing icon keeps its space but shows nothing instead of a broken image.
	if (src === undefined) {
		img.addClass("is-missing");
		return;
	}
	img.addEventListener("error", () => img.addClass("is-missing"));
	img.src = src;
}
