/** How long a finger has to rest on an item to open its menu (ms). */
const LONG_PRESS_MS = 500;
/** A finger moving further than this (px) scrolls instead. */
const MOVE_TOLERANCE_PX = 10;

/** Opens a menu for `target` at a position; returns whether there was one to open. */
export type MenuOpener = (target: HTMLElement, position: { x: number; y: number }) => boolean;

/**
 * Opens a context menu inside `el` on right-click and on long-press.
 *
 * iOS never fires `contextmenu` for a long-press, so touches are timed here;
 * Android does fire it, and only one menu opens either way. The click that
 * ends a long-press is swallowed, so it does not also pick the item below.
 */
export function onContextMenu(el: HTMLElement, open: MenuOpener): void {
	let timer: number | null = null;
	/** Where the current touch started; null without a touch. */
	let touch: { x: number; y: number } | null = null;
	/** A menu was opened by the current touch. */
	let opened = false;

	const stopTimer = () => {
		if (timer !== null) window.clearTimeout(timer);
		timer = null;
	};
	const endTouch = () => {
		stopTimer();
		touch = null;
	};

	el.addEventListener("pointerdown", (event) => {
		endTouch();
		opened = false;
		if (event.pointerType !== "touch") return;
		const target = event.target as HTMLElement;
		const start = { x: event.clientX, y: event.clientY };
		touch = start;
		timer = window.setTimeout(() => {
			timer = null;
			opened = open(target, start);
		}, LONG_PRESS_MS);
	});
	el.addEventListener("pointermove", (event) => {
		if (
			touch &&
			Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > MOVE_TOLERANCE_PX
		)
			stopTimer();
	});
	el.addEventListener("pointerup", endTouch);
	el.addEventListener("pointercancel", endTouch);

	el.addEventListener("contextmenu", (event) => {
		stopTimer();
		if (opened) {
			event.preventDefault();
			return;
		}
		if (!open(event.target as HTMLElement, { x: event.clientX, y: event.clientY })) return;
		event.preventDefault();
		if (touch) opened = true;
	});
	el.addEventListener(
		"click",
		(event) => {
			if (!opened) return;
			opened = false;
			event.preventDefault();
			event.stopImmediatePropagation();
		},
		{ capture: true },
	);
}
