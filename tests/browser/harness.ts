/**
 * Browser harness for the file explorer renderer.
 *
 * Builds a DOM that mimics Obsidian's file explorer (`tree-item` markup) plus a
 * fake `App`/`fileItems` map, then drives the renderer through the scenarios
 * that matter: initial render, re-render, renames, label updates, element
 * re-creation, icon removal and disposal.
 *
 * Run with `node tests/browser/build.mjs` and open the generated HTML file
 * (see tests/browser/serve.mjs for a tiny static server).
 */
import type { App } from "obsidian";
import { FileExplorerRenderer } from "../../src/file-explorer";
import { IconStore } from "../../src/icon-store";

interface FakeFileItem {
	root: HTMLElement;
	selfEl: HTMLElement;
	innerEl: HTMLElement | null;
}

interface Check {
	name: string;
	ok: boolean;
	detail: string;
}

const checks: Check[] = [];
const consoleErrors: string[] = [];

function check(name: string, ok: boolean, detail = ""): void {
	checks.push({ name, ok, detail });
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function scenario(name: string, fn: () => Promise<void> | void): Promise<void> {
	try {
		await fn();
	} catch (error) {
		check(`scenario threw: ${name}`, false, String(error));
	}
}

// ---------------------------------------------------------------- fake Obsidian

function createItem(name: string, kind: "file" | "folder"): FakeFileItem {
	const root = document.createElement("div");
	root.className = `tree-item nav-${kind}`;

	const selfEl = document.createElement("div");
	selfEl.className = `tree-item-self is-clickable nav-${kind}-title`;

	if (kind === "folder") {
		const chevron = document.createElement("div");
		chevron.className = "tree-item-icon collapse-icon";
		chevron.textContent = "›";
		selfEl.appendChild(chevron);
	}

	const innerEl = document.createElement("div");
	innerEl.className = `tree-item-inner nav-${kind}-title-content`;
	innerEl.textContent = name;
	selfEl.appendChild(innerEl);

	root.appendChild(selfEl);
	return { root, selfEl, innerEl };
}

const explorerEl = document.getElementById("explorer") as HTMLElement;
const treeEl = document.createElement("div");
treeEl.className = "nav-files-container";
explorerEl.appendChild(treeEl);

const fileItems: Record<string, FakeFileItem> = {};

function registerItem(
	path: string,
	name: string,
	kind: "file" | "folder",
	parent: HTMLElement,
): FakeFileItem {
	const item = createItem(name, kind);
	parent.appendChild(item.root);
	fileItems[path] = item;
	return item;
}

/** Mimics Obsidian moving a `fileItems` entry after a rename or move. */
function moveFileItem(oldPath: string, newPath: string): void {
	const item = fileItems[oldPath];
	if (!item) return;
	delete fileItems[oldPath];
	fileItems[newPath] = item;
}

// A second "view" without a fileItems map, to prove graceful degradation.
const otherContainerEl = document.createElement("div");
document.body.appendChild(otherContainerEl);

const view = { containerEl: explorerEl, fileItems };
const otherView = { containerEl: otherContainerEl, fileItems: undefined };

const app = {
	workspace: {
		getLeavesOfType: () => [
			{ loadIfDeferred: async () => {}, view },
			{ loadIfDeferred: async () => {}, view: otherView },
		],
	},
} as unknown as App;

// ---------------------------------------------------------------- helpers

function iconOf(item: FakeFileItem): HTMLElement | null {
	return item.selfEl.querySelector<HTMLElement>(":scope > .notemoji-icon");
}

function iconsInContainer(): number {
	return explorerEl.querySelectorAll(".notemoji-icon").length;
}

// ---------------------------------------------------------------- test data

const store = new IconStore();
store.set("Projects", "📁");
store.set("Projects/Website.md", "🚀");
store.set("Inbox.md", "🎉");
store.set("Projects/Tasks.md", "✅");
store.set("New.md", "✨");

const projects = registerItem("Projects", "Projects", "folder", treeEl);
const projectsChildren = document.createElement("div");
projectsChildren.className = "tree-item-children nav-folder-children";
projects.root.appendChild(projectsChildren);

const website = registerItem("Projects/Website.md", "Website.md", "file", projectsChildren);
const tasks = registerItem("Projects/Tasks.md", "Tasks.md", "file", projectsChildren);
const inbox = registerItem("Inbox.md", "Inbox.md", "file", treeEl);
const plain = registerItem("Unassigned.md", "Unassigned.md", "file", treeEl);

const renderer = new FileExplorerRenderer(app, store);

async function main(): Promise<void> {
	// ------------------------------------------------------------ initial render
	renderer.attach();
	await sleep(120);

	await scenario("initial render", () => {
		const folderIcon = iconOf(projects);
		check("folder icon is rendered", folderIcon !== null);
		check("folder icon shows the assigned emoji", folderIcon?.textContent === "📁");
		check(
			"folder icon sits after the chevron",
			projects.selfEl.children[0].classList.contains("collapse-icon") &&
				projects.selfEl.children[1] === folderIcon,
		);
		check(
			"folder icon sits directly before the name",
			folderIcon?.nextElementSibling === projects.innerEl,
		);
		check("file icon is rendered", iconOf(website)?.textContent === "🚀");
		check("second file icon is rendered", iconOf(inbox)?.textContent === "🎉");
		check(
			"nested file icon sits directly before the name",
			iconOf(website)?.nextElementSibling === website.innerEl,
		);
		check("items without emoji stay untouched", iconOf(plain) === null);
		check("items without emoji keep their child count", plain.selfEl.children.length === 1);
		check("exactly one icon per decorated item", iconsInContainer() === 4, `found ${iconsInContainer()}`);
	});

	// ------------------------------------------------------------ idempotency
	await scenario("re-attach does not duplicate icons", async () => {
		renderer.attach();
		await sleep(120);
		renderer.attach();
		await sleep(120);

		check(
			"still exactly one icon per decorated item",
			iconsInContainer() === 4,
			`found ${iconsInContainer()}`,
		);
		check(
			"no duplicated icon inside a title",
			projects.selfEl.querySelectorAll(":scope > .notemoji-icon").length === 1,
		);
		check(
			"no orphan icon nodes were left behind",
			explorerEl.querySelectorAll(".tree-item-self > .notemoji-icon").length === 4,
		);
	});

	// ------------------------------------------------------------ Obsidian updates the label
	await scenario("label update by Obsidian keeps the icon", async () => {
		inbox.innerEl!.textContent = "Archive.md";
		await sleep(120);

		check("icon survives a label update", iconOf(inbox)?.textContent === "🎉");
		check(
			"label update creates no duplicate",
			inbox.selfEl.querySelectorAll(":scope > .notemoji-icon").length === 1,
		);
	});

	// ------------------------------------------------------------ rename (worst case ordering)
	await scenario("rename moves the emoji", async () => {
		// Obsidian updates the explorer first: label and fileItems entry move …
		moveFileItem("Inbox.md", "Archive.md");
		renderer.scheduleSync();
		await sleep(120);

		// … then the plugin receives vault.on("rename") and moves the stored emoji.
		check("stored emoji moved", store.rename("Inbox.md", "Archive.md"));
		renderer.scheduleSync();
		await sleep(120);

		check("icon is rendered again after the rename event", iconOf(inbox)?.textContent === "🎉");
		check(
			"exactly one icon after the interim state",
			inbox.selfEl.querySelectorAll(":scope > .notemoji-icon").length === 1,
		);
		check("no extra icon nodes after rename", iconsInContainer() === 4, `found ${iconsInContainer()}`);
	});

	// ------------------------------------------------------------ moving a folder
	await scenario("moving a folder keeps folder and descendant emoji", async () => {
		projects.innerEl!.textContent = "Work";
		for (const key of Object.keys(fileItems)) {
			if (key === "Projects" || key.startsWith("Projects/")) {
				moveFileItem(key, "Work" + key.slice("Projects".length));
			}
		}

		check("stored emoji moved for the folder tree", store.rename("Projects", "Work"));
		renderer.scheduleSync();
		await sleep(120);

		check("folder icon kept", iconOf(projects)?.textContent === "📁");
		check("child icon kept", iconOf(website)?.textContent === "🚀");
		check("nested child icon kept", iconOf(tasks)?.textContent === "✅");
		check("icon count unchanged", iconsInContainer() === 4, `found ${iconsInContainer()}`);
	});

	// ------------------------------------------------------------ newly added DOM
	await scenario("newly rendered items are decorated by the observer", async () => {
		registerItem("New.md", "New.md", "file", projectsChildren);
		await sleep(200);

		const fresh = fileItems["New.md"];
		check("new item is decorated without a manual sync", iconOf(fresh)?.textContent === "✨");
		check(
			"new item has exactly one icon",
			fresh.selfEl.querySelectorAll(":scope > .notemoji-icon").length === 1,
		);
	});

	// ------------------------------------------------------------ changing an emoji
	await scenario("changing an emoji updates in place", async () => {
		store.set("Work", "💻");
		renderer.scheduleSync();
		await sleep(120);

		check("icon text was updated", iconOf(projects)?.textContent === "💻");
		check(
			"unchanged node was reused",
			projects.selfEl.querySelectorAll(":scope > .notemoji-icon").length === 1,
		);
		check(
			"emoji attribute kept in sync",
			iconOf(projects)?.getAttribute("data-notemoji-emoji") === "💻",
		);
	});

	// ------------------------------------------------------------ removing an emoji
	await scenario("removing an emoji restores the original markup", async () => {
		const before = website.selfEl.children.length;
		store.remove("Work/Website.md");
		renderer.scheduleSync();
		await sleep(120);

		check("icon node was removed", iconOf(website) === null);
		check(
			"no empty placeholder is left behind",
			website.selfEl.children.length === before - 1 && website.selfEl.children.length === 1,
		);
		check("remaining icons are untouched", iconsInContainer() === 4, `found ${iconsInContainer()}`);
	});

	// ------------------------------------------------------------ Obsidian re-creates an element
	await scenario("re-created elements are decorated again", async () => {
		const oldElement = tasks.selfEl;
		tasks.root.remove(); // Obsidian re-renders the item

		const replacement = createItem("Tasks.md", "file");
		projectsChildren.appendChild(replacement.root);
		fileItems["Work/Tasks.md"] = replacement;

		await sleep(250);

		check(
			"re-created element gets exactly one icon",
			replacement.selfEl.querySelectorAll(":scope > .notemoji-icon").length === 1,
			`found ${replacement.selfEl.querySelectorAll(":scope > .notemoji-icon").length}`,
		);
		check("re-created element shows the emoji", iconOf(replacement)?.textContent === "✅");
		check("detached element is not part of the document anymore", oldElement.isConnected === false);
		check("no duplicates in the container", iconsInContainer() === 4, `found ${iconsInContainer()}`);
	});

	// ------------------------------------------------------------ items without a name element
	await scenario("missing inner element does not throw", async () => {
		const weird = createItem("Odd.md", "file");
		weird.selfEl.removeChild(weird.innerEl as HTMLElement);
		weird.innerEl = null;
		treeEl.appendChild(weird.root);
		fileItems["Odd.md"] = weird;
		store.set("Odd.md", "🌀");

		renderer.scheduleSync();
		await sleep(120);

		check("icon is still rendered", iconOf(weird)?.textContent === "🌀");
		check("no crash for the odd item", true);

		// Clean up so later counts stay predictable.
		weird.root.remove();
		delete fileItems["Odd.md"];
		renderer.scheduleSync();
		await sleep(120);
	});

	// ------------------------------------------------------------ dispose
	await scenario("dispose removes every icon and observer", async () => {
		renderer.dispose();
		await sleep(80);

		check("all icons are removed on unload", iconsInContainer() === 0, `found ${iconsInContainer()}`);
		check(
			"untouched items are still intact",
			plain.selfEl.children.length === 1 && plain.selfEl.textContent === "Unassigned.md",
		);
	});
}

// Results are read by the browser automation (window.__results).
declare global {
	interface Window {
		__results?: { checks: Check[]; consoleErrors: string[] };
	}
}

/**
 * Renders a small sample tree with icon sizes close to Obsidian's file explorer,
 * purely for visual inspection (not part of the assertions).
 */
function renderVisualDemo(): void {
	const demoContainer = document.getElementById("visual") as HTMLElement | null;
	if (!demoContainer) return;

	const demoTree = document.createElement("div");
	demoTree.className = "nav-files-container";
	demoContainer.appendChild(demoTree);

	const demoItems: Record<string, FakeFileItem> = {};
	const demoStore = new IconStore();
	demoStore.set("Projects", "📁");
	demoStore.set("Projects/Website.md", "🚀");
	demoStore.set("Projects/Tasks.md", "✅");
	demoStore.set("Archive.md", "🎉");
	demoStore.set("Flag.md", "🇩🇪");
	demoStore.set("Family.md", "👨‍👩‍👧‍👦");

	const demoApp = {
		workspace: {
			getLeavesOfType: () => [
				{
					loadIfDeferred: async () => {},
					view: { containerEl: demoContainer, fileItems: demoItems },
				},
			],
		},
	} as unknown as App;

	const demoRenderer = new FileExplorerRenderer(demoApp, demoStore);

	const folder = createItem("Projects", "folder");
	demoTree.appendChild(folder.root);
	demoItems["Projects"] = folder;

	const children = document.createElement("div");
	children.className = "tree-item-children nav-folder-children";
	folder.root.appendChild(children);

	for (const [path, name] of [
		["Projects/Website.md", "Website.md"],
		["Projects/Tasks.md", "Tasks.md"],
	] as const) {
		const child = createItem(name, "file");
		children.appendChild(child.root);
		demoItems[path] = child;
	}

	for (const [path, name] of [
		["Archive.md", "Archive.md"],
		["Flag.md", "Flag.md"],
		["Family.md", "Family.md"],
		["Plain.md", "Plain.md"],
	] as const) {
		const item = createItem(name, "file");
		demoTree.appendChild(item.root);
		demoItems[path] = item;
	}

	demoRenderer.attach();
}

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
	consoleErrors.push(args.map((value) => String(value)).join(" "));
	originalConsoleError(...args);
};
window.addEventListener("error", (event) => {
	consoleErrors.push(`uncaught: ${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
	consoleErrors.push(`unhandled rejection: ${String(event.reason)}`);
});

void main().then(() => {
	renderVisualDemo();

	const failed = checks.filter((entry) => !entry.ok).length;
	window.__results = { checks, consoleErrors };

	const summary = document.getElementById("summary");
	if (summary) {
		summary.textContent = `${checks.length - failed}/${checks.length} checks passed`;
		summary.className = failed === 0 ? "ok" : "bad";
	}

	const list = document.getElementById("results");
	if (list) {
		for (const entry of checks) {
			const li = document.createElement("li");
			li.className = entry.ok ? "ok" : "bad";
			li.textContent = `${entry.ok ? "PASS" : "FAIL"} — ${entry.name}${entry.detail ? ` (${entry.detail})` : ""}`;
			list.appendChild(li);
		}
		for (const error of consoleErrors) {
			const li = document.createElement("li");
			li.className = "bad";
			li.textContent = `CONSOLE ERROR — ${error}`;
			list.appendChild(li);
		}
	}
});
