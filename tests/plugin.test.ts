import { beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "./fake-app";
import {
	ButtonComponent,
	DropdownComponent,
	MarkdownView,
	notices,
	openModals,
	settingsCreated,
	TFile,
	TFolder,
	ToggleComponent,
	WorkspaceLeaf,
} from "./obsidian";
import { loadPlugin } from "./plugin-harness";

interface PickerLike {
	options: { current: string; recent: readonly string[]; onSubmit: (emoji: string) => void };
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

	it("reads data.json from 1.x and writes nothing on startup", async () => {
		const harness = await loadPlugin({
			files: ["A.md"],
			data: { version: 1, icons: { "A.md": "🚀", Gone: "👻" } },
		});
		expect(harness.plugin.icons.get("A.md")).toBe("🚀");
		expect(harness.fake.saved).toEqual([]);
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

	it("set opens the picker and stores the emoji in data.json", async () => {
		const harness = await loadPlugin({ activeFile: "Notes/A.md" });
		const set = harness.command("set-emoji-active-note");
		expect(set.checkCallback?.(true)).toBe(true);
		expect(openModals).toHaveLength(0);
		set.checkCallback?.(false);
		expect(picker().options.current).toBe("");

		picker().options.onSubmit("🚀");
		await flush();
		expect(harness.lastSaved()).toEqual({
			version: 2,
			settings: {
				noteTitle: "off",
				showInTabs: true,
				showInViewHeader: false,
				emojiFont: "",
			},
			icons: { "Notes/A.md": "🚀" },
			recent: ["🚀"],
		});
	});

	it("remove is only offered when there is an emoji", async () => {
		const harness = await loadPlugin({ activeFile: "A.md", data: { icons: { "A.md": "🎉" } } });
		const remove = harness.command("remove-emoji-active-note");
		expect(remove.checkCallback?.(true)).toBe(true);
		remove.checkCallback?.(false);
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({});
		expect(remove.checkCallback?.(true)).toBe(false);
	});

	it("picker Remove removes the emoji", async () => {
		const harness = await loadPlugin({ activeFile: "A.md", data: { icons: { "A.md": "🎉" } } });
		harness.command("set-emoji-active-note").checkCallback?.(false);
		expect(picker().options.current).toBe("🎉");
		picker().options.onSubmit("");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({});
	});
});

describe("context menu", () => {
	it("offers set, then change and remove", async () => {
		const harness = await loadPlugin();
		const folder = harness.app.vault.add("Projects") as TFolder;

		const empty = harness.fileMenu(folder);
		expect(empty.titles()).toEqual(["Set folder emoji"]);
		empty.item("Set folder emoji").click();
		picker().options.onSubmit("📁");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ Projects: "📁" });

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

	it("passes the recently used emoji to the picker", async () => {
		const harness = await loadPlugin({ data: { recent: ["🎉", "🚀"] } });
		harness.fileMenu("A.md").item("Set note emoji").click();
		expect(picker().options.recent).toEqual(["🎉", "🚀"]);
	});
});

describe("vault events", () => {
	it("moves emoji when a folder is renamed and keeps them on delete", async () => {
		const harness = await loadPlugin({
			files: ["Projects/A.md"],
			data: { icons: { Projects: "📁", "Projects/A.md": "🚀" } },
		});
		harness.app.vault.rename("Projects", "Work");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ Work: "📁", "Work/A.md": "🚀" });

		const saves = harness.fake.saved.length;
		harness.app.vault.remove("Work");
		await flush();
		expect(harness.fake.saved).toHaveLength(saves);
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
		const dropdown = harness.setting("Emoji at note title").components[0] as DropdownComponent;
		expect(dropdown.getValue()).toBe("off");
		dropdown.change("above");
		(harness.setting("Emoji in tab titles").components[0] as ToggleComponent).change(false);
		(harness.setting("Emoji in view header title").components[0] as ToggleComponent).change(
			false,
		);
		await flush();
		expect(harness.lastSaved()?.settings).toEqual({
			noteTitle: "above",
			showInTabs: false,
			showInViewHeader: false,
			emojiFont: "",
		});
	});

	it("keeps working after data.json was reloaded by sync", async () => {
		const harness = await openSettings();
		harness.fake.dataJson = { version: 2, icons: { Synced: "🔄" } };
		await harness.plugin.onExternalSettingsChange();
		(harness.setting("Emoji in tab titles").components[0] as ToggleComponent).change(false);
		await flush();
		expect(harness.lastSaved()?.settings).toMatchObject({ showInTabs: false });
		expect(harness.lastSaved()?.icons).toEqual({ Synced: "🔄" });
	});

	it("removes emoji of missing items on request", async () => {
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

describe("titles", () => {
	it("renders on load, follows changes and cleans up on unload", async () => {
		const harness = await loadPlugin({
			data: { version: 2, settings: { noteTitle: "above" }, icons: { "A.md": "🚀" } },
		});
		const leaf = new WorkspaceLeaf(harness.app.asApp);
		leaf.root = harness.app.workspace.rootSplit;
		const view = new MarkdownView(leaf);
		view.file = harness.app.vault.add("A.md") as TFile;
		leaf.view = view;
		document.body.appendChild(view.containerEl);
		const titleEl = view.containerEl.createDiv({ cls: "inline-title", text: "A" });
		harness.app.workspace.leaves.push(leaf);

		harness.app.workspace.trigger("layout-change");
		await flush(50);
		const icon = () => titleEl.previousElementSibling?.textContent;
		expect(icon()).toBe("🚀");

		titleEl.previousElementSibling!.querySelector("button")!.click();
		picker().options.onSubmit("🌱");
		await flush(50);
		expect(icon()).toBe("🌱");

		harness.unload();
		expect(document.querySelector(".notemoji-title-icon")).toBeNull();
	});
});

/** Clicks a button of the confirmation dialog that is currently open. */
async function answer(text: "Delete" | "Delete all" | "Cancel"): Promise<void> {
	const dialog = openModals.at(-1)!.contentEl;
	const buttonEl = Array.from(dialog.querySelectorAll("button")).find(
		(el) => el.textContent === text,
	);
	const button = settingsCreated
		.flatMap((setting) => setting.components)
		.find(
			(entry): entry is ButtonComponent =>
				entry instanceof ButtonComponent && entry.buttonEl === buttonEl,
		);
	if (!button) throw new Error(`No "${text}" button in the open dialog`);
	button.click();
	await flush();
}

describe("custom icons", () => {
	const FOLDER = ".obsidian/plugins/notemoji/icons";

	interface CustomPicker extends PickerLike {
		options: PickerLike["options"] & {
			custom: { upload(name: string, data: ArrayBuffer): Promise<string> };
		};
	}

	it("uploads into the plugin folder and uses the icon", async () => {
		const harness = await loadPlugin();
		harness.fileMenu("A.md").item("Set note emoji").click();
		const options = (picker() as CustomPicker).options;
		const file = await options.custom.upload("Logo.PNG", new Uint8Array(8).buffer);
		options.onSubmit(`custom:${file}`);
		await flush();

		expect(harness.app.vault.adapter.files.has(`${FOLDER}/Logo.png`)).toBe(true);
		expect(harness.lastSaved()?.icons).toEqual({ "A.md": "custom:Logo.png" });
		expect(harness.lastSaved()?.recent).toEqual(["custom:Logo.png"]);
	});

	it("deletes an icon after confirmation and forgets where it was used", async () => {
		const harness = await loadPlugin({
			data: {
				icons: { "A.md": "custom:logo.png", "B.md": "🚀" },
				recent: ["custom:logo.png"],
			},
		});
		harness.app.vault.adapter.files.set(`${FOLDER}/logo.png`, new ArrayBuffer(4));

		const cancelled = harness.plugin.deleteCustomIcon("logo.png");
		await flush();
		expect(openModals.at(-1)!.contentEl.textContent).toContain("1 item uses it");
		await answer("Cancel");
		expect(await cancelled).toBe(false);
		expect(harness.app.vault.adapter.files.size).toBe(1);

		const deleted = harness.plugin.deleteCustomIcon("logo.png");
		await flush();
		await answer("Delete");
		expect(await deleted).toBe(true);
		expect(harness.app.vault.adapter.files.size).toBe(0);
		expect(harness.lastSaved()?.icons).toEqual({ "B.md": "🚀" });
		expect(harness.lastSaved()?.recent).toEqual([]);
	});

	it("shows the library in the settings and deletes all after confirmation", async () => {
		const harness = await loadPlugin({ data: { icons: { Folder: "custom:a.png" } } });
		harness.app.vault.adapter.folders.add(FOLDER);
		harness.app.vault.adapter.files.set(`${FOLDER}/a.png`, new ArrayBuffer(2048));
		harness.app.vault.adapter.files.set(`${FOLDER}/b.svg`, new ArrayBuffer(1024));

		settingsCreated.length = 0;
		harness.fake.settingTabs[0].display();
		await flush();
		const setting = settingsCreated.find((entry) => entry.nameEl.textContent === "Your icons")!;
		expect(setting.descEl.textContent).toContain("2 icons, 3 KB");
		const button = setting.components[0] as ButtonComponent;
		expect(button.disabled).toBe(false);

		void button.click();
		await flush();
		await answer("Delete all");
		expect(harness.app.vault.adapter.files.size).toBe(0);
		expect(harness.lastSaved()?.icons).toEqual({});
	});
});

describe("emoji font", () => {
	const FONTS = ".obsidian/plugins/notemoji/fonts";

	beforeEach(() => {
		// Browser font APIs, as far as Notemoji uses them.
		vi.stubGlobal(
			"FontFace",
			class {
				load() {
					return Promise.resolve(this);
				}
			},
		);
		if (!("fonts" in document) || !document.fonts) {
			Object.defineProperty(document, "fonts", { value: new Set(), configurable: true });
		}
		document.body.removeClass("notemoji-custom-font");
	});

	it("installs a font from the settings, loads it on start and can switch back", async () => {
		const harness = await loadPlugin();
		await harness.plugin.setEmojiFont("Twemoji.ttf", new Uint8Array(8).buffer);
		expect(harness.app.vault.adapter.files.has(`${FONTS}/Twemoji.ttf`)).toBe(true);
		expect(harness.lastSaved()?.settings).toMatchObject({ emojiFont: "Twemoji.ttf" });
		expect(document.body.hasClass("notemoji-custom-font")).toBe(true);

		settingsCreated.length = 0;
		harness.fake.settingTabs[0].display();
		const setting = settingsCreated.find((entry) => entry.nameEl.textContent === "Emoji font")!;
		expect(setting.descEl.textContent).toContain("Twemoji.ttf");
		const useSystem = setting.components[1] as ButtonComponent;
		expect(useSystem.buttonEl.textContent).toBe("Use system emoji");

		await useSystem.click();
		expect(harness.app.vault.adapter.files.size).toBe(0);
		expect(harness.lastSaved()?.settings).toMatchObject({ emojiFont: "" });
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
	});

	it("falls back to the system's emoji when the font file is missing (e.g. not synced yet)", async () => {
		const harness = await loadPlugin({ data: { settings: { emojiFont: "Twemoji.ttf" } } });
		expect(harness.plugin.emojiFont.active).toBe(false);
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
		expect(notices).toEqual([]);

		// Once the file arrives, the next start (or sync reload) picks it up.
		harness.app.vault.adapter.files.set(`${FONTS}/Twemoji.ttf`, new ArrayBuffer(8));
		expect(await harness.plugin.emojiFont.load("Twemoji.ttf")).toBe(true);
		harness.unload();
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
	});
});
