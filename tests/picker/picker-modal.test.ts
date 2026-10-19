import { afterEach, describe, expect, it, vi } from "vitest";
import { PickerModal, PickerOptions } from "../../src/picker/picker-modal";
import { createFakeApp } from "../fake-app";
import { openModals, Platform } from "../obsidian";

function open(options: Partial<PickerOptions> = {}) {
	const onSubmit = vi.fn();
	const modal = new PickerModal(createFakeApp().asApp, {
		title: "Set note emoji",
		description: "Website.md",
		current: "",
		recent: [],
		onSubmit,
		...options,
	});
	modal.open();
	const query = <T extends HTMLElement = HTMLElement>(selector: string) =>
		modal.contentEl.querySelector<T>(selector);
	const search = query<HTMLInputElement>(".notemoji-picker-search")!;
	return {
		modal,
		onSubmit,
		search,
		query,
		tiles: () =>
			Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".notemoji-picker-emoji")),
		tabs: () =>
			Array.from(modal.contentEl.querySelectorAll<HTMLElement>(".notemoji-picker-tab")),
		type(text: string) {
			search.value = text;
			search.dispatchEvent(new Event("input"));
		},
		press(key: string) {
			search.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
		},
		footer: () => query(".notemoji-picker-footer-name")?.textContent,
	};
}

afterEach(() => {
	for (const modal of [...openModals]) modal.close();
	Platform.isMobile = false;
});

describe("browsing", () => {
	it("shows title, item, categories and all emoji", () => {
		const picker = open();
		expect(picker.modal.titleEl.textContent).toBe("Set note emoji");
		expect(picker.query(".notemoji-picker-description")?.textContent).toBe("Website.md");
		expect(picker.tabs()).toHaveLength(9);
		expect(picker.tiles().length).toBeGreaterThan(1800);
		expect(picker.query(".notemoji-picker-remove")).toBeNull();
	});

	it("lists recently used emoji first, with their own tab", () => {
		const picker = open({ recent: ["🎉", "★"] });
		expect(picker.tabs()).toHaveLength(10);
		expect(picker.tabs()[0].getAttribute("aria-label")).toBe("Recently used");
		expect(
			picker
				.tiles()
				.slice(0, 2)
				.map((el) => el.textContent),
		).toEqual(["🎉", "★"]);
	});

	it("highlights the current emoji and offers Remove", () => {
		const picker = open({ current: "🚀" });
		expect(picker.query(".notemoji-picker-emoji.is-current")?.textContent).toBe("🚀");
		expect(picker.footer()).toBe("rocket");
		picker.query(".notemoji-picker-remove")!.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("");
		expect(openModals).toHaveLength(0);
	});

	it("submits a clicked emoji and closes", () => {
		const picker = open();
		const tile = picker.tiles().find((el) => el.textContent === "🐻")!;
		tile.click();
		expect(picker.onSubmit).toHaveBeenCalledWith("🐻");
		expect(openModals).toHaveLength(0);
	});

	it("names the hovered emoji in the footer", () => {
		const picker = open();
		const tile = picker.tiles().find((el) => el.textContent === "🐻")!;
		tile.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
		expect(picker.footer()).toBe("bear");
	});

	it("marks the clicked category tab", () => {
		const picker = open();
		const flags = picker.tabs().find((el) => el.dataset.section === "flags")!;
		flags.click();
		expect(flags.hasClass("is-active")).toBe(true);
		expect(flags.getAttribute("aria-selected")).toBe("true");
	});
});

describe("searching", () => {
	it("shows the best match first and submits it with Enter", () => {
		const picker = open();
		picker.type("rocket");
		expect(picker.tiles()[0].textContent).toBe("🚀");
		expect(picker.tiles()[0].hasClass("is-active")).toBe(true);
		expect(picker.footer()).toBe("rocket");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("🚀");
	});

	it("moves through results with the arrow keys", () => {
		const picker = open();
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

	it("offers a pasted emoji first, also when it is not in the list", () => {
		const picker = open();
		picker.type("🫠");
		expect(picker.tiles()[0].textContent).toBe("🫠");
		picker.type("★");
		expect(picker.tiles()[0].textContent).toBe("★");
		expect(picker.footer()).toBe("Custom emoji");
		picker.press("Enter");
		expect(picker.onSubmit).toHaveBeenCalledWith("★");
	});

	it("does not list a pasted emoji twice", () => {
		const picker = open();
		picker.type("🚀");
		expect(picker.tiles().filter((el) => el.textContent === "🚀")).toHaveLength(1);
	});

	it("explains when nothing matches and ignores Enter", () => {
		const picker = open();
		picker.type("qqqzzz");
		expect(picker.query(".notemoji-picker-empty")).not.toBeNull();
		picker.press("Enter");
		expect(picker.onSubmit).not.toHaveBeenCalled();
	});

	it("clears the search when a category tab is clicked", () => {
		const picker = open();
		picker.type("rocket");
		picker.tabs()[0].click();
		expect(picker.search.value).toBe("");
		expect(picker.tiles().length).toBeGreaterThan(1800);
	});
});

describe("focus", () => {
	it("focuses the search field on desktop", () => {
		const picker = open();
		expect(document.activeElement).toBe(picker.search);
	});

	it("does not focus it on mobile, so the keyboard does not cover the grid", () => {
		Platform.isMobile = true;
		const picker = open();
		expect(document.activeElement).not.toBe(picker.search);
	});
});
