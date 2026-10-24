# Decisions

Why Notemoji works the way it does. Read this before changing behaviour: most of these were
weighed against alternatives, tested in real vaults, and some were revised after testing. Rejected
ideas are listed so they are not proposed again without a new reason.

## Product

- **Purpose:** emoji and custom icons for notes, folders and files, shown next to their names
  (never written into them).
- **Simple first.** New features only when they fit this purpose; settings only when people
  really disagree about a behaviour.
- **Same on every device:** Windows, macOS, Linux, iOS, Android, with the same settings.

## Branding

- **Subline:** "Give your vault personality with emoji and custom icons for notes, folders and
  files." (also the manifest description).
- **Selling points, in this order:** emoji everywhere (explorer, tabs, title; folders and all
  files), a full and fast picker (recent, paste anything, keyboard), your own image icons, emoji
  styles and your own emoji font, synced and working on phones.
- **Not used for selling:** comparisons with other tools or with emoji in file names,
  "without renaming", clean links. Most people looking for the plugin do not think about that;
  facts like "notes are never changed" go into the FAQ.
- **Media** shows the inline title emoji, the dark theme and the logo (a smiling page). Every GIF
  changes the open note, so the title visibly changes. Only two GIFs (setting an emoji, switching
  styles), to keep the page light. No third-party characters or brand logos in any media.

## Storage

- **Everything in `data.json`, by vault path:** notes, folders and other files. Notes are never
  modified.
  - _Rejected: frontmatter._ Tried and removed: the property shows in Properties, and Obsidian
    has no clean way to hide a single property.
  - _Rejected: recovering emoji after renames outside Obsidian_ (by content, IDs, …). Keep it
    simple and predictable: renames inside Obsidian move the emoji, outside ones lose it.
- **Deletes never touch `data.json`.** With sync, a delete can be half of a rename on another
  device. No pruning at startup; a manual _Remove emoji of missing files_ button instead.
- **Stored values:** an emoji as-is (`"🚀"`) or `custom:<name>` (a custom icon in `data.json`).
  Prefixes are reserved for future icon sources.
- **`data.json` is versioned (v2)** and always read leniently: older files (1.x) keep working.
  It remembers what is on disk; anything in memory that differs is a change not saved yet, and
  when sync changed the file meanwhile, those changes are combined with it entry by entry,
  never dropped. Saves and reloads run in one queue; a save writes the current data (a burst of
  changes is one write) after checking the file, in case sync replaced it before Obsidian
  reported it. A deleted, empty or unreadable file during sync is ignored (the complete file
  follows). See `src/data-file.ts`.
- **Compatible in both directions.** Changes to `data.json` only add entries. Everything a
  version doesn't understand (top-level entries, settings or values, custom icon formats,
  `prefix:` icon values) is kept and written back, so an older version never drops a newer
  one's data. The version number goes up only for a change older versions can't handle; they
  then show a notice and stop saving instead of damaging the file. Icons kept for a newer
  version are never counted as missing or deleted with _Delete all_.
- **Repairing after 1.x.** Released 1.x keeps only the emoji when it saves (no settings, recent,
  custom icons or `custom:` values, trimmed paths) and never reloads. When a device that wasn't
  updated yet saves over the file, the others put back what it dropped: from memory when
  running, else from `backup.json`. Its emoji win, except over custom icons (it can only hold
  an outdated emoji there); emoji it lacks are restored (a removal there comes back, which is
  easier to undo than a lost emoji). An emoji 1.x changed and an outdated one can't be told
  apart; the newer write wins. A marker key in `icons` that 1.x drops also catches Obsidian
  Sync merging a 2.x file with a 1.x copy key by key. Release notes still ask to update every
  device.
- **`backup.json`** in the plugin folder: a copy of `data.json` on this device, written shortly
  after saves and reloads (never a backup of nothing). Obsidian Sync doesn't sync it, so it
  survives another device damaging the file; other sync tools copy it along, which is
  harmless. It is used, without saving right away, when `data.json` is unreadable or not
  downloaded yet; without a backup, nothing is saved over an unreadable file until it is
  restored or deleted (it may still be recovered from sync history). To start over on a device
  with a backup, delete both files.
- **Everything else lives in the plugin folder** (`fonts/`, `cache/`, `backup.json`), so uninstalling
  removes it. Obsidian has no uninstall hook; never delete user files in `onunload`. Never write
  anywhere else in the vault ("never bloat the user's disk").

## Picker

- Centred modal (also on mobile) with search, category tabs, recently used (24, stored in
  `data.json`, so shared across devices), custom icons and a _Remove_ button.
- Search: English names, keywords and shortcodes. Pasting any emoji or symbol works, also ones
  not in the list; pasted emoji are stored as the list writes them (`❤` → `❤️`). Typed keyboard
  text is a search: `+1` and `<3` find 👍 and ❤️; a lone keyboard symbol (`$`) is offered after
  the results. Half a flag (a single regional indicator letter) is not an icon.
- Keyboard: type to search, arrows move through the grid, Enter picks the selected tile (nothing
  when no tile is selected), Esc closes.
- Mobile: the search field is not focused automatically (the keyboard would cover the grid).
- Emoji up to Emoji 15.0, generated from emojibase.
  - _Rejected:_ skin tone selector, random button.
- **Performance:** the grid is virtualized and shows pre-rendered sprite sheets of the emoji,
  drawn in idle time after startup and cached in `cache/sprites/` per style, device type,
  density and a fingerprint of how the device draws emoji. Chosen after real lag on Windows,
  where drawing colour emoji glyphs is slow. A new folder replaces outdated ones (older format,
  emoji list or font) but keeps up to two that only look different (another computer of the
  same kind when the folder syncs), so devices don't delete each other's images. Drawn at up to
  2× density: 3× would triple the memory of the decoded images on phones. The cache lives in the plugin folder by the
  maintainer's choice (removed on uninstall), 3–7 MB per style.
- **No tooltips:** Obsidian shows every `aria-label` as a tooltip, which looked bad and caused
  lag on hover. Tiles, cards and the title emoji have none; the picker footer names the hovered
  emoji.

## Where emoji appear

- File explorer: always.
- Note title: _Off_ (default) / _Large, above the title_ (clickable, opens the picker) /
  _Inline_ (display-only). Hidden when Obsidian's inline title is off. Editing and reading view
  only.
  - _Rejected:_ hover previews and embeds; an "Add icon" button on notes without an emoji.
- Tab titles: on by default. View header title: off by default (changed after testing).
- Title decorations are display-only (CSS `::before` from an attribute), never part of the
  editable title text, so renaming by editing the title keeps working.
- Clicking emoji in the explorer or tabs keeps Obsidian's normal behaviour.

## Actions

- Right-click menu (_Set / Change / Remove … emoji_) and two commands.
  - _Rejected:_ multi-select actions, ribbon icon.

## Custom icons and emoji styles

- **Custom icons live in `data.json`** (`customIcons`, by name, base64), so they sync exactly
  when the emoji that use them sync. Items refer to an icon by name: each is stored once, and an
  identical upload reuses it. Uploaded in the picker; listed in the settings with preview,
  format, size and uses. Deleting asks first.
  - _Rejected:_ the plugin folder (Obsidian Sync copies only `manifest.json`, `main.js`,
    `styles.css` and `data.json` of a plugin); a vault folder (visible, easy to delete by
    accident); dot folders and folders in `.obsidian/` (never synced); a setting to choose
    between storages (two code paths for little gain).
- **Limits:** 3 MB for all icons (as stored), 60 KB per icon (45 KB file), so at least 50 icons
  always fit. Obsidian Sync (Standard) skips files over 5 MB, which would stop every emoji from
  syncing, and data.json also holds the emoji of large vaults and is uploaded on every save.
- **Sharp:** images are scaled down to 512 px on the longest side (several times the largest
  display size, the note title, on the densest screens), never upscaled. SVG stays a vector. An
  image that already fits is stored unchanged (animations keep playing); others become WebP at
  quality 90 → 60 (JPEG or PNG where WebP can't be written). AVIF is always converted.
- **Refused, with the reason:** HEIC, files over 20 MB, SVG over 45 KB (simplify or use PNG),
  animated GIF, PNG or WebP over 512 px or 45 KB (not frozen silently), images still too large at the lowest
  quality.
- Custom icons are shown through `blob:` URLs in `<img>` or CSS, never inline (SVG scripts never
  run). A missing icon (deleted or not synced yet) keeps its space empty; the settings list such
  icons and can remove them.
- Emoji styles change only Notemoji's emoji, not emoji in notes. System (default), Twemoji,
  OpenMoji, Noto Color Emoji, Noto Emoji Mono, own font file; chosen on cards with previews.
- **Downloads only on the user's click**, pinned to a release and checked by SHA-256. A style
  missing on a device (not downloaded or not synced yet) shows system emoji; nothing is
  downloaded automatically.
- **A style the device can't draw** shows system emoji, with the reason in the caption. Checked
  by drawing 😀 after loading: Noto Color Emoji is COLRv1, which Safari/WebKit (Obsidian on
  iPhone and iPad) doesn't support, so its glyphs would be empty there.
  - _Rejected:_ Apple, Samsung or Microsoft emoji as downloads (not redistributable).
- Own font file: no size limit, a confirmation above 50 MB.
- Settings tab icon: a colourful 😀 (`SettingTab.icon`, Obsidian 1.11+, ignored before).

## Compatibility and tooling

- Version 2.0.0 for the rework (new data format; update every device).
- `minAppVersion` 1.7.2: newer APIs only when guarded (see `SettingTab.icon`).
- Undocumented Obsidian internals (explorer items, tab title elements) only through
  `src/internals.ts`, always defensive.
- `npm run check` (Prettier, ESLint with the Obsidian rules, TypeScript, Vitest, build) must pass;
  CI runs it with read-only permissions. A test keeps `manifest.json`, `package.json`, the lock
  file and `versions.json` in step. No release automation.
- README media is recorded from the real plugin (`npm run demo`), so it stays truthful.

## Open

- Possible later: icons in bookmarks, links, search results and the quick switcher; icon
  libraries such as Lucide; search in more languages; a command to move emoji out of file names.
