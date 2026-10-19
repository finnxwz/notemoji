import { DataAdapter, normalizePath } from "obsidian";
import { isCustomFileName, uniqueFileName } from "./icon-value";

/** Largest image accepted as a custom icon. */
export const MAX_CUSTOM_ICON_BYTES = 2 * 1024 * 1024;

export class CustomIconError extends Error {}

/**
 * The user's own icons: image files in `<plugin folder>/icons/`.
 *
 * Living inside the plugin folder means Obsidian removes them together with
 * the plugin on uninstall, so nothing is left behind in the vault. Files are
 * always displayed through `<img>`, which never runs scripts inside SVGs.
 */
export class CustomIconLibrary {
	private cache: string[] | null = null;

	constructor(
		private readonly adapter: DataAdapter,
		readonly folder: string,
	) {}

	/** Resource URL for displaying a custom icon. */
	url(file: string): string {
		return this.adapter.getResourcePath(this.path(file));
	}

	/** File names of all custom icons, sorted. */
	async list(): Promise<string[]> {
		if (this.cache) return this.cache;
		if (!(await this.adapter.exists(this.folder))) return (this.cache = []);
		const { files } = await this.adapter.list(this.folder);
		this.cache = files
			.map((path) => path.slice(path.lastIndexOf("/") + 1))
			.filter(isCustomFileName)
			.sort((a, b) => a.localeCompare(b));
		return this.cache;
	}

	/** Stores an uploaded image and returns its file name in the library. */
	async add(name: string, data: ArrayBuffer): Promise<string> {
		if (data.byteLength > MAX_CUSTOM_ICON_BYTES) {
			throw new CustomIconError(`"${name}" is larger than 2 MB.`);
		}
		const file = uniqueFileName(name, new Set(await this.list()));
		if (!file) {
			throw new CustomIconError(`"${name}" is not a PNG, JPG, GIF, WebP or SVG image.`);
		}
		if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
		await this.adapter.writeBinary(this.path(file), data);
		this.cache = null;
		return file;
	}

	async remove(file: string): Promise<void> {
		if (!isCustomFileName(file)) return;
		if (await this.adapter.exists(this.path(file))) await this.adapter.remove(this.path(file));
		this.cache = null;
	}

	/** Deletes the whole icon folder. */
	async removeAll(): Promise<void> {
		if (await this.adapter.exists(this.folder)) await this.adapter.rmdir(this.folder, true);
		this.cache = null;
	}

	/** Number of icons and their total size in bytes. */
	async usage(): Promise<{ count: number; bytes: number }> {
		const files = await this.list();
		let bytes = 0;
		for (const file of files) bytes += (await this.adapter.stat(this.path(file)))?.size ?? 0;
		return { count: files.length, bytes };
	}

	/** Forgets the cached listing, e.g. after sync may have changed the folder. */
	refresh(): void {
		this.cache = null;
	}

	private path(file: string): string {
		return normalizePath(`${this.folder}/${file}`);
	}
}
