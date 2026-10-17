import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ICON_DATA_VERSION, IconStore } from "../src/icon-store";

function storeOf(entries: Record<string, string>): IconStore {
	return IconStore.fromData({ version: ICON_DATA_VERSION, icons: entries });
}

describe("IconStore basics", () => {
	it("stores, updates and removes emoji", () => {
		const store = new IconStore();

		assert.equal(store.set("Notes/A.md", "🚀"), true);
		assert.equal(store.get("Notes/A.md"), "🚀");

		assert.equal(store.set("Notes/A.md", "🎉"), true);
		assert.equal(store.get("Notes/A.md"), "🎉");

		// No change, so nothing needs to be saved.
		assert.equal(store.set("Notes/A.md", "🎉"), false);

		assert.equal(store.remove("Notes/A.md"), true);
		assert.equal(store.remove("Notes/A.md"), false);
		assert.equal(store.get("Notes/A.md"), undefined);
	});

	it("rejects invalid emoji and empty paths", () => {
		const store = new IconStore();
		assert.equal(store.set("A.md", "hello"), false);
		assert.equal(store.set("A.md", ""), false);
		assert.equal(store.set("", "🚀"), false);
		assert.equal(store.size, 0);
	});

	it("normalises emoji before storing", () => {
		const store = new IconStore();
		store.set("A.md", " 👨‍👩‍👧‍👦 ");
		assert.equal(store.get("A.md"), "👨‍👩‍👧‍👦");
	});
});

describe("IconStore.rename", () => {
	it("moves the icon of a renamed file", () => {
		const store = storeOf({ "Notes/A.md": "🚀", "Notes/B.md": "🎉" });
		assert.equal(store.rename("Notes/A.md", "Notes/C.md"), true);
		assert.equal(store.get("Notes/C.md"), "🚀");
		assert.equal(store.get("Notes/A.md"), undefined);
		assert.equal(store.get("Notes/B.md"), "🎉");
	});

	it("moves the icon of a moved file including its new folder", () => {
		const store = storeOf({ "A.md": "🚀" });
		store.rename("A.md", "Folder/A.md");
		assert.equal(store.get("Folder/A.md"), "🚀");
	});

	it("moves a renamed folder and all descendants", () => {
		const store = storeOf({
			Notes: "📁",
			"Notes/A.md": "🚀",
			"Notes/Sub/B.md": "🎉",
			"Notes2/C.md": "🔥",
		});

		assert.equal(store.rename("Notes", "Archive"), true);

		assert.equal(store.get("Archive"), "📁");
		assert.equal(store.get("Archive/A.md"), "🚀");
		assert.equal(store.get("Archive/Sub/B.md"), "🎉");
		// A sibling with a similar name must not be touched.
		assert.equal(store.get("Notes2/C.md"), "🔥");
		assert.equal(store.get("Notes"), undefined);
		assert.equal(store.get("Notes/Sub/B.md"), undefined);
	});

	it("moves descendants of a folder that has no icon itself", () => {
		const store = storeOf({ "Notes/A.md": "🚀" });
		assert.equal(store.rename("Notes", "Archive"), true);
		assert.equal(store.get("Archive/A.md"), "🚀");
	});

	it("reports no change for unknown paths and identical paths", () => {
		const store = storeOf({ "A.md": "🚀" });
		assert.equal(store.rename("Missing.md", "Other.md"), false);
		assert.equal(store.rename("A.md", "A.md"), false);
		assert.equal(store.rename("", "A.md"), false);
		assert.equal(store.get("A.md"), "🚀");
	});

	it("handles renames that swap prefixes", () => {
		const store = storeOf({ Old: "📁", "Old/A/B.md": "🚀", "Oldish/C.md": "🎉" });
		store.rename("Old", "New");
		assert.equal(store.get("New"), "📁");
		assert.equal(store.get("New/A/B.md"), "🚀");
		assert.equal(store.get("Oldish/C.md"), "🎉");
	});
});

describe("IconStore.removeTree", () => {
	it("removes a folder with all descendants", () => {
		const store = storeOf({
			Notes: "📁",
			"Notes/A.md": "🚀",
			"Notes/Sub/B.md": "🎉",
			"Notes2/C.md": "🔥",
		});

		assert.equal(store.removeTree("Notes"), true);
		assert.equal(store.size, 1);
		assert.equal(store.get("Notes2/C.md"), "🔥");
	});

	it("removes a single file only", () => {
		const store = storeOf({ "A.md": "🚀", "A.md.bak": "🎉" });
		assert.equal(store.removeTree("A.md"), true);
		assert.equal(store.get("A.md"), undefined);
		assert.equal(store.get("A.md.bak"), "🎉");
	});

	it("reports no change for unknown paths", () => {
		const store = storeOf({ "A.md": "🚀" });
		assert.equal(store.removeTree("Missing.md"), false);
		assert.equal(store.removeTree(""), false);
	});
});

describe("IconStore.prune", () => {
	it("drops mappings whose path no longer exists", () => {
		const store = storeOf({ "A.md": "🚀", "Gone.md": "🎉", Folder: "📁" });
		const removed = store.prune((path) => path !== "Gone.md");

		assert.deepEqual(removed, ["Gone.md"]);
		assert.equal(store.size, 2);
		assert.equal(store.get("A.md"), "🚀");
	});

	it("keeps everything when all paths exist", () => {
		const store = storeOf({ "A.md": "🚀" });
		assert.deepEqual(store.prune(() => true), []);
		assert.equal(store.size, 1);
	});
});

describe("IconStore.fromData", () => {
	it("starts empty for missing or unusable data", () => {
		for (const raw of [null, undefined, 42, "string", true, [], {}, { icons: null }, { icons: 5 }]) {
			assert.equal(IconStore.fromData(raw).size, 0, `expected ${JSON.stringify(raw)} to be empty`);
		}
	});

	it("loads the versioned shape", () => {
		const store = IconStore.fromData({
			version: 1,
			icons: { "Notes/A.md": "🚀", Folder: "📁" },
		});
		assert.equal(store.size, 2);
		assert.equal(store.get("Notes/A.md"), "🚀");
		assert.equal(store.get("Folder"), "📁");
	});

	it("loads a plain path → emoji map", () => {
		const store = IconStore.fromData({ "A.md": "🚀", "Folder/B.md": "🎉" });
		assert.equal(store.size, 2);
		assert.equal(store.get("Folder/B.md"), "🎉");
	});

	it("skips malformed entries instead of crashing", () => {
		const store = IconStore.fromData({
			version: 1,
			icons: {
				"Good.md": "🚀",
				"NotAnEmoji.md": "hello",
				"Number.md": 42,
				"Object.md": { icon: "🚀" },
				"": "🎉",
				"   ": "🎉",
			},
		});

		assert.equal(store.size, 1);
		assert.equal(store.get("Good.md"), "🚀");
	});

	it("round-trips through toData", () => {
		const original = storeOf({ "Notes/A.md": "👨‍👩‍👧‍👦", Folder: "🇩🇪" });
		const reloaded = IconStore.fromData(original.toData());

		assert.equal(reloaded.size, 2);
		assert.equal(reloaded.get("Notes/A.md"), "👨‍👩‍👧‍👦");
		assert.equal(reloaded.get("Folder"), "🇩🇪");
	});

	it("writes the current data version", () => {
		assert.equal(new IconStore().toData().version, ICON_DATA_VERSION);
	});
});
