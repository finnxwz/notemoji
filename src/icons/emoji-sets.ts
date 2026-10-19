/**
 * Open emoji sets that can be downloaded as the emoji style.
 *
 * Every file is pinned to an exact release and verified with its SHA-256
 * checksum before it is used, so a changed or tampered download is never
 * loaded. Only open licences: Apple's, Samsung's or Microsoft's system emoji
 * may not be redistributed.
 */
export interface EmojiSet {
	id: string;
	name: string;
	/** Shown under the dropdown; CC-BY licences require the credit. */
	credit: string;
	url: string;
	sha256: string;
	/** File name inside the plugin's fonts folder. */
	file: string;
	bytes: number;
	/** Black-and-white glyphs: the preview is inverted in light themes. */
	monochrome?: boolean;
}

/** In the order shown in the settings: related styles stay next to each other. */
export const EMOJI_SETS: readonly EmojiSet[] = [
	{
		id: "twemoji",
		name: "Twemoji",
		credit: "Twemoji by Twitter, CC-BY 4.0. Font by Mozilla (twemoji-colr 0.7.0).",
		url: "https://github.com/mozilla/twemoji-colr/releases/download/v0.7.0/Twemoji.Mozilla.ttf",
		sha256: "6d90152ee0d29e82fe2a87793af5aa4b7ad13e6538360889e141e81ed299ee8e",
		file: "twemoji.ttf",
		bytes: 1474284,
	},
	{
		id: "openmoji",
		name: "OpenMoji",
		credit: "OpenMoji by HfG Schwäbisch Gmünd, CC BY-SA 4.0 (17.0.0).",
		url: "https://raw.githubusercontent.com/hfg-gmuend/openmoji/17.0.0/font/OpenMoji-color-glyf_colr_0/OpenMoji-color-glyf_colr_0.woff2",
		sha256: "55cce9521e25f12cf4077ed9fa6060c97bf0b02f0f1b7fb7b34717593e718339",
		file: "openmoji.woff2",
		bytes: 976028,
	},
	{
		id: "noto-color",
		name: "Noto Color Emoji",
		credit: "Noto Color Emoji by Google, SIL Open Font License 1.1 (v2.051).",
		url: "https://raw.githubusercontent.com/googlefonts/noto-emoji/v2.051/fonts/Noto-COLRv1.ttf",
		sha256: "0ae57fe58645638523ba35f388d93739d292539a9acb84df5700c81b1e1a28d2",
		file: "noto-color.ttf",
		bytes: 4991984,
	},
	{
		id: "noto-mono",
		name: "Noto Emoji (black and white)",
		credit: "Noto Emoji by Google, SIL Open Font License 1.1.",
		url: "https://raw.githubusercontent.com/google/fonts/b979dba422e445492b0eb9951ac52ee0b4d648c3/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf",
		sha256: "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551",
		file: "noto-mono.ttf",
		bytes: 1982596,
		monochrome: true,
	},
];

export function findEmojiSet(id: string): EmojiSet | undefined {
	return EMOJI_SETS.find((set) => set.id === id);
}
