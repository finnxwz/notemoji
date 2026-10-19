/**
 * Records the README media (docs/media/*) from scripts/demo, a scene that runs
 * the real plugin in an Obsidian-like page.
 *
 *   npm run demo            # screenshots + GIF (the GIF needs ffmpeg)
 *   npm run demo -- --open  # only build .test-build/demo.html to look at it
 *   npm run demo -- --check # also write layout check screenshots to .test-build/
 *
 * Needs Chromium for Playwright (`npx playwright-core install chromium`) and a
 * colour emoji font (built into Windows and macOS; Noto Color Emoji on Linux).
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoDir = path.join(root, "scripts", "demo");
const buildDir = path.join(root, ".test-build");
const mediaDir = path.join(root, "docs", "media");
const viewport = { width: 1000, height: 600 };

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

const pause = (page, ms) => page.waitForTimeout(ms);

/** Moves the mouse in small steps so the recording shows a gliding cursor. */
async function glide(page, selector, { x = 0.5, y = 0.5 } = {}) {
	const box = await page.locator(selector).first().boundingBox();
	if (!box) throw new Error(`Not visible: ${selector}`);
	const point = { x: box.x + box.width * x, y: box.y + box.height * y };
	await page.mouse.move(point.x, point.y, { steps: 18 });
	return point;
}

async function click(page, selector, options) {
	await glide(page, selector, options);
	await pause(page, 250);
	await page.mouse.down();
	await page.mouse.up();
}

async function rightClick(page, selector) {
	const point = await glide(page, selector, { x: 0.4 });
	await pause(page, 250);
	await page.mouse.click(point.x, point.y, { button: "right" });
}

/** The scripted story. `still(name)` marks moments worth a screenshot. */
async function playScene(page, still) {
	await page.mouse.move(700, 420);
	await pause(page, 700);

	// 1. Right-click a note → Set note emoji → search → pick.
	await rightClick(page, '[data-path="Projects/Website relaunch.md"]');
	await pause(page, 600);
	await click(page, '.menu-item:text-is("Set note emoji")');
	await pause(page, 700);
	await page.keyboard.type("rocket", { delay: 140 });
	await pause(page, 600);
	await click(page, ".notemoji-picker-emoji");
	await page.mouse.move(800, 470, { steps: 18 });
	await pause(page, 1500);
	await still("note-title");

	// 2. A folder gets your own icon: upload an image in the Custom section.
	await rightClick(page, '[data-path="Daily notes"]');
	await pause(page, 600);
	await click(page, '.menu-item:text-is("Set folder emoji")');
	await pause(page, 600);
	await click(page, '.notemoji-picker-tab[data-section="custom"]');
	await pause(page, 600);
	await glide(page, ".notemoji-picker-emoji.is-upload");
	await pause(page, 500);
	await still("custom");
	await page.locator(".notemoji-picker .notemoji-hidden-input").setInputFiles(uploadFile);
	await page.mouse.move(820, 520, { steps: 18 });
	await pause(page, 1800);
}

/** A sample image to upload, written next to the build output. */
const uploadFile = path.join(buildDir, "calendar.svg");

async function openScene(browser, url, options) {
	const context = await browser.newContext({ viewport, ...options });
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.goto(url);
	await page.waitForFunction(() => window.demoReady === true);
	await page.evaluate(() => document.fonts.ready);
	return { context, page, errors };
}

const url = await buildPage();
await writeFile(
	uploadFile,
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#e8590c"/><rect x="14" y="18" width="36" height="32" rx="5" fill="#fff"/><rect x="14" y="18" width="36" height="9" rx="4" fill="#ffd8a8"/><circle cx="25" cy="36" r="3" fill="#e8590c"/><circle cx="39" cy="36" r="3" fill="#e8590c"/></svg>',
);
if (process.argv.includes("--open")) {
	console.log(url);
	process.exit(0);
}

const browser = await chromium.launch();
try {
	// Crisp stills at 2x.
	await mkdir(mediaDir, { recursive: true });
	const stills = await openScene(browser, url, { deviceScaleFactor: 2 });
	await playScene(stills.page, (name) =>
		stills.page.screenshot({ path: path.join(mediaDir, `${name}.png`) }),
	);

	if (process.argv.includes("--check")) {
		// Layout checks for other states; not part of the README.
		await stills.page.evaluate(() => window.setNoteTitle("inline"));
		await pause(stills.page, 200);
		await stills.page.screenshot({ path: path.join(buildDir, "check-inline.png") });
		await stills.page.evaluate(() => {
			window.setNoteTitle("above");
			window.setIconOf("Projects/Website relaunch.md", "custom:acme.svg");
		});
		await pause(stills.page, 200);
		await stills.page.screenshot({ path: path.join(buildDir, "check-custom-titles.png") });
		await stills.page.evaluate(() => window.showSettings());
		await pause(stills.page, 300);
		await stills.page.screenshot({ path: path.join(buildDir, "check-settings.png") });

		// Switch between real, downloaded styles (fonts cached by `npm run set-previews`).
		const fontsDir = path.join(buildDir, "fonts");
		for (const file of ["twemoji.ttf", "openmoji.woff2", "noto-color.ttf", "noto-mono.ttf"]) {
			const data = await readFile(path.join(fontsDir, file)).catch(() => null);
			if (!data) continue;
			await stills.page.evaluate(
				({ file, base64 }) => {
					const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
					window.demoAdapter.files.set(
						`.obsidian/plugins/notemoji/fonts/${file}`,
						bytes.buffer,
					);
				},
				{ file, base64: data.toString("base64") },
			);
		}
		const switches = [];
		for (const style of [
			"twemoji",
			"openmoji",
			"noto-color",
			"noto-mono",
			"system",
			"twemoji",
		]) {
			await stills.page.click(`.notemoji-style-card[data-style="${style}"]`);
			await pause(stills.page, 400);
			const file = path.join(buildDir, `check-switch-${switches.length}-${style}.png`);
			await stills.page.evaluate(() =>
				document.querySelector(".demo-settings").addClass("is-hidden"),
			);
			await stills.page.screenshot({
				path: file,
				clip: { x: 60, y: 60, width: 260, height: 260 },
			});
			await stills.page.evaluate(() =>
				document.querySelector(".demo-settings").removeClass("is-hidden"),
			);
			switches.push(file);
		}
		await stills.page.evaluate(() => document.querySelector(".demo-settings")?.remove());
		await rightClick(stills.page, '[data-path="Projects"]');
		await pause(stills.page, 300);
		await stills.page.screenshot({ path: path.join(buildDir, "check-menu.png") });
	}
	await stills.context.close();
	if (stills.errors.length > 0)
		throw new Error(`Errors in the demo:\n${stills.errors.join("\n")}`);

	// The video for the GIF.
	const videoDir = path.join(buildDir, "video");
	await rm(videoDir, { recursive: true, force: true });
	const recording = await openScene(browser, url, {
		recordVideo: { dir: videoDir, size: viewport },
	});
	await playScene(recording.page, async () => {});
	const video = recording.page.video();
	await recording.context.close();
	const webm = await video.path();

	try {
		execFileSync(
			"ffmpeg",
			[
				"-y",
				"-loglevel",
				"error",
				"-ss",
				"0.4",
				"-i",
				webm,
				"-vf",
				"fps=15,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
				path.join(mediaDir, "demo.gif"),
			],
			{ stdio: "inherit" },
		);
	} catch {
		console.warn(`ffmpeg failed or is missing; the raw recording is at ${webm}`);
	}
} finally {
	await browser.close();
}

console.log(`Media written to ${path.relative(root, mediaDir)}/`);
