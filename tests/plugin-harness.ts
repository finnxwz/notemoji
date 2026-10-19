/**
 * Loads the real plugin class (src/main.ts) against the fake app, like
 * Obsidian does, and offers shortcuts for driving it from tests.
 */
import type { PluginManifest } from "obsidian";
import NotemojiPlugin from "../src/main";
import { createFakeApp, FakeAppOptions, flush } from "./fake-app";
import { Menu, Plugin as FakePlugin, TAbstractFile } from "./obsidian";

export interface HarnessOptions extends FakeAppOptions {
	/** Contents of data.json before the plugin loads. */
	data?: unknown;
}

export async function loadPlugin(options: HarnessOptions = {}) {
	const app = createFakeApp(options);
	const plugin = new NotemojiPlugin(app.asApp, {
		id: "notemoji",
		version: "test",
		dir: ".obsidian/plugins/notemoji",
	} as PluginManifest);
	const fake = plugin as unknown as FakePlugin;
	fake.dataJson = structuredClone(options.data ?? null);
	fake.load();
	await flush();

	return {
		app,
		plugin,
		fake,
		/** The most recently saved data.json. */
		lastSaved: () => fake.saved.at(-1) as Record<string, unknown> | undefined,
		command(id: string) {
			const command = fake.commands.find((entry) => entry.id === id);
			if (!command) throw new Error(`No command ${id}`);
			return command;
		},
		/** The context menu Obsidian would show for `file`. */
		fileMenu(file: TAbstractFile | string, source = "file-explorer") {
			const item = typeof file === "string" ? app.vault.add(file) : file;
			const menu = new Menu();
			app.workspace.trigger("file-menu", menu, item, source);
			return menu;
		},
		unload: () => fake.unload(),
	};
}
