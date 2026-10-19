import { expect, it } from "vitest";
import { formatBytes, plural } from "../../src/settings/format";

it("formats sizes", () => {
	expect(formatBytes(512)).toBe("512 B");
	expect(formatBytes(2048)).toBe("2 KB");
	expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
	expect(formatBytes(250 * 1024 * 1024)).toBe("250 MB");
});

it("counts in words", () => {
	expect(plural(1, "icon", "icons")).toBe("1 icon");
	expect(plural(0, "icon", "icons")).toBe("0 icons");
});
