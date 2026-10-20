/**
 * Showcase scene for the README media: an Obsidian-like window running the
 * real plugin (src/main.ts) against the fake app from the tests. Menus, picker,
 * settings, storage and rendering are the shipped code; only Obsidian itself
 * is faked.
 *
 * The URL hash configures the scene (see scripts/record-demo.mjs):
 *   theme=light|dark     colour theme (default dark)
 *   layout=phone         a phone-sized layout; view=explorer shows the file list
 *   names=emoji          "before Notemoji": emoji typed into the file names instead
 */
import type { PluginManifest } from "obsidian";
import NotemojiPlugin from "../../src/main";
import type { NotemojiSettings } from "../../src/data";
import { createFakeApp } from "../../tests/fake-app";
import {
	customIcons,
	FileView,
	lineIcons,
	MarkdownView,
	Menu,
	Plugin as FakePlugin,
	View,
	WorkspaceLeaf,
} from "../../tests/obsidian";

const params = new URLSearchParams(location.hash.slice(1));

// The line icons Notemoji's buttons use (drawn like Obsidian's Lucide icons).
lineIcons.set("trash-2", '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>');
lineIcons.set("download", '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>');
lineIcons.set(
	"folder-open",
	'<path d="M6 14l1.5-3A2 2 0 0 1 9.3 10H20a2 2 0 0 1 1.9 2.5L20.4 18a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2"/>',
);
lineIcons.set(
	"image-plus",
	'<path d="M16 5h6M19 2v6M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/><circle cx="9" cy="9" r="2"/>',
);
const emojiInNames = params.get("names") === "emoji";
document.body.addClass(`theme-${params.get("theme") ?? "dark"}`);
if (params.get("layout") === "phone") {
	document.body.addClass("is-phone", `phone-${params.get("view") ?? "note"}`);
}

/** The vault, in explorer order. Folders end with "/"; a folder without listed files is collapsed. */
const TREE = [
	"Projects/",
	"Projects/Website relaunch.md",
	"Projects/Brand guidelines.md",
	"Projects/Roadmap.md",
	"Daily notes/",
	"Daily notes/2026-10-19.md",
	"Recipes/",
	"Travel/",
	"Home.md",
	"Ideas.md",
	"Reading list.md",
];

/** The emoji of the showcase vault ("Ideas.md" uses a custom image). */
const ICONS: Record<string, string> = {
	Projects: "📁",
	"Projects/Brand guidelines.md": "🎨",
	"Projects/Roadmap.md": "🗺️",
	"Daily notes": "🗓️",
	Recipes: "🍝",
	Travel: "✈️",
	"Home.md": "🏠",
	"Reading list.md": "📚",
	"Ideas.md": "custom:acme.svg",
};
/** Only used when the emoji are typed into the names. */
const NAME_EMOJI: Record<string, string> = {
	...ICONS,
	"Projects/Website relaunch.md": "🚀",
	"Ideas.md": "💡",
};

const paths = TREE.map((entry) => entry.replace(/\/$/, ""));
const app = createFakeApp({ files: paths });

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
/** The name as shown: with the emoji typed in front of it in the "before" scene. */
const shownName = (path: string) =>
	emojiInNames && NAME_EMOJI[path] ? `${NAME_EMOJI[path]} ${baseName(path)}` : baseName(path);

// ---------------------------------------------------------------- file explorer

const explorerEl = document.querySelector<HTMLElement>(".nav-files-container")!;
const fileItems: Record<string, { selfEl: HTMLElement; innerEl: HTMLElement }> = {};
const childrenEls = new Map<string, HTMLElement>([["", explorerEl]]);

for (const entry of TREE) {
	const isFolder = entry.endsWith("/");
	const path = entry.replace(/\/$/, "");
	const parent = childrenEls.get(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "")!;
	const itemEl = parent.createDiv({ cls: `tree-item ${isFolder ? "nav-folder" : "nav-file"}` });
	const selfEl = itemEl.createDiv({
		cls: `tree-item-self ${isFolder ? "nav-folder-title" : "nav-file-title"}`,
		attr: { "data-path": path },
	});
	if (isFolder) {
		const open = TREE.some((other) => other !== entry && other.startsWith(entry));
		selfEl.createDiv({ cls: "tree-item-icon collapse-icon", text: open ? "⌄" : "›" });
		childrenEls.set(path, itemEl.createDiv({ cls: "tree-item-children" }));
	}
	fileItems[path] = {
		selfEl,
		innerEl: selfEl.createDiv({ cls: "tree-item-inner", text: shownName(path) }),
	};
}
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
	)!;

const NOTE = "Projects/Website relaunch.md";
const noteView = new MarkdownView(new WorkspaceLeaf(app.asApp));
noteView.file = app.vault.getFileByPath(NOTE);
noteView.containerEl = document.querySelector<HTMLElement>(".workspace-leaf-content")!;
addLeaf(noteView, tabTitle(NOTE));

const homeView = new FileView(new WorkspaceLeaf(app.asApp));
homeView.file = app.vault.getFileByPath("Home.md");
addLeaf(homeView, tabTitle("Home.md"));

for (const el of [
	tabTitle(NOTE),
	document.querySelector(".view-header-title")!,
	document.querySelector(".inline-title")!,
]) {
	el.textContent = shownName(NOTE);
}
tabTitle("Home.md").textContent = shownName("Home.md");
document.querySelector(".link")!.textContent = emojiInNames
	? `${NAME_EMOJI["Projects/Brand guidelines.md"]} Brand guidelines`
	: "Brand guidelines";

// ---------------------------------------------------------------- the plugin

// Custom icon files live in memory; the page shows them through blob URLs.
const ICON_FOLDER = ".obsidian/plugins/notemoji/icons";
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
app.vault.adapter.folders.add(ICON_FOLDER);
app.vault.adapter.files.set(`${ICON_FOLDER}/acme.svg`, svg("#2f80ed", "M32 12 52 50H12z"));

const plugin = new NotemojiPlugin(app.asApp, {
	id: "notemoji",
	version: "demo",
	dir: ".obsidian/plugins/notemoji",
} as PluginManifest);
const fake = plugin as unknown as FakePlugin;
fake.dataJson = {
	version: 2,
	settings: { noteTitle: "above", showInViewHeader: params.get("layout") === "phone" },
	icons: emojiInNames ? {} : ICONS,
	recent: ["📁", "🎨", "🏠", "📚", "✅", "💡", "🔥", "🌱", "🗺️", "🍝"],
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

// ---------------------------------------------------------------- settings

/**
 * A stand-in for Obsidian's settings window, showing Notemoji's tab. `side`
 * leaves the file explorer visible next to it.
 */
function showSettings(side = false): void {
	const overlay = document.body.createDiv({ cls: "demo-settings" });
	overlay.toggleClass("is-side", side);
	const sidebar = overlay.createDiv({ cls: "demo-settings-sidebar" });
	sidebar.createDiv({ cls: "demo-settings-group", text: "Core plugins" });
	for (const name of ["Backlinks", "Canvas", "Templates"]) {
		sidebar.createDiv({ cls: "demo-settings-item", text: name });
	}
	sidebar.createDiv({ cls: "demo-settings-group", text: "Community plugins" });
	const item = sidebar.createDiv({ cls: "demo-settings-item is-active" });
	const icon = item.createSpan({ cls: "demo-settings-icon" });
	const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="svg-icon">${customIcons.get("notemoji-emoji") ?? ""}</svg>`;
	icon.append(new DOMParser().parseFromString(iconSvg, "image/svg+xml").documentElement);
	item.createSpan({ text: "Notemoji" });
	const tab = fake.settingTabs[0];
	overlay.createDiv({ cls: "demo-settings-content" }).appendChild(tab.containerEl);
	tab.display();
}

/** What the recorder (scripts/record-demo.mjs) drives. */
Object.assign(window, {
	demo: {
		adapter: app.vault.adapter,
		showSettings,
		/** Sets (or with null removes) the icon of a path. */
		setIcon(path: string, value: string | null) {
			const file = app.vault.getAbstractFileByPath(path);
			if (!file) return;
			if (value === null) plugin.icons.removeIcon(file as never);
			else plugin.icons.setIcon(file as never, value);
		},
		setSettings(patch: Partial<NotemojiSettings>) {
			plugin.updateSettings(patch);
		},
	},
	demoReady: true,
});
