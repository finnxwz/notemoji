/**
 * Records the README showcase (docs/media/*) from scripts/demo, a scene that
 * runs the real plugin in an Obsidian-like page.
 *
 *   npm run demo                    # every GIF and image
 *   npm run demo -- --only=picker   # some of them (comma-separated names)
 *   npm run demo -- --open          # only build .test-build/demo.html to look at it
 *
 * Needs Chromium for Playwright (`npx playwright-core install chromium`),
 * ffmpeg for the GIFs, a colour emoji font (built into Windows and macOS;
 * Noto Color Emoji on Linux) and, for the style GIF, the fonts cached by
 * `npm run set-previews`. Uses gifsicle to shrink the GIFs when installed.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = path.join(root, "scripts", "demo");
const buildDir = path.join(root, ".test-build");
const mediaDir = path.join(root, "docs", "media");

/** Every recording and image is made at twice its size, then scaled down: sharp text and emoji. */
const SCALE = 2;
const DESKTOP = { width: 1000, height: 600 };
const PHONE = { width: 390, height: 780 };
const NOTE = "Projects/Website relaunch.md";

// ---------------------------------------------------------------- page

async function buildPage() {
	const result = await build({
		entryPoints: [path.join(demoDir, "demo.ts")],
		bundle: true,
		write: false,
		format: "iife",
		target: "chrome120",
		alias: { obsidian: path.join(root, "tests", "obsidian.ts") },
		logLevel: "warning",
	});
	const styles =
		(await readFile(path.join(demoDir, "demo.css"), "utf8")) +
		(await readFile(path.join(root, "styles.css"), "utf8"));
	const script = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
	const html = (await readFile(path.join(demoDir, "demo.html"), "utf8"))
		.replace("/* STYLES */", () => styles)
		.replace("/* SCRIPT */", () => script);

	await mkdir(buildDir, { recursive: true });
	const file = path.join(buildDir, "demo.html");
	await writeFile(file, html, "utf8");
	return pathToFileURL(file).href;
}

/** Opens the scene with options in the URL hash (see demo.ts). */
async function openScene(browser, hash, { viewport = DESKTOP } = {}) {
	const context = await browser.newContext({ viewport, deviceScaleFactor: SCALE });
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.goto(`${pageUrl}#${hash}`);
	await page.waitForFunction(() => window.demoReady === true);
	await page.evaluate(() => document.fonts.ready);
	// Let the picker images be drawn, as they would be a few seconds after Obsidian starts.
	await page.waitForFunction(
		() =>
			[...window.demo.adapter.files.keys()].filter((key) => key.includes("cache/sprites"))
				.length >= 9,
		null,
		{ timeout: 30_000 },
	);
	return {
		page,
		async close() {
			await context.close();
			if (errors.length > 0) throw new Error(`Errors in the scene:\n${errors.join("\n")}`);
		},
	};
}

// ---------------------------------------------------------------- acting

/** Length of a frame while something moves (ms); GIFs count in hundredths of a second. */
const FRAME_MS = 40;

/**
 * Plays a scene in stop motion: after every cursor step, key press or scroll
 * step, a full-resolution screenshot becomes a frame of known length. Unlike
 * a screen recording this is sharp, smooth and independent of how fast the
 * machine is.
 */
class Actor {
	frames = [];
	position = { x: DESKTOP.width * 0.72, y: DESKTOP.height * 0.75 };

	constructor(page, folder, clip) {
		this.page = page;
		this.folder = folder;
		this.clip = clip;
	}

	async start() {
		await this.page.mouse.move(this.position.x, this.position.y);
		await this.hold(400);
	}

	/** Adds the current picture as a frame of `ms`. */
	async frame(ms) {
		const file = path.join(this.folder, `${String(this.frames.length).padStart(4, "0")}.png`);
		await this.page.screenshot({ path: file, clip: this.clip });
		this.frames.push({ file, ms });
	}

	/** Lets the page settle, then shows it for `ms`. */
	async hold(ms) {
		await this.page.waitForTimeout(120);
		await this.frame(ms);
	}

	/** Moves the cursor along an eased path, like a hand would. */
	async moveTo(x, y, duration = 480) {
		const from = this.position;
		const steps = Math.max(4, Math.round(duration / FRAME_MS));
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const ease = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
			await this.page.mouse.move(from.x + (x - from.x) * ease, from.y + (y - from.y) * ease);
			await this.frame(FRAME_MS);
		}
		this.position = { x, y };
	}

	async moveOnto(selector, { x = 0.5, y = 0.5 } = {}) {
		const box = await this.page.locator(selector).first().boundingBox();
		if (!box) throw new Error(`Not visible: ${selector}`);
		await this.moveTo(box.x + box.width * x, box.y + box.height * y);
	}

	async click(selector, options) {
		await this.moveOnto(selector, options);
		await this.hold(160);
		await this.page.mouse.down();
		await this.frame(90);
		await this.page.mouse.up();
		await this.hold(FRAME_MS);
	}

	async rightClick(selector) {
		await this.moveOnto(selector, { x: 0.35 });
		await this.hold(200);
		await this.page.mouse.click(this.position.x, this.position.y, { button: "right" });
		await this.hold(FRAME_MS);
	}

	async type(text) {
		for (const char of text) {
			await this.page.keyboard.type(char);
			await this.hold(110);
		}
	}

	async press(key, ms = 300) {
		await this.page.keyboard.press(key);
		await this.hold(ms);
	}

	/** Smooth wheel scrolling of whatever is under the cursor. */
	async scroll(distance, duration = 600) {
		const steps = Math.round(duration / FRAME_MS);
		for (let step = 1; step <= steps; step++) {
			const t = step / steps;
			const previous = (step - 1) / steps;
			const eased = (value) => 1 - (1 - value) ** 3;
			await this.page.mouse.wheel(0, distance * (eased(t) - eased(previous)));
			await this.page.waitForTimeout(30);
			await this.frame(FRAME_MS);
		}
	}
}

/** Puts the downloadable emoji fonts (cached by `npm run set-previews`) into the fake vault. */
async function addEmojiFonts(page) {
	for (const file of ["twemoji.ttf", "openmoji.woff2", "noto-color.ttf", "noto-mono.ttf"]) {
		const data = await readFile(path.join(buildDir, "fonts", file)).catch(() => {
			throw new Error(
				`Missing .test-build/fonts/${file}: run \`npm run set-previews\` first.`,
			);
		});
		await page.evaluate(
			({ file, base64 }) => {
				const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
				window.demo.adapter.files.set(
					`.obsidian/plugins/notemoji/fonts/${file}`,
					bytes.buffer,
				);
			},
			{ file, base64: data.toString("base64") },
		);
	}
}

// ---------------------------------------------------------------- GIFs

/**
 * Each GIF: what happens in it, and the part of the window it shows (`clip`
 * in CSS pixels) at which width.
 */
const GIFS = {
	/** Right-click → pick an emoji → it appears in the explorer, tab and title. */
	"set-emoji": {
		width: 960,
		async play(actor) {
			await actor.rightClick(`[data-path="${NOTE}"]`);
			await actor.hold(400);
			await actor.click('.menu-item:text-is("Set note emoji")');
			await actor.hold(500);
			await actor.type("rocket");
			await actor.hold(400);
			await actor.click(".notemoji-picker-emoji");
			await actor.moveTo(820, 470);
			await actor.hold(2400);
		},
	},

	/** Browsing, searching by keyword and choosing with the keyboard; the title follows. */
	picker: {
		width: 960,
		async setup(page) {
			await page.evaluate((note) => window.demo.setIcon(note, "🚀"), NOTE);
		},
		async play(actor) {
			await actor.rightClick(`[data-path="${NOTE}"]`);
			await actor.hold(300);
			await actor.click('.menu-item:text-is("Change note emoji")');
			await actor.hold(600);
			await actor.moveOnto(".notemoji-picker-body", { x: 0.6, y: 0.6 });
			await actor.scroll(1400, 900);
			await actor.hold(300);
			await actor.click('.notemoji-picker-tab[data-section="nature"]');
			await actor.hold(400);
			// Hovering names the emoji in the footer.
			for (const x of [0.12, 0.3, 0.48]) {
				await actor.moveOnto(".notemoji-picker-body", { x, y: 0.42 });
				await actor.hold(450);
			}
			await actor.click(".notemoji-picker-search", { x: 0.3 });
			await actor.type(":tada:");
			await actor.hold(700);
			await actor.press("Enter", 300);
			await actor.moveTo(820, 470);
			await actor.hold(2200);
		},
	},

	/** Switching the emoji style in the settings; the explorer, tab and title follow. */
	styles: {
		width: 960,
		async setup(page) {
			await addEmojiFonts(page);
			await page.evaluate((note) => window.demo.setIcon(note, "🚀"), NOTE);
			await page.evaluate(() => {
				window.demo.showSettings(true);
				// The "Emoji style" heading at the top of the panel.
				const content = document.querySelector(".demo-settings-content");
				const heading = document.querySelector(
					".notemoji-styles-section",
				)?.previousElementSibling;
				if (content && heading) {
					content.scrollTop +=
						heading.getBoundingClientRect().top - content.getBoundingClientRect().top;
				}
			});
		},
		async play(actor) {
			for (const style of ["twemoji", "openmoji", "noto-color", "noto-mono", "system"]) {
				await actor.click(`.notemoji-style-card[data-style="${style}"]`, {
					x: 0.3,
					y: 0.3,
				});
				// The font loads and the explorer re-renders.
				await actor.page.waitForTimeout(300);
				await actor.hold(1300);
			}
		},
	},
};

async function recordGif(browser, name, { hash = "", setup, play, clip, width }) {
	const scene = await openScene(browser, hash);
	await setup?.(scene.page);
	const folder = path.join(buildDir, "frames", name);
	await rm(folder, { recursive: true, force: true });
	await mkdir(folder, { recursive: true });
	const actor = new Actor(scene.page, folder, clip);
	await actor.start();
	await play(actor);
	await scene.close();

	// Frames with their exact lengths (the last one is listed twice, as ffmpeg's concat needs).
	const list = actor.frames
		.map(({ file, ms }) => `file '${file}'\nduration ${ms / 1000}`)
		.concat(`file '${actor.frames.at(-1).file}'`)
		.join("\n");
	const listFile = path.join(folder, "frames.txt");
	await writeFile(listFile, list);

	const gif = path.join(mediaDir, `${name}.gif`);
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-loglevel",
			"error",
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			listFile,
			"-vf",
			`scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
			"-fps_mode",
			"vfr",
			gif,
		],
		{ stdio: "inherit" },
	);
	shrinkGif(gif);
}

/** Lossless GIF optimisation when gifsicle is installed. */
function shrinkGif(file) {
	try {
		execFileSync("gifsicle", ["-O3", "--batch", file], { stdio: "ignore" });
	} catch {
		// Optional.
	}
}

// ---------------------------------------------------------------- stills

/** Window screenshots used by the composed images (written to .test-build/shots). */
const SHOTS = {
	dark: { hash: "theme=dark" },
	"phone-note": { hash: "theme=dark&layout=phone&view=note", viewport: PHONE },
	"phone-explorer": { hash: "theme=dark&layout=phone&view=explorer", viewport: PHONE },
};

async function takeShot(browser, name, { hash, viewport }) {
	const scene = await openScene(browser, hash, { viewport });
	await scene.page.evaluate((note) => window.demo.setIcon(note, "🚀"), NOTE);
	// No cursor in still images.
	await scene.page.evaluate(() => document.querySelector(".demo-cursor")?.remove());
	await scene.page.waitForTimeout(300);
	const file = path.join(buildDir, "shots", `${name}.png`);
	await scene.page.screenshot({ path: file });
	await scene.close();
	return file;
}

// ---------------------------------------------------------------- screenshots

/** The custom icons used in the showcase: original drawings in scripts/demo/icons, and the logo. */
async function addCustomIcons(page) {
	const folder = path.join(demoDir, "icons");
	const files = (await readdir(folder)).map((name) => path.join(folder, name));
	files.push(path.join(mediaDir, "logo.svg"));
	for (const file of files) {
		const name = path.basename(file) === "logo.svg" ? "notemoji.svg" : path.basename(file);
		await page.evaluate(
			({ name, svg }) => {
				const data = new TextEncoder().encode(svg).buffer;
				window.demo.adapter.files.set(`.obsidian/plugins/notemoji/icons/${name}`, data);
			},
			{ name, svg: await readFile(file, "utf8") },
		);
	}
}

/** Screenshots of the scene, written to docs/media as they are. */
const SCREENSHOTS = {
	/** Your own icons in the picker, and on notes and folders. */
	"custom-icons": async (page) => {
		await addCustomIcons(page);
		await page.evaluate((note) => {
			const icons = {
				[note]: "custom:frog.svg",
				Projects: "custom:planet.svg",
				"Projects/Roadmap.md": "custom:q3.svg",
				Recipes: "custom:coffee.svg",
				Travel: "custom:mountains.svg",
				"Reading list.md": "custom:leaf.svg",
			};
			for (const [path, value] of Object.entries(icons)) window.demo.setIcon(path, value);
		}, NOTE);
		await page.click(`[data-path="${NOTE}"]`, { button: "right" });
		await page.click('.menu-item:text-is("Change note emoji")');
		await page.click('.notemoji-picker-tab[data-section="custom"]');
		await page.hover(".notemoji-picker-emoji img[src]:near(.notemoji-picker-emoji.is-current)");
		await page.waitForTimeout(400);
	},
};

async function takeScreenshot(browser, name, play) {
	const scene = await openScene(browser, "theme=dark");
	await play(scene.page);
	await scene.page.evaluate(() => document.querySelector(".demo-cursor")?.remove());
	await scene.page.screenshot({ path: path.join(mediaDir, `${name}.png`) });
	await scene.close();
}

// ---------------------------------------------------------------- composed images

/** Images made from window screenshots, laid out as HTML (CSS size × SCALE). */
const COMPOSED = {
	banner: { size: { width: 1280, height: 640 }, shots: ["dark"], html: bannerHtml },
	mobile: {
		size: { width: 1280, height: 760 },
		shots: ["phone-note", "phone-explorer"],
		html: mobileHtml,
	},
};

const BASE_CSS = `
	* { box-sizing: border-box; margin: 0; }
	body {
		width: 100vw; height: 100vh; overflow: hidden;
		font-family: "Inter", sans-serif; color: #fff;
		background: radial-gradient(120% 120% at 0% 0%, #4b2fb5 0%, #241554 45%, #120b2b 100%);
	}
	.window {
		position: absolute; overflow: hidden; border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.14);
		box-shadow: 0 30px 80px rgba(6, 2, 20, 0.6), 0 8px 24px rgba(6, 2, 20, 0.4);
	}
	.window img { display: block; width: 100%; }
	.label {
		font-size: 15px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
		color: rgba(255, 255, 255, 0.6);
	}
`;

function bannerHtml([dark], logo) {
	return `<style>${BASE_CSS}
		.text { position: absolute; left: 72px; top: 150px; width: 420px; }
		.logo { width: 96px; height: 96px; filter: drop-shadow(0 12px 24px rgba(0,0,0,0.35)); }
		h1 { margin-top: 28px; font-size: 64px; font-weight: 800; letter-spacing: -0.03em; }
		p { margin-top: 14px; font-size: 24px; line-height: 1.4; color: rgba(255,255,255,0.78); }
		.window { left: 540px; top: 110px; width: 860px; }
	</style>
	<div class="text">
		<img class="logo" src="${logo}">
		<h1>Notemoji</h1>
		<p>Give your vault personality with emoji and custom icons for notes, folders and files.</p>
	</div>
	<div class="window"><img src="${dark}"></div>`;
}

function mobileHtml([note, explorer]) {
	const phone = (image, left) => `
		<div class="phone" style="left:${left}px">
			<div class="status"><span>9:41</span><span class="island"></span><span class="battery"></span></div>
			<img src="${image}">
		</div>`;
	return `<style>${BASE_CSS}
		.phone {
			position: absolute; top: 60px; width: 330px; height: 690px; overflow: hidden;
			padding: 10px; border-radius: 52px; background: #0b0b0f;
			box-shadow: 0 0 0 2px #2c2a36, 0 30px 80px rgba(6,2,20,0.6);
		}
		.phone img { display: block; width: 310px; border-radius: 0 0 42px 42px; }
		.status {
			display: flex; justify-content: space-between; align-items: center;
			height: 44px; padding: 0 28px; border-radius: 42px 42px 0 0;
			background: #1e1e1e; font-size: 15px; font-weight: 600;
		}
		.island { width: 96px; height: 28px; border-radius: 14px; background: #000; }
		.battery {
			width: 26px; height: 12px; border-radius: 4px;
			border: 1.5px solid rgba(255,255,255,0.8); padding: 1.5px;
			background: content-box #fff;
		}
		.text { position: absolute; left: 820px; top: 270px; width: 380px; }
		h2 { font-size: 40px; font-weight: 800; letter-spacing: -0.02em; }
		p { margin-top: 14px; font-size: 21px; line-height: 1.45; color: rgba(255,255,255,0.75); }
	</style>
	${phone(note, 90)}
	${phone(explorer, 450)}
	<div class="text"><h2>On your phone too</h2><p>Your emoji and icons sync with your vault to iOS and Android, ready for touch.</p></div>`;
}

const dataUrl = async (file, type = "image/png") =>
	`data:${type};base64,${(await readFile(file)).toString("base64")}`;

async function compose(browser, name, { size, shots, html }, shotFiles) {
	const page = await browser.newPage({ viewport: size, deviceScaleFactor: SCALE });
	const images = await Promise.all(shots.map((shot) => dataUrl(shotFiles[shot])));
	const logo = await dataUrl(path.join(mediaDir, "logo.svg"), "image/svg+xml");
	await page.setContent(html(images, logo));
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(200);
	await page.screenshot({ path: path.join(mediaDir, `${name}.png`) });
	await page.close();
}

async function renderLogo(browser) {
	const page = await browser.newPage({ viewport: { width: 256, height: 256 } });
	const logo = await dataUrl(path.join(mediaDir, "logo.svg"), "image/svg+xml");
	await page.setContent(
		`<style>*{margin:0}body{background:transparent}</style><img src="${logo}" width="256" height="256">`,
	);
	await page.screenshot({ path: path.join(mediaDir, "logo.png"), omitBackground: true });
	await page.close();
}

// ---------------------------------------------------------------- main

const pageUrl = await buildPage();
if (process.argv.includes("--open")) {
	console.log(pageUrl);
	process.exit(0);
}

const only = process.argv
	.find((arg) => arg.startsWith("--only="))
	?.slice("--only=".length)
	.split(",");
const wanted = (name) => !only || only.includes(name);

await mkdir(mediaDir, { recursive: true });
await mkdir(path.join(buildDir, "shots"), { recursive: true });

const browser = await chromium.launch();
try {
	if (wanted("logo")) await renderLogo(browser);

	for (const [name, gif] of Object.entries(GIFS)) {
		if (!wanted(name)) continue;
		await recordGif(browser, name, gif);
		console.log(`docs/media/${name}.gif`);
	}

	for (const [name, play] of Object.entries(SCREENSHOTS)) {
		if (!wanted(name)) continue;
		await takeScreenshot(browser, name, play);
		console.log(`docs/media/${name}.png`);
	}

	const composed = Object.entries(COMPOSED).filter(([name]) => wanted(name));
	const shotFiles = {};
	for (const shot of new Set(composed.flatMap(([, image]) => image.shots))) {
		shotFiles[shot] = await takeShot(browser, shot, SHOTS[shot]);
	}
	for (const [name, image] of composed) {
		await compose(browser, name, image, shotFiles);
		console.log(`docs/media/${name}.png`);
	}
} finally {
	await browser.close();
}
