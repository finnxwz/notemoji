/**
 * A small fake of the `obsidian` module.
 *
 * The real package only ships type definitions, so tests (and the README demo
 * scene) alias `obsidian` to this file. It implements just what Notemoji uses,
 * with the same names and DOM structure as the real app.
 */

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

export const apiVersion = "1.7.2";

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

export function setIcon(parent: HTMLElement, iconId: string): void {
	parent.empty();
	parent.createSpan({ cls: "svg-icon", attr: { "data-icon": iconId } });
}

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/|\/$/g, "");
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

export class Menu {
	items: MenuItem[] = [];

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
}

export class DropdownComponent extends ValueComponent<string> {
	options: Record<string, string> = {};
	constructor(readonly selectEl: HTMLSelectElement) {
		super("");
	}
	addOption(value: string, display: string): this {
		this.options[value] = display;
		return this;
	}
	addOptions(options: Record<string, string>): this {
		Object.assign(this.options, options);
		return this;
	}
}

export class ButtonComponent {
	disabled = false;
	cta = false;
	warning = false;
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
	setWarning(): this {
		this.warning = true;
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
	getViewType(): string {
		return "markdown";
	}
}

export class WorkspaceLeaf {
	app: App;
	view: View;
	constructor(app: App) {
		this.app = app;
		this.view = new View(this);
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
