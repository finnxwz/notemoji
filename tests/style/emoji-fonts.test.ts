import type { DataAdapter } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	EMOJI_FONT_CLASS,
	EMOJI_FONT_FAMILY,
	EmojiFontError,
	EmojiFonts,
} from "../../src/style/emoji-fonts";
import { EMOJI_SETS, findEmojiSet, isFontFileName } from "../../src/style/emoji-sets";
import { FakeAdapter } from "../fake-app";

const FOLDER = ".obsidian/plugins/notemoji/fonts";
const twemoji = findEmojiSet("twemoji")!;

/** A window document with its own font set, like the main window or a pop-out. */
function fakeDocument() {
	const fonts = new Set<FontFace>();
	return { fonts, body: document.createElement("body") } as unknown as Document & {
		fonts: Set<FontFace>;
	};
}

function setup(
	options: { broken?: boolean; hash?: string; offline?: boolean; canDraw?: boolean } = {},
) {
	const adapter = new FakeAdapter();
	const loader = vi.fn((family: string) =>
		options.broken
			? Promise.reject(new Error("bad font"))
			: // Like Chromium, which reports family names with spaces in quotes.
				Promise.resolve({ family: JSON.stringify(family) } as unknown as FontFace),
	);
	let lastUrl = "";
	const downloader = {
		download: vi.fn((url: string) => {
			lastUrl = url;
			return options.offline
				? Promise.reject(new Error("offline"))
				: Promise.resolve(data(32));
		}),
		// The pinned checksum of whatever was downloaded, unless a test overrides it.
		sha256: vi.fn(() =>
			Promise.resolve(options.hash ?? EMOJI_SETS.find((set) => set.url === lastUrl)!.sha256),
		),
	};
	const glyphCheck = vi.fn(() => options.canDraw ?? true);
	const fonts = new EmojiFonts(
		adapter as unknown as DataAdapter,
		FOLDER,
		loader,
		downloader,
		glyphCheck,
	);
	const main = fakeDocument();
	fonts.attach(main);
	return { adapter, loader, downloader, fonts, main, glyphCheck };
}

const data = (size = 16) => new Uint8Array(size).buffer;
const uses = (doc: Document & { fonts: Set<FontFace> }) =>
	doc.fonts.size === 1 && doc.body.hasClass(EMOJI_FONT_CLASS);

describe("emoji sets", () => {
	it("are pinned, open and have unique files", () => {
		for (const set of EMOJI_SETS) {
			expect(set.url).toMatch(/^https:\/\/(github\.com|raw\.githubusercontent\.com)\//);
			expect(set.sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(isFontFileName(set.file), set.file).toBe(true);
			expect(set.credit).not.toBe("");
		}
		expect(new Set(EMOJI_SETS.map((set) => set.file)).size).toBe(EMOJI_SETS.length);
	});
});

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

describe("downloadable sets", () => {
	it("shows system emoji while a set is not downloaded, and never downloads on its own", async () => {
		const { downloader, fonts, main } = setup();
		await fonts.apply("twemoji", "");
		expect(fonts.active).toBe(false);
		expect(uses(main)).toBe(false);
		expect(downloader.download).not.toHaveBeenCalled();
		expect(await fonts.isAvailable("twemoji", "")).toBe(false);
	});

	it("downloads, verifies and then uses a set in every window", async () => {
		const { adapter, loader, downloader, fonts, main } = setup();
		const popout = fakeDocument();
		fonts.attach(popout);
		await fonts.download(twemoji);
		expect(downloader.download).toHaveBeenCalledWith(twemoji.url);
		expect(adapter.files.has(`${FOLDER}/twemoji.ttf`)).toBe(true);

		await fonts.apply("twemoji", "");
		// Loaded from the file by URL, so large fonts are not copied into memory.
		expect(loader).toHaveBeenCalledWith(
			expect.stringMatching(new RegExp(`^${EMOJI_FONT_FAMILY} \\d+$`)),
			`url("app://local/${FOLDER}/twemoji.ttf")`,
		);
		expect(uses(main) && uses(popout)).toBe(true);
	});

	it("rejects a download with the wrong checksum and stores nothing", async () => {
		const { adapter, fonts } = setup({ hash: "0".repeat(64) });
		await expect(fonts.download(twemoji)).rejects.toThrow(/not the expected file/);
		expect(adapter.files.size).toBe(0);
	});

	it("explains a failed download", async () => {
		const { fonts } = setup({ offline: true });
		await expect(fonts.download(twemoji)).rejects.toThrow(/Check your connection/);
	});

	it("keeps downloaded sets and can delete them", async () => {
		const { fonts } = setup();
		await fonts.download(twemoji);
		await fonts.download(findEmojiSet("openmoji")!);
		expect((await fonts.downloadedSets()).map((entry) => entry.set.id)).toEqual([
			"twemoji",
			"openmoji",
		]);
		await fonts.deleteSet(twemoji);
		expect((await fonts.downloadedSets()).map((entry) => entry.set.id)).toEqual(["openmoji"]);
	});

	it("goes back to system emoji for system, unknown styles and broken files", async () => {
		const { fonts, main } = setup();
		await fonts.download(twemoji);
		await fonts.apply("twemoji", "");
		await fonts.apply("system", "");
		expect(uses(main)).toBe(false);
		await fonts.apply("apple", "");
		expect(fonts.active).toBe(false);

		const broken = setup({ broken: true });
		await broken.fonts.download(twemoji);
		await broken.fonts.apply("twemoji", "");
		expect(broken.fonts.active).toBe(false);
	});

	it("registers every load under a new family, so switching always re-renders", async () => {
		const { fonts, main } = setup();
		await fonts.download(twemoji);
		await fonts.apply("twemoji", "");
		const first = main.body.style.getPropertyValue("--notemoji-custom-family");
		await fonts.apply("twemoji", "");
		const second = main.body.style.getPropertyValue("--notemoji-custom-family");
		expect(first).toMatch(/^"Notemoji Emoji \d+"$/);
		expect(second).not.toBe(first);
		await fonts.apply("system", "");
		expect(main.body.style.getPropertyValue("--notemoji-custom-family")).toBe("");
	});

	it("lets only the latest choice win when switching quickly", async () => {
		const { fonts, main } = setup();
		await fonts.download(twemoji);
		const slow = fonts.apply("twemoji", "");
		const fast = fonts.apply("system", "");
		await Promise.all([slow, fast]);
		expect(uses(main)).toBe(false);
	});
});

describe("own font file", () => {
	it("installs one file at a time and uses it in windows opened later", async () => {
		const { adapter, fonts } = setup();
		await fonts.installOwn("Mine.ttf", data());
		await fonts.installOwn("Other.woff2", data());
		expect([...adapter.files.keys()]).toEqual([`${FOLDER}/own/Other.woff2`]);
		await fonts.apply("file", "Other.woff2");
		const later = fakeDocument();
		fonts.attach(later);
		expect(uses(later)).toBe(true);
	});

	it("keeps downloaded sets when the own font changes", async () => {
		const { adapter, fonts } = setup();
		await fonts.download(twemoji);
		await fonts.installOwn("Mine.ttf", data());
		await fonts.removeOwn();
		expect([...adapter.files.keys()]).toEqual([`${FOLDER}/twemoji.ttf`]);
	});

	it("rejects wrong types, huge files and broken fonts", async () => {
		const { fonts } = setup();
		await expect(fonts.installOwn("emoji.png", data())).rejects.toBeInstanceOf(EmojiFontError);
		const broken = setup({ broken: true });
		await expect(broken.fonts.installOwn("bad.ttf", data())).rejects.toThrow(
			/could not be loaded/,
		);
		expect(broken.adapter.files.size).toBe(0);
	});
});

describe("devices that can't draw a style", () => {
	it("show system emoji and say so, e.g. Noto Color Emoji on iPhone", async () => {
		const { adapter, fonts, main, glyphCheck } = setup({ canDraw: false });
		const noto = findEmojiSet("noto-color")!;
		adapter.files.set(`${FOLDER}/${noto.file}`, data());
		await fonts.apply("noto-color", "");
		expect(glyphCheck).toHaveBeenCalledWith(expect.anything(), expect.any(String), "color");
		expect(fonts.unsupported).toBe(true);
		expect(fonts.active).toBe(false);
		expect(uses(main)).toBe(false);

		// Switching to system emoji is not "unsupported".
		await fonts.apply("system", "");
		expect(fonts.unsupported).toBe(false);
	});

	it("only need visible glyphs for black-and-white styles and own fonts", async () => {
		const { adapter, fonts, glyphCheck } = setup();
		const mono = findEmojiSet("noto-mono")!;
		adapter.files.set(`${FOLDER}/${mono.file}`, data());
		await fonts.apply("noto-mono", "");
		expect(glyphCheck).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.any(String),
			"visible",
		);
		expect(fonts.active).toBe(true);
	});
});
