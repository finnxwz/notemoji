import { describe, expect, it, vi } from "vitest";
import { parseData } from "../../src/icons/data";
import { IconService } from "../../src/icons/icon-service";
import { createFakeApp, FakeAppOptions, flush } from "../fake-app";
import type { TAbstractFile, TFile } from "obsidian";

function setup(options: FakeAppOptions & { data?: unknown; confirm?: boolean } = {}) {
	const app = createFakeApp(options);
	const data = parseData(options.data ?? null);
	const save = vi.fn();
	const confirmReplace = vi.fn(() => Promise.resolve(options.confirm ?? true));
	const service = new IconService(app.asApp, data, { save, confirmReplace });
	// Wired like in main.ts.
	app.vault.on("rename", (file: TAbstractFile, oldPath: string) =>
		service.handleRename(file, oldPath),
	);
	app.vault.on("delete", (file: TAbstractFile) => service.handleDelete(file));
	app.metadataCache.on("changed", (file: TFile) => service.handleMetadataChange(file));
	const changes = vi.fn();
	service.onChange(changes);
	service.indexNotes();
	changes.mockClear();
	const file = (path: string) => app.vault.add(path) as unknown as TFile;
	return { app, data, service, save, confirmReplace, changes, file };
}

describe("reading", () => {
	it("reads notes from frontmatter and everything else from data.json", () => {
		const { service } = setup({
			frontmatter: {
				"A.md": { icon: "🚀" },
				"B.md": { icon: "LiHome" },
				"C.md": { tags: [] },
			},
			data: { icons: { Folder: "📁", "image.png": "🖼️" } },
		});
		expect(service.get("A.md")).toBe("🚀");
		expect(service.get("B.md")).toBeUndefined();
		expect(service.get("C.md")).toBeUndefined();
		expect(service.get("Folder")).toBe("📁");
		expect(service.get("image.png")).toBe("🖼️");
	});

	it("prefers frontmatter over a version 1 entry", () => {
		const { service } = setup({
			frontmatter: { "A.md": { icon: "🌱" } },
			data: { icons: { "A.md": "🎉", "B.md": "🎈" } },
		});
		expect(service.get("A.md")).toBe("🌱");
		expect(service.get("B.md")).toBe("🎈");
	});

	it("follows edits made in the Properties panel", () => {
		const { app, service, changes, file } = setup({ frontmatter: { "A.md": {} } });
		app.metadataCache.set(file("A.md"), { icon: "🌱" });
		expect(service.get("A.md")).toBe("🌱");
		expect(changes).toHaveBeenCalledTimes(1);

		app.metadataCache.set(file("A.md"), { icon: "🌱", other: 1 });
		expect(changes).toHaveBeenCalledTimes(1);

		app.metadataCache.set(file("A.md"), {});
		expect(service.get("A.md")).toBeUndefined();
		expect(changes).toHaveBeenCalledTimes(2);
	});
});

describe("setting", () => {
	it("writes notes to frontmatter, not data.json", async () => {
		const { app, service, save, file } = setup({ frontmatter: { "A.md": { tags: ["x"] } } });
		expect(await service.setIcon(file("A.md"), "🚀")).toBe(true);
		expect(app.metadataCache.frontmatter.get("A.md")).toEqual({ tags: ["x"], icon: "🚀" });
		expect(service.get("A.md")).toBe("🚀");
		expect(save).not.toHaveBeenCalled();
	});

	it("writes folders and other files to data.json", async () => {
		const { data, service, save, file } = setup();
		await service.setIcon(file("Folder"), "📁");
		await service.setIcon(file("doc.pdf"), "📄");
		expect(data.icons.toRecord()).toEqual({ Folder: "📁", "doc.pdf": "📄" });
		expect(save).toHaveBeenCalledTimes(2);
	});

	it("moves a version 1 note entry into frontmatter on change", async () => {
		const { app, data, service, save, file } = setup({ data: { icons: { "A.md": "🎉" } } });
		await service.setIcon(file("A.md"), "🚀");
		expect(app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "🚀" });
		expect(data.icons.size).toBe(0);
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the emoji is unchanged or invalid", async () => {
		const { app, service, changes, file } = setup({ frontmatter: { "A.md": { icon: "🚀" } } });
		expect(await service.setIcon(file("A.md"), "🚀")).toBe(false);
		expect(await service.setIcon(file("A.md"), "hello")).toBe(false);
		expect(app.fileManager.writes).toBe(0);
		expect(changes).not.toHaveBeenCalled();
	});

	it("asks before replacing a value that is not an emoji", async () => {
		const declined = setup({ frontmatter: { "A.md": { icon: "LiHome" } }, confirm: false });
		expect(await declined.service.setIcon(declined.file("A.md"), "🚀")).toBe(false);
		expect(declined.confirmReplace).toHaveBeenCalledWith(expect.anything(), "LiHome", "🚀");
		expect(declined.app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "LiHome" });

		const accepted = setup({ frontmatter: { "A.md": { icon: "LiHome" } }, confirm: true });
		expect(await accepted.service.setIcon(accepted.file("A.md"), "🚀")).toBe(true);
		expect(accepted.app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "🚀" });
	});

	it("does not ask when the property is empty", async () => {
		const { service, confirmReplace, file } = setup({
			frontmatter: { "A.md": { icon: null } },
		});
		await service.setIcon(file("A.md"), "🚀");
		expect(confirmReplace).not.toHaveBeenCalled();
	});

	it("propagates write errors and changes nothing", async () => {
		const { app, service, file } = setup({ frontmatter: { "A.md": {} } });
		app.fileManager.failWith = new Error("invalid YAML");
		await expect(service.setIcon(file("A.md"), "🚀")).rejects.toThrow("invalid YAML");
		expect(service.get("A.md")).toBeUndefined();
	});

	it("does not emit twice when Obsidian re-indexes the written note", async () => {
		const { service, changes, file } = setup({ frontmatter: { "A.md": {} } });
		await service.setIcon(file("A.md"), "🚀");
		await flush();
		expect(changes).toHaveBeenCalledTimes(1);
	});
});

describe("removing", () => {
	it("deletes the property of a note", async () => {
		const { app, service, file } = setup({ frontmatter: { "A.md": { icon: "🚀", tags: [] } } });
		expect(await service.removeIcon(file("A.md"))).toBe(true);
		expect(app.metadataCache.frontmatter.get("A.md")).toEqual({ tags: [] });
	});

	it("removes right after setting, before the metadata cache caught up", async () => {
		const { app, service, file } = setup({ frontmatter: { "A.md": {} } });
		await service.setIcon(file("A.md"), "🚀");
		// The cache still reports the old (empty) frontmatter.
		const realCache = app.metadataCache.getFileCache.bind(app.metadataCache);
		app.metadataCache.getFileCache = () => ({ frontmatter: {} });
		expect(await service.removeIcon(file("A.md"))).toBe(true);
		app.metadataCache.getFileCache = realCache;
		expect(app.metadataCache.frontmatter.get("A.md")).toEqual({});
		expect(service.get("A.md")).toBeUndefined();
	});

	it("leaves a property alone that is not an emoji", async () => {
		const { app, service, file } = setup({ frontmatter: { "A.md": { icon: "LiHome" } } });
		expect(await service.removeIcon(file("A.md"))).toBe(false);
		expect(app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "LiHome" });
	});

	it("removes data.json entries, including version 1 notes", async () => {
		const { data, service, file } = setup({ data: { icons: { Folder: "📁", "A.md": "🎉" } } });
		await service.removeIcon(file("Folder"));
		await service.removeIcon(file("A.md"));
		expect(data.icons.size).toBe(0);
	});
});

describe("vault events", () => {
	it("moves data.json entries and the note index on rename", () => {
		const { app, data, service, save } = setup({
			files: ["Projects/sub/doc.pdf"],
			frontmatter: { "Projects/A.md": { icon: "🚀" } },
			data: { icons: { Projects: "📁", "Projects/sub/doc.pdf": "📄" } },
		});
		app.vault.rename("Projects", "Work");
		expect(data.icons.toRecord()).toEqual({ Work: "📁", "Work/sub/doc.pdf": "📄" });
		expect(service.get("Work/A.md")).toBe("🚀");
		expect(service.get("Projects/A.md")).toBeUndefined();
		expect(save).toHaveBeenCalledTimes(1);
	});

	it("keeps data.json untouched on delete (sync-safe) and hides the entry", () => {
		const { app, data, service, save } = setup({
			files: ["Folder", "Folder/A.md"],
			frontmatter: { "Folder/A.md": { icon: "🚀" } },
			data: { icons: { Folder: "📁" } },
		});
		app.vault.remove("Folder");
		expect(data.icons.get("Folder")).toBe("📁");
		expect(service.get("Folder/A.md")).toBeUndefined();
		expect(save).not.toHaveBeenCalled();
		expect(service.missingPaths()).toEqual(["Folder"]);
	});
});

describe("maintenance", () => {
	it("removes entries of missing items on request", () => {
		const { data, service } = setup({
			files: ["Alive"],
			data: { icons: { Alive: "🌱", Gone: "👻", "Gone/doc.pdf": "📄" } },
		});
		expect(service.missingPaths()).toEqual(["Gone", "Gone/doc.pdf"]);
		expect(service.removeMissing()).toBe(2);
		expect(data.icons.toRecord()).toEqual({ Alive: "🌱" });
		expect(service.removeMissing()).toBe(0);
	});

	it("moves version 1 note emoji into frontmatter", async () => {
		const { app, data, service } = setup({
			files: ["Folder"],
			frontmatter: { "A.md": {}, "B.md": { icon: "🌱" }, "C.md": { icon: "LiHome" } },
			data: { icons: { "A.md": "🚀", "B.md": "🎉", "C.md": "🎈", Folder: "📁" } },
		});
		expect(service.notesInData().map((file) => file.path)).toEqual(["A.md", "B.md", "C.md"]);
		expect(await service.moveNotesToFrontmatter()).toEqual({ moved: 2, skipped: 1 });
		expect(app.metadataCache.frontmatter.get("A.md")).toEqual({ icon: "🚀" });
		expect(app.metadataCache.frontmatter.get("B.md")).toEqual({ icon: "🌱" });
		expect(app.metadataCache.frontmatter.get("C.md")).toEqual({ icon: "LiHome" });
		expect(data.icons.toRecord()).toEqual({ "C.md": "🎈", Folder: "📁" });
	});

	it("keeps the progress when a note cannot be written", async () => {
		const { app, data, service, save } = setup({
			frontmatter: { "A.md": { icon: "🌱" }, "B.md": {} },
			data: { icons: { "A.md": "🎉", "B.md": "🚀" } },
		});
		app.fileManager.failWith = new Error("invalid YAML");
		await expect(service.moveNotesToFrontmatter()).rejects.toThrow();
		expect(data.icons.toRecord()).toEqual({ "B.md": "🚀" });
		expect(save).toHaveBeenCalled();
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
