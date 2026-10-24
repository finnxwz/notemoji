import { parseIcon } from "../icons/icon-value";

/** What every renderer needs: the icon of a path, and how to show custom icons. */
export interface IconSource {
	/** The stored icon of a vault path (emoji or `custom:<name>`), if any. */
	get(path: string): string | undefined;
	/** URL of a custom icon's image; `undefined` when it is missing (deleted, or not synced yet). */
	url(id: string): string | undefined;
}

/** Resolves a custom icon to its image URL. */
export type IconUrl = (id: string) => string | undefined;

/**
 * What a rendered icon depends on: its value, and for custom icons also the
 * image URL, which changes when sync replaces the icon or brings a missing
 * one. Renderers re-render only when this changes.
 */
export function renderKey(value: string, url: IconUrl): string {
	const icon = parseIcon(value);
	return icon?.type === "custom" ? `${value}\n${url(icon.id) ?? ""}` : value;
}

/** Shows an icon inside `el`: the emoji as text, or the custom image. */
export function renderIcon(el: HTMLElement, value: string, url: IconUrl): void {
	const icon = parseIcon(value);
	el.empty();
	if (icon?.type !== "custom") {
		el.setText(icon?.emoji ?? "");
		return;
	}
	const src = url(icon.id);
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
