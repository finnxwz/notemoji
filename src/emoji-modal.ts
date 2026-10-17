import { App, Modal } from "obsidian";
import { parseEmojiInput } from "./emoji";

export interface EmojiModalOptions {
	/** Modal heading, e.g. "Set emoji" or "Change folder emoji". */
	title: string;
	/** Optional line below the heading, e.g. the name of the item. */
	description?: string;
	/** Currently assigned emoji ("" when the item has none). */
	current: string;
	/** Called with the chosen emoji, or "" when the emoji should be removed. */
	onSubmit: (emoji: string) => void;
}

/**
 * Minimal modal for entering an emoji.
 *
 * The input is a plain text field, so the operating system's own emoji picker
 * (Windows: Win + ., macOS: Control + Command + Space) and clipboard pasting
 * work as usual. Multi code point sequences are kept intact, and everything
 * else is validated through `parseEmojiInput`.
 */
export class EmojiModal extends Modal {
	private readonly options: EmojiModalOptions;
	private inputEl!: HTMLInputElement;
	private previewEl!: HTMLElement;
	private hintEl!: HTMLElement;
	private submitEl!: HTMLButtonElement;

	constructor(app: App, options: EmojiModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("notemoji-modal");

		contentEl.createEl("h2", { text: this.options.title });
		if (this.options.description) {
			contentEl.createDiv({ cls: "notemoji-description", text: this.options.description });
		}

		const rowEl = contentEl.createDiv({ cls: "notemoji-input-row" });
		this.previewEl = rowEl.createDiv({
			cls: "notemoji-preview",
			attr: { "aria-hidden": "true" },
		});
		this.inputEl = rowEl.createEl("input", {
			cls: "notemoji-input",
			attr: {
				type: "text",
				autocomplete: "off",
				spellcheck: "false",
				placeholder: "Emoji (Win + . or ⌃⌘Space)",
			},
		});
		this.inputEl.value = this.options.current;
		this.inputEl.addEventListener("input", () => this.refresh());
		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key !== "Enter" || event.isComposing) return;
			event.preventDefault();
			this.submit();
		});

		this.hintEl = contentEl.createDiv({ cls: "notemoji-hint" });

		const actionsEl = contentEl.createDiv({ cls: "notemoji-actions" });
		if (this.options.current !== "") {
			const removeEl = actionsEl.createEl("button", { text: "Remove", cls: "notemoji-remove" });
			removeEl.addEventListener("click", () => this.remove());
		}
		this.submitEl = actionsEl.createEl("button", { text: "Set emoji", cls: "mod-cta" });
		this.submitEl.addEventListener("click", () => this.submit());

		this.refresh();
		this.inputEl.focus();
		this.inputEl.select();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** Mirrors the current input state in the preview, hint and submit button. */
	private refresh(): void {
		const parsed = parseEmojiInput(this.inputEl.value);
		const hasCurrent = this.options.current !== "";

		this.previewEl.textContent = parsed.status === "ok" ? parsed.emoji : "?";
		this.previewEl.classList.toggle("is-empty", parsed.status !== "ok");

		if (parsed.status === "empty" && hasCurrent) {
			this.hintEl.textContent = "Submit to remove the emoji.";
			this.hintEl.classList.remove("is-error");
		} else {
			this.hintEl.textContent = parsed.message;
			this.hintEl.classList.toggle("is-error", parsed.status === "invalid");
		}

		this.submitEl.textContent =
			parsed.status === "empty" && hasCurrent ? "Remove emoji" : "Set emoji";
		this.submitEl.disabled =
			parsed.status === "invalid" || (parsed.status === "empty" && !hasCurrent);
	}

	private submit(): void {
		const parsed = parseEmojiInput(this.inputEl.value);
		if (parsed.status === "invalid") {
			this.refresh();
			this.inputEl.focus();
			return;
		}

		const emoji = parsed.status === "ok" ? parsed.emoji : "";
		if (emoji === "" && this.options.current === "") {
			// Nothing entered and nothing to remove.
			this.close();
			return;
		}

		this.close();
		this.options.onSubmit(emoji);
	}

	private remove(): void {
		this.close();
		this.options.onSubmit("");
	}
}
