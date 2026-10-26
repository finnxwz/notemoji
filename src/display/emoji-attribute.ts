import { parseIcon } from "../icons/icon-value";
import { IconSource, IconUrl, IMAGE_VARIABLE, renderKey } from "./icon-source";

/**
 * Display-only icons on Obsidian's own title elements, and on the empty
 * elements Notemoji puts next to links.
 *
 * The icon is drawn by CSS (`::before`): an emoji from the `data-notemoji`
 * attribute, a picture from the `--notemoji-image` variable (an Obsidian icon
 * as a mask in the text colour, marked by `data-notemoji-mask`). Either way
 * it is never part of the element's text, so editable titles (inline title,
 * view header) keep renaming the file exactly as before, and Obsidian
 * updating the title text leaves the icon alone.
 */
export const EMOJI_ATTRIBUTE = "data-notemoji";
/** The stored value of the picture shown (`custom:<name>` or `lucide:<name>`). */
export const IMAGE_ATTRIBUTE = "data-notemoji-image";
export const MASK_ATTRIBUTE = "data-notemoji-mask";

/** Tracks every element we decorated, so cleanup is exact (also across windows). */
export class EmojiAttributes {
	private readonly elements = new Map<HTMLElement, string>();

	/** Makes `wanted` (element → stored icon value) the complete set of decorations. */
	apply(wanted: ReadonlyMap<HTMLElement, string>, source: IconSource): void {
		for (const el of [...this.elements.keys()]) {
			if (!wanted.has(el)) this.undecorate(el);
		}
		const url: IconUrl = (icon) => source.url(icon);
		for (const [el, value] of wanted) {
			const key = renderKey(value, url);
			if (this.elements.get(el) === key) continue;
			setIconAttributes(el, value, url);
			this.elements.set(el, key);
		}
	}

	clear(): void {
		for (const el of [...this.elements.keys()]) this.undecorate(el);
	}

	private undecorate(el: HTMLElement): void {
		el.removeAttribute(EMOJI_ATTRIBUTE);
		el.removeAttribute(IMAGE_ATTRIBUTE);
		el.removeAttribute(MASK_ATTRIBUTE);
		el.setCssProps({ [IMAGE_VARIABLE]: "" });
		this.elements.delete(el);
	}
}

/** Sets the attributes CSS draws an icon from (see above); also used for the emoji at links. */
export function setIconAttributes(el: HTMLElement, value: string, url: IconUrl): void {
	const icon = parseIcon(value);
	if (icon !== undefined && icon.type !== "emoji") {
		// A missing icon keeps its space, empty, like in the file explorer.
		const src = url(icon);
		el.removeAttribute(EMOJI_ATTRIBUTE);
		el.setAttribute(IMAGE_ATTRIBUTE, value);
		// Only with a picture: a mask without one would fill the space with colour.
		el.toggleAttribute(MASK_ATTRIBUTE, icon.type === "lucide" && src !== undefined);
		el.setCssProps({
			[IMAGE_VARIABLE]: src === undefined ? "" : `url(${JSON.stringify(src)})`,
		});
	} else {
		el.removeAttribute(IMAGE_ATTRIBUTE);
		el.removeAttribute(MASK_ATTRIBUTE);
		el.setCssProps({ [IMAGE_VARIABLE]: "" });
		el.setAttribute(EMOJI_ATTRIBUTE, icon?.emoji ?? "");
	}
}
