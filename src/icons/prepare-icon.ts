import { formatBytes } from "../format";
import { CustomIconError, MAX_ICON_SIZE, StoredIcon, StoredIconType } from "./custom-icons";
import {
	base64Length,
	encodeBase64,
	fitWithin,
	IMAGE_MIME,
	ImageKind,
	isAnimated,
	sniffImage,
} from "./image-format";

/**
 * Turns an uploaded file into a custom icon, or explains why it can't be one.
 *
 * - SVG stays a vector, unchanged.
 * - Other images are scaled down to 512 px on the longest side, which stays
 *   sharp even at the size of the note title on the densest screens. Smaller
 *   images keep their size (upscaling adds bytes, not detail).
 * - An image that already fits is stored exactly as uploaded (no quality loss,
 *   animations keep playing); others are re-encoded, lowering the quality step
 *   by step until they fit. Animated images that don't fit are refused rather
 *   than silently frozen to their first frame.
 *
 * Decoding and drawing go through `ImageCodec`, so the rules here are free of
 * the DOM and can be unit tested.
 */

/** Longest side of a stored image, in pixels. */
export const ICON_PX = 512;

/** Largest file accepted for an upload; bigger images are slow or impossible to decode on phones. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Largest file that fits `MAX_ICON_SIZE` once base64-encoded (45 KB). */
export const MAX_ICON_BYTES = (MAX_ICON_SIZE / 4) * 3;

/** Qualities tried in order for lossy formats. */
const QUALITIES = [0.9, 0.8, 0.7, 0.6];

/** A decoded image. */
export interface LoadedImage {
	readonly width: number;
	readonly height: number;
	/** Draws the image at the given size. */
	resize(width: number, height: number): ResizedImage;
	/** Frees the decoded image and every drawing made from it. */
	dispose(): void;
}

export interface ResizedImage {
	/** Whether any pixel is not fully opaque. */
	hasAlpha(): boolean;
	/** Encodes the drawing. `type` is what was actually produced (browsers fall back to PNG). */
	encode(type: string, quality?: number): Promise<{ type: string; bytes: Uint8Array }>;
}

export interface ImageCodec {
	/** Decodes an image; rejects when this device can't read it. */
	load(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<LoadedImage>;
}

function reject(message: string): never {
	throw new CustomIconError(message);
}

function stored(type: string, bytes: Uint8Array): StoredIcon {
	return { type: type as StoredIconType, data: encodeBase64(bytes) };
}

export async function prepareIcon(
	fileName: string,
	bytes: Uint8Array<ArrayBuffer>,
	codec: ImageCodec,
): Promise<StoredIcon> {
	const name = `"${fileName}"`;
	if (bytes.length === 0) reject(`${name} is empty.`);
	if (bytes.length > MAX_UPLOAD_BYTES) {
		reject(`${name} is larger than 20 MB. Please use a smaller image.`);
	}
	const kind = sniffImage(bytes);
	if (kind === "heic") {
		reject(
			`${name} is a HEIC photo, which not every device can show. Convert it to JPG or PNG first.`,
		);
	}
	if (!kind) reject(`${name} is not a PNG, JPG, GIF, WebP, AVIF or SVG image.`);

	if (kind === "svg") {
		if (bytes.length > MAX_ICON_BYTES) {
			reject(
				`${name} is too detailed for an icon (${formatBytes(bytes.length)}; SVG icons can have up to 45 KB). ` +
					"Simplify it, for example with SVGO, or save it as a PNG.",
			);
		}
		// Only to make sure it can be shown.
		(await load(name, bytes, kind, codec)).dispose();
		return stored(IMAGE_MIME.svg, bytes);
	}

	const image = await load(name, bytes, kind, codec);
	try {
		const fits =
			Math.max(image.width, image.height) <= ICON_PX && bytes.length <= MAX_ICON_BYTES;
		if (isAnimated(bytes, kind)) {
			// AVIF can't be stored as it is (not every device shows it), and converting freezes it.
			if (kind === "avif") {
				reject(
					`${name} is an animated AVIF, which can't be used as an icon. Use an animated GIF or WebP.`,
				);
			}
			if (fits) return stored(IMAGE_MIME[kind], bytes);
			reject(
				`${name} is an animated image of ${image.width} × ${image.height} px and ${formatBytes(bytes.length)}. ` +
					"Animated icons can be up to 512 × 512 px and 45 KB. Make it smaller, or use a still image.",
			);
		}
		// AVIF is always converted: not every device Obsidian runs on can show it.
		if (fits && kind !== "avif") return stored(IMAGE_MIME[kind], bytes);

		const size = fitWithin(image.width, image.height, ICON_PX);
		const resized = image.resize(size.width, size.height);
		const encoded = await encodeToFit(resized, kind);
		if (encoded && "bytes" in encoded) return stored(encoded.type, encoded.bytes);
		reject(
			`${name} has too much detail to store at ${size.width} × ${size.height} px, even at lower quality. ` +
				(encoded?.pngOnly
					? "This device can only store transparent images as PNG, which is larger; adding it on a computer usually works, and it syncs here."
					: "Try a simpler image, or crop it to the part you need."),
		);
	} finally {
		image.dispose();
	}
}

async function load(
	name: string,
	bytes: Uint8Array<ArrayBuffer>,
	kind: ImageKind,
	codec: ImageCodec,
): Promise<LoadedImage> {
	try {
		const image = await codec.load(bytes, IMAGE_MIME[kind]);
		// SVGs without a width and height have no size of their own, which is fine.
		if (kind === "svg" || (image.width > 0 && image.height > 0)) return image;
		image.dispose();
	} catch {
		// Explained below.
	}
	return reject(
		`${name} could not be read. The file may be damaged or too large for this device.`,
	);
}

/**
 * WebP at falling quality (keeps transparency, smallest by far). Devices that
 * can't write WebP get JPEG for opaque images and PNG for transparent ones.
 */
async function encodeToFit(
	image: ResizedImage,
	kind: ImageKind,
): Promise<{ type: string; bytes: Uint8Array } | { pngOnly: boolean } | undefined> {
	const fits = (bytes: Uint8Array) => base64Length(bytes.length) <= MAX_ICON_SIZE;
	for (const quality of QUALITIES) {
		const result = await image.encode("image/webp", quality);
		if (result.type !== "image/webp") break;
		if (fits(result.bytes)) return result;
		if (quality === QUALITIES[QUALITIES.length - 1]) return undefined;
	}
	if (kind === "jpeg" || !image.hasAlpha()) {
		for (const quality of QUALITIES) {
			const result = await image.encode("image/jpeg", quality);
			if (result.type === "image/jpeg" && fits(result.bytes)) return result;
		}
		return undefined;
	}
	const png = await image.encode("image/png");
	return png.type === "image/png" && fits(png.bytes) ? png : { pngOnly: true };
}
