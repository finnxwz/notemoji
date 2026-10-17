# Notemoji

Assign emoji icons to notes and folders in the file explorer to make your vault feel a little cozier.

## ⚒️ Features

- Emoji icons for **notes, files and folders** that show up right in front of their name.
- Right-click a file or folder → **Set / Change / Remove … emoji**.
- A minimal input that works with your operating system's emoji picker
  (Windows: `Win + .`, macOS: `Control + Command + Space`) and with pasting.
- Multi code point emoji are supported: flags, skin tones, variation selectors,
  keycaps and ZWJ families (`🇩🇪`, `👍🏽`, `❤️`, `1️⃣`, `👨‍👩‍👧‍👦`).
- Icons stay with their note, also if renamed or moved.
- No settings, no assets, no emoji database. Your notes are never modified.

## 🤔 How to use Notemoji

| Action          | How                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------- |
| Set an emoji    | Right-click the item in the file explorer → *Set note emoji* / *Set folder emoji*         |
| Change an emoji | Right-click → *Change … emoji* (the input is pre-filled)                                  |
| Remove an emoji | Right-click → *Remove … emoji*, or clear the input and submit                             |

The input only accepts a single emoji. If you enter more than one, only the first one is
being used. 

## 💻 Installation

- **directly in Obsidian:** 
	- Settings → Community plugins → Browse* → search for **Notemoji** → *Install* → **Enable**
- **via GitHub:**
	- Copy `manifest.json`, `main.js` and `styles.css` into `<your vault>/.obsidian/plugins/notemoji/`.
	- Reload Obsidian and enable **Notemoji** under *Settings → Community plugins*.

## 💡 Additional info

- Icons are shown in the **file explorer** only. Tabs, the note title, search
  results and bookmarks are intentionally left untouched.
- Deleting an item also removes its emoji. Because Obsidian reports every
  deletion the same way, a file restored from the trash starts without its emoji
  (it can be re-assigned in just two clicks).
- Emoji come from your operating system and the fonts you have installed. Some
  platforms do not ship flag glyphs, so `🇩🇪` may be displayed as `DE`, the real
  emoji is stored either way.
- Your icons are saved in Obsidian's plugin data and never touch the content of
  your notes.

## 😎 You might also like some other plugins I've made:

- **[TidyTasks](obsidian://show-plugin?id=tidytasks)** - Automatically move completed tasks to the bottom of each Markdown task list, keeping subtasks attached and surrounding text in place.

My plugins are designed to work across Windows, macOS, Android, and iOS.

## ⚠️ Feedback and support

Found a bug or have a suggestion? Open an issue in this repository's **GitHub Issues** tab. Include your Obsidian version, device/platform, a small Markdown example and what you expected to happen. Please remove private note content before sharing examples.