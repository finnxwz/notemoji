import { afterEach, describe, expect, it } from "vitest";
import { setDestructive } from "../src/internals";
import { ButtonComponent, setApiVersion } from "./obsidian";

describe("setDestructive", () => {
	afterEach(() => setApiVersion("1.7.2"));

	it("uses setDestructive() from Obsidian 1.13 on", () => {
		setApiVersion("1.13.0");
		const button = new ButtonComponent(document.createElement("button"));
		expect(setDestructive(button as never)).toBe(button);
		expect(button.destructive).toBe(true);
		expect(button.buttonEl.hasClass("mod-warning")).toBe(false);
	});

	it("adds the class of the deprecated setWarning() before", () => {
		const button = new ButtonComponent(document.createElement("button"));
		expect(setDestructive(button as never)).toBe(button);
		expect(button.destructive).toBe(false);
		expect(button.buttonEl.hasClass("mod-warning")).toBe(true);
	});
});
