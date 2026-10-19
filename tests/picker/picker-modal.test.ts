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
	const custom = (options.custom as ReturnType<typeof fakeCustom>) ?? fakeCustom();
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
	return {
		modal,
		onSubmit,
		custom,
		search,
		query,
		tiles: () =>
			Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".notemoji-picker-emoji")),
		tile: (label: string) =>
			modal.contentEl.querySelector<HTMLElement>(
				`.notemoji-picker-emoji[aria-label="${label}"]`,
			)!,
		tabs: () =>
			Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".notemoji-picker-tab")),
		type(text: string) {
			search.value = text;
			search.dispatchEvent(new Event("input"));
		},
		press(key: string) {
			search.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		},
		async upload(...names: string[]) {
			const input = query<HTMLInputElement>(".notemoji-picker-upload-input")!;
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
	it("shows title, item, categories and all emoji", async () => {
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
		expect(picker.tiles().length).toBeGreaterThan(1800);
		expect(picker.query(".notemoji-picker-remove")).toBeNull();
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
		const picker = await open({ current: "🚀" });
		expect(picker.query(".notemoji-picker-emoji.is-current")?.textContent).toBe("🚀");
		expect(picker.footer()).toBe("rocket");
		picker.query(".notemoji-picker-remove")!.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("");
		expect(openModals).toHaveLength(0);
	});

	it("submits a clicked emoji and closes", async () => {
		const picker = await open();
		picker.tile("bear").click();
		expect(picker.onSubmit).toHaveBeenCalledWith("🐻");
		expect(openModals).toHaveLength(0);
	});

	it("names the hovered emoji in the footer", async () => {
		const picker = await open();
		picker.tile("bear").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		expect(picker.footer()).toBe("bear");
	});

	it("marks the clicked category tab", async () => {
		const picker = await open();
		const flags = picker.tabs().find((el) => el.dataset.section === "flags")!;
		flags.click();
		expect(flags.hasClass("is-active")).toBe(true);
		expect(flags.getAttribute("aria-selected")).toBe("true");
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
		expect(active).toBeGreaterThan(0);
		const expected = picker.tiles()[active].textContent;
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith(expected);
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
		expect(picker.query(".notemoji-picker-empty")).not.toBeNull();
		picker.press("Enter");
		expect(picker.onSubmit).not.toHaveBeenCalled();
	});

	it("clears the search when a category tab is clicked", async () => {
		const picker = await open();
		picker.type("rocket");
		picker.tabs()[1].click();
		expect(picker.search.value).toBe("");
		expect(picker.tiles().length).toBeGreaterThan(1800);
	});
});

describe("custom icons", () => {
	it("shows the library as images with an upload tile", async () => {
		const picker = await open({ custom: fakeCustom(["logo.png", "star.png"]) });
		const section = picker.query('.notemoji-picker-section[data-section="custom"]')!;
		const images = Array.from(section.querySelectorAll("img")).map((img) =>
			img.getAttribute("src"),
		);
		expect(images).toEqual(["app://icons/logo.png", "app://icons/star.png"]);
		expect(section.querySelector(".notemoji-picker-upload")).not.toBeNull();

		picker.tile("logo.png").click();
		expect(picker.onSubmit).toHaveBeenCalledWith("custom:logo.png");
	});

	it("finds custom icons by file name", async () => {
		const picker = await open({ custom: fakeCustom(["company-logo.png"]) });
		picker.type("logo");
		expect(picker.tiles()[0].getAttribute("aria-label")).toBe("company-logo.png");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("custom:company-logo.png");
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
		expect(picker.tile("a.png")).not.toBeNull();
		expect(picker.tile("b.png")).not.toBeNull();
	});

	it("deletes a custom icon from its context menu", async () => {
		const picker = await open({ custom: fakeCustom(["logo.png"]) });
		const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
		picker.tile("logo.png").dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		shownMenus[0].item("Delete custom icon").click();
		await flush();
		expect(picker.custom.remove).toHaveBeenCalledWith("logo.png");
		expect(picker.query('.notemoji-picker-emoji[aria-label="logo.png"]')).toBeNull();
	});

	it("has no context menu for emoji", async () => {
		const picker = await open();
		picker.tile("bear").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
		expect(shownMenus).toHaveLength(0);
	});

	it("hides recent custom icons whose file is gone", async () => {
		const picker = await open({ recent: ["custom:gone.png", "🎉"], custom: fakeCustom() });
		expect(picker.tiles()[0].textContent).toBe("🎉");
		expect(picker.query('[aria-label="gone.png"]')).toBeNull();
	});

	it("shows the current custom icon in the footer", async () => {
		const picker = await open({ current: "custom:logo.png", custom: fakeCustom(["logo.png"]) });
		expect(picker.footer()).toBe("logo.png");
		expect(picker.query(".notemoji-picker-footer-emoji img")?.getAttribute("src")).toBe(
			"app://icons/logo.png",
		);
	});
});

describe("focus", () => {
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
