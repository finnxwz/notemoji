# Decisions

Why Notemoji works the way it does. Read this before changing behaviour: most of these were
weighed against alternatives, tested in real vaults, and some were revised after testing. Rejected
ideas are listed so they are not proposed again without a new reason. How things are built is in
the code comments.

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
- **Not used for selling:** comparisons with other tools or with emoji in file names, "without
  renaming", clean links. Most people looking for the plugin do not think about that; facts like
  "notes are never changed" go into the FAQ.
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
  When sync changed the file while this device has unsaved changes, both are combined entry by
  entry, never dropped (`src/data-file.ts`). A deleted, empty or unreadable file during sync is
  ignored: the complete file follows.
- **Compatible in both directions.** Changes to `data.json` only add entries. Everything a
  version doesn't understand (entries, settings, values, icon formats) is kept and written back,
  so an older version never drops a newer one's data. The version number goes up only for a
  change older versions can't handle; they then show a notice and stop saving instead of
  damaging the file. Icons kept for a newer version never count as missing.
- **Repairing after 1.x.** Released 1.x keeps only the emoji when it saves. When a device that
  wasn't updated yet saves over the file, the others put back what it dropped (from memory, else
  from `backup.json`); its emoji win, except over custom and Obsidian icons, which it can't have
  seen. Release notes still ask to update every device.
- **`backup.json`** in the plugin folder: this device's copy of `data.json`, used when the file is
  unreadable or not downloaded yet. Obsidian Sync doesn't sync it, so it survives another device
  damaging the file. Without a backup, nothing is saved over an unreadable file. To start over on a
  device, delete both files.
- **Everything else lives in the plugin folder** (`fonts/`, `cache/`, `backup.json`), so
  uninstalling removes it. Obsidian has no uninstall hook; never delete user files in `onunload`.
  Never write anywhere else in the vault ("never bloat the user's disk").

## Picker

- Centred modal (also on mobile) with search, category tabs, recently used (24, stored in
  `data.json`, so shared across devices), custom icons, Obsidian icons and a _Remove_ button.
- Search: English names, keywords and shortcodes. Pasting any emoji or symbol works, also ones
  not in the list. Typed keyboard text is a search: `+1` and `<3` find 👍 and ❤️; a lone keyboard
  symbol (`$`) is offered after the results.
- Keyboard: type to search, arrows move through the grid, Enter picks, Esc closes. On mobile the
  search field is not focused automatically (the keyboard would cover the grid).
- Emoji up to Emoji 15.0, generated from emojibase.
  - _Rejected:_ skin tone selector, random button. (Emoji for new notes are a separate, opt-in
    feature the maintainer asked for; see "Automatic emoji for new notes".)
- **Performance:** a virtualized grid of pre-rendered emoji images, chosen after real lag on
  Windows, where drawing colour emoji is slow. Cached per style and device in the plugin folder
  (the maintainer's choice: removed on uninstall), 3–7 MB per style; at most 2× density, as 3×
  would triple the memory on phones.
- **No tooltips:** Obsidian shows every `aria-label` as a tooltip, which looked bad and caused
  lag on hover. The picker footer names the hovered emoji instead.

## Where emoji appear

- File explorer: always.
- Note title: _Inline_ (default, display-only) / _Large, above the title_ (clickable, opens the
  picker) / _Off_. Inline by default since 2.0.0: the title is where people look, and the emoji
  changes nothing in the note. Hidden when Obsidian's inline title is off.
  - _Rejected:_ hover previews and embeds; an "Add icon" button on notes without an emoji.
- Tab titles: on by default. View header title: off by default (changed after testing).
- Title decorations are display-only, never part of the editable title text, so renaming by
  editing the title keeps working. Clicking emoji keeps Obsidian's normal behaviour.
- Links in notes: _Emoji next to links_, off by default (some find emoji in running text noisy).

## Emoji next to links

- **The linked note's emoji right before the link** (wikilinks, and Markdown links to a path in the
  vault), in reading view (also hover previews, embedded notes, tables and callouts) and in Live
  Preview. Not in source mode, not for embeds, unresolved links, or links to a heading of the same
  note.
  - _Not now:_ Backlinks, search, link suggestions, Bases, Properties, Canvas (each needs its own
    undocumented DOM).
- **Resolved exactly as Obsidian opens the link:** the target, never the alias (an alias may be
  another note's name, which would show that note's icon), from the note the link is in.
- **Display-only:** never copied, searched or read out. In reading view, clicking it opens the
  link. A custom icon missing on this device shows nothing here (an empty space in running text
  would look like a typo).
- **Updates live** when the setting, an icon or a file changes, without re-rendering notes.
- **In the editor, links are found from Obsidian's syntax and checked against the text,** so a
  future Obsidian that parses differently shows no icon rather than a wrong one.

## Actions

- Right-click menu (_Set / Change / Remove … emoji_) and two commands.
  - _Rejected:_ multi-select actions, ribbon icon.

## Automatic emoji for new notes

- **Opt-in setting, off by default**, requested by the maintainer. Only notes, never folders,
  attachments, canvases or bases, and never existing notes.
- **Only notes made on this device:** a note counts when it is opened within 5 seconds of being
  created, once Obsidian has started (it reports every file as created while it starts). Notes that
  arrive by sync, imports and notes other plugins create in bulk are hardly ever opened that
  quickly, so two devices don't pick different emoji for the same note. Nothing is picked while
  `data.json` isn't read from disk or belongs to a newer version: a change nobody made must not be
  what writes the file then. Known limit: a note that arrives by sync and is opened within those
  seconds counts as new.
- **Your own emoji win:** choosing an emoji, even the same one, or removing it makes it the
  user's. A note made with a name that already has an icon (a restore, or sync) keeps it.
  Automatic picks are not added to the recently used emoji: nobody chose them.
- **Leftovers don't carry over:** every new note starts as _Untitled_, so an emoji stored for an
  untitled name, or for the name such a note then gets (Obsidian can't rename onto an existing
  note), belonged to a deleted note and is replaced.
- **Simple on purpose,** from the name only, in this order:
  1. a word with one obvious emoji (pizza → 🍕, dentist → 🦷), or the name of a listed emoji in
     the title (brain → 🧠): that emoji;
  2. a key word of a theme (trip, meeting, budget): one of the theme's few emoji, by chance;
  3. otherwise one of about 45 emoji that suit any note, by chance.

  An obvious emoji anywhere beats a theme word ("Pizza with the team" → 🍕); of two of a kind, the
  first wins. Whole words only, plurals listed, no stemming (loose matching gave "Bank balance" →
  ☯️-style mistakes). Left out on purpose: words that often mean something else (map, as in maps
  of content; chef; chicken), and emoji names that are common words ("Trip to Turkey" isn't 🦃).
  Groups hold only emoji that fit every note of the theme, and none some systems draw as
  something else (🏨 looks like a hospital on Windows).
  - _Rejected (too complex for what it adds):_ the folder's theme, seasons for daily notes,
    neighbours getting different emoji, official emoji keywords as an extra layer.

- **English, plus the language Obsidian runs in** (Obsidian 1.8.7 and later). Each other language
  is one file in `src/icons/auto-emoji-words/`; its words win where both languages have one, and
  it names English words that mean something else in it (German _Gift_ is poison), which then
  don't count. Compound words are listed as they are (_Einkaufsliste_).
  - _Rejected:_ every language at once (nearly every short word means something somewhere);
    splitting compounds (guesswork). Japanese, Chinese and Korean write without spaces, so whole
    words don't work there.
- **Every note is treated the same, also personal or serious ones.**
  - _Rejected:_ a list of sad words (funeral, cancer, depressed …) that get no emoji. It can't be
    complete (acronyms, other languages), a miss looks like a bug, and so does a research note
    about chemotherapy without an emoji; an emoji that suits any note doesn't hurt on any note.
- **"Untitled" notes wait for their name** (in every language Obsidian is translated into),
  which is what says what the note is about; one left untitled gets none.
  - _Rejected:_ a friendly emoji right away, replaced when the name fits (looked random).
- **Renamed soon after:** within 5 minutes, an emoji picked because nothing fit makes way for
  one that fits the new name. Picks that already fit stay.
- Every listed emoji is from Emoji 12.0 or older and in the picker's list, so Windows 10, older
  phones and every emoji style can draw it: nobody chose these emoji, so nobody would know why a
  box shows instead. Tests check both.

## Custom icons and emoji styles

- **Custom icons live in `data.json`** (by name), so they sync exactly when the emoji that use
  them sync. Uploaded in the picker; listed in the settings with size and uses. Deleting asks
  first.
  - _Rejected:_ the plugin folder (Obsidian Sync copies only `manifest.json`, `main.js`,
    `styles.css` and `data.json` of a plugin); a vault folder (visible, easy to delete by
    accident); dot folders and folders in `.obsidian/` (never synced); a setting to choose
    between storages (two code paths for little gain).
- **Limits:** 3 MB for all icons, 60 KB per icon, so at least 50 icons always fit. Obsidian Sync
  (Standard) skips files over 5 MB, which would stop every emoji from syncing.
- **Sharp:** images are scaled down to 512 px (several times the largest display size on the
  densest screens), never upscaled; SVG stays a vector, and an image that already fits is stored
  unchanged (animations keep playing).
- **Refused, with the reason:** HEIC, files over 20 MB, SVG over 45 KB, animated images over
  512 px or 45 KB (not frozen silently), images still too large at the lowest quality.
- Custom icons are never inserted as markup (SVG scripts never run). A missing icon keeps its
  space empty; the settings list such icons and can remove them.
- Emoji styles change only Notemoji's emoji, not emoji in notes: system (default), Twemoji,
  OpenMoji, Noto Color Emoji, Noto Emoji Mono or an own font file.
- **Downloads only on the user's click**, pinned and checked by SHA-256; nothing is downloaded
  automatically. A style missing or not drawable on a device shows system emoji, with the
  reason.
  - _Rejected:_ Apple, Samsung or Microsoft emoji as downloads (not redistributable).
- Own font file: no size limit, a confirmation above 50 MB.
- Settings tab icon: a colourful 😀.

## Obsidian icons

- **Obsidian's own icons (Lucide) are a third icon source.** The picker lists the icons of the
  running Obsidian, so Notemoji stays small and always offers what Obsidian has.
- **A copy of each icon in use lives in `data.json`,** and every device draws that copy:
  different Obsidian versions name or draw icons differently, or lack them.
  - _Rejected:_ the name alone (icons would differ or vanish between devices); bundling Lucide
    (size, and a second copy of what Obsidian already has).
- **Copies follow the icons in use** and are never replaced or dropped when files from devices
  are combined (a device may not be able to draw an icon again). Starting up or syncing never
  writes `data.json` just for copies.
- **Drawn in the text colour,** so they follow light and dark themes like Obsidian's own icons;
  never inserted as markup.
- **They share the 3 MB of custom icons;** a copy takes about 1 KB.
- **In the picker after all emoji,** so people who use emoji only never scroll past them.
  - _Not offered:_ a colour of their own, a context menu.
- **No downloadable icon packs for now:** most look like Obsidian's icons, and custom icons
  cover the rest. If ever, one pack at a time (brand logos first, which Obsidian's icons no
  longer have), downloaded on a click and drawn from copies in `data.json`, so sync never depends
  on thousands of icon files.

## Compatibility and tooling

- Version 2.0.0 for the rework (new data format; update every device).
- `minAppVersion` 1.7.2: newer APIs only when guarded (`requireApiVersion`).
- Undocumented Obsidian internals only through `src/internals.ts`, always defensive.
- `npm run check` (Prettier, ESLint, TypeScript, Vitest, build) must pass; `src/` passes
  Obsidian's recommended lint rules with no exceptions, as the community directory's scorecard
  runs them.
- **Settings appear in Obsidian's settings search** (setting definitions, Obsidian 1.13); older
  versions get the same rows. Settings are always saved through the plugin, never by Obsidian
  saving the settings alone over `data.json`.
- **Releases are built by a workflow** that checks, builds, signs the release files (which the
  scorecard checks) and creates a draft to publish; the built `main.js` is reproducible. For now
  it is only started by hand, to test the process first; a trigger on pushed version tags can be
  added later. Steps in CONTRIBUTING.md.
- **Node 24** (`.nvmrc`) for the tooling only; the plugin runs in Obsidian. CodeMirror packages
  are development dependencies only: Obsidian provides them at runtime.
- README media is recorded from the real plugin (`npm run demo`), so it stays truthful.

## Open

- Possible later: icons in bookmarks, search results, backlinks and the quick switcher; search in
  more languages; a command to move emoji out of file names.
