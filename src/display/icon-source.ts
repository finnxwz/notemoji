import { parseIcon } from "../icons/icon-value";

/** What every renderer needs: the icon of a path, and where custom icon files live. */
export interface IconSource {
	/** The stored icon of a vault path (emoji or `custom:<file>`), if any. */
	get(path: string): string | undefined;
	/** Resource URL of a custom icon file. */
	url(file: string): string;
}

/** Resolves a custom icon file to a resource URL. */
export type IconUrl = (file: string) => string;

/** Shows an icon inside `el`: the emoji as text, or the custom image. */
export function renderIcon(el: HTMLElement, value: string, url: IconUrl): void {
	const icon = parseIcon(value);
	el.empty();
	if (icon?.type !== "custom") {
		el.setText(icon?.emoji ?? "");
		return;
	}
	const img = el.createEl("img", {
		cls: "notemoji-image",
		attr: { src: url(icon.file), alt: "", draggable: "false" },
	});
	// A file that is missing on this device (e.g. not synced) shows nothing instead of a broken image.
	img.addEventListener("error", () => img.addClass("is-missing"));
}
