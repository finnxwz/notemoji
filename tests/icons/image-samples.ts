/** Minimal image files for format detection tests (headers only, not decodable). */

const text = (value: string) => Array.from(value, (char) => char.charCodeAt(0));

export const bytes = (...parts: Array<number[] | string>) =>
	new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? text(part) : part)));

export const PNG = bytes([0x89], "PNG\r\n\x1a\n", [0, 0, 0, 13], "IHDR");
export const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], "JFIF");
export const WEBP = bytes("RIFF", [36, 0, 0, 0], "WEBPVP8 ");

/** An ISO media file whose `ftyp` box lists `brands` (major brand first). */
export function isoMedia(...brands: string[]): Uint8Array {
	const [major, ...compatible] = brands;
	const size = 16 + 4 * compatible.length;
	return bytes([0, 0, 0, size], "ftyp", major, [0, 0, 0, 0], ...compatible);
}

/** A 1×1 GIF with `frames` frames, a global colour table and a graphic control extension. */
export function gif(frames: number, { localColours = false } = {}): Uint8Array {
	const frame = [
		// Graphic control extension.
		0x21,
		0xf9,
		0x04,
		0x00,
		0x0a,
		0x00,
		0x00,
		0x00,
		// Image descriptor: position, size, packed (optional local colour table of 2).
		0x2c,
		0,
		0,
		0,
		0,
		1,
		0,
		1,
		0,
		localColours ? 0x80 : 0x00,
		...(localColours ? [0, 0, 0, 255, 255, 255] : []),
		// LZW minimum code size, one data sub-block, terminator.
		0x02,
		0x02,
		0x44,
		0x01,
		0x00,
	];
	return bytes(
		"GIF89a",
		[1, 0, 1, 0, 0x80, 0, 0],
		[0, 0, 0, 255, 255, 255],
		// Application extension (looping), as animated GIFs have.
		[0x21, 0xff, 0x0b],
		"NETSCAPE2.0",
		[0x03, 0x01, 0x00, 0x00, 0x00],
		...Array.from({ length: frames }, () => frame),
		[0x3b],
	);
}

export const svg = (source: string) => new TextEncoder().encode(source);

/** A PNG with an animation control chunk (APNG) before its image data, or a still one. */
export function png({ animated }: { animated: boolean }): Uint8Array {
	const chunk = (type: string, length: number) => [
		[0, 0, 0, length],
		type,
		new Array(length + 4).fill(0),
	];
	return bytes(
		[0x89],
		"PNG\r\n\x1a\n",
		...chunk("IHDR", 13),
		...(animated ? chunk("acTL", 8) : []),
		...chunk("IDAT", 2),
		...chunk("IEND", 0),
	);
}

/** An extended WebP (`VP8X`) with or without the animation flag. */
export function webpX({ animated }: { animated: boolean }): Uint8Array {
	return bytes(
		"RIFF",
		[30, 0, 0, 0],
		"WEBPVP8X",
		[10, 0, 0, 0],
		[animated ? 0x12 : 0x10, 0, 0, 0],
		[0, 0, 0, 0, 0, 0],
	);
}
