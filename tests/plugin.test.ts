import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from "vitest";
import { FakeApp, flush } from "./fake-app";
import {
	ButtonComponent,
	DropdownComponent,
	getIcon,
	lineIcons,
	MarkdownView,
	network,
	notices,
	openModals,
	Setting,
	settingsCreated,
	TFile,
	TFolder,
	ToggleComponent,
	WorkspaceLeaf,
} from "./obsidian";
import { canvasCodec } from "../src/icons/canvas-codec";
import { svgMarkup } from "../src/icons/library-icons";
import { encodeBase64 } from "../src/icons/image-format";
import { ICONS_MARKER } from "../src/data";
import { findEmojiSet } from "../src/style/emoji-sets";
import type { NotemojiSettingTab } from "../src/settings/settings-tab";
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
				noteTitle: "inline",
				showInTabs: true,
				showInViewHeader: false,
				showInLinks: false,
				emojiStyle: "system",
				emojiFont: "",
				autoEmoji: false,
			},
			icons: { "Notes/A.md": "🚀" },
			recent: ["🚀"],
			libraryIcons: {},
			customIcons: {},
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

describe("data safety", () => {
	const BACKUP = ".obsidian/plugins/notemoji/backup.json";
	const v2 = {
		version: 2,
		settings: { noteTitle: "above" },
		icons: { "A.md": "🚀", "B.md": "custom:logo" },
		recent: ["custom:logo"],
		customIcons: { logo: { type: "image/png", data: "AAAA" } },
	};
	const readBackup = async (harness: Awaited<ReturnType<typeof loadPlugin>>) =>
		JSON.parse(await harness.app.vault.adapter.read(BACKUP)) as Record<string, unknown>;

	it("keeps a backup on this device after saving", async () => {
		const harness = await loadPlugin({ data: v2 });
		harness.fileMenu("C.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		// Written shortly after the save, at the latest on unload.
		harness.unload();
		await flush();
		expect((await readBackup(harness)).icons).toEqual({
			[ICONS_MARKER]: "",
			...v2.icons,
			"C.md": "🌱",
		});
	});

	it("repairs data.json when a device with Notemoji 1.x saved over it", async () => {
		const harness = await loadPlugin({ data: v2 });
		harness.fake.dataJson = { version: 1, icons: { "A.md": "🎉" } };
		await harness.plugin.onExternalSettingsChange();
		await flush();
		const saved = harness.lastSaved()!;
		expect(saved.version).toBe(2);
		expect(saved.icons).toEqual({ "A.md": "🎉", "B.md": "custom:logo" });
		expect(saved.customIcons).toEqual(v2.customIcons);
		expect(saved.recent).toEqual(["custom:logo"]);
		expect(harness.plugin.settings.noteTitle).toBe("above");
		expect(harness.plugin.icons.get("A.md")).toBe("🎉");
	});

	it("repairs it at startup from the backup when this device was closed meanwhile", async () => {
		const first = await loadPlugin({ data: v2 });
		// Any save leaves a backup on this device.
		first.plugin.updateSettings({ showInTabs: true });
		await flush();
		const harness = await loadPluginWith(first, { version: 1, icons: { "A.md": "🎉" } });
		expect(harness.plugin.icons.get("B.md")).toBe("custom:logo");
		expect(harness.plugin.icons.get("A.md")).toBe("🎉");
		expect(harness.plugin.customIcons.list()).toEqual(["logo"]);
		expect(harness.plugin.settings.noteTitle).toBe("above");
		await flush();
		expect(harness.lastSaved()?.version).toBe(2);
	});

	it("starts normally after updating from 1.x, when there is no backup yet", async () => {
		const harness = await loadPlugin({ data: { version: 1, icons: { "A.md": "🎉" } } });
		expect(harness.plugin.icons.get("A.md")).toBe("🎉");
		expect(notices).toEqual([]);
	});

	it("restores an unreadable data.json from the backup", async () => {
		const backup = JSON.stringify({ ...v2, icons: { [ICONS_MARKER]: "", ...v2.icons } });
		const harness = await loadPluginWith(await loadPlugin(), "damaged", backup);
		expect(harness.plugin.icons.get("B.md")).toBe("custom:logo");
		expect(notices.at(-1)).toContain("the backup on this device is used");
		// Not saved right away: sync may still bring an intact copy…
		expect(harness.fake.saved).toEqual([]);
		// …but the next change is saved, with everything from the backup.
		harness.fileMenu("C.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ ...v2.icons, "C.md": "🌱" });
	});

	it("never saves over an unreadable data.json without a backup", async () => {
		const harness = await loadPluginWith(await loadPlugin(), "damaged");
		expect(notices.at(-1)).toContain("could not be read");
		harness.fileMenu("A.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		expect(harness.fake.saved).toEqual([]);
	});

	it("never saves over data of a newer version, and says why", async () => {
		const newer = { ...v2, version: 3 };
		const harness = await loadPlugin({ data: newer });
		expect(notices.at(-1)).toContain("Update it on this device too");
		harness.fileMenu("A.md").item("Change note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		expect(harness.fake.saved).toEqual([]);

		// Once this device's data is current again (e.g. restored), saving resumes.
		harness.fake.dataJson = v2;
		await harness.plugin.onExternalSettingsChange();
		harness.fileMenu("A.md").item("Change note emoji").click();
		picker().options.onSubmit("🌵");
		await flush();
		expect(harness.lastSaved()?.icons).toMatchObject({ "A.md": "🌵" });
	});

	it("ignores data.json while it is deleted or half synced", async () => {
		const harness = await loadPlugin({ data: v2 });
		for (const value of [null, {}]) {
			harness.fake.dataJson = value;
			await harness.plugin.onExternalSettingsChange();
		}
		expect(harness.plugin.icons.get("A.md")).toBe("🚀");
		expect(harness.fake.saved).toEqual([]);
	});

	it("keeps both a change made here during a reload and the reloaded file", async () => {
		const harness = await loadPlugin({ data: v2 });
		const fake = harness.fake as unknown as { loadData: () => Promise<unknown> };
		const original = fake.loadData.bind(harness.fake);
		let first = true;
		fake.loadData = async () => {
			const result = await original();
			if (first) {
				first = false;
				// The user picks an emoji while the reload is reading.
				harness.fileMenu("C.md").item("Set note emoji").click();
				picker().options.onSubmit("🌱");
			}
			return result;
		};
		harness.fake.dataJson = { ...v2, icons: { ...v2.icons, "D.md": "🔄" } };
		await harness.plugin.onExternalSettingsChange();
		await flush();
		expect(harness.plugin.icons.get("C.md")).toBe("🌱");
		expect(harness.plugin.icons.get("D.md")).toBe("🔄");
		expect(harness.lastSaved()?.icons).toEqual({ ...v2.icons, "C.md": "🌱", "D.md": "🔄" });
	});

	it("keeps a change made while a save is writing and a reload waits behind it", async () => {
		const harness = await loadPlugin({ data: v2 });
		const fake = harness.fake as unknown as { saveData: (data: unknown) => Promise<void> };
		const original = fake.saveData.bind(harness.fake);
		let release!: () => void;
		let firstSave = true;
		fake.saveData = async (data) => {
			if (firstSave) {
				firstSave = false;
				// The first save takes a while (a slow disk).
				await new Promise<void>((resolve) => (release = resolve));
			}
			return original(data);
		};
		harness.fileMenu("C.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		const reload = harness.plugin.onExternalSettingsChange();
		harness.fileMenu("E.md").item("Set note emoji").click();
		picker().options.onSubmit("🌵");
		release();
		await reload;
		await flush();
		expect(harness.plugin.icons.get("E.md")).toBe("🌵");
		expect(harness.lastSaved()?.icons).toMatchObject({ "C.md": "🌱", "E.md": "🌵" });
	});

	it("takes in a file sync replaced before saving, also before Obsidian reported it", async () => {
		const harness = await loadPlugin({ data: v2 });
		// Sync wrote the file; onExternalSettingsChange has not been called yet.
		harness.fake.dataJson = { ...v2, icons: { ...v2.icons, "D.md": "🔄" } };
		harness.fileMenu("C.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		expect(harness.lastSaved()?.icons).toMatchObject({ "C.md": "🌱", "D.md": "🔄" });
		expect(harness.plugin.icons.get("D.md")).toBe("🔄");

		// And never saves over a newer version written that way.
		harness.fake.dataJson = { ...v2, version: 3 };
		const saves = harness.fake.saved.length;
		harness.fileMenu("F.md").item("Set note emoji").click();
		picker().options.onSubmit("🌵");
		await flush();
		expect(harness.fake.saved).toHaveLength(saves);
	});

	it("writes a burst of changes once", async () => {
		const harness = await loadPlugin({ data: v2 });
		for (const path of ["C.md", "D.md", "E.md"]) {
			harness.fileMenu(path).item("Set note emoji").click();
			picker().options.onSubmit("🌱");
		}
		await flush();
		expect(harness.fake.saved).toHaveLength(1);
		expect(harness.lastSaved()?.icons).toMatchObject({
			"C.md": "🌱",
			"D.md": "🌱",
			"E.md": "🌱",
		});
	});

	it("keeps the backup current with changes from other devices", async () => {
		const harness = await loadPlugin({ data: v2 });
		harness.fake.dataJson = { ...v2, icons: { ...v2.icons, "D.md": "🔄" } };
		await harness.plugin.onExternalSettingsChange();
		harness.unload();
		await flush();
		expect((await readBackup(harness)).icons).toMatchObject({ "D.md": "🔄" });
	});

	it("never repairs over data of a newer version", async () => {
		const harness = await loadPlugin({ data: { ...v2, version: 3 } });
		harness.fake.dataJson = { version: 1, icons: { "A.md": "🎉" } };
		await harness.plugin.onExternalSettingsChange();
		await flush();
		expect(harness.fake.saved).toEqual([]);
	});

	it("starts over once an unreadable data.json was deleted", async () => {
		const harness = await loadPluginWith(await loadPlugin(), "damaged");
		harness.app.vault.adapter.files.delete(".obsidian/plugins/notemoji/data.json");
		await harness.plugin.onExternalSettingsChange();
		harness.fileMenu("A.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ "A.md": "🌱" });
	});

	it("shows the backup while data.json is not downloaded yet, without saving", async () => {
		const first = await loadPlugin({ data: v2 });
		first.plugin.updateSettings({ showInTabs: true });
		await flush();
		const harness = await loadPluginWith(first, null);
		expect(harness.plugin.icons.get("B.md")).toBe("custom:logo");
		expect(harness.fake.saved).toEqual([]);
	});

	it("combines a change made while the backup is shown with data.json once it arrives", async () => {
		const first = await loadPlugin({ data: v2 });
		first.plugin.updateSettings({ showInTabs: true });
		await flush();
		const harness = await loadPluginWith(first, null);
		const fake = harness.fake as unknown as { loadData: () => Promise<unknown> };
		const read = fake.loadData.bind(harness.fake);
		fake.loadData = async () => {
			fake.loadData = read;
			const result = await read();
			// The user picks an emoji while sync brings data.json.
			harness.fileMenu("C.md").item("Set note emoji").click();
			picker().options.onSubmit("🌱");
			return result;
		};
		harness.fake.dataJson = { ...v2, icons: { ...v2.icons, "D.md": "🔄" } };
		await harness.plugin.onExternalSettingsChange();
		await flush();
		expect(harness.plugin.icons.get("C.md")).toBe("🌱");
		expect(harness.lastSaved()?.icons).toEqual({ ...v2.icons, "C.md": "🌱", "D.md": "🔄" });
	});

	it("combines an emoji set on a new device with data.json arriving right then", async () => {
		const harness = await loadPlugin();
		// Sync wrote data.json; Obsidian has not reported it yet.
		harness.fake.dataJson = v2;
		harness.fileMenu("C.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ ...v2.icons, "C.md": "🌱" });
		expect(harness.lastSaved()?.customIcons).toEqual(v2.customIcons);
		expect(harness.plugin.settings.noteTitle).toBe("above");
	});

	it("writes the backup one write after another, so an older one never wins", async () => {
		// The backup follows a change after 2 s; here at once.
		const later = window.setTimeout.bind(window);
		const timers = vi
			.spyOn(window, "setTimeout")
			.mockImplementation((run, ms) => later(run, ms === 2000 ? 0 : ms) as never);
		let release: (() => void) | undefined;
		const harness = await loadPlugin({
			data: v2,
			beforeLoad: ({ vault: { adapter } }) => {
				const write = adapter.write.bind(adapter);
				adapter.write = async (path, text) => {
					// The first backup takes a while (a slow disk).
					if (path === BACKUP && !release) {
						await new Promise<void>((resolve) => (release = resolve));
					}
					return write(path, text);
				};
			},
		});
		await flush();
		harness.fileMenu("C.md").item("Set note emoji").click();
		picker().options.onSubmit("🌱");
		await flush();
		harness.unload();
		release!();
		await flush();
		timers.mockRestore();
		expect((await readBackup(harness)).icons).toMatchObject({ "C.md": "🌱" });
	});

	it("keeps settings of a newer version until they are changed here", async () => {
		const harness = await loadPlugin({
			data: { ...v2, settings: { emojiStyle: "fluent", iconSize: "large" } },
		});
		harness.plugin.updateSettings({ showInTabs: false });
		await flush();
		expect(harness.lastSaved()?.settings).toMatchObject({
			emojiStyle: "fluent",
			iconSize: "large",
			showInTabs: false,
		});
		harness.plugin.updateSettings({ emojiStyle: "system" });
		await flush();
		expect(harness.lastSaved()?.settings).toMatchObject({
			emojiStyle: "system",
			iconSize: "large",
		});
	});
});

/**
 * Loads the plugin again on the same device (same files, including the
 * backup) with `data` as data.json, or with an unreadable one.
 */
async function loadPluginWith(
	previous: Awaited<ReturnType<typeof loadPlugin>>,
	data: unknown,
	backup?: string,
) {
	previous.unload();
	await flush();
	const adapter = previous.app.vault.adapter;
	if (backup !== undefined) await adapter.write(".obsidian/plugins/notemoji/backup.json", backup);
	const harness = await loadPlugin({
		data: data === "damaged" ? null : data,
		adapterFiles: adapter.files,
		damaged: data === "damaged",
	});
	return harness;
}

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
		expect(dropdown.getValue()).toBe("inline");
		dropdown.change("above");
		(harness.setting("Emoji in tab titles").components[0] as ToggleComponent).change(false);
		(harness.setting("Emoji in view header title").components[0] as ToggleComponent).change(
			false,
		);
		(harness.setting("Emoji next to links").components[0] as ToggleComponent).change(true);
		await flush();
		expect(harness.lastSaved()?.settings).toEqual({
			noteTitle: "above",
			showInTabs: false,
			showInViewHeader: false,
			showInLinks: true,
			emojiStyle: "system",
			emojiFont: "",
			autoEmoji: false,
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
		expect(openModals.at(-1)!.contentEl.textContent).toContain("won't come back");
		await answer("Remove");
		expect(harness.lastSaved()?.icons).toEqual({ Alive: "🌱" });
		// The row shows the new state right away.
		expect(button.buttonEl.textContent).toBe("Remove");
		expect(button.disabled).toBe(true);
	});
});

describe("settings tab in Obsidian 1.13", () => {
	interface Row {
		name: string;
		control?: { key: string };
		render?: (setting: Setting) => void;
	}

	/** The tab as Obsidian 1.13 builds it: from setting definitions, not display(). */
	async function definitions(options: Parameters<typeof loadPlugin>[0] = {}) {
		const harness = await loadPlugin(options);
		const tab = harness.fake.settingTabs[0] as unknown as NotemojiSettingTab;
		const groups = tab.getSettingDefinitions() as Array<{ heading: string; items: Row[] }>;
		return { ...harness, tab, groups };
	}

	it("puts every setting into Obsidian's settings search", async () => {
		const { groups } = await definitions();
		expect(groups.map((group) => group.heading)).toEqual([
			"Display",
			"Emoji style",
			"Custom icons",
			"Maintenance",
		]);
		expect(groups[0].items.map((item) => item.control?.key)).toEqual([
			"noteTitle",
			"showInTabs",
			"showInViewHeader",
			"showInLinks",
			"autoEmoji",
		]);
	});

	it("reads and changes settings through Notemoji, which saves all of data.json", async () => {
		const harness = await definitions({ data: { version: 2, icons: { "A.md": "🚀" } } });
		expect(harness.tab.getControlValue("showInLinks")).toBe(false);
		harness.tab.setControlValue("showInLinks", true);
		await flush();
		expect(harness.plugin.settings.showInLinks).toBe(true);
		expect(harness.lastSaved()?.icons).toEqual({ "A.md": "🚀" });
		// Only its own controls, with values of the stored kind.
		harness.tab.setControlValue("emojiStyle", "twemoji");
		harness.tab.setControlValue("showInTabs", "yes");
		expect(harness.plugin.settings.emojiStyle).toBe("system");
		expect(harness.plugin.settings.showInTabs).toBe(true);
	});

	it("draws the same rows in older versions", async () => {
		const harness = await definitions();
		settingsCreated.length = 0;
		harness.fake.settingTabs[0].display();
		const rows = settingsCreated.filter(
			(setting) => setting.settingEl.parentElement === harness.tab.containerEl,
		);
		expect(rows.map((setting) => setting.nameEl.textContent)).toEqual(
			harness.groups.flatMap((group) => [
				group.heading,
				...group.items.map((row) => row.name),
			]),
		);
	});

	it("draws the emoji styles and the custom icons in their rows", async () => {
		const { groups } = await definitions();
		const containerEl = createDiv();
		for (const group of groups.slice(1, 3)) {
			const row = group.items[0];
			row.render?.(new Setting(containerEl).setName(row.name));
		}
		expect(
			containerEl.querySelector(".notemoji-section-row .notemoji-styles-section"),
		).not.toBe(null);
		expect(
			containerEl.querySelector(".notemoji-section-row .notemoji-custom-icons-section"),
		).not.toBe(null);
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

describe("emoji next to links", () => {
	/** A rendered part of Index.md with a link, passed through the plugin's post-processor. */
	function renderLink(harness: Awaited<ReturnType<typeof loadPlugin>>, href: string) {
		const el = document.body.createEl("p");
		const anchor = el.createEl("a", { cls: "internal-link", attr: { "data-href": href } });
		for (const postProcessor of harness.fake.postProcessors) {
			postProcessor(el, { sourcePath: "Index.md", addChild: (child) => child.load() });
		}
		return () => anchor.querySelector(".notemoji-link-icon")?.getAttribute("data-notemoji");
	}

	it("is off by default and follows the setting, icons and files without re-rendering", async () => {
		const harness = await loadPlugin({
			files: ["Index.md", "Rome.md"],
			// Synced before the note itself arrives.
			data: { version: 2, icons: { "Rome.md": "🏛️", "Later.md": "⏰" } },
		});
		expect(harness.fake.editorExtensions).toHaveLength(1);
		const rome = renderLink(harness, "Rome");
		const later = renderLink(harness, "Later");
		expect(rome()).toBeUndefined();

		harness.plugin.updateSettings({ showInLinks: true });
		await flush(50);
		expect(rome()).toBe("🏛️");
		expect(later()).toBeUndefined();

		harness
			.fileMenu("Rome.md")
			.items.find((item) => item.title === "Change note emoji")!
			.click();
		picker().options.onSubmit("🍝");
		harness.app.vault.create("Later.md");
		await flush(50);
		expect(rome()).toBe("🍝");
		expect(later()).toBe("⏰");
		harness.app.vault.rename("Rome.md", "Roma.md");
		await flush(50);
		expect(rome()).toBeUndefined();

		harness.unload();
		expect(document.querySelector(".notemoji-link-icon")).toBeNull();
		expect(harness.fake.postProcessors).toHaveLength(0);
	});

	it("renders notes open in reading view again when it starts while they are shown", async () => {
		const views: MarkdownView[] = [];
		const open = (app: FakeApp, mode: "source" | "preview") => {
			const leaf = new WorkspaceLeaf(app.asApp);
			const view = new MarkdownView(leaf);
			view.mode = mode;
			leaf.view = view;
			app.workspace.leaves.push(leaf);
			views.push(view);
		};
		const openBoth = (app: FakeApp) => {
			open(app, "preview");
			open(app, "source");
		};
		const on = { version: 2, settings: { showInLinks: true } };

		// Turned on or updated while Obsidian runs: reading views only.
		await loadPlugin({ data: on, beforeLoad: openBoth });
		expect(views.map((view) => view.rerendered)).toEqual([1, 0]);

		// Not while the setting is off, and not at startup, where notes are rendered later.
		views.length = 0;
		await loadPlugin({ beforeLoad: openBoth });
		const startup = await loadPlugin({ data: on, layoutReady: false, beforeLoad: openBoth });
		startup.app.workspace.finishLayout();
		expect(views.map((view) => view.rerendered)).toEqual([0, 0, 0, 0]);
	});

	it("renders notes in reading view again when turned on or off, also right after installing", async () => {
		const views: MarkdownView[] = [];
		// Installed while notes are open, with the setting off: they were rendered without it.
		const harness = await loadPlugin({
			beforeLoad: (app: FakeApp) => {
				for (const mode of ["preview", "source"] as const) {
					const leaf = new WorkspaceLeaf(app.asApp);
					const view = new MarkdownView(leaf);
					view.mode = mode;
					leaf.view = view;
					app.workspace.leaves.push(leaf);
					views.push(view);
				}
			},
		});
		const rerendered = () => views.map((view) => view.rerendered);
		expect(rerendered()).toEqual([0, 0]);

		harness.plugin.updateSettings({ showInLinks: true });
		expect(rerendered()).toEqual([1, 0]);
		harness.plugin.updateSettings({ showInLinks: true });
		expect(rerendered()).toEqual([1, 0]);
		harness.plugin.updateSettings({ showInLinks: false });
		expect(rerendered()).toEqual([2, 0]);

		// Also when turned on on another device.
		harness.fake.dataJson = { version: 2, settings: { showInLinks: true } };
		await harness.plugin.onExternalSettingsChange();
		expect(rerendered()).toEqual([3, 0]);
	});
});

/** Clicks a button of the confirmation dialog that is currently open. */
async function answer(
	text: "Delete" | "Delete all" | "Remove" | "Cancel" | "Use it",
): Promise<void> {
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
	interface CustomPicker extends PickerLike {
		options: PickerLike["options"] & {
			custom: {
				list(): Promise<string[]>;
				upload(name: string, data: ArrayBuffer): Promise<string>;
			};
		};
	}

	/** A small PNG file (only the header matters to the fake decoder). */
	const png = (fill = 1) => {
		const file = new Uint8Array(64).fill(fill);
		file.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		return file.buffer;
	};
	const stored = (fill = 1) => ({
		type: "image/png",
		data: encodeBase64(new Uint8Array(png(fill))),
	});

	let revoked: MockInstance<(url: string) => void>;

	beforeEach(() => {
		// happy-dom can't decode images: every image is a 64 × 64 px picture.
		vi.spyOn(canvasCodec, "load").mockResolvedValue({
			width: 64,
			height: 64,
			resize: () => {
				throw new Error("not needed for small images");
			},
			dispose: () => undefined,
		});
		let next = 0;
		vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:icon-${++next}`);
		revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
	});

	afterEach(() => vi.restoreAllMocks());

	async function upload(
		harness: Awaited<ReturnType<typeof loadPlugin>>,
		name: string,
		data: ArrayBuffer,
	) {
		const file =
			harness.app.vault.getAbstractFileByPath("A.md") ?? harness.app.vault.add("A.md");
		harness.plugin.openPicker(file as never);
		const options = (picker() as CustomPicker).options;
		const id = await options.custom.upload(name, data);
		options.onSubmit(`custom:${id}`);
		await flush();
		return id;
	}

	it("stores uploads in data.json and uses them", async () => {
		const harness = await loadPlugin();
		expect(await upload(harness, "Logo.PNG", png())).toBe("Logo");
		const saved = harness.lastSaved()!;
		expect(saved.customIcons).toEqual({ Logo: stored() });
		expect(saved.icons).toEqual({ "A.md": "custom:Logo" });
		expect(saved.recent).toEqual(["custom:Logo"]);
		// Nothing is written outside data.json.
		expect(harness.app.vault.adapter.files.size).toBe(0);
	});

	it("reuses an icon uploaded twice and says so", async () => {
		const harness = await loadPlugin();
		await upload(harness, "logo.png", png());
		expect(await upload(harness, "logo (1).png", png())).toBe("logo");
		expect(notices).toContain('"logo (1).png" is already one of your icons, as "logo".');
		expect(Object.keys(harness.lastSaved()!.customIcons as object)).toEqual(["logo"]);
	});

	it("explains refused uploads", async () => {
		const harness = await loadPlugin();
		harness.fileMenu("A.md").item("Set note emoji").click();
		const options = (picker() as CustomPicker).options;
		await expect(options.custom.upload("notes.png", new ArrayBuffer(10))).rejects.toThrow(
			"is not a PNG, JPG, GIF, WebP, AVIF or SVG image",
		);
		expect(await options.custom.list()).toEqual([]);
	});

	it("explains when converting fails on this device", async () => {
		vi.spyOn(canvasCodec, "load").mockResolvedValue({
			width: 2000,
			height: 2000,
			resize: () => {
				throw new Error("No canvas available.");
			},
			dispose: () => undefined,
		});
		const harness = await loadPlugin();
		await expect(harness.plugin.uploadCustomIcon("big.png", png())).rejects.toThrow(
			'"big.png" could not be converted on this device.',
		);
	});

	it("deletes an icon after confirmation and forgets where it was used", async () => {
		const harness = await loadPlugin({
			data: {
				icons: { "A.md": "custom:logo", "B.md": "🚀" },
				recent: ["custom:logo"],
				customIcons: { logo: stored() },
			},
		});

		const cancelled = harness.plugin.deleteCustomIcon("logo");
		await flush();
		expect(openModals.at(-1)!.contentEl.textContent).toContain("1 item uses it");
		await answer("Cancel");
		expect(await cancelled).toBe(false);
		expect(harness.plugin.customIcons.list()).toEqual(["logo"]);

		const deleted = harness.plugin.deleteCustomIcon("logo");
		await flush();
		await answer("Delete");
		expect(await deleted).toBe(true);
		await flush();
		expect(harness.lastSaved()?.customIcons).toEqual({});
		expect(harness.lastSaved()?.icons).toEqual({ "B.md": "🚀" });
		expect(harness.lastSaved()?.recent).toEqual([]);
	});

	it("brings icons added on another device with sync", async () => {
		const harness = await loadPlugin({ data: { icons: { "A.md": "custom:logo" } } });
		expect(harness.plugin.customIcons.url("logo")).toBeUndefined();

		harness.fake.dataJson = {
			icons: { "A.md": "custom:logo" },
			customIcons: { logo: stored() },
		};
		await harness.plugin.onExternalSettingsChange();
		const first = harness.plugin.customIcons.url("logo");
		expect(first).toMatch(/^blob:/);

		// Replaced on the other device: a new image, the old one is freed.
		harness.fake.dataJson = {
			icons: { "A.md": "custom:logo" },
			customIcons: { logo: stored(2) },
		};
		await harness.plugin.onExternalSettingsChange();
		expect(revoked).toHaveBeenCalledWith(first);
		expect(harness.plugin.customIcons.url("logo")).not.toBe(first);
		expect(harness.fake.saved).toEqual([]);
	});

	it("frees the images on unload", async () => {
		const harness = await loadPlugin({ data: { customIcons: { logo: stored() } } });
		const url = harness.plugin.customIcons.url("logo");
		harness.unload();
		expect(revoked).toHaveBeenCalledWith(url);
	});

	describe("in the settings", () => {
		async function openSettings(data: unknown) {
			const harness = await loadPlugin({ data });
			settingsCreated.length = 0;
			harness.fake.settingTabs[0].display();
			await flush();
			const setting = (name: string) =>
				settingsCreated.find((entry) => entry.nameEl.textContent === name);
			const button = (name: string, text: string) =>
				setting(name)!.components.find(
					(entry): entry is ButtonComponent =>
						entry instanceof ButtonComponent && entry.buttonEl.textContent === text,
				)!;
			return { harness, setting, button };
		}

		const library = {
			icons: { "A.md": "custom:logo", "B.md": "custom:logo", Folder: "custom:gone" },
			customIcons: {
				logo: stored(1),
				spare: { type: "image/svg+xml", data: "PHN2Zz4=" },
			},
		};

		it("shows the storage used, the limit and why", async () => {
			const { setting } = await openSettings(library);
			const storage = setting("Storage")!.descEl.textContent;
			expect(storage).toContain("96 B of 3 MB used by 2 icons.");
			expect(storage).toContain("Obsidian Sync skips files larger than 5 MB");
			expect(storage).toContain("at least 50 icons");
		});

		it("lists every icon with a preview, format, size and uses", async () => {
			const { setting } = await openSettings(library);
			const logo = setting("logo")!;
			expect(logo.descEl.textContent).toBe("PNG · 88 B · Used 2 times");
			expect(logo.nameEl.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
			expect(setting("spare")!.descEl.textContent).toBe("SVG · 8 B · Not used");
		});

		it("deletes one icon after confirmation", async () => {
			const { harness, button } = await openSettings(library);
			void button("logo", "Delete").click();
			await flush();
			await answer("Delete");
			await flush();
			expect(harness.plugin.customIcons.list()).toEqual(["spare"]);
			expect(harness.lastSaved()?.icons).toEqual({ Folder: "custom:gone" });
		});

		it("deletes unused icons after confirmation", async () => {
			const { harness, button } = await openSettings(library);
			void button("Storage", "Delete 1 unused").click();
			await flush();
			expect(openModals.at(-1)!.contentEl.textContent).toContain("spare");
			await answer("Delete");
			expect(harness.plugin.customIcons.list()).toEqual(["logo"]);
		});

		it("keeps an unused icon that sync gives a use while the dialog is open", async () => {
			const { harness, button } = await openSettings(library);
			void button("Storage", "Delete 1 unused").click();
			await flush();
			const file = harness.app.vault.add("C.md") as TFile;
			harness.plugin.icons.setIcon(file as never, "custom:spare");
			await answer("Delete");
			expect(harness.plugin.customIcons.list()).toEqual(["logo", "spare"]);
			expect(harness.plugin.icons.get("C.md")).toBe("custom:spare");
		});

		it("shows new uses after removing emoji of missing files", async () => {
			const { button } = await openSettings(library);
			void button("Remove emoji of missing files", "Remove 3").click();
			await flush();
			await answer("Remove");
			const logo = settingsCreated
				.filter((entry) => entry.nameEl.textContent === "logo")
				.at(-1);
			expect(logo?.descEl.textContent).toBe("PNG · 88 B · Not used");
		});

		it("deletes all after confirmation", async () => {
			const { harness, button } = await openSettings(library);
			void button("Storage", "Delete all").click();
			await flush();
			await answer("Delete all");
			await flush();
			expect(harness.lastSaved()?.customIcons).toEqual({});
			expect(harness.lastSaved()?.icons).toEqual({});
		});

		it("explains icons that are used but missing, and removes them on request", async () => {
			const { harness, setting, button } = await openSettings(library);
			expect(setting("Missing icons")!.descEl.textContent).toContain(
				"1 item uses an icon that is no longer in your library (gone)",
			);
			void button("Missing icons", "Remove").click();
			await flush();
			await answer("Remove");
			expect(harness.lastSaved()?.icons).toEqual({
				"A.md": "custom:logo",
				"B.md": "custom:logo",
			});
		});

		it("doesn't count icons kept for a newer version as missing", async () => {
			const { harness, setting, button } = await openSettings({
				version: 2,
				icons: { "A.md": "custom:future", "B.md": "custom:logo" },
				customIcons: { logo: stored(1), future: { type: "image/jxl", data: "AAAA" } },
			});
			expect(setting("Missing icons")).toBeUndefined();
			void button("Storage", "Delete all").click();
			await flush();
			await answer("Delete all");
			await flush();
			expect(harness.lastSaved()?.icons).toEqual({ "A.md": "custom:future" });
			expect(harness.lastSaved()?.customIcons).toEqual({
				future: { type: "image/jxl", data: "AAAA" },
			});
		});

		it("invites to upload when there are none", async () => {
			const { setting, button } = await openSettings({});
			expect(setting("Storage")!.descEl.textContent).toContain("No custom icons yet.");
			expect(button("Storage", "Delete all").disabled).toBe(true);
			expect(setting("Missing icons")).toBeUndefined();
		});
	});
});

describe("Obsidian icons", () => {
	/** This device's copy of an icon, as stored in data.json. */
	const drawn = (name: string) => svgMarkup(getIcon(`lucide-${name}`)!);
	/** A copy made with another Obsidian version: same name, other drawing. */
	const other = (name: string) =>
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${name}</title></svg>`;

	let created: Blob[];
	let revoked: MockInstance<(url: string) => void>;

	beforeEach(() => {
		created = [];
		vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
			created.push(blob as Blob);
			return `blob:icon-${created.length}`;
		});
		revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		lineIcons.delete("rocket");
	});

	it("stores a picked icon with a copy of it, and remembers it as recently used", async () => {
		const harness = await loadPlugin();
		harness.fileMenu("A.md").item("Set note emoji").click();
		picker().options.onSubmit("lucide:star");
		await flush();
		const saved = harness.lastSaved()!;
		expect(saved.icons).toEqual({ "A.md": "lucide:star" });
		expect(saved.recent).toEqual(["lucide:star"]);
		expect(saved.libraryIcons).toEqual({ "lucide:star": drawn("star") });
		expect(harness.fake.saved).toHaveLength(1);
	});

	it("never replaces a copy, so devices with other Obsidian versions don't swap them", async () => {
		const harness = await loadPlugin({
			data: {
				version: 2,
				icons: { "A.md": "lucide:star" },
				libraryIcons: { "lucide:star": other("star") },
			},
		});
		expect(harness.fake.saved).toEqual([]);
		harness.fileMenu("B.md").item("Set note emoji").click();
		picker().options.onSubmit("lucide:star");
		await flush();
		expect(harness.lastSaved()?.libraryIcons).toEqual({ "lucide:star": other("star") });
	});

	it("drops unused copies and adds missing ones after loading, saved with the next change", async () => {
		const harness = await loadPlugin({
			data: {
				version: 2,
				icons: { "A.md": "lucide:star" },
				recent: ["lucide:arrow-right"],
				libraryIcons: { "lucide:shapes": other("shapes") },
			},
		});
		// Starting up never writes data.json just for this.
		expect(harness.fake.saved).toEqual([]);
		harness.plugin.updateSettings({ showInTabs: false });
		await flush();
		expect(harness.lastSaved()?.libraryIcons).toEqual({
			"lucide:star": drawn("star"),
			"lucide:arrow-right": drawn("arrow-right"),
		});
	});

	it("keeps copies this device can't make, and those of a newer version", async () => {
		const harness = await loadPlugin({
			data: {
				version: 2,
				icons: { "A.md": "lucide:rocket", "B.md": "lucide:sparkles" },
				// Used by a newer version in a place this one doesn't know.
				bookmarks: { "C.md": "lucide:star" },
				libraryIcons: {
					"lucide:rocket": other("rocket"),
					"lucide:star": other("star"),
					"phosphor:star": "<svg/>",
				},
			},
		});
		// Nothing to add (this Obsidian has no sparkles) and nothing to drop.
		expect(harness.fake.saved).toEqual([]);
		expect(harness.plugin.libraryIcons.url("rocket")).toMatch(/^blob:/);
		expect(await created.at(-1)!.text()).toBe(other("rocket"));
		expect(harness.plugin.libraryIcons.url("sparkles")).toBeUndefined();
	});

	it("keeps the copies in step with changes synced from other devices", async () => {
		const harness = await loadPlugin({
			data: {
				version: 2,
				icons: { "A.md": "lucide:star" },
				libraryIcons: { "lucide:star": other("star") },
			},
		});
		const url = harness.plugin.libraryIcons.url("star");

		// Another device replaced the icon, and (with an older build) brought no copy.
		harness.fake.dataJson = { version: 2, icons: { "A.md": "lucide:arrow-right" } };
		await harness.plugin.onExternalSettingsChange();
		await flush();
		// Not written back right away; the copy goes with the next change.
		expect(harness.fake.saved).toEqual([]);
		expect(revoked).toHaveBeenCalledWith(url);
		harness.plugin.updateSettings({ showInTabs: false });
		await flush();
		expect(harness.lastSaved()?.libraryIcons).toEqual({
			"lucide:arrow-right": drawn("arrow-right"),
		});

		// A copy that sync brings is used as it is.
		const saves = harness.fake.saved.length;
		harness.fake.dataJson = {
			version: 2,
			icons: { "A.md": "lucide:rocket" },
			libraryIcons: { "lucide:rocket": other("rocket") },
		};
		await harness.plugin.onExternalSettingsChange();
		await flush();
		expect(harness.fake.saved).toHaveLength(saves);
		harness.plugin.libraryIcons.url("rocket");
		expect(await created.at(-1)!.text()).toBe(other("rocket"));
	});

	it("changes nothing while the backup is shown in place of data.json, and catches up once it is there", async () => {
		const backup = JSON.stringify({
			version: 2,
			icons: { [ICONS_MARKER]: "", "A.md": "lucide:star" },
			libraryIcons: { "lucide:shapes": other("shapes") },
		});
		// data.json is not downloaded yet: the backup is shown, and nothing is saved.
		const harness = await loadPluginWith(await loadPlugin(), null, backup);
		expect(harness.plugin.icons.get("A.md")).toBe("lucide:star");
		expect(harness.fake.saved).toEqual([]);

		harness.fake.dataJson = { version: 2, icons: { "A.md": "lucide:star" } };
		await harness.plugin.onExternalSettingsChange();
		await flush();
		expect(harness.fake.saved).toEqual([]);
		harness.plugin.updateSettings({ showInTabs: false });
		await flush();
		expect(harness.lastSaved()?.libraryIcons).toEqual({ "lucide:star": drawn("star") });
	});

	it("drops a copy in the same save that removes its last use", async () => {
		const harness = await loadPlugin({
			files: ["A.md"],
			data: {
				version: 2,
				icons: { "A.md": "lucide:star" },
				libraryIcons: { "lucide:star": other("star") },
			},
		});
		harness
			.fileMenu("A.md")
			.items.find((item) => item.title === "Remove note emoji")!
			.click();
		await flush();
		expect(harness.fake.saved).toHaveLength(1);
		expect(harness.lastSaved()?.libraryIcons).toEqual({});
		// Nor is it counted in the storage anymore.
		expect(harness.plugin.libraryIcons.usage().count).toBe(0);
	});

	it("doesn't write data.json for a copy added after loading when sync brings another change", async () => {
		const harness = await loadPlugin({
			data: { version: 2, icons: { "A.md": "lucide:star" } },
		});
		// Another device changed something else, and the file still has no copy of star.
		harness.fake.dataJson = {
			version: 2,
			icons: { [ICONS_MARKER]: "", "A.md": "lucide:star", "B.md": "🚀" },
		};
		await harness.plugin.onExternalSettingsChange();
		await flush();
		expect(harness.plugin.icons.get("B.md")).toBe("🚀");
		expect(harness.fake.saved).toEqual([]);
		// The copy goes with the next change.
		harness.plugin.updateSettings({ showInTabs: false });
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ "A.md": "lucide:star", "B.md": "🚀" });
		expect(harness.lastSaved()?.libraryIcons).toEqual({ "lucide:star": drawn("star") });
	});

	it("shows the copy at the note title, in the text colour", async () => {
		lineIcons.set("rocket", '<path d="M4 20 20 4"/>');
		const harness = await loadPlugin({
			data: {
				version: 2,
				settings: { noteTitle: "above" },
				icons: { "A.md": "lucide:rocket" },
				libraryIcons: { "lucide:rocket": other("rocket") },
			},
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
		const mask = titleEl.previousElementSibling?.querySelector<HTMLElement>(".notemoji-mask");
		const url = /url\("(.*)"\)/.exec(
			mask?.style.getPropertyValue("--notemoji-image") ?? "",
		)?.[1];
		const blob = created[Number(url?.slice("blob:icon-".length)) - 1];
		// The copy, not this device's own drawing of the same name.
		expect(await blob.text()).toBe(other("rocket"));

		harness.unload();
		expect(revoked).toHaveBeenCalledWith(url);
	});

	it("counts the copies in the custom icons' storage", async () => {
		const harness = await loadPlugin({
			data: {
				version: 2,
				icons: { "A.md": "lucide:star", "B.md": "custom:logo" },
				libraryIcons: { "lucide:star": drawn("star") },
				customIcons: { logo: { type: "image/svg+xml", data: "PHN2Zz4=" } },
			},
		});
		settingsCreated.length = 0;
		harness.fake.settingTabs[0].display();
		const storage = settingsCreated.find((entry) => entry.nameEl.textContent === "Storage")!;
		const bytes = drawn("star").length + 8;
		expect(storage.descEl.textContent).toContain(
			`${bytes} B of 3 MB used by 2 icons, including 1 Obsidian icon.`,
		);
		expect(storage.descEl.textContent).toContain("saved as a small copy");
		// Only the custom icon is listed.
		expect(
			settingsCreated.filter((entry) => entry.settingEl.hasClass("notemoji-icon-row")),
		).toHaveLength(1);
	});
});

describe("emoji style", () => {
	const FONTS = ".obsidian/plugins/notemoji/fonts";
	const twemoji = findEmojiSet("twemoji")!;
	/** Bytes whose SHA-256 is mocked to the pinned checksum (or not). */
	const download = new Uint8Array([1, 2, 3]).buffer;

	beforeEach(() => {
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
		network.responses.clear();
		network.requests.length = 0;
	});

	function mockChecksum(hex: string) {
		const bytes = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
		vi.spyOn(crypto.subtle, "digest").mockResolvedValue(bytes.buffer);
	}

	/** Opens the settings and returns helpers for the emoji style section. */
	async function openSettings(harness: Awaited<ReturnType<typeof loadPlugin>>) {
		settingsCreated.length = 0;
		const tab = harness.fake.settingTabs[0];
		tab.display();
		await flush(10);
		const card = (id: string) =>
			tab.containerEl.querySelector<HTMLElement>(`.notemoji-style-card[data-style="${id}"]`)!;
		const action = (id: string, label: string) =>
			card(id).querySelector<HTMLElement>(`.notemoji-style-action[aria-label="${label}"]`);
		const caption = () =>
			tab.containerEl.querySelector(".notemoji-styles-caption")?.textContent ?? "";
		return { tab, card, action, caption };
	}

	it("shows a card with a preview for every style, in a sensible order", async () => {
		const harness = await loadPlugin();
		const { tab, card, caption } = await openSettings(harness);
		const cards = Array.from(
			tab.containerEl.querySelectorAll<HTMLElement>(".notemoji-style-card"),
		);
		expect(cards.map((el) => el.dataset.style)).toEqual([
			"system",
			"twemoji",
			"openmoji",
			"noto-color",
			"noto-mono",
			"file",
		]);
		expect(card("system").getAttribute("aria-checked")).toBe("true");
		for (const id of ["twemoji", "openmoji", "noto-color", "noto-mono"]) {
			expect(card(id).querySelector("img")?.getAttribute("src")).toMatch(
				/^data:image\/png;base64,/,
			);
		}
		expect(card("noto-mono").querySelector("img")!.hasClass("is-monochrome")).toBe(true);
		expect(card("twemoji").textContent).toContain("1.4 MB");
		// No tooltips: Obsidian shows one for every labelled or titled element.
		expect(tab.containerEl.querySelector(".notemoji-styles")!.hasAttribute("aria-label")).toBe(
			false,
		);
		expect(card("twemoji").hasAttribute("title")).toBe(false);
		expect(caption()).toContain("Your device's own emoji");
	});

	it("downloads a set from its card (only on click) and selects it", async () => {
		const harness = await loadPlugin();
		let settings = await openSettings(harness);
		expect(network.requests).toEqual([]);
		expect(settings.action("twemoji", "Download")).not.toBeNull();

		network.responses.set(twemoji.url, download);
		mockChecksum(twemoji.sha256);
		settings.action("twemoji", "Download")!.click();
		await flush(20);
		expect(network.requests).toEqual([twemoji.url]);
		expect(harness.app.vault.adapter.files.has(`${FONTS}/twemoji.ttf`)).toBe(true);
		expect(harness.lastSaved()?.settings).toMatchObject({ emojiStyle: "twemoji" });
		expect(document.body.hasClass("notemoji-custom-font")).toBe(true);
		expect(settings.card("twemoji").hasClass("is-selected")).toBe(true);
		expect(settings.card("twemoji").textContent).toContain("Downloaded");
		expect(settings.action("twemoji", "Download")).toBeNull();

		// Switching to another downloaded or built-in style needs no network.
		settings.card("system").click();
		await flush(20);
		expect(harness.lastSaved()?.settings).toMatchObject({ emojiStyle: "system" });
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
		settings = await openSettings(harness);
		settings.card("twemoji").click();
		await flush(20);
		expect(document.body.hasClass("notemoji-custom-font")).toBe(true);
		expect(network.requests).toHaveLength(1);
	});

	it("clicking a card that is not downloaded downloads it too", async () => {
		const harness = await loadPlugin();
		const settings = await openSettings(harness);
		network.responses.set(twemoji.url, download);
		mockChecksum(twemoji.sha256);
		settings.card("twemoji").click();
		await flush(20);
		expect(network.requests).toEqual([twemoji.url]);
		expect(harness.lastSaved()?.settings).toMatchObject({ emojiStyle: "twemoji" });
	});

	it("keeps the current style when a download fails", async () => {
		const harness = await loadPlugin();
		const settings = await openSettings(harness);
		settings.action("twemoji", "Download")!.click();
		await flush(20);
		expect(notices.at(-1)).toMatch(/Could not download Twemoji/);
		expect(settings.card("system").hasClass("is-selected")).toBe(true);
		expect(harness.app.vault.adapter.files.size).toBe(0);
	});

	it("refuses a download that is not the pinned file", async () => {
		const harness = await loadPlugin({ data: { settings: { emojiStyle: "twemoji" } } });
		network.responses.set(twemoji.url, download);
		mockChecksum("0".repeat(64));
		await expect(harness.plugin.style.download(twemoji)).rejects.toThrow(
			/not the expected file/,
		);
		expect(harness.app.vault.adapter.files.size).toBe(0);
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
	});

	it("deletes a download from its card; deleting the active one switches to system emoji", async () => {
		const harness = await loadPlugin({ data: { settings: { emojiStyle: "twemoji" } } });
		harness.app.vault.adapter.files.set(`${FONTS}/twemoji.ttf`, new ArrayBuffer(2048));
		const settings = await openSettings(harness);
		settings.action("twemoji", "Delete download")!.click();
		await flush(20);
		expect(harness.app.vault.adapter.files.size).toBe(0);
		expect(harness.lastSaved()?.settings).toMatchObject({ emojiStyle: "system" });
		expect(settings.card("system").hasClass("is-selected")).toBe(true);
	});

	it("installs and removes an own font file from its card", async () => {
		const harness = await loadPlugin();
		await harness.plugin.style.installOwn("Mine.ttf", new Uint8Array(8).buffer);
		expect(harness.lastSaved()?.settings).toMatchObject({
			emojiStyle: "file",
			emojiFont: "Mine.ttf",
		});
		expect(document.body.hasClass("notemoji-custom-font")).toBe(true);

		const settings = await openSettings(harness);
		expect(settings.card("file").querySelector(".notemoji-style-sample.is-own")).not.toBeNull();
		expect(settings.action("file", "Change font")).not.toBeNull();
		settings.action("file", "Remove font")!.click();
		await flush(20);
		expect(harness.lastSaved()?.settings).toMatchObject({
			emojiStyle: "system",
			emojiFont: "",
		});
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
	});

	it("selects with the keyboard", async () => {
		const harness = await loadPlugin();
		harness.app.vault.adapter.files.set(`${FONTS}/openmoji.woff2`, new ArrayBuffer(8));
		const settings = await openSettings(harness);
		settings
			.card("openmoji")
			.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
		await flush(20);
		expect(harness.lastSaved()?.settings).toMatchObject({ emojiStyle: "openmoji" });
	});

	it("asks before using a very large font file", async () => {
		const harness = await loadPlugin({ data: { settings: { emojiStyle: "file" } } });
		const settings = await openSettings(harness);
		const input =
			settings.tab.containerEl.querySelector<HTMLInputElement>('input[type="file"]')!;
		const huge = {
			name: "Huge.ttf",
			size: 250 * 1024 * 1024,
			arrayBuffer: () => Promise.resolve(new Uint8Array(8).buffer),
		};
		Object.defineProperty(input, "files", { value: [huge], configurable: true });
		input.dispatchEvent(new Event("change"));
		await flush(10);
		expect(openModals.at(-1)!.contentEl.textContent).toContain("250 MB");
		await answer("Cancel");
		expect(harness.app.vault.adapter.files.size).toBe(0);

		input.dispatchEvent(new Event("change"));
		await flush(10);
		await answer("Use it");
		await flush(10);
		expect(harness.app.vault.adapter.files.has(`${FONTS}/own/Huge.ttf`)).toBe(true);
	});

	it("unload removes the font everywhere", async () => {
		const harness = await loadPlugin();
		await harness.plugin.style.installOwn("Mine.ttf", new Uint8Array(8).buffer);
		harness.unload();
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
	});

	it("drops a font that is still loading when the plugin unloads", async () => {
		const loads: Array<() => void> = [];
		vi.stubGlobal(
			"FontFace",
			class {
				load() {
					return new Promise((resolve) => loads.push(() => resolve(this)));
				}
			},
		);
		const harness = await loadPlugin({
			data: { settings: { emojiStyle: "twemoji" } },
			adapterFiles: new Map([[`${FONTS}/${twemoji.file}`, download]]),
		});
		const rebuild = vi
			.spyOn(harness.plugin.style.sprites, "rebuild")
			.mockImplementation(() => undefined);
		harness.plugin.style.warmUp();
		await flush(10);
		expect(loads).toHaveLength(1);
		harness.unload();
		loads[0]();
		await flush(10);
		expect(document.body.hasClass("notemoji-custom-font")).toBe(false);
		// Nor are the picker's images prepared again for it.
		expect(rebuild).toHaveBeenCalledTimes(1);
	});
});

it("gives the settings tab a colourful emoji icon", async () => {
	const harness = await loadPlugin();
	expect((harness.fake.settingTabs[0] as unknown as { icon: string }).icon).toBe(
		"notemoji-emoji",
	);
});

describe("picker image cache", () => {
	const CACHE = ".obsidian/plugins/notemoji/cache/sprites";

	it("deleting a style removes its cached images", async () => {
		const harness = await loadPlugin();
		const adapter = harness.app.vault.adapter;
		adapter.files.set(".obsidian/plugins/notemoji/fonts/twemoji.ttf", new ArrayBuffer(8));
		adapter.files.set(`${CACHE}/twemoji/windows-1x-f1-x/smileys.png`, new ArrayBuffer(8));
		adapter.files.set(`${CACHE}/system/windows-1x-f1-x/smileys.png`, new ArrayBuffer(8));
		await harness.plugin.style.deleteSet(findEmojiSet("twemoji")!);
		expect([...adapter.files.keys()]).toEqual([`${CACHE}/system/windows-1x-f1-x/smileys.png`]);
	});

	it("shows the cache size in the settings and clears it", async () => {
		const harness = await loadPlugin();
		harness.app.vault.adapter.files.set(
			`${CACHE}/system/windows-1x-f1-x/smileys.png`,
			new ArrayBuffer(3 * 1024),
		);
		settingsCreated.length = 0;
		harness.fake.settingTabs[0].display();
		await flush(10);
		const setting = settingsCreated.find(
			(entry) => entry.nameEl.textContent === "Picker image cache",
		)!;
		expect(setting.descEl.textContent).toContain("3 KB");
		await (setting.components[0] as ButtonComponent).click();
		expect(harness.app.vault.adapter.files.size).toBe(0);
	});
});

describe("picker preparation", () => {
	it("prepares the picker after startup, also while the workspace keeps changing", async () => {
		vi.useFakeTimers();
		try {
			const loading = loadPlugin({ files: ["A.md"] });
			await vi.advanceTimersByTimeAsync(0);
			const harness = await loading;
			const rebuild = vi
				.spyOn(harness.plugin.style.sprites, "rebuild")
				.mockImplementation(() => undefined);
			// Opening notes and switching tabs right after startup.
			for (let i = 0; i < 6; i++) {
				harness.app.workspace.trigger("active-leaf-change");
				harness.app.workspace.trigger("layout-change");
				await vi.advanceTimersByTimeAsync(500);
			}
			expect(rebuild).toHaveBeenCalledTimes(1);

			// Opening the picker later does not prepare it again.
			harness.plugin.openPicker(harness.app.vault.getAbstractFileByPath("A.md") as never);
			expect(rebuild).toHaveBeenCalledTimes(1);
			harness.unload();
		} finally {
			vi.useRealTimers();
		}
	});
});
