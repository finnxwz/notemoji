/**
 * Plugin load smoke test.
 *
 * Loads the built `main.js` exactly like Obsidian does (CommonJS module with
 * `require("obsidian")`), but with a stubbed Obsidian API, then drives the real
 * plugin lifecycle: onload, commands, context menu, vault events, persistence
 * and onunload.
 *
 * Run with `npm run test:plugin` (requires `npm run build` first).
 */
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mainPath = path.join(root, "main.js");
const require = createRequire(import.meta.url);

// Minimal browser globals the plugin touches outside of the DOM tree.
globalThis.window = globalThis;
globalThis.MutationObserver ??= class {
	observe() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
};

// ------------------------------------------------------------------ Obsidian stub

class TFileStub {
	constructor(path) {
		this.path = path;
		const slash = path.lastIndexOf("/");
		this.name = slash >= 0 ? path.slice(slash + 1) : path;
		const dot = this.name.lastIndexOf(".");
		this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
	}
}

class TFolderStub {
	constructor(path) {
		this.path = path;
		const slash = path.lastIndexOf("/");
		this.name = slash >= 0 ? path.slice(slash + 1) : path;
	}
}

class MenuItemStub {
	constructor() {
		this.title = "";
		this.icon = "";
		this.clickHandler = null;
	}
	setTitle(title) {
		this.title = title;
		return this;
	}
	setIcon(icon) {
		this.icon = icon;
		return this;
	}
	onClick(handler) {
		this.clickHandler = handler;
		return this;
	}
}

class MenuStub {
	constructor() {
		this.items = [];
	}
	addItem(callback) {
		const item = new MenuItemStub();
		callback(item);
		this.items.push(item);
		return this;
	}
	titles() {
		return this.items.map((item) => item.title);
	}
}

class PluginStub {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest;
		this.commands = [];
		this.eventRefs = [];
		this.cleanups = [];
	}
	addCommand(command) {
		this.commands.push(command);
		return command;
	}
	addSettingTab() {}
	registerEvent(ref) {
		this.eventRefs.push(ref);
	}
	register(callback) {
		this.cleanups.push(callback);
	}
	registerInterval() {}
	async loadData() {
		return this.__dataToLoad ?? null;
	}
	async saveData(data) {
		this.__saved.push(structuredClone(data));
	}
}

/**
 * Creates a fresh stub environment: fake app, capture arrays for notices/modals
 * and a loader that returns the plugin class from the real `main.js`.
 */
function createHarness(options = {}) {
	const notices = [];
	const modals = [];
	const workspaceHandlers = new Map();
	const vaultHandlers = new Map();
	// By default every path is assumed to exist in the vault; tests for
	// stale-path cleanup pass an explicit set of surviving paths.
	const knownPaths = options.knownPaths ?? null;

	const obsidian = {
		Plugin: PluginStub,
		Modal: class {
			constructor(app) {
				this.app = app;
				this.isOpen = false;
				modals.push(this);
			}
			open() {
				this.isOpen = true;
			}
			close() {
				this.isOpen = false;
			}
		},
		Notice: class {
			constructor(message) {
				notices.push(message);
			}
		},
		TFile: TFileStub,
		TFolder: TFolderStub,
		Menu: MenuStub,
	};

	const app = {
		workspace: {
			on(name, callback) {
				const list = workspaceHandlers.get(name) ?? [];
				list.push(callback);
				workspaceHandlers.set(name, list);
				return { name };
			},
			onLayoutReady(callback) {
				callback();
			},
			getActiveFile: () => options.activeFile ?? null,
			getLeavesOfType: () => [],
		},
		vault: {
			on(name, callback) {
				const list = vaultHandlers.get(name) ?? [];
				list.push(callback);
				vaultHandlers.set(name, list);
				return { name };
			},
			getAbstractFileByPath: (filePath) =>
				knownPaths === null || knownPaths.has(filePath) ? {} : null,
		},
	};

	const emitWorkspace = (name, ...args) => {
		for (const handler of workspaceHandlers.get(name) ?? []) handler(...args);
	};
	const emitVault = (name, ...args) => {
		for (const handler of vaultHandlers.get(name) ?? []) handler(...args);
	};

	// Load main.js with the stubbed obsidian module.
	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (request === "obsidian") return obsidian;
		return originalLoad.call(this, request, parent, isMain);
	};

	let exported;
	try {
		delete require.cache[require.resolve(mainPath)];
		exported = require(mainPath);
	} finally {
		Module._load = originalLoad;
	}

	const PluginClass = exported?.default ?? exported;
	const plugin = new PluginClass(app, { id: "notemoji", version: "1.0.0" });
	plugin.__saved = [];

	return {
		plugin,
		pluginClass: PluginClass,
		notices,
		modals,
		menu: () => new MenuStub(),
		emitWorkspace,
		emitVault,
		lastSaved: () => plugin.__saved.at(-1),
		tick: () => new Promise((resolve) => setTimeout(resolve, 0)),
	};
}

// ------------------------------------------------------------------ tests

describe("plugin bundle", () => {
	it("exists (run npm run build first)", () => {
		assert.ok(existsSync(mainPath), `main.js not found at ${mainPath}`);
	});
});

describe("plugin loading", () => {
	it("exports a plugin class with the expected lifecycle", () => {
		const harness = createHarness();
		assert.equal(typeof harness.pluginClass, "function");
		assert.equal(typeof harness.plugin.onload, "function");
		assert.equal(typeof harness.plugin.onunload, "function");
	});

	it("completes onload and registers both commands", async () => {
		const harness = createHarness();
		await harness.plugin.onload();

		const ids = harness.plugin.commands.map((command) => command.id);
		assert.deepEqual(ids, ["set-emoji-active-note", "remove-emoji-active-note"]);
		for (const command of harness.plugin.commands) {
			assert.equal(typeof command.checkCallback, "function");
			assert.ok(command.name.length > 0);
		}
	});

	it("survives missing and malformed data", async () => {
		for (const data of [null, undefined, "garbage", 42, [], {}, { icons: 7 }]) {
			const harness = createHarness();
			harness.plugin.__dataToLoad = data;
			await harness.plugin.onload();
			await harness.plugin.onunload();
		}
	});

	it("prunes stale paths on startup and saves the cleanup", async () => {
		const harness = createHarness({ knownPaths: new Set(["Alive.md"]) });
		harness.plugin.__dataToLoad = {
			version: 1,
			icons: { "Alive.md": "🚀", "Gone.md": "🎉" },
		};
		await harness.plugin.onload();

		assert.deepEqual(Object.keys(harness.lastSaved().icons), ["Alive.md"]);
	});

	it("does not save when nothing changed on startup", async () => {
		const harness = createHarness({ knownPaths: new Set(["Alive.md"]) });
		harness.plugin.__dataToLoad = { version: 1, icons: { "Alive.md": "🚀" } };
		await harness.plugin.onload();

		assert.equal(harness.plugin.__saved.length, 0);
	});
});

describe("commands", () => {
	it("is only offered when a note is active", async () => {
		const harness = createHarness();
		await harness.plugin.onload();

		for (const command of harness.plugin.commands) {
			assert.equal(command.checkCallback(true), false, `${command.id} must be unavailable`);
			assert.equal(command.checkCallback(false), false);
		}
		assert.equal(harness.modals.length, 0);
		assert.equal(harness.notices.length, 0);
	});

	it("opens the modal for the active note and stores the chosen emoji", async () => {
		const harness = createHarness({ activeFile: new TFileStub("Notes/A.md") });
		await harness.plugin.onload();

		const setCommand = harness.plugin.commands.find((c) => c.id === "set-emoji-active-note");
		assert.equal(setCommand.checkCallback(true), true);
		assert.equal(harness.modals.length, 0, "the availability check must not open the modal");
		assert.equal(setCommand.checkCallback(false), true);
		assert.equal(harness.modals.length, 1);
		const modal = harness.modals.at(-1);
		assert.equal(modal.isOpen, true);
		assert.equal(modal.options.current, "");
		assert.match(modal.options.description, /A\.md/);

		modal.options.onSubmit("🚀");
		await harness.tick();

		assert.deepEqual(harness.lastSaved(), { version: 1, icons: { "Notes/A.md": "🚀" } });
	});

	it("removes an existing emoji of the active note and then hides itself", async () => {
		const harness = createHarness({ activeFile: new TFileStub("Notes/A.md") });
		harness.plugin.__dataToLoad = { version: 1, icons: { "Notes/A.md": "🎉" } };
		await harness.plugin.onload();

		const remove = harness.plugin.commands.find((c) => c.id === "remove-emoji-active-note");
		assert.equal(remove.checkCallback(true), true);
		assert.equal(remove.checkCallback(false), true);
		await harness.tick();
		assert.deepEqual(harness.lastSaved(), { version: 1, icons: {} });

		// Nothing left to remove, so the command is no longer offered.
		assert.equal(remove.checkCallback(true), false);
	});

	it("pre-fills the modal when an emoji already exists", async () => {
		const harness = createHarness({ activeFile: new TFileStub("A.md") });
		harness.plugin.__dataToLoad = { version: 1, icons: { "A.md": "🎉" } };
		await harness.plugin.onload();

		harness.plugin.commands.find((c) => c.id === "set-emoji-active-note").checkCallback(false);
		const modal = harness.modals.at(-1);
		assert.equal(modal.options.current, "🎉");
		assert.match(modal.options.title, /Change/i);
	});
});

describe("context menu", () => {
	it("offers the right entries for a folder with and without an emoji", async () => {
		const harness = createHarness();
		await harness.plugin.onload();

		const folder = new TFolderStub("Projects");

		const emptyMenu = harness.menu();
		harness.emitWorkspace("file-menu", emptyMenu, folder);
		assert.deepEqual(emptyMenu.titles(), ["Set folder emoji"]);
		emptyMenu.items[0].clickHandler();
		const modal = harness.modals.at(-1);
		assert.equal(modal.isOpen, true);

		modal.options.onSubmit("📁");
		await harness.tick();

		const filledMenu = harness.menu();
		harness.emitWorkspace("file-menu", filledMenu, folder);
		assert.deepEqual(filledMenu.titles(), ["Change folder emoji", "Remove folder emoji"]);

		filledMenu.items[1].clickHandler();
		await harness.tick();
		assert.deepEqual(harness.lastSaved(), { version: 1, icons: {} });
	});

	it("uses note/file wording for files", async () => {
		const harness = createHarness();
		await harness.plugin.onload();

		const noteMenu = harness.menu();
		harness.emitWorkspace("file-menu", noteMenu, new TFileStub("A.md"));
		assert.deepEqual(noteMenu.titles(), ["Set note emoji"]);

		const fileMenu = harness.menu();
		harness.emitWorkspace("file-menu", fileMenu, new TFileStub("image.png"));
		assert.deepEqual(fileMenu.titles(), ["Set file emoji"]);
	});

	it("ignores objects that are neither file nor folder", async () => {
		const harness = createHarness();
		await harness.plugin.onload();

		const menu = harness.menu();
		harness.emitWorkspace("file-menu", menu, { path: "weird" });
		assert.deepEqual(menu.titles(), []);
	});
});

describe("vault events", () => {
	it("moves stored emoji when a folder with descendants is renamed", async () => {
		const harness = createHarness();
		harness.plugin.__dataToLoad = {
			version: 1,
			icons: { Projects: "📁", "Projects/A.md": "🚀", Other: "🎉" },
		};
		await harness.plugin.onload();

		harness.emitVault("rename", new TFolderStub("Work"), "Projects");
		await harness.tick();

		assert.deepEqual(harness.lastSaved().icons, {
			Work: "📁",
			"Work/A.md": "🚀",
			Other: "🎉",
		});
	});

	it("moves stored emoji when a file is renamed", async () => {
		const harness = createHarness();
		harness.plugin.__dataToLoad = { version: 1, icons: { "A.md": "🚀" } };
		await harness.plugin.onload();

		harness.emitVault("rename", new TFileStub("Folder/B.md"), "A.md");
		await harness.tick();

		assert.deepEqual(harness.lastSaved().icons, { "Folder/B.md": "🚀" });
	});

	it("does not save when an unrelated file is renamed", async () => {
		const harness = createHarness();
		harness.plugin.__dataToLoad = { version: 1, icons: { "A.md": "🚀" } };
		await harness.plugin.onload();

		harness.emitVault("rename", new TFileStub("Other.md"), "Missing.md");
		await harness.tick();

		assert.equal(harness.plugin.__saved.length, 0);
	});

	it("cleans up when a folder with descendants is deleted", async () => {
		const harness = createHarness();
		harness.plugin.__dataToLoad = {
			version: 1,
			icons: { Projects: "📁", "Projects/A.md": "🚀", "Projects2/B.md": "🎉" },
		};
		await harness.plugin.onload();

		harness.emitVault("delete", new TFolderStub("Projects"));
		await harness.tick();

		assert.deepEqual(harness.lastSaved().icons, { "Projects2/B.md": "🎉" });
	});
});

describe("unload", () => {
	it("disposes without throwing and can be loaded again", async () => {
		const harness = createHarness();
		await harness.plugin.onload();
		await harness.plugin.onunload();

		const second = createHarness();
		await second.plugin.onload();
		await second.plugin.onunload();
	});
});
