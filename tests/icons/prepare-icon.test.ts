import { describe, expect, it, vi } from "vitest";
import { CustomIconError, MAX_ICON_SIZE } from "../../src/icons/custom-icons";
import { decodeBase64 } from "../../src/icons/image-format";
import {
	ImageCodec,
	MAX_ICON_BYTES,
	MAX_UPLOAD_BYTES,
	prepareIcon,
} from "../../src/icons/prepare-icon";
import { bytes, gif, isoMedia, JPEG, PNG, png, svg, WEBP, webpX } from "./image-samples";

interface FakeImage {
	width?: number;
	height?: number;
	alpha?: boolean;
	/** Can the device write WebP? Browsers fall back to PNG when they can't. */
	webp?: boolean;
	/** Encoded size for a type and quality. */
	encodedSize?: (type: string, quality: number | undefined, size: [number, number]) => number;
	broken?: boolean;
}

/** A codec that records what was drawn and encoded, and produces bytes of a chosen size. */
function fakeCodec(image: FakeImage = {}) {
	const calls = {
		resized: [] as Array<[number, number]>,
		encoded: [] as Array<[string, number | undefined]>,
		disposed: 0,
	};
	const load = vi.fn(() => {
		if (image.broken) return Promise.reject(new Error("decode failed"));
		return Promise.resolve({
			width: image.width ?? 100,
			height: image.height ?? 100,
			dispose: () => (calls.disposed += 1),
			resize(width: number, height: number) {
				calls.resized.push([width, height]);
				return {
					hasAlpha: () => image.alpha ?? false,
					encode(type: string, quality?: number) {
						calls.encoded.push([type, quality]);
						const actual =
							type === "image/webp" && image.webp === false ? "image/png" : type;
						const size = image.encodedSize?.(actual, quality, [width, height]) ?? 1000;
						return Promise.resolve({
							type: actual,
							bytes: new Uint8Array(size).fill(7),
						});
					},
				};
			},
		});
	});
	const codec: ImageCodec = { load };
	return { codec, calls, load };
}

/** A file of `size` bytes that starts like `head`. */
function sized(head: Uint8Array, size: number): Uint8Array<ArrayBuffer> {
	const file = new Uint8Array(size);
	file.set(head.subarray(0, Math.min(head.length, size)));
	return file;
}

const file = (head: Uint8Array) => sized(head, Math.max(head.length, 64));

async function refusal(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(CustomIconError);
		return (error as Error).message;
	}
	throw new Error("Expected the upload to be refused");
}

describe("refused uploads", () => {
	it("explains empty, huge, unknown and HEIC files", async () => {
		const { codec, load } = fakeCodec();
		expect(await refusal(prepareIcon("a.png", new Uint8Array(), codec))).toContain("empty");
		expect(
			await refusal(prepareIcon("a.png", sized(PNG, MAX_UPLOAD_BYTES + 1), codec)),
		).toContain("larger than 20 MB");
		expect(await refusal(prepareIcon("notes.png", file(bytes("hello")), codec))).toBe(
			'"notes.png" is not a PNG, JPG, GIF, WebP, AVIF or SVG image.',
		);
		expect(
			await refusal(prepareIcon("IMG_1.HEIC", file(isoMedia("heic", "mif1")), codec)),
		).toContain("Convert it to JPG or PNG");
		expect(load).not.toHaveBeenCalled();
	});

	it("explains files the device can't decode", async () => {
		const { codec } = fakeCodec({ broken: true });
		expect(await refusal(prepareIcon("a.png", file(PNG), codec))).toBe(
			'"a.png" could not be read. The file may be damaged or too large for this device.',
		);
		const empty = fakeCodec({ width: 0, height: 0 });
		expect(await refusal(prepareIcon("a.png", file(PNG), empty.codec))).toContain(
			"could not be read",
		);
		expect(empty.calls.disposed).toBe(1);
	});

	it("judges by content, not by the file name", async () => {
		const { codec } = fakeCodec();
		const icon = await prepareIcon("photo.png", file(JPEG), codec);
		expect(icon.type).toBe("image/jpeg");
	});
});

describe("SVG", () => {
	const source = svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');

	it("is stored unchanged, as a vector", async () => {
		const { codec, calls } = fakeCodec({ width: 0, height: 0 });
		const icon = await prepareIcon("logo.svg", new Uint8Array(source), codec);
		expect(icon.type).toBe("image/svg+xml");
		expect(decodeBase64(icon.data)).toEqual(source);
		expect(calls.resized).toEqual([]);
		expect(calls.disposed).toBe(1);
	});

	it("is refused above 45 KB, with a hint", async () => {
		const { codec } = fakeCodec();
		const large = sized(source, MAX_ICON_BYTES + 1);
		expect(await refusal(prepareIcon("map.svg", large, codec))).toContain(
			"SVG icons can have up to 45 KB",
		);
		const fits = await prepareIcon("map.svg", sized(source, MAX_ICON_BYTES), codec);
		expect(fits.data.length).toBeLessThanOrEqual(MAX_ICON_SIZE);
	});

	it("must be displayable", async () => {
		const { codec } = fakeCodec({ broken: true });
		expect(await refusal(prepareIcon("x.svg", new Uint8Array(source), codec))).toContain(
			"could not be read",
		);
	});
});

describe("images that already fit", () => {
	it("are stored exactly as uploaded, without upscaling", async () => {
		for (const [head, type] of [
			[PNG, "image/png"],
			[JPEG, "image/jpeg"],
			[WEBP, "image/webp"],
			[gif(1), "image/gif"],
		] as const) {
			const { codec, calls } = fakeCodec({ width: 64, height: 32 });
			const upload = file(head);
			const icon = await prepareIcon("a", upload, codec);
			expect(icon.type).toBe(type);
			expect(decodeBase64(icon.data)).toEqual(upload);
			expect(calls.resized).toEqual([]);
			expect(calls.disposed).toBe(1);
		}
	});

	it("keep animated GIFs animated", async () => {
		const { codec } = fakeCodec({ width: 512, height: 512 });
		const icon = await prepareIcon("party.gif", file(gif(2)), codec);
		expect(icon.type).toBe("image/gif");
	});

	it("convert AVIF, which not every device can show", async () => {
		const { codec, calls } = fakeCodec({ width: 100, height: 50 });
		const icon = await prepareIcon("a.avif", file(isoMedia("avif", "mif1")), codec);
		expect(icon.type).toBe("image/webp");
		expect(calls.resized).toEqual([[100, 50]]);
	});
});

describe("larger images", () => {
	it("are scaled to 512 px on the longest side and stored as WebP", async () => {
		const { codec, calls } = fakeCodec({ width: 3000, height: 2000 });
		const icon = await prepareIcon("photo.jpg", file(JPEG), codec);
		expect(calls.resized).toEqual([[512, 341]]);
		expect(calls.encoded).toEqual([["image/webp", 0.9]]);
		expect(icon.type).toBe("image/webp");
		expect(calls.disposed).toBe(1);
	});

	it("re-encode small images that are too large in bytes, at their own size", async () => {
		const { codec, calls } = fakeCodec({ width: 300, height: 200 });
		await prepareIcon("big.png", sized(PNG, MAX_ICON_BYTES + 1), codec);
		expect(calls.resized).toEqual([[300, 200]]);
	});

	it("lower the quality step by step until they fit", async () => {
		const { codec, calls } = fakeCodec({
			width: 4000,
			height: 4000,
			encodedSize: (_, quality) =>
				(quality ?? 1) >= 0.75 ? MAX_ICON_BYTES + 1 : MAX_ICON_BYTES,
		});
		const icon = await prepareIcon("detail.png", file(PNG), codec);
		expect(calls.encoded.map(([, quality]) => quality)).toEqual([0.9, 0.8, 0.7]);
		expect(icon.data.length).toBeLessThanOrEqual(MAX_ICON_SIZE);
	});

	it("are refused when even the lowest quality is too large", async () => {
		const { codec, calls } = fakeCodec({
			width: 4000,
			height: 3000,
			encodedSize: () => MAX_ICON_BYTES + 1,
		});
		expect(await refusal(prepareIcon("noise.png", file(PNG), codec))).toContain(
			"too much detail to store at 512 × 384 px",
		);
		expect(calls.encoded.map(([type]) => type)).toEqual(Array(4).fill("image/webp"));
		expect(calls.disposed).toBe(1);
	});

	it("refuse animated PNG and WebP that don't fit, and keep small ones animated", async () => {
		for (const [head, type] of [
			[png({ animated: true }), "image/png"],
			[webpX({ animated: true }), "image/webp"],
		] as const) {
			const large = fakeCodec({ width: 600, height: 600 });
			expect(await refusal(prepareIcon("moving", file(head), large.codec))).toContain(
				"animated image",
			);
			const small = fakeCodec({ width: 128, height: 128 });
			expect((await prepareIcon("moving", file(head), small.codec)).type).toBe(type);
		}
	});

	it("refuse animated AVIF, which can only be stored converted (frozen)", async () => {
		const { codec } = fakeCodec({ width: 64, height: 64 });
		expect(
			await refusal(prepareIcon("moving.avif", file(isoMedia("avis", "avif")), codec)),
		).toContain("animated AVIF");
	});

	it("refuse animated GIFs that don't fit instead of freezing them", async () => {
		const { codec, calls } = fakeCodec({ width: 800, height: 600 });
		expect(await refusal(prepareIcon("party.gif", file(gif(2)), codec))).toContain(
			"animated image of 800 × 600 px",
		);
		expect(calls.resized).toEqual([]);
		const heavy = fakeCodec({ width: 100, height: 100 });
		expect(
			await refusal(prepareIcon("party.gif", sized(gif(2), MAX_ICON_BYTES + 1), heavy.codec)),
		).toContain("up to 512 × 512 px and 45 KB");
	});
});

describe("devices that can't write WebP", () => {
	it("use JPEG for opaque images", async () => {
		const { codec, calls } = fakeCodec({ width: 1000, height: 1000, webp: false });
		const icon = await prepareIcon("photo.png", file(PNG), codec);
		expect(icon.type).toBe("image/jpeg");
		expect(calls.encoded).toEqual([
			["image/webp", 0.9],
			["image/jpeg", 0.9],
		]);
	});

	it("use PNG for transparent images, refused when too large", async () => {
		const ok = fakeCodec({ width: 1000, height: 1000, webp: false, alpha: true });
		expect((await prepareIcon("logo.png", file(PNG), ok.codec)).type).toBe("image/png");

		const large = fakeCodec({
			width: 1000,
			height: 1000,
			webp: false,
			alpha: true,
			encodedSize: () => MAX_ICON_BYTES + 1,
		});
		const message = await refusal(prepareIcon("logo.png", file(PNG), large.codec));
		expect(message).toContain("too much detail");
		expect(message).toContain("adding it on a computer usually works");
	});
});
