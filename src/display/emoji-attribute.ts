import { parseIcon } from "../icons/icon-value";
import { IconSource, renderKey } from "./icon-source";

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
		const url = (id: string) => source.url(id);
		for (const [el, value] of wanted) {
			const key = renderKey(value, url);
			if (this.elements.get(el) === key) continue;
			this.decorate(el, value, source);
			this.elements.set(el, key);
		}
	}

	clear(): void {
		for (const el of [...this.elements.keys()]) this.undecorate(el);
	}

	private decorate(el: HTMLElement, value: string, source: IconSource): void {
		const icon = parseIcon(value);
		if (icon?.type === "custom") {
			// A missing icon keeps its space, empty, like in the file explorer.
			const url = source.url(icon.id);
			el.removeAttribute(EMOJI_ATTRIBUTE);
			el.setAttribute(IMAGE_ATTRIBUTE, icon.id);
			el.setCssProps({
				[IMAGE_VARIABLE]: url === undefined ? "" : `url(${JSON.stringify(url)})`,
			});
		} else {
			el.removeAttribute(IMAGE_ATTRIBUTE);
			el.setCssProps({ [IMAGE_VARIABLE]: "" });
			el.setAttribute(EMOJI_ATTRIBUTE, icon?.emoji ?? "");
		}
	}

	private undecorate(el: HTMLElement): void {
		el.removeAttribute(EMOJI_ATTRIBUTE);
		el.removeAttribute(IMAGE_ATTRIBUTE);
		el.setCssProps({ [IMAGE_VARIABLE]: "" });
		this.elements.delete(el);
	}
}
