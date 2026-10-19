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

async function open(options: Partial<PickerOptions> = {}) {
	const onSubmit = vi.fn();
	const custom = (options.custom as ReturnType<typeof fakeCustom> | undefined) ?? fakeCustom();
	const modal = new PickerModal(createFakeApp().asApp, {
		title: "Set note emoji",
		description: "Website.md",
		current: "",
		recent: [],
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
			const files = names.map((name) => new File([new Uint8Array(4)], name));
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
		expect(picker.footer()).toBe("grinning face");
		picker.query(".notemoji-picker-remove")!.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("");
		expect(openModals).toHaveLength(0);
	});

	it("submits a clicked emoji and names hovered ones in the footer", async () => {
		const picker = await open();
		const tile = picker.tile("😃")!;
		tile.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		expect(picker.footer()).toBe("grinning face with big eyes");
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
		expect(picker.footer()).toBe("rocket");
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

describe("opening", () => {
	it("shows emoji right away, before the custom icon list is read", () => {
		const custom = { ...fakeCustom(), list: () => new Promise<string[]>(() => {}) };
		const modal = new PickerModal(createFakeApp().asApp, {
			title: "Set note emoji",
			current: "",
			recent: [],
			custom,
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
