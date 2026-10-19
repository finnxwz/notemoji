import { beforeEach, describe, expect, it } from "vitest";
import { flush } from "./fake-app";
import {
	ButtonComponent,
	DropdownComponent,
	notices,
	openModals,
	settingsCreated,
	TFolder,
	ToggleComponent,
} from "./obsidian";
import { loadPlugin } from "./plugin-harness";

interface PickerLike {
	options: { current: string; onSubmit: (emoji: string) => void };
}

function picker(): PickerLike {
	const modal = openModals.at(-1) as unknown as PickerLike | undefined;
	if (!modal?.options) throw new Error("No picker open");
	return modal;
}

beforeEach(() => {
	notices.length = 0;
	settingsCreated.length = 0;
	for (const modal of [...openModals]) modal.close();
});

describe("loading", () => {
	it("registers the commands and a settings tab", async () => {
		const { fake } = await loadPlugin();
		expect(fake.commands.map((command) => command.id)).toEqual([
			"set-emoji-active-note",
			"remove-emoji-active-note",
		]);
		expect(fake.settingTabs).toHaveLength(1);
	});

	it("survives missing and malformed data", async () => {
		for (const data of [
			null,
			undefined,
			"garbage",
			42,
			[],
			{},
			{ icons: 7 },
			{ settings: 1 },
		]) {
			const { unload } = await loadPlugin({ data });
			unload();
		}
		expect(notices).toEqual([]);
	});

	it("does not write anything on startup", async () => {
		const harness = await loadPlugin({
			files: ["Alive"],
			data: { version: 1, icons: { Alive: "🌱", Gone: "👻" } },
		});
		expect(harness.fake.saved).toEqual([]);
		expect(harness.app.fileManager.writes).toBe(0);
	});

	it("unload detaches every event handler", async () => {
		const { app, unload } = await loadPlugin();
		unload();
		expect(app.workspace.count() + app.vault.count() + app.metadataCache.count()).toBe(0);
	});
});

describe("commands", () => {
	it("are only offered when a file is active", async () => {
		const { fake } = await loadPlugin();
		for (const command of fake.commands) expect(command.checkCallback?.(true)).toBe(false);
	});

	it("set opens the picker and writes the note's frontmatter", async () => {
		const harness = await loadPlugin({ activeFile: "Notes/A.md" });
		const set = harness.command("set-emoji-active-note");
		expect(set.checkCallback?.(true)).toBe(true);
		expect(openModals).toHaveLength(0);
		set.checkCallback?.(false);
		expect(picker().options.current).toBe("");

		picker().options.onSubmit("🚀");
		await flush();
		expect(harness.app.metadataCache.frontmatter.get("Notes/A.md")).toEqual({ icon: "🚀" });
		expect(harness.lastSaved()?.icons).toEqual({});
		expect(harness.lastSaved()?.recent).toEqual(["🚀"]);
	});

	it("remove deletes the property and is then no longer offered", async () => {
		const harness = await loadPlugin({
			activeFile: "A.md",
			frontmatter: { "A.md": { icon: "🎉", tags: ["x"] } },
		});
		const remove = harness.command("remove-emoji-active-note");
		expect(remove.checkCallback?.(true)).toBe(true);
		remove.checkCallback?.(false);
		await flush();
		expect(harness.app.metadataCache.frontmatter.get("A.md")).toEqual({ tags: ["x"] });
		expect(remove.checkCallback?.(true)).toBe(false);
	});

	it("shows a notice when the frontmatter cannot be written", async () => {
		const harness = await loadPlugin({ activeFile: "A.md" });
		harness.app.fileManager.failWith = new Error("invalid YAML");
		harness.command("set-emoji-active-note").checkCallback?.(false);
		picker().options.onSubmit("🚀");
		await flush();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/frontmatter/);
	});
});

describe("replacing a non-emoji icon property", () => {
	async function setOnOtherIconNote(answer: "Replace" | "Cancel") {
		const harness = await loadPlugin({ frontmatter: { "A.md": { icon: "LiHome" } } });
		harness.fileMenu("A.md").item("Set note emoji").click();
		picker().options.onSubmit("🚀");
		await flush();

		const confirmEl = openModals.at(-1)!.contentEl;
		expect(confirmEl.textContent).toContain("LiHome");
		const button = Array.from(confirmEl.querySelectorAll("button")).find(
			(el) => el.textContent === answer,
		);
		const component = settingsCreated
			.flatMap((setting) => setting.components)
			.find(
				(entry): entry is ButtonComponent =>
					entry instanceof ButtonComponent && entry.buttonEl === button,
			);
		component!.click();
		await flush();
		return harness;
	}

	it("replaces after confirmation", async () => {
		const harness = await setOnOtherIconNote("Replace");
		expect(harness.app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "🚀" });
	});

	it("keeps the value when cancelled", async () => {
		const harness = await setOnOtherIconNote("Cancel");
		expect(harness.app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "LiHome" });
		expect(openModals.some((modal) => modal.contentEl.textContent?.includes("LiHome"))).toBe(
			false,
		);
	});
});

describe("context menu", () => {
	it("offers set, then change and remove, for folders in data.json", async () => {
		const harness = await loadPlugin();
		const folder = harness.app.vault.add("Projects") as TFolder;

		const empty = harness.fileMenu(folder);
		expect(empty.titles()).toEqual(["Set folder emoji"]);
		empty.item("Set folder emoji").click();
		picker().options.onSubmit("📁");
		await flush();
		expect(harness.lastSaved()).toEqual({
			version: 2,
			settings: { noteTitle: "above", showInTabs: true, showInViewHeader: true },
			icons: { Projects: "📁" },
			recent: ["📁"],
		});

		const filled = harness.fileMenu(folder);
		expect(filled.titles()).toEqual(["Change folder emoji", "Remove folder emoji"]);
		filled.item("Remove folder emoji").click();
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({});
	});

	it("uses note and file wording", async () => {
		const harness = await loadPlugin();
		expect(harness.fileMenu("A.md").titles()).toEqual(["Set note emoji"]);
		expect(harness.fileMenu("image.png").titles()).toEqual(["Set file emoji"]);
	});
});

describe("sync", () => {
	it("reloads data.json changed on disk without writing it back", async () => {
		const harness = await loadPlugin({ files: ["Folder"], data: { icons: { Folder: "📁" } } });
		harness.fake.dataJson = { version: 2, icons: { Folder: "🗂️" }, recent: ["🗂️"] };
		await harness.plugin.onExternalSettingsChange();
		expect(harness.plugin.icons.get("Folder")).toBe("🗂️");
		expect(harness.plugin.icons.recent).toEqual(["🗂️"]);
		expect(harness.fake.saved).toEqual([]);

		// Later saves build on the reloaded data, not on the stale copy.
		harness.fileMenu("Other").item("Set folder emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ Folder: "🗂️", Other: "🌱" });
	});
});

describe("settings tab", () => {
	async function openSettings(options: Parameters<typeof loadPlugin>[0] = {}) {
		const harness = await loadPlugin(options);
		const tab = harness.fake.settingTabs[0];
		settingsCreated.length = 0;
		tab.display();
		const setting = (name: string) => {
			const found = settingsCreated.find((entry) => entry.nameEl.textContent === name);
			if (!found) throw new Error(`No setting "${name}"`);
			return found;
		};
		return { ...harness, tab, setting };
	}

	it("changes and saves the display settings", async () => {
		const harness = await openSettings();
		(harness.setting("Emoji at note title").components[0] as DropdownComponent).change(
			"inline",
		);
		(harness.setting("Emoji in tab titles").components[0] as ToggleComponent).change(false);
		(harness.setting("Emoji in view header title").components[0] as ToggleComponent).change(
			false,
		);
		await flush();
		expect(harness.lastSaved()?.settings).toEqual({
			noteTitle: "inline",
			showInTabs: false,
			showInViewHeader: false,
		});
	});

	it("offers the frontmatter migration only when there is something to move", async () => {
		const without = await openSettings();
		expect(() => without.setting("Move note emoji to frontmatter")).toThrow();

		const harness = await openSettings({
			frontmatter: { "A.md": {} },
			data: { version: 1, icons: { "A.md": "🚀" } },
		});
		const button = harness.setting("Move note emoji to frontmatter")
			.components[0] as ButtonComponent;
		await button.click();
		await flush();
		expect(harness.app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "🚀" });
		expect(harness.lastSaved()?.icons).toEqual({});
		expect(notices.at(-1)).toMatch(/Moved 1 emoji/);
	});

	it("removes emoji of missing files on request", async () => {
		const harness = await openSettings({
			files: ["Alive"],
			data: { icons: { Alive: "🌱", Gone: "👻" } },
		});
		const button = harness.setting("Remove emoji of missing files")
			.components[0] as ButtonComponent;
		expect(button.buttonEl.textContent).toBe("Remove 1");
		button.click();
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ Alive: "🌱" });
	});
});
