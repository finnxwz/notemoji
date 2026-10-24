import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PickerModal, PickerOptions } from "../../src/picker/picker-modal";
import { createFakeApp, flush } from "../fake-app";
import { notices, openModals, Platform, shownMenus } from "../obsidian";

/** In-memory custom icon library; uploads of anything but PNG fail like the real one. */
function fakeCustom(initial: string[] = []) {
	const files = [...initial];
	return {
		files,
		list: vi.fn(() => Promise.resolve([...files])),
		url: (file: string) => `app://icons/${file}`,
		upload: vi.fn((name: string) => {
			if (!name.endsWith(".png"))
				return Promise.reject(new Error(`"${name}" is not an image.`));
			files.push(name);
			return Promise.resolve(name);
		}),
		remove: vi.fn((file: string) => {
			files.splice(files.indexOf(file), 1);
			return Promise.resolve(true);
		}),
	};
}

/** Obsidian's icons on this device, and the copies in data.json (by name → URL). */
function fakeLibrary(names = ["arrow-left", "arrow-right", "arrow-up-right", "shapes", "star"]) {
	const copies = new Map<string, string>();
	return {
		copies,
		list: () => names,
		storedUrl: (name: string) => copies.get(name),
	};
}

async function open(options: Partial<PickerOptions> = {}) {
	const onSubmit = vi.fn();
	const custom = (options.custom as ReturnType<typeof fakeCustom> | undefined) ?? fakeCustom();
	const modal = new PickerModal(createFakeApp().asApp, {
		title: "Set note emoji",
		description: "Website.md",
		current: "",
		recent: [],
		library: fakeLibrary(),
		onSubmit,
		...options,
		custom,
	});
	modal.open();
	await flush();
	const query = <T extends HTMLElement = HTMLElement>(selector: string) =>
		modal.contentEl.querySelector<T>(selector);
	const search = query<HTMLInputElement>(".notemoji-picker-search")!;
	const tiles = () =>
		Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".notemoji-picker-emoji"));
	return {
		modal,
		onSubmit,
		custom,
		search,
		query,
		tiles,
		/** A rendered tile by its emoji (or custom file name for images). */
		tile: (value: string) =>
			tiles().find(
				(el) =>
					el.textContent === value ||
					el.querySelector("img")?.getAttribute("src") === `app://icons/${value}`,
			),
		tabs: () =>
			Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".notemoji-picker-tab")),
		body: () => query(".notemoji-picker-body")!,
		type(text: string) {
			search.value = text;
			search.dispatchEvent(new Event("input"));
		},
		press(key: string) {
			search.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		},
		async upload(...names: string[]) {
			const input = query<HTMLInputElement>(".notemoji-hidden-input")!;
			const files = names.map((name) => {
				const file = new File([new Uint8Array(4)], name);
				// A "video" that claims to be huge, to check it is refused before reading.
				if (name.endsWith(".mov"))
					Object.defineProperty(file, "size", { value: 500 * 1024 * 1024 });
				return file;
			});
			Object.defineProperty(input, "files", { value: files, configurable: true });
			input.dispatchEvent(new Event("change"));
			await flush(10);
		},
		footer: () => query(".notemoji-picker-footer-name")?.textContent,
	};
}

beforeEach(() => {
	notices.length = 0;
	shownMenus.length = 0;
});

afterEach(() => {
	for (const modal of [...openModals]) modal.close();
	Platform.isMobile = false;
});

describe("browsing", () => {
	it("shows title, item and the category tabs", async () => {
		const picker = await open();
		expect(picker.modal.titleEl.textContent).toBe("Set note emoji");
		expect(picker.query(".notemoji-picker-description")?.textContent).toBe("Website.md");
		expect(picker.tabs().map((tab) => tab.dataset.section)).toEqual([
			"custom",
			"smileys",
			"people",
			"nature",
			"food",
			"travel",
			"activities",
			"objects",
			"symbols",
			"flags",
			"lucide",
		]);
		expect(picker.query(".notemoji-picker-remove")).toBeNull();
	});

	it("keeps only the visible part of ~1,900 emoji in the DOM", async () => {
		const picker = await open();
		expect(picker.tiles().length).toBeGreaterThan(30);
		expect(picker.tiles().length).toBeLessThan(250);
		expect(picker.tile("😀")).toBeDefined();
		expect(picker.tile("🏁")).toBeUndefined();
	});

	it("labels no tile, so Obsidian shows no tooltips while hovering", async () => {
		const picker = await open();
		expect(picker.tiles().filter((el) => el.hasAttribute("aria-label"))).toEqual([]);
		picker.query(".is-upload")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		expect(picker.footer()).toBe("Upload an image (PNG, SVG and more)");
	});

	it("lists recently used icons first, with their own tab", async () => {
		const picker = await open({ recent: ["🎉", "★"] });
		expect(picker.tabs()[0].getAttribute("aria-label")).toBe("Recently used");
		expect(
			picker
				.tiles()
				.slice(0, 2)
				.map((el) => el.textContent),
		).toEqual(["🎉", "★"]);
	});

	it("highlights the current emoji and offers Remove", async () => {
		const picker = await open({ current: "😀" });
		expect(picker.tile("😀")!.hasClass("is-current")).toBe(true);
		expect(picker.footer()).toBe("Grinning face");
		picker.query(".notemoji-picker-remove")!.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("");
		expect(openModals).toHaveLength(0);
	});

	it("submits a clicked emoji and names hovered ones in the footer", async () => {
		const picker = await open();
		const tile = picker.tile("😃")!;
		tile.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		expect(picker.footer()).toBe("Grinning face with big eyes");
		tile.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("😃");
		expect(openModals).toHaveLength(0);
	});

	it("jumps to a category and renders it, highlighting its tab", async () => {
		const picker = await open();
		const flags = picker.tabs().find((el) => el.dataset.section === "flags")!;
		flags.click();
		expect(picker.body().scrollTop).toBeGreaterThan(1000);
		expect(picker.tile("🏁")).toBeDefined();
		expect(flags.hasClass("is-active")).toBe(true);
		expect(flags.getAttribute("aria-selected")).toBe("true");
	});

	it("pins the current section's name while scrolling through it", async () => {
		const picker = await open();
		const sticky = picker.query(".notemoji-picker-sticky")!;
		expect(sticky.hasClass("is-visible")).toBe(false);
		picker
			.tabs()
			.find((el) => el.dataset.section === "nature")!
			.click();
		picker.body().scrollTop += 200;
		picker.body().dispatchEvent(new Event("scroll"));
		await flush(30);
		expect(sticky.hasClass("is-visible")).toBe(true);
		expect(sticky.textContent).toBe("Animals & nature");
	});
});

describe("searching", () => {
	it("shows the best match first and submits it with Enter", async () => {
		const picker = await open();
		picker.type("rocket");
		expect(picker.tiles()[0].textContent).toBe("🚀");
		expect(picker.tiles()[0].hasClass("is-active")).toBe(true);
		expect(picker.footer()).toBe("Rocket");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("🚀");
	});

	it("moves through results with the arrow keys", async () => {
		const picker = await open();
		picker.type("heart");
		picker.press("ArrowRight"); // still moves the caret, not the selection
		expect(picker.tiles()[0].hasClass("is-active")).toBe(true);
		picker.press("ArrowDown");
		picker.press("ArrowRight");
		const active = picker.tiles().findIndex((el) => el.hasClass("is-active"));
		expect(active).toBeGreaterThan(1);
		expect(picker.tiles().filter((el) => el.hasClass("is-active"))).toHaveLength(1);
		const expected = picker.tiles()[active].textContent;
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith(expected);
	});

	it("keeps the active tile visible far down the list", async () => {
		const picker = await open();
		for (let i = 0; i < 60; i++) picker.press("ArrowDown");
		expect(picker.tiles().filter((el) => el.hasClass("is-active"))).toHaveLength(1);
		expect(picker.body().scrollTop).toBeGreaterThan(1000);
	});

	it("searches for typed shortcuts like +1 and <3 instead of using their first character", async () => {
		const picker = await open();
		picker.type("+1");
		expect(picker.tiles()[0].textContent).toBe("👍");
		expect(picker.tiles().some((el) => el.textContent === "+")).toBe(false);
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("👍");

		const again = await open();
		again.type("<3");
		expect(again.tiles()[0].textContent).toBe("❤️");
	});

	it("offers a lone keyboard symbol only after the results", async () => {
		const picker = await open();
		picker.type("$");
		const tiles = picker.tiles().map((el) => el.textContent);
		expect(tiles.at(-1)).toBe("$");
		expect(tiles[0]).not.toBe("$");
	});

	it("offers a pasted emoji first, also when it is not in the list", async () => {
		const picker = await open();
		picker.type("🫠");
		expect(picker.tiles()[0].textContent).toBe("🫠");
		picker.type("★");
		expect(picker.tiles()[0].textContent).toBe("★");
		expect(picker.footer()).toBe("Custom emoji");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("★");
	});

	it("stores a pasted emoji the way the list has it", async () => {
		const picker = await open();
		picker.type(String.fromCodePoint(0x2764)); // ❤ without the emoji variation selector
		expect(picker.footer()).toBe("Red heart");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith(String.fromCodePoint(0x2764, 0xfe0f));
	});

	it("does not list a pasted emoji twice", async () => {
		const picker = await open();
		picker.type("🚀");
		expect(picker.tiles().filter((el) => el.textContent === "🚀")).toHaveLength(1);
	});

	it("explains when nothing matches and ignores Enter", async () => {
		const picker = await open();
		picker.type("qqqzzz");
		expect(picker.query(".notemoji-picker-empty")!.hasClass("is-visible")).toBe(true);
		expect(picker.tiles()).toHaveLength(0);
		picker.press("Enter");
		expect(picker.onSubmit).not.toHaveBeenCalled();
	});

	it("ignores Enter until a tile is selected", async () => {
		const picker = await open({ recent: ["🎉"] });
		picker.press("Enter");
		expect(picker.onSubmit).not.toHaveBeenCalled();
		picker.press("ArrowDown");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("🎉");
	});

	it("clears the search when a category tab is clicked", async () => {
		const picker = await open();
		picker.type("rocket");
		picker.tabs()[1].click();
		expect(picker.search.value).toBe("");
		expect(picker.query(".notemoji-picker-empty")!.hasClass("is-visible")).toBe(false);
	});
});

describe("custom icons", () => {
	it("shows the library as images with an upload tile", async () => {
		const picker = await open({ custom: fakeCustom(["logo.png", "star.png"]) });
		const images = Array.from(
			picker.modal.contentEl.querySelectorAll(".notemoji-picker-emoji img"),
		);
		expect(images.map((img) => img.getAttribute("src"))).toEqual([
			"app://icons/logo.png",
			"app://icons/star.png",
		]);
		expect(picker.query(".notemoji-picker-emoji.is-upload")).not.toBeNull();
		picker.tile("logo.png")!.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("custom:logo.png");
	});

	it("finds custom icons by file name", async () => {
		const picker = await open({ custom: fakeCustom(["company-logo.png"]) });
		picker.type("logo");
		expect(picker.tiles()[0].querySelector("img")?.getAttribute("src")).toBe(
			"app://icons/company-logo.png",
		);
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("custom:company-logo.png");
	});

	it("opens the file dialog from the upload tile", async () => {
		const picker = await open();
		const input = picker.query<HTMLInputElement>(".notemoji-hidden-input")!;
		const click = vi.spyOn(input, "click").mockImplementation(() => {});
		picker.query(".notemoji-picker-emoji.is-upload")!.click();
		expect(click).toHaveBeenCalled();
		expect(picker.onSubmit).not.toHaveBeenCalled();
	});

	it("uses a single upload right away", async () => {
		const picker = await open();
		await picker.upload("new.png");
		expect(picker.custom.upload).toHaveBeenCalledWith("new.png", expect.any(ArrayBuffer));
		expect(picker.onSubmit).toHaveBeenCalledWith("custom:new.png");
	});

	it("adds several uploads to the library and reports failures", async () => {
		const picker = await open();
		await picker.upload("a.png", "notes.txt", "b.png");
		expect(picker.onSubmit).not.toHaveBeenCalled();
		expect(notices).toEqual(['"notes.txt" is not an image.']);
		expect(picker.tile("a.png")).toBeDefined();
		expect(picker.tile("b.png")).toBeDefined();
	});

	it("refuses huge files before reading them", async () => {
		const picker = await open();
		await picker.upload("clip.mov");
		expect(picker.custom.upload).not.toHaveBeenCalled();
		expect(notices).toEqual(['"clip.mov" is larger than 20 MB. Please use a smaller image.']);
	});

	it("deletes a custom icon from its context menu", async () => {
		const picker = await open({ custom: fakeCustom(["logo.png"]) });
		const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
		picker.tile("logo.png")!.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		shownMenus[0].item("Delete custom icon").click();
		await flush();
		expect(picker.custom.remove).toHaveBeenCalledWith("logo.png");
		expect(picker.tile("logo.png")).toBeUndefined();
	});

	describe("long-press on touch screens", () => {
		const touch = (type: string, el: HTMLElement, x = 10, y = 10) =>
			el.dispatchEvent(
				new PointerEvent(type, {
					pointerType: "touch",
					clientX: x,
					clientY: y,
					bubbles: true,
					cancelable: true,
				}),
			);

		beforeEach(() => {
			vi.useFakeTimers();
		});
		afterEach(() => {
			vi.useRealTimers();
		});

		it("opens the menu and does not also pick the icon", async () => {
			const loading = open({ custom: fakeCustom(["logo.png"]) });
			await vi.advanceTimersByTimeAsync(0);
			const picker = await loading;
			const tile = picker.tile("logo.png")!;
			touch("pointerdown", tile, 40, 60);
			vi.advanceTimersByTime(600);
			expect(shownMenus).toHaveLength(1);
			expect(shownMenus[0].position).toEqual({ x: 40, y: 60 });
			// Android also reports the long-press as a context menu.
			tile.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
			expect(shownMenus).toHaveLength(1);
			touch("pointerup", tile);
			tile.click();
			expect(picker.onSubmit).not.toHaveBeenCalled();
			// The next tap picks it as usual.
			touch("pointerdown", tile);
			touch("pointerup", tile);
			tile.click();
			expect(picker.onSubmit).toHaveBeenCalledWith("custom:logo.png");
		});

		it("is not triggered by a short tap or by scrolling", async () => {
			const loading = open({ custom: fakeCustom(["logo.png"]) });
			await vi.advanceTimersByTimeAsync(0);
			const picker = await loading;
			const tile = picker.tile("logo.png")!;
			touch("pointerdown", tile);
			touch("pointerup", tile);
			vi.advanceTimersByTime(600);
			touch("pointerdown", tile, 10, 10);
			touch("pointermove", tile, 10, 60);
			vi.advanceTimersByTime(600);
			expect(shownMenus).toHaveLength(0);
		});
	});

	it("has no context menu for emoji", async () => {
		const picker = await open();
		picker.tile("😀")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		expect(shownMenus).toHaveLength(0);
	});

	it("hides recent custom icons whose file is gone", async () => {
		const picker = await open({ recent: ["custom:gone.png", "🎉"], custom: fakeCustom() });
		expect(picker.tiles()[0].textContent).toBe("🎉");
		expect(picker.tile("gone.png")).toBeUndefined();
	});

	it("shows the current custom icon in the footer", async () => {
		const picker = await open({ current: "custom:logo.png", custom: fakeCustom(["logo.png"]) });
		expect(picker.footer()).toBe("logo.png");
		expect(picker.query(".notemoji-picker-footer-emoji img")?.getAttribute("src")).toBe(
			"app://icons/logo.png",
		);
	});
});

describe("Obsidian icons", () => {
	/** A rendered tile showing Obsidian's own drawing of an icon. */
	const drawnTile = (picker: Awaited<ReturnType<typeof open>>, name: string) =>
		picker.tiles().find((el) => el.querySelector(`svg.lucide-${name}`));

	it("come after every emoji, with a tab showing one of them", async () => {
		const picker = await open();
		const tab = picker.tabs().at(-1)!;
		expect(tab.dataset.section).toBe("lucide");
		expect(tab.getAttribute("aria-label")).toBe("Obsidian icons");
		expect(tab.querySelector("svg.lucide-shapes")).not.toBeNull();
		expect(drawnTile(picker, "star")).toBeUndefined();

		tab.click();
		expect(picker.body().scrollTop).toBeGreaterThan(1000);
		const tile = drawnTile(picker, "arrow-right")!;
		expect(tile.hasClass("is-lucide")).toBe(true);
		tile.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		expect(picker.footer()).toBe("Arrow right");
		expect(picker.query(".notemoji-picker-footer-emoji svg.lucide-arrow-right")).not.toBeNull();
		tile.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("lucide:arrow-right");
	});

	it("are left out where Obsidian has none", async () => {
		const picker = await open({ library: fakeLibrary([]) });
		expect(picker.tabs().map((tab) => tab.dataset.section)).not.toContain("lucide");
		picker.type("shapes");
		expect(picker.tiles()).toHaveLength(0);
	});

	it("are found by name after the emoji, and picked with Enter", async () => {
		const picker = await open();
		picker.type("arrow r");
		const tiles = picker.tiles();
		const first = tiles.findIndex((el) => el.hasClass("is-lucide"));
		expect(first).toBeGreaterThan(0);
		expect(tiles.slice(first).every((el) => el.hasClass("is-lucide"))).toBe(true);
		expect(tiles[first].querySelector("svg.lucide-arrow-right")).not.toBeNull();

		picker.type("shapes");
		expect(picker.tiles()).toHaveLength(1);
		expect(picker.footer()).toBe("Shapes");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("lucide:shapes");
	});

	it("are reached with the arrow keys like emoji", async () => {
		const picker = await open();
		picker.type("star");
		// To the last row, then to its end: the Obsidian icon after the emoji.
		for (let i = 0; i < 5; i++) picker.press("ArrowDown");
		for (let i = 0; i < 20; i++) picker.press("ArrowRight");
		expect(picker.footer()).toBe("Star");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("lucide:star");
	});

	it("show their copy when recently used, or else this device's drawing", async () => {
		const library = fakeLibrary(["arrow-right", "star"]);
		library.copies.set("shapes", "blob:shapes");
		library.copies.set("star", "blob:star");
		const picker = await open({
			library,
			recent: ["lucide:shapes", "lucide:arrow-right", "lucide:star", "lucide:rocket", "🎉"],
		});
		const recent = picker.tiles().slice(0, 4);
		// Copied on another device: shown even though this Obsidian lacks it.
		expect(recent[0].querySelector<HTMLElement>(".notemoji-mask")?.style.cssText).toContain(
			"blob:shapes",
		);
		expect(recent[1].querySelector("svg.lucide-arrow-right")).not.toBeNull();
		expect(recent[2].querySelector<HTMLElement>(".notemoji-mask")?.style.cssText).toContain(
			"blob:star",
		);
		// Neither a copy nor a drawing: left out.
		expect(recent[3].textContent).toBe("🎉");
	});

	it("show the current icon in the footer and highlight it", async () => {
		const picker = await open({ current: "lucide:star" });
		expect(picker.footer()).toBe("Star");
		expect(picker.query(".notemoji-picker-footer-emoji svg.lucide-star")).not.toBeNull();
		picker.tabs().at(-1)!.click();
		expect(drawnTile(picker, "star")!.hasClass("is-current")).toBe(true);
	});

	it("have no context menu", async () => {
		const picker = await open();
		picker.type("shapes");
		picker.tiles()[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		expect(shownMenus).toHaveLength(0);
	});
});

describe("opening", () => {
	it("shows emoji right away, before the custom icon list is read", () => {
		const custom = { ...fakeCustom(), list: () => new Promise<string[]>(() => {}) };
		const modal = new PickerModal(createFakeApp().asApp, {
			title: "Set note emoji",
			current: "",
			recent: [],
			custom,
			library: fakeLibrary(),
			onSubmit: () => {},
		});
		modal.open();
		expect(modal.contentEl.querySelectorAll(".notemoji-picker-emoji").length).toBeGreaterThan(
			30,
		);
		modal.close();
	});

	it("focuses the search field on desktop", async () => {
		const picker = await open();
		expect(document.activeElement).toBe(picker.search);
	});

	it("does not focus it on mobile, so the keyboard does not cover the grid", async () => {
		Platform.isMobile = true;
		const picker = await open();
		expect(document.activeElement).not.toBe(picker.search);
	});
});

describe("pre-rendered emoji", () => {
	function fakeSprites(ready: string[]) {
		const listeners = new Set<() => void>();
		const available = new Set(ready);
		return {
			available,
			slot: (emoji: string) =>
				available.has(emoji)
					? { image: 'url("blob:x")', position: "-32px -0px", size: "1024px 32px" }
					: undefined,
			onChange: (listener: () => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			notify: () => listeners.forEach((listener) => listener()),
			listeners,
		};
	}

	it("shows sprite slices where available and text otherwise", async () => {
		const sprites = fakeSprites(["😀"]);
		const picker = await open({ sprites });
		const sprite = picker.modal.contentEl.querySelector<HTMLElement>(".notemoji-sprite")!;
		expect(sprite.style.getPropertyValue("--notemoji-sprite-position")).toBe("-32px -0px");
		expect(picker.tile("😃")).toBeDefined(); // not pre-rendered yet: text
	});

	it("switches tiles over when more images become ready, and stops listening when closed", async () => {
		const sprites = fakeSprites([]);
		const picker = await open({ sprites });
		expect(picker.modal.contentEl.querySelectorAll(".notemoji-sprite")).toHaveLength(0);
		sprites.available.add("😃");
		sprites.notify();
		expect(picker.modal.contentEl.querySelectorAll(".notemoji-sprite")).toHaveLength(1);
		picker.modal.close();
		expect(sprites.listeners.size).toBe(0);
	});
});
