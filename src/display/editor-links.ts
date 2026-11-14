/**
 * Finds the internal links in the editor's syntax tokens (Live Preview).
 *
 * Obsidian's editor parses Markdown into flat tokens, each with CSS-like
 * classes (`hmd-internal-link`, `formatting-link`, `url`, …). Only the
 * classes are used to find a link's parts; where it starts and what it
 * points to is checked against the text, so a token split differently in
 * another Obsidian version gives no icon rather than a wrong one.
 *
 * Free of DOM and Obsidian imports so it can be unit tested.
 */

export interface LinkToken {
	from: number;
	to: number;
	classes: readonly string[];
}

/** An internal link in the text. */
export interface EditorLink {
	/** Where the link starts (`[[` or `[`): the emoji goes right before it. */
	at: number;
	/** What it points to, as written: a path, maybe with `#heading` (no alias). */
	linktext: string;
}

/** `scheme:` of an external link (`https:`, `mailto:`, `obsidian:`). */
const EXTERNAL_LINK = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The links among `tokens` (in document order), with `slice` giving the text
 * of a range. Wikilinks (`[[note]]`, `[[note#heading|alias]]`) and Markdown
 * links to notes (`[text](note.md)`); embeds (`![[…]]`, `![…](…)`) and
 * external links are left out.
 */
export function findEditorLinks(
	tokens: Iterable<LinkToken>,
	slice: (from: number, to: number) => string,
): EditorLink[] {
	const links: EditorLink[] = [];
	/** The target of the wikilink being read: adjacent target tokens. */
	let target: { from: number; to: number } | null = null;
	/** The URL of the Markdown link being read: adjacent URL tokens. */
	let url: { from: number; to: number } | null = null;
	/** Start of the `[` that may open the Markdown link being read. */
	let bracket: number | null = null;
	/** Where the previous token ended. */
	let lastTo = -1;

	const endTarget = () => {
		if (target === null) return;
		const { from, to } = target;
		target = null;
		if (slice(from - 2, from) !== "[[" || slice(from - 3, from - 2) === "!") return;
		// In a table, the alias pipe is escaped: `[[note\|alias]]`.
		const linktext = slice(from, to).replace(/\\$/, "").trim();
		if (linktext !== "") links.push({ at: from - 2, linktext });
	};
	const endUrl = () => {
		if (url === null) return;
		const { from, to } = url;
		url = null;
		const start = bracket;
		bracket = null;
		if (start === null || slice(start - 1, start) === "!") return;
		const before = slice(from - 3, from);
		if (!before.endsWith("](") && before !== "](<") return;
		// With `(<` a token of its own, the URL tokens are what's inside the angle
		// brackets, where there is no title: `Trip (2)` is a name.
		const written = slice(from, to);
		const linktext = markdownLinkTarget(before === "](<" ? `<${written}>` : written);
		if (linktext !== undefined) links.push({ at: start, linktext });
	};

	for (const token of tokens) {
		const { classes } = token;
		// Every part of a Markdown link is a link or URL token, right after the
		// one before; anything else in between means the `[` opened none
		// (`[foo]`, a footnote), so it can't be taken for a later link's.
		const inMarkdownLink =
			token.from === lastTo && (classes.includes("link") || classes.includes("url"));
		if (!inMarkdownLink) bracket = null;
		lastTo = token.to;
		const isTarget =
			classes.includes("hmd-internal-link") &&
			!classes.includes("link-alias") &&
			!classes.includes("link-alias-pipe");
		const isUrl =
			classes.includes("url") &&
			!classes.includes("formatting") &&
			!classes.includes("hmd-internal-link");

		if (isTarget) {
			if (target !== null && target.to === token.from) target.to = token.to;
			else {
				endTarget();
				target = { from: token.from, to: token.to };
			}
			continue;
		}
		endTarget();
		if (isUrl) {
			if (url !== null && url.to === token.from) url.to = token.to;
			else {
				endUrl();
				url = { from: token.from, to: token.to };
			}
			continue;
		}
		endUrl();
		if (
			classes.includes("formatting-link") &&
			!classes.includes("formatting-link-string") &&
			slice(token.from, token.to) === "["
		) {
			bracket = token.from;
		}
	}
	endTarget();
	endUrl();
	return links;
}

/**
 * What a Markdown link's URL points to inside the vault, still as written
 * (`My%20note.md`: it is decoded where it is resolved); `undefined` for
 * external links.
 */
export function markdownLinkTarget(url: string): string | undefined {
	// Without a title (`note.md "Title"`) and the angle brackets of `<my note.md>`.
	let target = url.trim().replace(/\s+("[^"]*"|'[^']*'|\([^)]*\))$/, "");
	if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
	if (target === "" || EXTERNAL_LINK.test(target)) return undefined;
	return target;
}
