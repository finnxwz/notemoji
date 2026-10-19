import type { TAbstractFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { parseData } from "../../src/data";
import { IconService } from "../../src/icons/icon-service";
import { createFakeApp, FakeAppOptions } from "../fake-app";

function setup(options: FakeAppOptions & { data?: unknown } = {}) {
	const app = createFakeApp(options);
	const data = parseData(options.data ?? null);
	const save = vi.fn();
	const service = new IconService(app.asApp, data, save);
	// Wired like in main.ts.
	app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
		service.handleRename(file, oldPath),
	);
	const changes = vi.fn();
	service.onChange(changes);
	const item = (path: string) => app.vault.add(path) as unknown as TAbstractFile;
	return { app, data, service, save, changes, item };
}

describe("setting and removing", () => {
	it("stores notes, folders and files in data.json", () => {
		const { data, service, save, changes, item } = setup();
		expect(service.setIcon(item("Notes/A.md"), "🚀")).toBe(true);
		expect(service.setIcon(item("Folder"), "📁")).toBe(true);
		expect(service.setIcon(item("doc.pdf"), " 📄 ")).toBe(true);
		expect(data.icons.toRecord()).toEqual({
			"Notes/A.md": "🚀",
			Folder: "📁",
			"doc.pdf": "📄",
		});
		expect(service.get("Notes/A.md")).toBe("🚀");
		expect(save).toHaveBeenCalledTimes(3);
		expect(changes).toHaveBeenCalledTimes(3);
	});

	it("does nothing for unchanged or invalid input", () => {
		const { service, save, item } = setup({ data: { icons: { "A.md": "🚀" } } });
		expect(service.setIcon(item("A.md"), "🚀")).toBe(false);
		expect(service.setIcon(item("A.md"), "hello")).toBe(false);
		expect(service.setIcon(item("A.md"), "")).toBe(false);
		expect(save).not.toHaveBeenCalled();
	});

	it("removes an emoji and reports when there was none", () => {
		const { service, save, item } = setup({ data: { icons: { "A.md": "🚀" } } });
		expect(service.removeIcon(item("A.md"))).toBe(true);
		expect(service.removeIcon(item("A.md"))).toBe(false);
		expect(service.get("A.md")).toBeUndefined();
		expect(save).toHaveBeenCalledTimes(1);
	});
});

describe("vault events", () => {
	it("moves emoji with renames, including folder contents", () => {
		const { app, data, save } = setup({
			files: ["Projects/sub/doc.pdf", "Projects/A.md", "Other.md"],
			data: {
				icons: {
					Projects: "📁",
					"Projects/A.md": "🚀",
					"Projects/sub/doc.pdf": "📄",
					"Other.md": "🎉",
				},
			},
		});
		app.vault.rename("Projects", "Work");
		expect(data.icons.toRecord()).toEqual({
			Work: "📁",
			"Work/A.md": "🚀",
			"Work/sub/doc.pdf": "📄",
			"Other.md": "🎉",
		});
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("ignores renames of items without emoji", () => {
		const { app, save, changes } = setup({
			files: ["A.md"],
			data: { icons: { "B.md": "🚀" } },
		});
		app.vault.rename("A.md", "C.md");
		expect(save).not.toHaveBeenCalled();
		expect(changes).not.toHaveBeenCalled();
	});

	it("keeps data.json untouched on delete (sync-safe)", () => {
		const { app, data, service, save } = setup({
			files: ["Folder/A.md"],
			data: { icons: { Folder: "📁", "Folder/A.md": "🚀" } },
		});
		app.vault.remove("Folder");
		expect(data.icons.size).toBe(2);
		expect(save).not.toHaveBeenCalled();
		expect(service.missingPaths()).toEqual(["Folder", "Folder/A.md"]);
	});
});

describe("maintenance", () => {
	it("removes entries of missing items on request", () => {
		const { data, service } = setup({
			files: ["Alive"],
			data: { icons: { Alive: "🌱", Gone: "👻", "Gone/doc.pdf": "📄" } },
		});
		expect(service.removeMissing()).toBe(2);
		expect(data.icons.toRecord()).toEqual({ Alive: "🌱" });
		expect(service.removeMissing()).toBe(0);
	});

	it("notifies after data.json was replaced by a sync", () => {
		const { service, changes } = setup({ data: { icons: { "A.md": "🚀" } } });
		service.replaceData(parseData({ icons: { "A.md": "🌱" } }));
		expect(service.get("A.md")).toBe("🌱");
		expect(changes).toHaveBeenCalledTimes(1);
	});
});

describe("recent", () => {
	it("remembers emoji and saves only on change", () => {
		const { service, save } = setup();
		service.rememberRecent("🚀");
		service.rememberRecent("🎉");
		service.rememberRecent("🎉");
		expect(service.recent).toEqual(["🎉", "🚀"]);
		expect(save).toHaveBeenCalledTimes(2);
	});
});

describe("custom icons", () => {
	it("stores custom icons and forgets them when their file is deleted", () => {
		const { data, service, save, item } = setup({ data: { recent: ["custom:a.png", "🚀"] } });
		expect(service.setIcon(item("A.md"), "custom:a.png")).toBe(true);
		expect(service.setIcon(item("Folder"), "custom:a.png")).toBe(true);
		expect(service.setIcon(item("B.md"), "custom:b.svg")).toBe(true);
		expect(service.setIcon(item("C.md"), "custom:../x.png")).toBe(false);
		expect(service.countCustomUses("a.png")).toBe(2);

		save.mockClear();
		service.forgetCustomIcons(["a.png"]);
		expect(data.icons.toRecord()).toEqual({ "B.md": "custom:b.svg" });
		expect(service.recent).toEqual(["🚀"]);
		expect(save).toHaveBeenCalledTimes(1);

		service.forgetCustomIcons();
		expect(data.icons.size).toBe(0);
		service.forgetCustomIcons();
		expect(save).toHaveBeenCalledTimes(2);
	});
});
