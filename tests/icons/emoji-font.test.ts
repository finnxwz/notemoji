import type { DataAdapter } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	EMOJI_FONT_CLASS,
	EMOJI_FONT_FAMILY,
	EmojiFont,
	EmojiFontError,
	MAX_FONT_BYTES,
} from "../../src/icons/emoji-font";
import { isFontFileName } from "../../src/icons/icon-value";
import { FakeAdapter } from "../fake-app";

const FOLDER = ".obsidian/plugins/notemoji/fonts";

/** A window document with its own font set, like the main window or a pop-out. */
function fakeDocument() {
	const fonts = new Set<FontFace>();
	return { fonts, body: document.createElement("body") } as unknown as Document & {
		fonts: Set<FontFace>;
	};
}

function setup(options: { broken?: boolean } = {}) {
	const adapter = new FakeAdapter();
	const loader = vi.fn((family: string) =>
		options.broken
			? Promise.reject(new Error("bad font"))
			: Promise.resolve({ family } as unknown as FontFace),
	);
	const font = new EmojiFont(adapter as unknown as DataAdapter, FOLDER, loader);
	const main = fakeDocument();
	font.attach(main);
	return { adapter, loader, font, main };
}

const data = (size = 16) => new Uint8Array(size).buffer;

describe("isFontFileName", () => {
	it("accepts font files only", () => {
		for (const name of ["Twemoji.ttf", "noto.WOFF2", "a.otf", "b.woff"]) {
			expect(isFontFileName(name), name).toBe(true);
		}
		for (const name of ["font", "a.png", "../a.ttf", ".ttf", ""]) {
			expect(isFontFileName(name), name).toBe(false);
		}
	});
});

describe("EmojiFont", () => {
	it("installs a font and uses it in every attached window", async () => {
		const { adapter, loader, font, main } = setup();
		const popout = fakeDocument();
		font.attach(popout);

		expect(await font.install("Twemoji.ttf", data())).toBe("Twemoji.ttf");
		expect(loader).toHaveBeenCalledWith(EMOJI_FONT_FAMILY, expect.any(ArrayBuffer));
		expect(adapter.files.has(`${FOLDER}/Twemoji.ttf`)).toBe(true);
		for (const doc of [main, popout]) {
			expect(doc.fonts.size).toBe(1);
			expect(doc.body.hasClass(EMOJI_FONT_CLASS)).toBe(true);
		}
		expect(font.active).toBe(true);
	});

	it("uses the font in windows opened later", async () => {
		const { font } = setup();
		await font.install("Twemoji.ttf", data());
		const later = fakeDocument();
		font.attach(later);
		expect(later.body.hasClass(EMOJI_FONT_CLASS)).toBe(true);
	});

	it("replaces the previous font file", async () => {
		const { adapter, font, main } = setup();
		await font.install("Twemoji.ttf", data());
		await font.install("Noto.woff2", data());
		expect([...adapter.files.keys()]).toEqual([`${FOLDER}/Noto.woff2`]);
		expect(main.fonts.size).toBe(1);
	});

	it("rejects wrong types, huge files and broken fonts without touching the current one", async () => {
		const { adapter, font } = setup();
		await font.install("Twemoji.ttf", data());
		await expect(font.install("emoji.png", data())).rejects.toBeInstanceOf(EmojiFontError);
		await expect(font.install("big.ttf", data(MAX_FONT_BYTES + 1))).rejects.toThrow(/30 MB/);

		const broken = setup({ broken: true });
		await expect(broken.font.install("bad.ttf", data())).rejects.toThrow(/could not be loaded/);
		expect(broken.adapter.files.size).toBe(0);
		expect([...adapter.files.keys()]).toEqual([`${FOLDER}/Twemoji.ttf`]);
	});

	it("loads an installed font on startup and reports missing ones", async () => {
		const { adapter, font, main } = setup();
		adapter.files.set(`${FOLDER}/Twemoji.ttf`, data());
		expect(await font.load("Twemoji.ttf")).toBe(true);
		expect(main.body.hasClass(EMOJI_FONT_CLASS)).toBe(true);
		expect(await font.load("Missing.ttf")).toBe(false);
		expect(main.body.hasClass(EMOJI_FONT_CLASS)).toBe(false);
	});

	it("goes back to the system's emoji", async () => {
		const { adapter, font, main } = setup();
		await font.install("Twemoji.ttf", data());
		await font.uninstall();
		expect(adapter.files.size).toBe(0);
		expect(main.fonts.size).toBe(0);
		expect(main.body.hasClass(EMOJI_FONT_CLASS)).toBe(false);
		expect(font.active).toBe(false);
	});
});
