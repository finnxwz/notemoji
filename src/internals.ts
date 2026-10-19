/**
 * Typings for the undocumented Obsidian internals Notemoji relies on.
 *
 * Obsidian has no public API for decorating the file explorer or tab headers.
 * The fields below have been stable for years and are what icon plugins build
 * on, but they are not guaranteed: every access is defensive, and renderers
 * simply skip what they cannot find.
 */
import type { TAbstractFile, WorkspaceLeaf } from "obsidian";

export interface FileExplorerItem {
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

/** Internal field of a workspace leaf: the title element of its tab header. */
export interface LeafWithTabHeader extends WorkspaceLeaf {
	tabHeaderInnerTitleEl?: HTMLElement;
}

/** Path of the file shown in a leaf, also while the leaf is still deferred. */
export function filePathOfLeaf(leaf: WorkspaceLeaf): string | undefined {
	const view = leaf.view as { file?: TAbstractFile | null } | undefined;
	if (view?.file?.path) return view.file.path;

	// Since Obsidian 1.7.2 background tabs stay deferred until they are opened.
	const state = leaf.getViewState().state as { file?: unknown } | undefined;
	return typeof state?.file === "string" ? state.file : undefined;
}
