/**
 * A small fake of the `obsidian` module.
 *
 * The real package only ships type definitions, so tests (and the README demo
 * scene) alias `obsidian` to this file. It implements just what Notemoji uses,
 * with the same names and DOM structure as the real app.
 */

import { StateField } from "@codemirror/state";

// ------------------------------------------------------------------ DOM helpers

interface DomElementInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
}

function applyInfo(el: HTMLElement, info?: DomElementInfo | string): void {
	const options: DomElementInfo = typeof info === "string" ? { cls: info } : (info ?? {});
	if (options.cls) el.className = ([] as string[]).concat(options.cls).join(" ");
	if (options.text !== undefined) el.textContent = options.text;
	for (const [name, value] of Object.entries(options.attr ?? {})) {
		if (value === null || value === false) continue;
		el.setAttribute(name, String(value));
	}
}

function createElIn<K extends keyof HTMLElementTagNameMap>(
	parent: Node | null,
	tag: K,
	info?: DomElementInfo | string,
): HTMLElementTagNameMap[K] {
	const doc = parent?.ownerDocument ?? document;
	const el = doc.createElement(tag);
	applyInfo(el, info);
	parent?.appendChild(el);
	return el;
}

/** Installs the helpers Obsidian adds to every DOM node (idempotent). */
function installDomHelpers(win: Window & typeof globalThis): void {
	const proto = win.HTMLElement.prototype as unknown as Record<string, unknown>;
	if (proto.createEl) return;

	proto.createEl = function (
		this: HTMLElement,
		tag: keyof HTMLElementTagNameMap,
		info?: DomElementInfo,
	) {
		return createElIn(this, tag, info);
	};
	proto.createDiv = function (this: HTMLElement, info?: DomElementInfo) {
		return createElIn(this, "div", info);
	};
	proto.createSpan = function (this: HTMLElement, info?: DomElementInfo) {
		return createElIn(this, "span", info);
	};
	proto.empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
	proto.setText = function (this: HTMLElement, text: string) {
		this.textContent = text;
	};
	proto.addClass = function (this: HTMLElement, ...classes: string[]) {
		this.classList.add(...classes);
	};
	proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
		this.classList.remove(...classes);
	};
	proto.hasClass = function (this: HTMLElement, cls: string) {
		return this.classList.contains(cls);
	};
	proto.toggleClass = function (this: HTMLElement, cls: string, value: boolean) {
		this.classList.toggle(cls, value);
	};
	proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
		for (const [name, value] of Object.entries(props)) {
			if (value === "") this.style.removeProperty(name);
			else this.style.setProperty(name, value);
		}
	};
	proto.setAttr = function (this: HTMLElement, name: string, value: string | null) {
		if (value === null) this.removeAttribute(name);
		else this.setAttribute(name, value);
	};
	(win.Node.prototype as unknown as Record<string, unknown>).instanceOf = function (
		this: Node,
		type: new () => unknown,
	) {
		return this instanceof type;
	};
	// The window a node belongs to (for pop-out windows).
	Object.defineProperty(win.Node.prototype, "win", {
		get(this: Node) {
			return this.ownerDocument?.defaultView ?? win;
		},
	});

	const globals = win as unknown as Record<string, unknown>;
	globals.createEl = (tag: keyof HTMLElementTagNameMap, info?: DomElementInfo) =>
		createElIn(null, tag, info);
	globals.createDiv = (info?: DomElementInfo) => createElIn(null, "div", info);
	globals.createSpan = (info?: DomElementInfo) => createElIn(null, "span", info);
	globals.activeDocument = win.document;
	globals.activeWindow = win;
}

installDomHelpers(window);

// ------------------------------------------------------------------ basics

export let apiVersion = "1.7.2";

/** Tests run as the oldest supported Obsidian unless they set another version. */
export function setApiVersion(version: string): void {
	apiVersion = version;
}

/** The language Obsidian runs in; tests may change it. */
export let language = "en";

export function setLanguage(code: string): void {
	language = code;
}

export function getLanguage(): string {
	return language;
}

export function requireApiVersion(version: string): boolean {
	const have = apiVersion.split(".").map(Number);
	const want = version.split(".").map(Number);
	for (let i = 0; i < Math.max(have.length, want.length); i++) {
		const difference = (have[i] ?? 0) - (want[i] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return true;
}

export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isPhone: false,
	isTablet: false,
	isMacOS: false,
	isWin: false,
	isLinux: true,
};

/** Icons registered with addIcon, by id. */
export const customIcons = new Map<string, string>();

export function addIcon(iconId: string, svgContent: string): void {
	customIcons.set(iconId, svgContent);
}

/**
 * Obsidian's own (Lucide) icons by name: their SVG contents. Like a real
 * Obsidian version, it has some icons and lacks others; tests add or remove
 * names, and the showcase scene adds the ones Notemoji's buttons use.
 */
export const lineIcons = new Map<string, string>([
	["star", '<path d="M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5-6.5 4.5 2-7.5L2 9h7z"/>'],
	["arrow-right", '<path d="M5 12h14M12 5l7 7-7 7"/>'],
	["arrow-left", '<path d="M19 12H5M12 19l-7-7 7-7"/>'],
	["arrow-up-right", '<path d="M7 17 17 7M7 7h10v10"/>'],
	["shapes", '<circle cx="7" cy="7" r="4"/><rect x="13" y="13" width="8" height="8"/>'],
]);

/** Ids of every registered icon: Obsidian's own (`lucide-…`) and those added with addIcon. */
export function getIconIds(): string[] {
	return [...[...lineIcons.keys()].map((name) => `lucide-${name}`), ...customIcons.keys()];
}

/** A new SVG element of an icon, as Obsidian draws it; null for an unknown id. */
export function getIcon(iconId: string): SVGSVGElement | null {
	const name = iconId.replace(/^lucide-/, "");
	const drawing = lineIcons.get(name) ?? customIcons.get(iconId);
	if (drawing === undefined) return null;
	const svg =
		'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
		'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
		`class="svg-icon ${iconId}">${drawing}</svg>`;
	const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
	return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
}

/** Draws an icon into `parent`; an unknown one shows as "+" (a stand-in in the showcase). */
export function setIcon(parent: HTMLElement, iconId: string): void {
	parent.empty();
	const svg = getIcon(iconId);
	if (svg) parent.append(svg);
	else parent.createSpan({ cls: "svg-icon", text: "+", attr: { "data-icon": iconId } });
}

/** The path part of a link: `note#heading` → `note`. */
export function getLinkpath(linktext: string): string {
	const hash = linktext.indexOf("#");
	return hash === -1 ? linktext : linktext.slice(0, hash);
}

/** The note an editor shows; tests set it with `editorInfoField.init(…)`. */
export const editorInfoField = StateField.define<{ file: TFile | null }>({
	create: () => ({ file: null }),
	update: (value) => value,
});

/** Whether an editor is in Live Preview (true) or source mode. */
export const editorLivePreviewField = StateField.define<boolean>({
	create: () => true,
	update: (value) => value,
});

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/|\/$/g, "");
}

/**
 * Network for `requestUrl`: tests register responses by URL. Anything else
 * fails, so a test can never reach the real network.
 */
export const network = {
	responses: new Map<string, ArrayBuffer>(),
	requests: [] as string[],
};

export function requestUrl(
	request: { url: string } | string,
): Promise<{ arrayBuffer: ArrayBuffer }> {
	const url = typeof request === "string" ? request : request.url;
	network.requests.push(url);
	const data = network.responses.get(url);
	return data
		? Promise.resolve({ arrayBuffer: data })
		: Promise.reject(new Error(`No network in tests: ${url}`));
}

/** Every notice shown, oldest first. Tests may clear it. */
export const notices: string[] = [];

export class Notice {
	constructor(message: string | DocumentFragment) {
		notices.push(typeof message === "string" ? message : (message.textContent ?? ""));
	}
	hide(): void {}
}

// ------------------------------------------------------------------ events

export interface EventRef {
	name: string;
	callback: (...args: unknown[]) => unknown;
	source: Events;
}

export class Events {
	private handlers = new Map<string, EventRef[]>();

	on(name: string, callback: (...args: never[]) => unknown): EventRef {
		const ref: EventRef = { name, callback: callback as EventRef["callback"], source: this };
		this.handlers.set(name, [...(this.handlers.get(name) ?? []), ref]);
		return ref;
	}

	offref(ref: EventRef): void {
		this.handlers.set(
			ref.name,
			(this.handlers.get(ref.name) ?? []).filter((entry) => entry !== ref),
		);
	}

	trigger(name: string, ...args: unknown[]): void {
		for (const ref of [...(this.handlers.get(name) ?? [])]) ref.callback(...args);
	}

	/** Number of active handlers, to check that everything is detached on unload. */
	count(name?: string): number {
		if (name !== undefined) return this.handlers.get(name)?.length ?? 0;
		let total = 0;
		for (const list of this.handlers.values()) total += list.length;
		return total;
	}
}

// ------------------------------------------------------------------ files

export class TAbstractFile {
	path: string;
	name: string;
	parent: TFolder | null = null;

	constructor(path: string) {
		this.path = path;
		this.name = path.slice(path.lastIndexOf("/") + 1);
	}
}

export class TFile extends TAbstractFile {
	stat = { ctime: 0, mtime: 0, size: 0 };

	get extension(): string {
		const dot = this.name.lastIndexOf(".");
		return dot > 0 ? this.name.slice(dot + 1) : "";
	}

	get basename(): string {
		const dot = this.name.lastIndexOf(".");
		return dot > 0 ? this.name.slice(0, dot) : this.name;
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];

	isRoot(): boolean {
		return this.path === "/" || this.path === "";
	}
}

// ------------------------------------------------------------------ components

export class Component {
	private cleanups: Array<() => void> = [];

	onload(): void | Promise<void> {}
	onunload(): void {}
	load(): void {
		void this.onload();
	}
	unload(): void {
		this.onunload();
		for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
	}
	register(callback: () => unknown): void {
		this.cleanups.push(() => void callback());
	}
	registerEvent(ref: EventRef): void {
		this.cleanups.push(() => ref.source.offref(ref));
	}
	registerDomEvent(
		el: HTMLElement | Document | Window,
		type: string,
		callback: EventListener,
		options?: AddEventListenerOptions,
	): void {
		el.addEventListener(type, callback, options);
		this.cleanups.push(() => el.removeEventListener(type, callback, options));
	}
	registerInterval(id: number): number {
		this.cleanups.push(() => window.clearInterval(id));
		return id;
	}
}

/** A rendered part of a note, unloaded with it. */
export class MarkdownRenderChild extends Component {
	constructor(public containerEl: HTMLElement) {
		super();
	}
}

export interface MarkdownPostProcessorContext {
	sourcePath: string;
	addChild(child: MarkdownRenderChild): void;
}

export type MarkdownPostProcessor = (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void;

export interface Command {
	id: string;
	name: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
}

export class Plugin extends Component {
	app: App;
	manifest: { id: string; version: string };
	commands: Command[] = [];
	settingTabs: PluginSettingTab[] = [];
	postProcessors: MarkdownPostProcessor[] = [];
	editorExtensions: unknown[] = [];
	/** Contents of the fake data.json; `saved` records every write. */
	dataJson: unknown = null;
	saved: unknown[] = [];

	constructor(app: App, manifest: { id: string; version: string }) {
		super();
		this.app = app;
		this.manifest = manifest;
	}

	addCommand(command: Command): Command {
		this.commands.push(command);
		return command;
	}
	addSettingTab(tab: PluginSettingTab): void {
		this.settingTabs.push(tab);
	}
	registerMarkdownPostProcessor(postProcessor: MarkdownPostProcessor): MarkdownPostProcessor {
		this.postProcessors.push(postProcessor);
		this.register(() => {
			this.postProcessors = this.postProcessors.filter((entry) => entry !== postProcessor);
		});
		return postProcessor;
	}
	registerEditorExtension(extension: unknown): void {
		this.editorExtensions.push(extension);
	}
	loadData(): Promise<unknown> {
		return Promise.resolve(structuredClone(this.dataJson));
	}
	saveData(data: unknown): Promise<void> {
		this.dataJson = structuredClone(data);
		this.saved.push(this.dataJson);
		return Promise.resolve();
	}
}

// ------------------------------------------------------------------ modals

/** Every modal currently open, oldest first. */
export const openModals: Modal[] = [];

export class Modal {
	app: App;
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	private readonly onKeydown = (event: KeyboardEvent) => {
		if (event.key === "Escape") this.close();
	};

	constructor(app: App) {
		this.app = app;
		this.containerEl = createElIn(null, "div", "modal-container mod-dim");
		createElIn(this.containerEl, "div", "modal-bg").addEventListener("click", () =>
			this.close(),
		);
		this.modalEl = createElIn(this.containerEl, "div", "modal");
		createElIn(this.modalEl, "div", "modal-close-button").addEventListener("click", () =>
			this.close(),
		);
		this.titleEl = createElIn(
			createElIn(this.modalEl, "div", "modal-header"),
			"div",
			"modal-title",
		);
		this.contentEl = createElIn(this.modalEl, "div", "modal-content");
	}

	open(): void {
		document.body.appendChild(this.containerEl);
		document.addEventListener("keydown", this.onKeydown);
		openModals.push(this);
		void this.onOpen();
	}

	close(): void {
		const index = openModals.indexOf(this);
		if (index === -1) return;
		openModals.splice(index, 1);
		document.removeEventListener("keydown", this.onKeydown);
		this.onClose();
		this.containerEl.remove();
	}

	setTitle(title: string): this {
		this.titleEl.setText(title);
		return this;
	}

	onOpen(): void | Promise<void> {}
	onClose(): void {}
}

// ------------------------------------------------------------------ menus

export class MenuItem {
	title = "";
	icon = "";
	section = "";
	handler: ((event: MouseEvent | KeyboardEvent) => unknown) | null = null;

	setTitle(title: string): this {
		this.title = title;
		return this;
	}
	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}
	setSection(section: string): this {
		this.section = section;
		return this;
	}
	onClick(handler: (event: MouseEvent | KeyboardEvent) => unknown): this {
		this.handler = handler;
		return this;
	}
	click(): void {
		this.handler?.(new MouseEvent("click"));
	}
}

/** Menus shown with showAtMouseEvent or showAtPosition, oldest first. Tests may clear it. */
export const shownMenus: Menu[] = [];

export class Menu {
	items: MenuItem[] = [];
	/** Where showAtPosition opened it. */
	position: { x: number; y: number } | null = null;

	showAtMouseEvent(_event: MouseEvent): this {
		shownMenus.push(this);
		return this;
	}
	showAtPosition(position: { x: number; y: number }): this {
		this.position = position;
		shownMenus.push(this);
		return this;
	}

	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		callback(item);
		this.items.push(item);
		return this;
	}
	addSeparator(): this {
		return this;
	}
	titles(): string[] {
		return this.items.map((item) => item.title);
	}
	item(title: string): MenuItem {
		const item = this.items.find((entry) => entry.title === title);
		if (!item) throw new Error(`No menu item "${title}" in [${this.titles().join(", ")}]`);
		return item;
	}
}

// ------------------------------------------------------------------ settings

class ValueComponent<T> {
	protected changeHandler: ((value: T) => unknown) | null = null;
	constructor(protected value: T) {}
	getValue(): T {
		return this.value;
	}
	setValue(value: T): this {
		this.value = value;
		return this;
	}
	onChange(handler: (value: T) => unknown): this {
		this.changeHandler = handler;
		return this;
	}
	/** Simulates the user changing the value. */
	change(value: T): unknown {
		this.value = value;
		return this.changeHandler?.(value);
	}
}

export class ToggleComponent extends ValueComponent<boolean> {
	constructor(readonly toggleEl: HTMLElement) {
		super(false);
	}
	setValue(value: boolean): this {
		this.toggleEl.toggleClass("is-enabled", value);
		return super.setValue(value);
	}
}

export class DropdownComponent extends ValueComponent<string> {
	options: Record<string, string> = {};
	constructor(readonly selectEl: HTMLSelectElement) {
		super("");
	}
	addOption(value: string, display: string): this {
		this.options[value] = display;
		this.selectEl.createEl("option", { text: display, attr: { value } });
		return this;
	}
	setValue(value: string): this {
		this.selectEl.value = value;
		return super.setValue(value);
	}
	addOptions(options: Record<string, string>): this {
		for (const [value, display] of Object.entries(options)) this.addOption(value, display);
		return this;
	}
}

export class ButtonComponent {
	disabled = false;
	cta = false;
	destructive = false;
	private handler: ((event: MouseEvent) => unknown) | null = null;
	constructor(readonly buttonEl: HTMLButtonElement) {}
	setButtonText(text: string): this {
		this.buttonEl.setText(text);
		return this;
	}
	setCta(): this {
		this.cta = true;
		return this;
	}
	setDestructive(): this {
		this.destructive = true;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.buttonEl.disabled = disabled;
		return this;
	}
	onClick(handler: (event: MouseEvent) => unknown): this {
		this.handler = handler;
		return this;
	}
	/** Simulates a click and returns whatever the handler returned (e.g. a promise). */
	click(): unknown {
		return this.handler?.(new MouseEvent("click"));
	}
}

export type SettingComponent = ToggleComponent | DropdownComponent | ButtonComponent;

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: SettingComponent[] = [];
	isHeading = false;

	constructor(containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		const infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = infoEl.createDiv({ cls: "setting-item-name" });
		this.descEl = infoEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
		settingsCreated.push(this);
	}

	setName(name: string | DocumentFragment): this {
		this.nameEl.replaceChildren(name);
		return this;
	}
	setDesc(desc: string | DocumentFragment): this {
		this.descEl.replaceChildren(desc);
		return this;
	}
	setClass(cls: string): this {
		this.settingEl.addClass(cls);
		return this;
	}
	setHeading(): this {
		this.isHeading = true;
		this.settingEl.addClass("setting-item-heading");
		return this;
	}
	addToggle(callback: (toggle: ToggleComponent) => unknown): this {
		const toggle = new ToggleComponent(this.controlEl.createDiv({ cls: "checkbox-container" }));
		this.components.push(toggle);
		callback(toggle);
		return this;
	}
	addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
		const dropdown = new DropdownComponent(
			this.controlEl.createEl("select", { cls: "dropdown" }),
		);
		this.components.push(dropdown);
		callback(dropdown);
		return this;
	}
	addButton(callback: (button: ButtonComponent) => unknown): this {
		const button = new ButtonComponent(this.controlEl.createEl("button"));
		this.components.push(button);
		callback(button);
		return this;
	}
}

/** Every Setting constructed, oldest first. Tests may clear it. */
export const settingsCreated: Setting[] = [];

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = createElIn(null, "div", "vertical-tab-content");
	}

	display(): void {}
	hide(): void {}
}

// ------------------------------------------------------------------ views

export class View extends Component {
	app: App;
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		this.containerEl = createElIn(null, "div", "workspace-leaf-content");
	}

	getViewType(): string {
		return "empty";
	}
}

export class FileView extends View {
	file: TFile | null = null;
}

export class MarkdownView extends FileView {
	mode: "source" | "preview" = "source";
	/** How often the reading view was rendered again. */
	rerendered = 0;
	previewMode = { rerender: () => (this.rerendered += 1) };

	getViewType(): string {
		return "markdown";
	}
	getMode(): "source" | "preview" {
		return this.mode;
	}
}

export class WorkspaceLeaf {
	app: App;
	view: View;
	/** The split the leaf lives in (main area, sidebar, pop-out). */
	root: unknown = null;
	/** View state while the leaf is deferred (not loaded yet). */
	state: Record<string, unknown> = {};

	constructor(app: App) {
		this.app = app;
		this.view = new View(this);
	}

	getRoot(): unknown {
		return this.root;
	}

	getViewState(): { type: string; state: Record<string, unknown> } {
		return { type: this.view.getViewType(), state: this.state };
	}
}

// ------------------------------------------------------------------ app

/** The shape the fake App exposes; see tests/fake-app.ts for a builder. */
export interface App {
	vault: unknown;
	workspace: unknown;
	metadataCache: unknown;
	fileManager: unknown;
}
