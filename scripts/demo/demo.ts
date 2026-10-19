/**
 * Demo scene for the README media: an Obsidian-like window running the real
 * plugin (src/main.ts) against the fake app from the tests. Menus, picker,
 * storage and rendering are the shipped code; only Obsidian itself is faked.
 *
 * Built and recorded by scripts/record-demo.mjs.
 */
import type { PluginManifest } from "obsidian";
import NotemojiPlugin from "../../src/main";
import { createFakeApp } from "../../tests/fake-app";
import {
	customIcons,
	FileView,
	MarkdownView,
	Menu,
	Plugin as FakePlugin,
	View,
	WorkspaceLeaf,
} from "../../tests/obsidian";

const app = createFakeApp({
	files: [
		"Projects/Website relaunch.md",
		"Projects/Brand guidelines.md",
		"Projects/Roadmap.md",
		"Daily notes/2026-10-19.md",
		"Home.md",
		"Ideas.md",
		"Reading list.md",
	],
});

// ---------------------------------------------------------------- file explorer

const explorerEl = document.querySelector<HTMLElement>(".nav-files-container")!;
const fileItems: Record<string, { selfEl: HTMLElement; innerEl: HTMLElement }> = {};

function addItem(path: string, parent: HTMLElement): HTMLElement {
	const isFolder = !path.endsWith(".md");
	const itemEl = parent.createDiv({ cls: `tree-item ${isFolder ? "nav-folder" : "nav-file"}` });
	const selfEl = itemEl.createDiv({
		cls: `tree-item-self ${isFolder ? "nav-folder-title" : "nav-file-title"}`,
		attr: { "data-path": path },
	});
	if (isFolder) selfEl.createDiv({ cls: "tree-item-icon collapse-icon", text: "⌄" });
	const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
	fileItems[path] = { selfEl, innerEl: selfEl.createDiv({ cls: "tree-item-inner", text: name }) };
	return isFolder ? itemEl.createDiv({ cls: "tree-item-children" }) : itemEl;
}

const projects = addItem("Projects", explorerEl);
for (const name of ["Website relaunch", "Brand guidelines", "Roadmap"]) {
	addItem(`Projects/${name}.md`, projects);
}
addItem("Daily notes/2026-10-19.md", addItem("Daily notes", explorerEl));
for (const name of ["Home", "Ideas", "Reading list"]) addItem(`${name}.md`, explorerEl);
fileItems["Projects/Website relaunch.md"].selfEl.addClass("is-active");

function addLeaf(view: View, tabTitleEl: HTMLElement | null): WorkspaceLeaf {
	const leaf = view.leaf;
	leaf.view = view;
	leaf.root = app.workspace.rootSplit;
	Object.assign(leaf, {
		tabHeaderInnerTitleEl: tabTitleEl,
		loadIfDeferred: () => Promise.resolve(),
	});
	app.workspace.leaves.push(leaf);
	return leaf;
}

const explorerView = new View(new WorkspaceLeaf(app.asApp));
explorerView.getViewType = () => "file-explorer";
Object.assign(explorerView, { containerEl: explorerEl, fileItems });
addLeaf(explorerView, null);

// ---------------------------------------------------------------- open notes

const tabTitle = (path: string) =>
	document.querySelector<HTMLElement>(
		`.workspace-tab-header[data-path="${path}"] .workspace-tab-header-inner-title`,
	);

const noteView = new MarkdownView(new WorkspaceLeaf(app.asApp));
noteView.file = app.vault.getFileByPath("Projects/Website relaunch.md");
noteView.containerEl = document.querySelector<HTMLElement>(".workspace-leaf-content")!;
addLeaf(noteView, tabTitle("Projects/Website relaunch.md"));

const homeView = new FileView(new WorkspaceLeaf(app.asApp));
homeView.file = app.vault.getFileByPath("Home.md");
addLeaf(homeView, tabTitle("Home.md"));

// ---------------------------------------------------------------- the plugin

// Custom icon files live in memory; the page shows them through blob URLs.
const ICONS = ".obsidian/plugins/notemoji/icons";
const blobUrls = new Map<string, string>();
app.vault.adapter.getResourcePath = (path: string) => {
	const data = app.vault.adapter.files.get(path);
	if (!data) return "";
	if (!blobUrls.has(path)) {
		const type = path.endsWith(".svg") ? "image/svg+xml" : "image/png";
		blobUrls.set(path, URL.createObjectURL(new Blob([data], { type })));
	}
	return blobUrls.get(path)!;
};
const svg = (fill: string, glyph: string) =>
	new TextEncoder().encode(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${fill}"/><path d="${glyph}" fill="#fff"/></svg>`,
	).buffer;
app.vault.adapter.folders.add(ICONS);
app.vault.adapter.files.set(`${ICONS}/acme.svg`, svg("#2f80ed", "M32 12 52 50H12z"));

const plugin = new NotemojiPlugin(app.asApp, {
	id: "notemoji",
	version: "demo",
	dir: ".obsidian/plugins/notemoji",
} as PluginManifest);
const fake = plugin as unknown as FakePlugin;
fake.dataJson = {
	version: 2,
	settings: { noteTitle: "above" },
	icons: {
		Projects: "📁",
		"Projects/Brand guidelines.md": "🎨",
		"Home.md": "🏠",
		"Reading list.md": "📚",
		"Ideas.md": "custom:acme.svg",
	},
	recent: ["📁", "🎨", "🏠", "📚", "✅", "💡", "🔥", "🌱"],
};
fake.load();

// ---------------------------------------------------------------- context menu

/** Renders the menu Obsidian would show, including the entries Notemoji adds. */
const menuEl = document.querySelector<HTMLElement>(".menu")!;
explorerEl.addEventListener("contextmenu", (event) => {
	const path = (event.target as HTMLElement).closest<HTMLElement>("[data-path]")?.dataset.path;
	const file = path ? app.vault.getAbstractFileByPath(path) : null;
	if (!file) return;
	event.preventDefault();

	const menu = new Menu();
	app.workspace.trigger("file-menu", menu, file, "file-explorer");
	menuEl.empty();
	for (const title of ["Open in new tab", "Rename…", "Move file to…"]) {
		menuEl.createDiv({ cls: "menu-item", text: title });
	}
	menuEl.createDiv({ cls: "menu-separator" });
	for (const item of menu.items) {
		menuEl.createDiv({ cls: "menu-item", text: item.title }).addEventListener("click", () => {
			menuEl.removeClass("is-open");
			item.click();
		});
	}
	menuEl.style.left = `${event.clientX}px`;
	menuEl.style.top = `${event.clientY}px`;
	menuEl.addClass("is-open");
});
document.addEventListener("click", (event) => {
	if (!menuEl.contains(event.target as Node)) menuEl.removeClass("is-open");
});

// ---------------------------------------------------------------- fake cursor

/** Headless recordings have no mouse pointer, so the page draws one. */
const cursorEl = document.querySelector<SVGElement>(".demo-cursor")!;
document.addEventListener("mousemove", (event) => {
	cursorEl.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
});
document.addEventListener("mousedown", () => cursorEl.classList.add("is-down"));
document.addEventListener("mouseup", () => cursorEl.classList.remove("is-down"));

/** A minimal stand-in for Obsidian's settings window, showing Notemoji's tab. */
function showSettings(): void {
	const overlay = document.body.createDiv({ cls: "demo-settings" });
	const sidebar = overlay.createDiv({ cls: "demo-settings-sidebar" });
	sidebar.createDiv({ cls: "demo-settings-group", text: "Core plugins" });
	for (const name of ["Backlinks", "Canvas", "Templates"]) {
		sidebar.createDiv({ cls: "demo-settings-item", text: name });
	}
	sidebar.createDiv({ cls: "demo-settings-group", text: "Community plugins" });
	const item = sidebar.createDiv({ cls: "demo-settings-item is-active" });
	const icon = item.createSpan({ cls: "demo-settings-icon" });
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="svg-icon">${customIcons.get("notemoji-emoji") ?? ""}</svg>`;
	icon.append(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement);
	item.createSpan({ text: "Notemoji" });
	const tab = fake.settingTabs[0];
	overlay.createDiv({ cls: "demo-settings-content" }).appendChild(tab.containerEl);
	tab.display();
}

/** Lets the recorder switch the note title mode. */
Object.assign(window, {
	showSettings,
	demoReady: true,
	setIconOf(path: string, value: string) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file) plugin.icons.setIcon(file as never, value);
	},
	setNoteTitle(mode: "above" | "inline" | "off") {
		plugin.updateSettings({ noteTitle: mode });
	},
});
