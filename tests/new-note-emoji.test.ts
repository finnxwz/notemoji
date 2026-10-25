import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ICONS_MARKER } from "../src/data";
import { splitEmoji } from "../src/icons/auto-emoji";
import { FRIENDLY_EMOJI, THEMES } from "../src/icons/auto-emoji-themes";
import { flush } from "./fake-app";
import {
	openModals,
	setApiVersion,
	setLanguage,
	settingsCreated,
	TFile,
	ToggleComponent,
} from "./obsidian";
import { HarnessOptions, loadPlugin } from "./plugin-harness";

type Harness = Awaited<ReturnType<typeof loadPlugin>>;

const ON = { settings: { autoEmoji: true } };
const firstFriendly = splitEmoji(FRIENDLY_EMOJI)[0];

function theme(id: string): string[] {
	return splitEmoji(THEMES.find((entry) => entry.id === id)?.emoji ?? "");
}

/** Makes a note like "New note" does: Obsidian creates it, then opens it. */
async function newNote(harness: Harness, path: string): Promise<TFile> {
	const file = harness.app.vault.create(path) as TFile;
	harness.app.workspace.openFile(file);
	await flush();
	return file;
}

/** Picks an emoji for the note in the picker, as the user does. */
function choose(harness: Harness, file: TFile, emoji: string): void {
	const action = harness.plugin.icons.get(file.path) === undefined ? "Set" : "Change";
	harness.fileMenu(file).item(`${action} note emoji`).click();
	(
		openModals.at(-1) as unknown as { options: { onSubmit(emoji: string): void } }
	).options.onSubmit(emoji);
}

function load(options: HarnessOptions = {}) {
	return loadPlugin({ data: ON, ...options });
}

/** Lets time pass for Notemoji's clock (`Date.now`). */
function wait(ms: number): void {
	vi.setSystemTime(Date.now() + ms);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 24, 12));
	// The first emoji among the least used, so picks are predictable.
	vi.spyOn(Math, "random").mockReturnValue(0);
	settingsCreated.length = 0;
	for (const modal of [...openModals]) modal.close();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	setLanguage("en");
	setApiVersion("1.7.2");
});

describe("automatic emoji for new notes", () => {
	it("is off by default", async () => {
		const harness = await loadPlugin();
		await newNote(harness, "Pizza night.md");
		expect(harness.plugin.icons.get("Pizza night.md")).toBeUndefined();
		expect(harness.fake.saved).toEqual([]);
	});

	it("gives a note made on this device an emoji, without adding it to the recent list", async () => {
		const harness = await load();
		await newNote(harness, "Pizza night.md");
		expect(harness.lastSaved()?.icons).toEqual({ "Pizza night.md": "🍕" });
		expect(harness.lastSaved()?.recent).toEqual([]);
		expect(harness.plugin.icons.recent).toEqual([]);
	});

	it("also when the note is already open when Obsidian reports it", async () => {
		const harness = await load();
		const file = harness.app.vault.add("Pizza.md") as TFile;
		harness.app.workspace.activeFile = file;
		harness.app.vault.trigger("create", file);
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});

	it("leaves notes alone that are not opened right away (sync, imports)", async () => {
		const harness = await load();
		const synced = harness.app.vault.create("Synced pizza.md") as TFile;
		const late = harness.app.vault.create("Late pizza.md") as TFile;
		wait(6000);
		harness.app.workspace.openFile(late);
		await flush();
		harness.app.workspace.openFile(synced);
		await flush();
		expect(harness.fake.saved).toEqual([]);
	});

	it("waits while data.json isn't there or can't be saved over", async () => {
		// Not downloaded yet: the backup on this device stands in, and nothing may be saved.
		const backup = JSON.stringify({ version: 2, ...ON, icons: { [ICONS_MARKER]: "" } });
		const path = ".obsidian/plugins/notemoji/backup.json";
		const waiting = await loadPlugin({
			adapterFiles: new Map([[path, new TextEncoder().encode(backup).buffer]]),
		});
		expect(waiting.plugin.settings.autoEmoji).toBe(true);
		await newNote(waiting, "Pizza.md");
		expect(waiting.plugin.icons.get("Pizza.md")).toBeUndefined();
		expect(waiting.fake.saved).toEqual([]);

		// Written by a newer version.
		const newer = await loadPlugin({ data: { version: 3, ...ON } });
		await newNote(newer, "Pizza.md");
		expect(newer.plugin.icons.get("Pizza.md")).toBeUndefined();
	});

	it("waits while sync has deleted data.json", async () => {
		const harness = await load();
		harness.fake.dataJson = null;
		await harness.plugin.onExternalSettingsChange();
		await newNote(harness, "Pizza.md");
		expect(harness.plugin.icons.get("Pizza.md")).toBeUndefined();
		expect(harness.fake.saved).toEqual([]);

		harness.fake.dataJson = { version: 2, ...ON };
		await harness.plugin.onExternalSettingsChange();
		await newNote(harness, "Pizza night.md");
		expect(harness.plugin.icons.get("Pizza night.md")).toBe("🍕");
	});

	it("is only for notes", async () => {
		const harness = await load();
		await newNote(harness, "Board.canvas");
		await newNote(harness, "Pizza.png");
		harness.app.vault.create("Pizza");
		await flush();
		expect(harness.fake.saved).toEqual([]);
	});

	it("ignores the files Obsidian reports while it starts", async () => {
		const harness = await load({ layoutReady: false });
		await newNote(harness, "Existing pizza.md");
		harness.app.workspace.finishLayout();
		harness.app.workspace.openFile(harness.app.vault.getFileByPath("Existing pizza.md")!);
		await flush();
		expect(harness.fake.saved).toEqual([]);

		await newNote(harness, "New pizza.md");
		expect(harness.lastSaved()?.icons).toEqual({ "New pizza.md": "🍕" });
	});

	it("keeps an emoji stored for a note made with its name (a restore, or sync)", async () => {
		const harness = await load({ data: { ...ON, icons: { "Pizza.md": "🚀" } } });
		await newNote(harness, "Pizza.md");
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🚀");
		expect(harness.fake.saved).toEqual([]);
	});

	it("stops when it is turned off", async () => {
		const harness = await load();
		harness.plugin.updateSettings({ autoEmoji: false });
		await newNote(harness, "Pizza.md");
		expect(harness.plugin.icons.get("Pizza.md")).toBeUndefined();
	});

	it("gives none to a note renamed to another kind of file before it is opened", async () => {
		const harness = await load();
		harness.app.vault.create("Pizza.md");
		const file = harness.app.vault.rename("Pizza.md", "Pizza.txt") as TFile;
		harness.app.workspace.openFile(file);
		await flush();
		expect(harness.fake.saved).toEqual([]);
	});

	it("follows a rename before the note is opened", async () => {
		const harness = await load();
		harness.app.vault.create("Untitled.md");
		const file = harness.app.vault.rename("Untitled.md", "Pizza.md") as TFile;
		harness.app.workspace.openFile(file);
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});

	it("gives a theme word one of the theme's emoji", async () => {
		const harness = await load();
		await newNote(harness, "Trip to Rome.md");
		expect(harness.plugin.icons.get("Trip to Rome.md")).toBe(theme("travel")[0]);
	});
});

describe("the language Obsidian runs in", () => {
	it("adds its words to the English ones", async () => {
		setApiVersion("1.8.7");
		setLanguage("de");
		const harness = await load();
		await newNote(harness, "Zahnarzttermin.md");
		await newNote(harness, "Pizza night.md");
		expect(harness.plugin.icons.get("Zahnarzttermin.md")).toBe("🦷");
		expect(harness.plugin.icons.get("Pizza night.md")).toBe("🍕");
	});

	it("is unknown before Obsidian 1.8.7: English only", async () => {
		setLanguage("de");
		const harness = await load();
		await newNote(harness, "Zahnarzttermin.md");
		expect(harness.plugin.icons.get("Zahnarzttermin.md")).toBe(firstFriendly);
	});
});

describe("an untitled note that gets its name", () => {
	it("gets no emoji until it has a name, then one that fits it", async () => {
		const harness = await load();
		await newNote(harness, "Untitled.md");
		expect(harness.plugin.icons.get("Untitled.md")).toBeUndefined();
		expect(harness.fake.saved).toEqual([]);

		harness.app.vault.rename("Untitled.md", "Pizza night.md");
		await flush();
		expect(harness.lastSaved()?.icons).toEqual({ "Pizza night.md": "🍕" });
		expect(harness.lastSaved()?.recent).toEqual([]);
	});

	it("gets one that suits any note when the name fits nothing", async () => {
		const harness = await load();
		await newNote(harness, "Untitled.md");
		harness.app.vault.rename("Untitled.md", "Q3 summary.md");
		await flush();
		expect(harness.plugin.icons.get("Q3 summary.md")).toBe(firstFriendly);
	});

	it("knows Obsidian's name for new notes in other languages, also numbered", async () => {
		const harness = await load();
		for (const name of ["Untitled 2", "Unbenannt", "Sans titre 3", "未命名"]) {
			await newNote(harness, `${name}.md`);
			expect(harness.plugin.icons.get(`${name}.md`), name).toBeUndefined();
		}
		harness.app.vault.rename("Unbenannt.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});

	it("keeps waiting while only its folder changes", async () => {
		const harness = await load({ files: ["Stuff"] });
		await newNote(harness, "Stuff/Untitled.md");
		harness.app.vault.rename("Stuff", "Travel");
		await flush();
		expect(harness.plugin.icons.get("Travel/Untitled.md")).toBeUndefined();
		harness.app.vault.rename("Travel/Untitled.md", "Travel/Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Travel/Pizza.md")).toBe("🍕");
	});

	it("doesn't take over an emoji left at 'Untitled' by a deleted note", async () => {
		const harness = await load({ data: { ...ON, icons: { "Untitled.md": "🦁" } } });
		await newNote(harness, "Untitled.md");
		expect(harness.plugin.icons.get("Untitled.md")).toBeUndefined();
		harness.app.vault.rename("Untitled.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});

	it("doesn't take over an emoji left at its new name by a deleted note", async () => {
		const harness = await load({ data: { ...ON, icons: { "Pizza.md": "🦁" } } });
		await newNote(harness, "Untitled.md");
		harness.app.vault.rename("Untitled.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});

	it("also when it gets its name later", async () => {
		const harness = await load();
		await newNote(harness, "Untitled.md");
		wait(30 * 60 * 1000);
		harness.app.vault.rename("Untitled.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});

	it("keeps an emoji the user chose while it was untitled", async () => {
		const harness = await load();
		const file = await newNote(harness, "Untitled.md");
		choose(harness, file, "🚀");
		harness.app.vault.rename("Untitled.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🚀");
	});

	it("gets none when turned off before it has a name", async () => {
		const harness = await load();
		await newNote(harness, "Untitled.md");
		harness.plugin.updateSettings({ autoEmoji: false });
		harness.app.vault.rename("Untitled.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBeUndefined();
	});
});

describe("a renamed note soon after its automatic emoji", () => {
	it("gets an emoji that fits a new name instead of a friendly one", async () => {
		const harness = await load();
		await newNote(harness, "Q3 summary.md");
		expect(harness.plugin.icons.get("Q3 summary.md")).toBe(firstFriendly);
		harness.app.vault.rename("Q3 summary.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});

	it("only within a few minutes", async () => {
		const harness = await load();
		await newNote(harness, "Q3 summary.md");
		wait(6 * 60 * 1000);
		harness.app.vault.rename("Q3 summary.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe(firstFriendly);
	});

	it("keeps an emoji that already fit its name", async () => {
		const harness = await load();
		await newNote(harness, "Trip.md");
		harness.app.vault.rename("Trip.md", "Coffee.md");
		await flush();
		expect(harness.plugin.icons.get("Coffee.md")).toBe(theme("travel")[0]);
	});

	it("keeps the automatic emoji once the user chose it too", async () => {
		const harness = await load();
		const file = await newNote(harness, "Q3 summary.md");
		choose(harness, file, firstFriendly);
		harness.app.vault.rename("Q3 summary.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBe(firstFriendly);
	});

	it("gets none back once the user removed it", async () => {
		const harness = await load();
		const file = await newNote(harness, "Q3 summary.md");
		harness.fileMenu(file).item("Remove note emoji").click();
		harness.app.vault.rename("Q3 summary.md", "Pizza.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza.md")).toBeUndefined();
	});

	it("also at the path of a deleted note that had one", async () => {
		const harness = await load();
		await newNote(harness, "Q3 summary.md");
		// Deletes never touch data.json, so the deleted note's emoji is still stored for the path.
		harness.app.vault.remove("Q3 summary.md");
		await newNote(harness, "Q3 summary.md");
		harness.app.vault.rename("Q3 summary.md", "Pizza night.md");
		await flush();
		expect(harness.plugin.icons.get("Pizza night.md")).toBe("🍕");
	});
});

describe("the setting", () => {
	it("is a toggle that saves", async () => {
		const harness = await loadPlugin();
		harness.fake.settingTabs[0].display();
		const setting = settingsCreated.find(
			(entry) => entry.nameEl.textContent === "Automatic emoji for new notes",
		);
		const toggle = setting?.components[0] as ToggleComponent;
		expect(toggle.getValue()).toBe(false);
		toggle.change(true);
		await flush();
		expect(harness.lastSaved()?.settings).toMatchObject({ autoEmoji: true });

		await newNote(harness, "Pizza.md");
		expect(harness.plugin.icons.get("Pizza.md")).toBe("🍕");
	});
});
