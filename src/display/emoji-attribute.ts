import { parseIcon } from "../icons/icon-value";
import type { IconSource } from "./icon-source";

/**
 * Display-only icons on Obsidian's own title elements.
 *
 * The icon is drawn by CSS (`::before`): an emoji from the `data-notemoji`
 * attribute, a custom image from the `--notemoji-image` variable. Either way
 * it is never part of the element's text, so editable titles (inline title,
 * view header) keep renaming the file exactly as before, and Obsidian
 * updating the title text leaves the icon alone.
 */
export const EMOJI_ATTRIBUTE = "data-notemoji";
export const IMAGE_ATTRIBUTE = "data-notemoji-image";
const IMAGE_VARIABLE = "--notemoji-image";

/** Tracks every element we decorated, so cleanup is exact (also across windows). */
export class EmojiAttributes {
	private readonly elements = new Map<HTMLElement, string>();

	/** Makes `wanted` (element → stored icon value) the complete set of decorations. */
	apply(wanted: ReadonlyMap<HTMLElement, string>, source: IconSource): void {
		for (const el of [...this.elements.keys()]) {
			if (!wanted.has(el)) this.undecorate(el);
		}
		for (const [el, value] of wanted) {
			if (this.elements.get(el) === value) continue;
			this.decorate(el, value, source);
		}
	}

	clear(): void {
		for (const el of [...this.elements.keys()]) this.undecorate(el);
	}

	private decorate(el: HTMLElement, value: string, source: IconSource): void {
		const icon = parseIcon(value);
		if (icon?.type === "custom") {
			el.removeAttribute(EMOJI_ATTRIBUTE);
			el.setAttribute(IMAGE_ATTRIBUTE, icon.file);
			el.setCssProps({ [IMAGE_VARIABLE]: `url(${JSON.stringify(source.url(icon.file))})` });
		} else {
			el.removeAttribute(IMAGE_ATTRIBUTE);
			el.setCssProps({ [IMAGE_VARIABLE]: "" });
			el.setAttribute(EMOJI_ATTRIBUTE, icon?.emoji ?? "");
		}
		this.elements.set(el, value);
	}

	private undecorate(el: HTMLElement): void {
		el.removeAttribute(EMOJI_ATTRIBUTE);
		el.removeAttribute(IMAGE_ATTRIBUTE);
		el.setCssProps({ [IMAGE_VARIABLE]: "" });
		this.elements.delete(el);
	}
}
