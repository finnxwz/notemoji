import { fitWithin } from "./image-format";
import type { ImageCodec, LoadedImage, ResizedImage } from "./prepare-icon";

/**
 * Largest intermediate drawing when scaling down. Phones limit canvas sizes
 * (iOS: about 16 megapixels), and halving in steps looks better than one big
 * jump, which skips pixels.
 */
const MAX_STEP_PX = 2048;

/** Decodes with an `<img>` and draws with a canvas: available on every platform Obsidian runs on. */
export const canvasCodec: ImageCodec = {
	async load(bytes, type) {
		const url = URL.createObjectURL(new Blob([bytes], { type }));
		const img = new Image();
		img.src = url;
		try {
			await img.decode();
		} catch (error) {
			URL.revokeObjectURL(url);
			throw error;
		}
		return new DecodedImage(img, url);
	},
};

class DecodedImage implements LoadedImage {
	/** Every canvas drawn, released on dispose: iOS runs out of canvas memory otherwise. */
	private readonly canvases: HTMLCanvasElement[] = [];

	constructor(
		private readonly img: HTMLImageElement,
		private readonly url: string,
	) {}

	get width(): number {
		return this.img.naturalWidth;
	}

	get height(): number {
		return this.img.naturalHeight;
	}

	resize(width: number, height: number): ResizedImage {
		let source: CanvasImageSource = this.img;
		let longest = Math.max(this.width, this.height);
		const target = Math.max(width, height);
		while (longest > 2 * target) {
			longest = Math.max(2 * target, Math.min(MAX_STEP_PX, Math.ceil(longest / 2)));
			const step = fitWithin(this.width, this.height, longest);
			source = this.draw(source, step.width, step.height);
		}
		return new Drawing(this.draw(source, width, height));
	}

	dispose(): void {
		URL.revokeObjectURL(this.url);
		for (const canvas of this.canvases) {
			canvas.width = 0;
			canvas.height = 0;
		}
		this.canvases.length = 0;
	}

	private draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
		const canvas = createEl("canvas", { attr: { width, height } });
		this.canvases.push(canvas);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("No canvas available.");
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.drawImage(source, 0, 0, width, height);
		return canvas;
	}
}

class Drawing implements ResizedImage {
	constructor(private readonly canvas: HTMLCanvasElement) {}

	hasAlpha(): boolean {
		const context = this.canvas.getContext("2d");
		if (!context) return true;
		const { data } = context.getImageData(0, 0, this.canvas.width, this.canvas.height);
		for (let index = 3; index < data.length; index += 4) {
			if (data[index] < 255) return true;
		}
		return false;
	}

	encode(type: string, quality?: number): Promise<{ type: string; bytes: Uint8Array }> {
		return new Promise((resolve, reject) => {
			this.canvas.toBlob(
				(blob) => {
					if (!blob) {
						reject(new Error("The image could not be encoded."));
						return;
					}
					blob.arrayBuffer().then(
						(buffer) => resolve({ type: blob.type, bytes: new Uint8Array(buffer) }),
						reject,
					);
				},
				type,
				quality,
			);
		});
	}
}
