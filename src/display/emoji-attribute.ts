/**
 * Display-only emoji on Obsidian's own title elements.
 *
 * The emoji is set as an attribute and drawn by CSS (`::before`), so it is
 * never part of the element's text: editable titles (inline title, view
 * header) keep renaming the file exactly as before, and Obsidian updating the
 * title text leaves the emoji alone.
 */
export const EMOJI_ATTRIBUTE = "data-notemoji";

/** Tracks every element we decorated, so cleanup is exact (also across windows). */
export class EmojiAttributes {
	private readonly elements = new Set<HTMLElement>();

	/** Makes `wanted` the complete set of decorated elements. */
	apply(wanted: ReadonlyMap<HTMLElement, string>): void {
		for (const el of this.elements) {
			if (wanted.has(el)) continue;
			el.removeAttribute(EMOJI_ATTRIBUTE);
			this.elements.delete(el);
		}
		for (const [el, emoji] of wanted) {
			if (el.getAttribute(EMOJI_ATTRIBUTE) !== emoji) el.setAttribute(EMOJI_ATTRIBUTE, emoji);
			this.elements.add(el);
		}
	}

	clear(): void {
		this.apply(new Map());
	}
}
