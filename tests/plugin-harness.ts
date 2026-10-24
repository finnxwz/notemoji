/**
 * Loads the real plugin class (src/main.ts) against the fake app, like
 * Obsidian does, and offers shortcuts for driving it from tests.
 */
import type { PluginManifest } from "obsidian";
import { ICONS_MARKER } from "../src/data";
import NotemojiPlugin from "../src/main";
import { createFakeApp, FakeAppOptions, flush } from "./fake-app";
import { Menu, Plugin as FakePlugin, TAbstractFile } from "./obsidian";

export interface HarnessOptions extends FakeAppOptions {
	/** Contents of data.json before the plugin loads. */
	data?: unknown;
	/** data.json exists but is not valid JSON. */
	damaged?: boolean;
	/** Files already on the device (e.g. from an earlier run), by path. */
	adapterFiles?: ReadonlyMap<string, ArrayBuffer>;
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
	for (const [path, data] of options.adapterFiles ?? []) app.vault.adapter.files.set(path, data);
	if (options.damaged) {
		app.vault.adapter.files.set(
			".obsidian/plugins/notemoji/data.json",
			new TextEncoder().encode('{"version": 2, "icons": {"A.md": "').buffer,
		);
	}
	// Fixtures written as version 2 count as saved by this version (see ICONS_MARKER).
	const load = fake.loadData.bind(fake);
	fake.loadData = async () => withMarker(await load());
	fake.load();
	await flush();

	return {
		app,
		plugin,
		fake,
		/** The most recently saved data.json, without the version 2 marker in `icons`. */
		lastSaved: () => withoutMarker(fake.saved.at(-1)),
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withMarker(data: unknown): unknown {
	if (!isRecord(data) || data.version !== 2 || !isRecord(data.icons)) return data;
	return { ...data, icons: { [ICONS_MARKER]: "", ...data.icons } };
}

function withoutMarker(data: unknown): Record<string, unknown> | undefined {
	if (!isRecord(data)) return undefined;
	if (!isRecord(data.icons)) return data;
	const icons = { ...data.icons };
	delete icons[ICONS_MARKER];
	return { ...data, icons };
}
