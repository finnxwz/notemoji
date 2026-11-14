/**
 * Byte-level facts about uploaded images: what format a file really is, and
 * whether a GIF is animated. Decided from the content, never from the file
 * name. Free of DOM and Obsidian imports so it can be unit tested.
 */

/** Formats accepted as custom icons. */
export type ImageKind = "png" | "jpeg" | "gif" | "webp" | "avif" | "svg";

/** MIME type of each accepted format. */
export const IMAGE_MIME: Record<ImageKind, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
};

/** File extensions offered in the upload dialog. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"] as const;

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
	if (start + length > bytes.length) return "";
	return String.fromCharCode(...bytes.subarray(start, start + length));
}

/**
 * The format of an image file from its first bytes. `"heic"` marks iPhone
 * photos (HEIF), which are recognised only to explain why they are refused.
 */
export function sniffImage(bytes: Uint8Array): ImageKind | "heic" | undefined {
	if (ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
	if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";
	if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";
	if (ascii(bytes, 4, 4) === "ftyp") return heifKind(bytes);
	return isSvg(bytes) ? "svg" : undefined;
}

/** The brands of an ISO media file's `ftyp` box: the major brand, then the compatible ones. */
function ftypBrands(bytes: Uint8Array): string[] {
	if (ascii(bytes, 4, 4) !== "ftyp") return [];
	const size = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
	const end = Math.min(size > 8 ? size : 32, bytes.length, 256);
	const brands: string[] = [ascii(bytes, 8, 4)];
	// After the major brand comes the minor version, then the compatible brands.
	for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(ascii(bytes, offset, 4));
	return brands;
}

/** AVIF or HEIC from the brands of an ISO media file. */
function heifKind(bytes: Uint8Array): "avif" | "heic" | undefined {
	const brands = ftypBrands(bytes);
	if (brands.some((brand) => brand === "avif" || brand === "avis")) return "avif";
	if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "heic";
	return undefined;
}

/** An SVG document: an `<svg` root after an optional XML declaration, comments and doctype. */
function isSvg(bytes: Uint8Array): boolean {
	// TextDecoder drops a byte order mark at the start.
	const head = new TextDecoder().decode(bytes.subarray(0, 4096));
	// A doctype may contain an internal subset in brackets, with `>` inside (Illustrator).
	const rest = head.replace(
		/^(\s+|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>)*/i,
		"",
	);
	return /^<svg[\s>/]/i.test(rest);
}

/**
 * Whether a GIF has more than one frame. Walks the GIF block structure;
 * damaged files count as still (they fail later, when decoded).
 */
export function isAnimatedGif(bytes: Uint8Array): boolean {
	let offset = 13;
	if (bytes.length < offset) return false;
	// Global colour table.
	if (bytes[10] & 0x80) offset += 3 * (1 << ((bytes[10] & 0x07) + 1));

	let frames = 0;
	const skipSubBlocks = () => {
		while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
		offset += 1;
	};
	while (offset < bytes.length) {
		const block = bytes[offset];
		if (block === 0x2c) {
			frames += 1;
			if (frames > 1) return true;
			const packed = bytes[offset + 9];
			offset += 10;
			// Local colour table, then the LZW minimum code size.
			if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
			offset += 1;
			skipSubBlocks();
		} else if (block === 0x21) {
			offset += 2;
			skipSubBlocks();
		} else {
			// 0x3b (trailer) or damage.
			return false;
		}
	}
	return false;
}

/**
 * Whether an image has more than one frame: animated GIF, animated PNG (APNG)
 * or animated WebP. Drawing such an image keeps only its first frame.
 */
export function isAnimated(bytes: Uint8Array, kind: ImageKind): boolean {
	if (kind === "gif") return isAnimatedGif(bytes);
	if (kind === "png") return isAnimatedPng(bytes);
	if (kind === "webp") return isAnimatedWebp(bytes);
	if (kind === "avif") return ftypBrands(bytes).includes("avis");
	return false;
}

/** An APNG has an `acTL` chunk before its image data. */
function isAnimatedPng(bytes: Uint8Array): boolean {
	let offset = 8;
	while (offset + 8 <= bytes.length) {
		const length =
			((bytes[offset] << 24) |
				(bytes[offset + 1] << 16) |
				(bytes[offset + 2] << 8) |
				bytes[offset + 3]) >>>
			0;
		const type = ascii(bytes, offset + 4, 4);
		if (type === "acTL") return true;
		if (type === "IDAT" || type === "IEND") return false;
		offset += 12 + length;
	}
	return false;
}

/** An animated WebP sets the animation flag of its `VP8X` header. */
function isAnimatedWebp(bytes: Uint8Array): boolean {
	return ascii(bytes, 12, 4) === "VP8X" && (bytes[20] & 0x02) !== 0;
}

/** Size that fits within `max` on its longest side, keeping the aspect ratio; never larger. */
export function fitWithin(
	width: number,
	height: number,
	max: number,
): { width: number; height: number } {
	const scale = Math.min(1, max / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

/** Length of `bytes` bytes as base64. */
export function base64Length(bytes: number): number {
	return 4 * Math.ceil(bytes / 3);
}

export function encodeBase64(bytes: Uint8Array): string {
	let binary = "";
	// In slices: spreading a large array into one call overflows the stack.
	for (let start = 0; start < bytes.length; start += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
	}
	return btoa(binary);
}

export function decodeBase64(data: string): Uint8Array<ArrayBuffer> {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

export function isBase64(data: string): boolean {
	return data.length > 0 && data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(data);
}
