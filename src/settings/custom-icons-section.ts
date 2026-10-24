import { Notice, Setting } from "obsidian";
import { confirm } from "../confirm-modal";
import { formatBytes, plural } from "../format";
import { ICON_STORAGE_LIMIT, StoredIconType } from "../icons/custom-icons";
import type NotemojiPlugin from "../main";

const FORMAT_NAMES: Record<StoredIconType, string> = {
	"image/png": "PNG",
	"image/jpeg": "JPEG",
	"image/gif": "GIF",
	"image/webp": "WebP",
	"image/svg+xml": "SVG",
};

/** "a, b, c" or "a, b, c and 7 more" */
function listNames(names: readonly string[], max = 10): string {
	const shown = names.slice(0, max).join(", ");
	return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/**
 * The custom icons in the settings: the storage used and its limit, every
 * icon with its preview, format, size and uses, and icons that are used but
 * missing. Re-renders only itself after a change.
 */
export class CustomIconsSection {
	private readonly el: HTMLElement;

	constructor(
		private readonly plugin: NotemojiPlugin,
		parentEl: HTMLElement,
	) {
		this.el = parentEl.createDiv({ cls: "notemoji-custom-icons-section" });
		this.render();
	}

	render(): void {
		const { plugin, el: containerEl } = this;
		containerEl.empty();

		const library = plugin.customIcons;
		const ids = library.list();
		const uses = plugin.icons.customUses();
		const { count, bytes } = library.usage();
		const unused = ids.filter((id) => !uses.has(id));

		const storage = new Setting(containerEl)
			.setName("Storage")
			.setClass("notemoji-icon-storage");
		storage.descEl.empty();
		storage.descEl.createDiv({
			text:
				count === 0
					? "No custom icons yet. Upload your own images in the picker's custom icons section."
					: `${formatBytes(bytes)} of 3 MB used by ${plural(count, "icon", "icons")}.`,
		});
		storage.descEl
			.createDiv({ cls: "notemoji-storage-bar" })
			.createDiv({ cls: "notemoji-storage-bar-fill" })
			.setCssProps({
				"--notemoji-storage-used": `${Math.min(100, (bytes / ICON_STORAGE_LIMIT) * 100)}%`,
			});
		storage.descEl.createDiv({
			text:
				"Icons are saved in Notemoji's data.json, so they sync together with your emoji. " +
				"They can use up to 3 MB because Obsidian Sync skips files larger than 5 MB (Standard plan), " +
				"which would stop your emoji from syncing. That is room for at least 50 icons, usually many more. " +
				"Images are scaled down to 512 pixels, which stays sharp even on very dense screens.",
		});
		if (unused.length > 0) {
			storage.addButton((button) =>
				button.setButtonText(`Delete ${unused.length} unused`).onClick(async () => {
					const confirmed = await confirm(plugin.app, {
						title: "Delete unused custom icons?",
						message: `${plural(unused.length, "icon is", "icons are")} not used by any note, folder or file and will be deleted: ${listNames(unused)}.`,
						confirmText: "Delete",
						warning: true,
					});
					if (!confirmed) return;
					for (const id of unused) library.remove(id);
					plugin.icons.forgetCustomIcons(unused);
					this.render();
				}),
			);
		}
		storage.addButton((button) =>
			button
				.setButtonText("Delete all")
				.setWarning()
				.setDisabled(count === 0)
				.onClick(async () => {
					const confirmed = await confirm(plugin.app, {
						title: "Delete all custom icons?",
						message: `All ${plural(library.usage().count, "custom icon", "custom icons")} will be deleted. Notes, folders and files using them will show no icon anymore.`,
						confirmText: "Delete all",
						warning: true,
					});
					if (!confirmed) return;
					// Also assignments of missing icons, but not of icons kept for a newer version.
					const forget = new Set([
						...library.list(),
						...plugin.icons.customUses().keys(),
					]);
					library.removeAll();
					plugin.icons.forgetCustomIcons(
						[...forget].filter((id) => !library.isReserved(id)),
					);
					new Notice("Deleted all custom icons.");
					this.render();
				}),
		);

		// Icons in a format of a newer version are kept for it, not missing.
		const missing = [...uses.keys()].filter(
			(id) => !library.get(id) && !library.isReserved(id),
		);
		if (missing.length > 0) {
			const items = missing.reduce((sum, id) => sum + (uses.get(id) ?? 0), 0);
			new Setting(containerEl)
				.setName("Missing icons")
				.setDesc(
					`${plural(items, "item uses", "items use")} ${missing.length === 1 ? "an icon that is" : "icons that are"} no longer in your library (${listNames(missing)}), ` +
						`for example after deleting ${missing.length === 1 ? "it" : "them"} on another device. They show an empty space.`,
				)
				.addButton((button) =>
					button.setButtonText("Remove").onClick(async () => {
						const confirmed = await confirm(plugin.app, {
							title: "Remove missing icons?",
							message: `${plural(items, "item", "items")} will show no icon anymore.`,
							confirmText: "Remove",
							warning: true,
						});
						if (!confirmed) return;
						plugin.icons.forgetCustomIcons(missing);
						this.render();
					}),
				);
		}

		for (const id of ids) {
			const icon = library.get(id);
			if (!icon) continue;
			const used = uses.get(id) ?? 0;
			const row = new Setting(containerEl).setClass("notemoji-icon-row").setName(id);
			const url = library.url(id);
			if (url) {
				row.nameEl.prepend(
					createEl("img", {
						cls: "notemoji-icon-row-image",
						attr: { src: url, alt: "", draggable: "false" },
					}),
				);
			}
			row.setDesc(
				[
					FORMAT_NAMES[icon.type],
					formatBytes(icon.data.length),
					used === 0 ? "Not used" : `Used ${plural(used, "time", "times")}`,
				].join(" · "),
			);
			row.addButton((button) =>
				button.setButtonText("Delete").onClick(async () => {
					if (await plugin.deleteCustomIcon(id)) this.render();
				}),
			);
		}
	}
}
