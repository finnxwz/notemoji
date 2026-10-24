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
- **Stored values:** an emoji as-is (`"🚀"`), `custom:<name>` (a custom icon in `data.json`) or
  `lucide:<name>` (one of Obsidian's icons). Other prefixes are reserved for future icon sources.
- **`data.json` is versioned (v2)** and always read leniently: older files (1.x) keep working.
  It remembers what is on disk; anything in memory that differs is a change not saved yet, and
  when sync changed the file meanwhile, those changes are combined with it entry by entry,
  never dropped. Saves and reloads run in one queue; a save writes the current data (a burst of
  changes is one write) after checking the file, in case sync replaced it before Obsidian
  reported it. A deleted, empty or unreadable file during sync is ignored (the complete file
  follows). See `src/data-file.ts`.
- **Compatible in both directions.** Changes to `data.json` only add entries. Everything a
  version doesn't understand (top-level entries, settings or values, custom icon formats,
  copies of other icon sources, `prefix:` icon values) is kept and written back, so an older
  version never drops a newer one's data. The version number goes up only for a change older
  versions can't handle; they then show a notice and stop saving instead of damaging the file.
  Icons kept for a newer version are never counted as missing or deleted with _Delete all_.
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
  `data.json`, so shared across devices), custom icons, Obsidian icons and a _Remove_ button.
- Search: English names, keywords and shortcodes. Pasting any emoji or symbol works, also ones
  not in the list; pasted emoji are stored as the list writes them (`❤` → `❤️`). Typed keyboard
  text is a search: `+1` and `<3` find 👍 and ❤️; a lone keyboard symbol (`$`) is offered after
  the results. Half a flag (a single regional indicator letter) is not an icon.
- Keyboard: type to search, arrows move through the grid, Enter picks the selected tile (nothing
  when no tile is selected), Esc closes.
- Mobile: the search field is not focused automatically (the keyboard would cover the grid).
- Emoji up to Emoji 15.0, generated from emojibase.
  - _Rejected:_ skin tone selector, random button. (Random emoji for new notes is a separate,
    opt-in use the maintainer asked for; see "Automatic emoji for new notes".)
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

## Automatic emoji for new notes

- **Opt-in setting, off by default**, requested by the maintainer. Only notes (`.md`), never
  folders, attachments, canvases or bases, and never existing notes.
- **Only notes made on this device:** a note counts when it is opened within 5 seconds of being
  created (_New note_, daily notes, templates, a click on an unresolved link). Notes that arrive
  by sync (Obsidian Sync, iCloud, Git), imports and notes other plugins create in bulk are hardly
  ever opened that quickly, so two devices don't pick different random emoji for the same note:
  the device that made it picks, and the emoji syncs like any other. Creates are ignored until the
  layout is ready, because Obsidian reports every file as created while it starts (checked with
  `workspace.layoutReady` rather than by registering later, so a daily note created at startup
  still counts).
- **Your own emoji win:** a note that already has an icon (moved there with a rename, or kept from
  a deleted note at the same path) is left as it is. The pick is stored like an emoji set in the
  picker (synced, changeable, removable) but not added to the recently used emoji: nobody chose
  it.
- **Themed random** (`src/icons/auto-emoji.ts`, lists in `auto-emoji-themes.ts`). The first
  source that fits wins: English key words in the name (whole words only, plurals listed, no
  stemming: loose matching gave "Bank balance" → ☯️-style mistakes); a date the name starts with
  (the season of its month); the note's folder, else the folder above (key words in its name, or
  its emoji when that belongs to a theme); otherwise about 150 friendly emoji (no flags, people,
  skin tones, sequences, nothing ambiguous, religious or political). A key word with one obvious
  emoji (pizza → 🍕) beats other key words and is taken unless a neighbour has it.
- **Variety:** chosen by chance among the theme's least used emoji: first not used by an item in
  the same folder, then not among the last 8 automatic picks of the session.
- **Seasons by hemisphere**, from the time zone (a short list of southern zones; north
  otherwise). Holiday emoji (🎄, 🎃) only in their month.
- **"Untitled", then named:** Obsidian names a new note _Untitled_ (in any language) and the real
  name follows right away. A pick from the friendly emoji is remembered for this session; at the
  note's first rename within 5 minutes, if it still has that emoji and the new name fits a theme,
  the emoji is replaced. Picks that already fit (name, date or folder) stay.
- Every listed emoji is in the picker's list, written as the list writes it (a test checks), so
  emoji styles can draw it.

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

## Obsidian icons

- **Obsidian's own icons (Lucide, ISC) are a third icon source,** stored as `lucide:<name>` (the
  id from `getIconIds()` without `lucide-`). The picker lists the icons of the running Obsidian,
  not a bundled list, so Notemoji stays small and always offers what Obsidian has.
- **A copy of each icon in use lives in `data.json`** (`libraryIcons`, by value, the SVG as plain
  text), and every device draws that copy. Devices run different Obsidian versions (1.7.2 ships
  Lucide 0.446 or so; 1.13 ships Lucide 1.x with renamed icons and without brand icons), so the
  same name can be missing or look different elsewhere.
  - _Rejected:_ the name alone (icons would differ or vanish between devices); bundling Lucide
    (size, and a second copy of what Obsidian already has).
- **Copies follow the icons in use:** added when an icon is picked; after loading and after every
  reload from sync, unused copies are dropped and missing ones added where this device can draw
  the icon. A copy is never replaced, so two devices with different Obsidian versions don't keep
  swapping their drawings. Saved only when something changed, never while the backup stands in
  for `data.json`. Icons used anywhere in data of a newer version count as used, so an older
  version never drops copies a newer one relies on.
- **Shown as a CSS mask filled with the text colour,** so they follow light and dark themes like
  Obsidian's own icons, through a `blob:` URL (the copy is synced data and never inserted as
  markup). Without a copy, this device's own drawing is shown; without either, the space stays
  empty, like a missing custom icon.
- **They share the 3 MB of custom icons.** A copy takes about 1 KB, so a pick never fails for
  lack of room; the storage in the settings counts them, without listing them one by one.
- **In the picker:** a section _Obsidian icons_ after all emoji categories (people who use emoji
  only never scroll past them), its tab showing a Lucide icon. Tiles are drawn by Obsidian
  (`setIcon`) as they scroll into view, fast enough without sprite sheets. Search matches the
  start of the words of a name (`arrow r` finds `arrow-right`), after emoji and custom icons; the
  footer names the icon in plain words. Picked icons enter the recently used list like emoji.
  - _Not offered:_ a colour of their own (they take the text colour) or a context menu.

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

- Possible later: icons in bookmarks, links, search results and the quick switcher; search in
  more languages; a command to move emoji out of file names.
