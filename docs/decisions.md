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
- **Stored values:** an emoji as-is (`"🚀"`) or `custom:<file>`. Prefixes are reserved for future
  icon sources.
- **`data.json` is versioned (v2)** and always read leniently: older files (1.x) keep working,
  damaged ones fall back to defaults instead of throwing. Reloaded on external changes (sync),
  after pending saves.
- **Everything else lives in the plugin folder** (`icons/`, `fonts/`, `cache/`), so uninstalling
  removes it. Obsidian has no uninstall hook; never delete user files in `onunload`. Never write
  anywhere else in the vault ("never bloat the user's disk").

## Picker

- Centred modal (also on mobile) with search, category tabs, recently used (24, stored in
  `data.json`, so shared across devices), custom icons and a _Remove_ button.
- Search: English names, keywords and shortcodes. Pasting any emoji or symbol works, also ones
  not in the list; pasted emoji are stored as the list writes them (`❤` → `❤️`).
- Keyboard: type to search, arrows move through the grid, Enter picks the selected tile (nothing
  when no tile is selected), Esc closes.
- Mobile: the search field is not focused automatically (the keyboard would cover the grid).
- Emoji up to Emoji 15.0, generated from emojibase.
  - _Rejected:_ skin tone selector, random button.
- **Performance:** the grid is virtualized and shows pre-rendered sprite sheets of the emoji,
  drawn in idle time after startup and cached in `cache/sprites/` per style, device type,
  density and a fingerprint of how the device draws emoji. Chosen after real lag on Windows,
  where drawing colour emoji glyphs is slow. The cache lives in the plugin folder by the
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

- Custom icons: PNG, JPG, GIF, WebP, SVG up to 2 MB, uploaded in the picker, stored in `icons/`,
  always shown through `<img>` (SVG scripts never run). Deleting asks first.
- Emoji styles change only Notemoji's emoji, not emoji in notes. System (default), Twemoji,
  OpenMoji, Noto Color Emoji, Noto Emoji Mono, own font file; chosen on cards with previews.
- **Downloads only on the user's click**, pinned to a release and checked by SHA-256. A style
  missing on a device (not downloaded or not synced yet) shows system emoji; nothing is
  downloaded automatically.
  - _Rejected:_ Apple, Samsung or Microsoft emoji as downloads (not redistributable).
- Own font file: no size limit, a confirmation above 50 MB.
- Settings tab icon: a colourful 😀 (`SettingTab.icon`, Obsidian 1.11+, ignored before).

## Compatibility and tooling

- `minAppVersion` 1.7.2: newer APIs only when guarded (see `SettingTab.icon`).
- Undocumented Obsidian internals (explorer items, tab title elements) only through
  `src/internals.ts`, always defensive.
- `npm run check` (Prettier, ESLint with the Obsidian rules, TypeScript, Vitest, build) must pass;
  CI runs it. No release automation.
- README media is recorded from the real plugin (`npm run demo`), so it stays truthful.

## Open

- Version number of the next release (1.1.0 or 2.0.0).
- Possible later: icons in bookmarks, links, search results and the quick switcher; icon
  libraries such as Lucide; search in more languages; a command to move emoji out of file names.
