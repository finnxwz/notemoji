import { describe, expect, it } from "vitest";
import {
	base64Length,
	decodeBase64,
	encodeBase64,
	fitWithin,
	isAnimated,
	isAnimatedGif,
	isBase64,
	sniffImage,
} from "../../src/icons/image-format";
import { bytes, gif, isoMedia, JPEG, PNG, png, svg, WEBP, webpX } from "./image-samples";

describe("sniffImage", () => {
	it("recognises formats by content", () => {
		expect(sniffImage(PNG)).toBe("png");
		expect(sniffImage(JPEG)).toBe("jpeg");
		expect(sniffImage(gif(1))).toBe("gif");
		expect(sniffImage(WEBP)).toBe("webp");
		expect(sniffImage(isoMedia("avif", "mif1", "miaf"))).toBe("avif");
		expect(sniffImage(isoMedia("mif1", "avif"))).toBe("avif");
		expect(sniffImage(isoMedia("avis", "msf1"))).toBe("avif");
	});

	it("recognises iPhone photos to explain why they are refused", () => {
		expect(sniffImage(isoMedia("heic", "mif1", "heic"))).toBe("heic");
		expect(sniffImage(isoMedia("mif1", "heic"))).toBe("heic");
	});

	it("recognises SVG after declarations, comments and a byte order mark", () => {
		expect(sniffImage(svg('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("svg");
		expect(sniffImage(svg("<svg>\n</svg>"))).toBe("svg");
		expect(
			sniffImage(
				svg(
					`${String.fromCodePoint(0xfeff)}<?xml version="1.0"?>\n<!-- Made with a tool -->\n` +
						'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<SVG viewBox="0 0 1 1"></SVG>',
				),
			),
		).toBe("svg");
	});

	it("recognises SVG with an internal doctype subset, as Illustrator writes", () => {
		expect(
			sniffImage(
				svg(
					'<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd" [\n' +
						'\t<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n<svg version="1.1"></svg>',
				),
			),
		).toBe("svg");
	});

	it("rejects everything else", () => {
		for (const sample of [
			new Uint8Array(),
			bytes("hello"),
			svg("<html><svg></svg></html>"),
			svg("<svgfoo>"),
			bytes("%PDF-1.7"),
			isoMedia("mp42", "isom"),
			bytes([0x89], "PNX"),
			bytes("RIFF", [0, 0, 0, 0], "WAVE"),
		]) {
			expect(sniffImage(sample)).toBeUndefined();
		}
	});
});

describe("isAnimatedGif", () => {
	it("counts frames", () => {
		expect(isAnimatedGif(gif(1))).toBe(false);
		expect(isAnimatedGif(gif(2))).toBe(true);
		expect(isAnimatedGif(gif(3, { localColours: true }))).toBe(true);
		expect(isAnimatedGif(gif(1, { localColours: true }))).toBe(false);
	});

	it("treats damaged files as still", () => {
		expect(isAnimatedGif(gif(2).subarray(0, 40))).toBe(false);
		expect(isAnimatedGif(bytes("GIF89a"))).toBe(false);
		expect(isAnimatedGif(new Uint8Array(100).fill(0xff))).toBe(false);
	});
});

describe("isAnimated", () => {
	it("finds animation in GIF, PNG and WebP", () => {
		expect(isAnimated(gif(2), "gif")).toBe(true);
		expect(isAnimated(png({ animated: true }), "png")).toBe(true);
		expect(isAnimated(png({ animated: false }), "png")).toBe(false);
		expect(isAnimated(webpX({ animated: true }), "webp")).toBe(true);
		expect(isAnimated(webpX({ animated: false }), "webp")).toBe(false);
		expect(isAnimated(WEBP, "webp")).toBe(false);
		expect(isAnimated(JPEG, "jpeg")).toBe(false);
		expect(isAnimated(isoMedia("avis", "avif", "msf1"), "avif")).toBe(true);
		expect(isAnimated(isoMedia("avif", "mif1"), "avif")).toBe(false);
		expect(sniffImage(png({ animated: true }))).toBe("png");
		expect(sniffImage(webpX({ animated: true }))).toBe("webp");
	});
});

describe("fitWithin", () => {
	it("scales down to the longest side, never up", () => {
		expect(fitWithin(3000, 2000, 512)).toEqual({ width: 512, height: 341 });
		expect(fitWithin(2000, 3000, 512)).toEqual({ width: 341, height: 512 });
		expect(fitWithin(256, 256, 512)).toEqual({ width: 256, height: 256 });
		expect(fitWithin(10000, 1, 512)).toEqual({ width: 512, height: 1 });
	});
});

describe("base64", () => {
	it("round-trips large data and reports its length", () => {
		const data = new Uint8Array(200_000).map((_, index) => index % 256);
		const encoded = encodeBase64(data);
		expect(encoded).toHaveLength(base64Length(data.length));
		expect(decodeBase64(encoded)).toEqual(data);
		expect(isBase64(encoded)).toBe(true);
	});

	it("validates", () => {
		for (const value of ["", "abc", "ab=c", "a b=", "!!!!", "YQ==="]) {
			expect(isBase64(value), value).toBe(false);
		}
		for (const value of ["YQ==", "YWI=", "YWJj"]) expect(isBase64(value), value).toBe(true);
	});
});
