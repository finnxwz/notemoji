import { DataAdapter, normalizePath } from "obsidian";
import type { SpriteCache } from "./emoji-sprites";

/**
 * The pre-rendered emoji images on disk, in the plugin folder (removed with
 * the plugin):
 *
 *     cache/sprites/<style>/<device>-<details>/<category>.png
 *
 * One folder per style, so deleting a style removes its images in one go.
 * Inside, one folder per kind of device (the same style looks different on
 * Windows and iOS, and the folder syncs with the vault), screen density,
 * drawing format, look of the emoji and emoji list. When a newer folder for
 * the same device and density is written, the older ones are removed.
 */
export class SpriteCacheFolder implements SpriteCache {
	constructor(
		private readonly adapter: DataAdapter,
		readonly folder: string,
	) {}

	/** A cached image, or null when there is none (or only a partly written or synced one). */
	async read(key: string, category: string): Promise<ArrayBuffer | null> {
		const path = this.path(key, category);
		if (!(await this.adapter.exists(path))) return null;
		const data = await this.adapter.readBinary(path);
		return isCompletePng(data) ? data : null;
	}

	async write(key: string, category: string, data: ArrayBuffer): Promise<void> {
		const keyFolder = normalizePath(`${this.folder}/${key}`);
		if (!(await this.adapter.exists(keyFolder))) {
			await this.removeOutdated(key);
			await this.makeFolders(keyFolder);
		}
		await this.adapter.writeBinary(this.path(key, category), data);
	}

	/** Removes the images of one style (all devices), e.g. after it was deleted. */
	async removeStyle(style: string): Promise<void> {
		const path = normalizePath(`${this.folder}/${style}`);
		if (await this.adapter.exists(path)) await this.adapter.rmdir(path, true);
	}

	async clear(): Promise<void> {
		if (await this.adapter.exists(this.folder)) await this.adapter.rmdir(this.folder, true);
	}

	/** Total size of the cached images in bytes. */
	async size(): Promise<number> {
		return (await this.adapter.exists(this.folder)) ? this.sizeOf(this.folder) : 0;
	}

	private async sizeOf(folder: string): Promise<number> {
		const { files, folders } = await this.adapter.list(folder);
		let bytes = 0;
		for (const file of files) bytes += (await this.adapter.stat(file))?.size ?? 0;
		for (const child of folders) bytes += await this.sizeOf(child);
		return bytes;
	}

	/** Drops folders of the same style, device and density that a new one replaces. */
	private async removeOutdated(key: string): Promise<void> {
		const slash = key.lastIndexOf("/");
		if (slash === -1) return;
		const styleFolder = normalizePath(`${this.folder}/${key.slice(0, slash)}`);
		if (!(await this.adapter.exists(styleFolder))) return;
		// `<device>-<density>-…`: the first two parts say which device it is for.
		const device = key
			.slice(slash + 1)
			.split("-")
			.slice(0, 2)
			.join("-");
		const { folders } = await this.adapter.list(styleFolder);
		for (const folder of folders) {
			const name = folder.slice(folder.lastIndexOf("/") + 1);
			if (name.split("-").slice(0, 2).join("-") === device)
				await this.adapter.rmdir(folder, true);
		}
	}

	private async makeFolders(path: string): Promise<void> {
		let current = "";
		for (const part of path.split("/")) {
			current = current === "" ? part : `${current}/${part}`;
			if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current);
		}
	}

	private path(key: string, category: string): string {
		return normalizePath(`${this.folder}/${key}/${category}.png`);
	}
}

const PNG_START = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The last chunk of every PNG: `IEND` and its checksum. */
const PNG_END = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

/** Whether `data` is a whole PNG file, from its signature to its end chunk. */
export function isCompletePng(data: ArrayBuffer): boolean {
	const bytes = new Uint8Array(data);
	const end = bytes.length - PNG_END.length;
	return (
		bytes.length >= PNG_START.length + PNG_END.length &&
		PNG_START.every((byte, i) => bytes[i] === byte) &&
		PNG_END.every((byte, i) => bytes[end + i] === byte)
	);
}
