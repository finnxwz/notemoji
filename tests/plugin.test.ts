import { describe, expect, it } from "vitest";
import { flush } from "./fake-app";
import { notices, openModals, TFolder } from "./obsidian";
import { loadPlugin } from "./plugin-harness";

interface PickerLike {
	options: {
		title: string;
		description?: string;
		current: string;
		onSubmit: (emoji: string) => void;
	};
}

function lastModal(): PickerLike {
	const modal = openModals.at(-1);
	if (!modal) throw new Error("No modal open");
	return modal as unknown as PickerLike;
}

describe("loading", () => {
	it("registers both commands", async () => {
		const { fake } = await loadPlugin();
		expect(fake.commands.map((command) => command.id)).toEqual([
			"set-emoji-active-note",
			"remove-emoji-active-note",
		]);
	});

	it("survives missing and malformed data", async () => {
		for (const data of [null, undefined, "garbage", 42, [], {}, { icons: 7 }]) {
			const { unload } = await loadPlugin({ data });
			unload();
		}
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

	it("set opens the picker and stores the emoji", async () => {
		const harness = await loadPlugin({ activeFile: "Notes/A.md" });
		harness.command("set-emoji-active-note").checkCallback?.(false);
		const modal = lastModal();
		expect(modal.options.current).toBe("");
		modal.options.onSubmit("🚀");
		await flush();
		expect(harness.lastSaved()).toEqual({ version: 1, icons: { "Notes/A.md": "🚀" } });
	});

	it("remove is only offered when there is an emoji", async () => {
		const harness = await loadPlugin({
			activeFile: "A.md",
			data: { version: 1, icons: { "A.md": "🎉" } },
		});
		const remove = harness.command("remove-emoji-active-note");
		expect(remove.checkCallback?.(true)).toBe(true);
		remove.checkCallback?.(false);
		await flush();
		expect(harness.lastSaved()).toEqual({ version: 1, icons: {} });
		expect(remove.checkCallback?.(true)).toBe(false);
		expect(notices).toEqual([]);
	});
});

describe("context menu", () => {
	it("offers set, then change and remove", async () => {
		const harness = await loadPlugin();
		const folder = harness.app.vault.add("Projects") as TFolder;

		const empty = harness.fileMenu(folder);
		expect(empty.titles()).toEqual(["Set folder emoji"]);
		empty.item("Set folder emoji").click();
		lastModal().options.onSubmit("📁");
		await flush();

		const filled = harness.fileMenu(folder);
		expect(filled.titles()).toEqual(["Change folder emoji", "Remove folder emoji"]);
		filled.item("Remove folder emoji").click();
		await flush();
		expect(harness.lastSaved()).toEqual({ version: 1, icons: {} });
	});

	it("uses note and file wording", async () => {
		const harness = await loadPlugin();
		expect(harness.fileMenu("A.md").titles()).toEqual(["Set note emoji"]);
		expect(harness.fileMenu("image.png").titles()).toEqual(["Set file emoji"]);
	});
});

describe("vault events", () => {
	it("moves emoji when a folder is renamed", async () => {
		const harness = await loadPlugin({
			files: ["Projects/A.md", "Other"],
			data: { version: 1, icons: { Projects: "📁", "Projects/A.md": "🚀", Other: "🎉" } },
		});
		harness.app.vault.rename("Projects", "Work");
		await flush();
		expect(harness.lastSaved()).toEqual({
			version: 1,
			icons: { Work: "📁", "Work/A.md": "🚀", Other: "🎉" },
		});
	});
});
