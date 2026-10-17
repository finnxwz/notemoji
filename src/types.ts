/**
 * Minimal typings for the parts of the file explorer we rely on.
 *
 * Obsidian does not expose a public API for decorating file explorer items, so
 * the plugin reads the file explorer view's internal `fileItems` map (path →
 * DOM element). That map has been stable for years and is what community icon
 * plugins build on, but it is not guaranteed by Obsidian; every access below is
 * therefore defensive and the rendering code degrades gracefully when it is
 * missing (see README, "Known limitations").
 */
import type { TAbstractFile } from "obsidian";

export interface FileExplorerItem {
	/** @deprecated Obsidian < 1.2 exposed the title element as `titleEl`. */
	titleEl?: HTMLElement;
	/** @deprecated Obsidian < 1.2 exposed the inner title as `titleInnerEl`. */
	titleInnerEl?: HTMLElement;
	/** The `.nav-file-title` / `.nav-folder-title` element. */
	selfEl?: HTMLElement;
	/** The `.tree-item-inner` element that contains the visible name. */
	innerEl?: HTMLElement;
	file?: TAbstractFile;
}

export interface FileExplorerView {
	containerEl?: HTMLElement;
	fileItems?: Record<string, FileExplorerItem>;
}

