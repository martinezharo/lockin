# Lock In — Site Blocker

A Chrome extension (Manifest V3) that blocks distracting sites permanently or
on a timer, organizes them into groups, and can lock its own settings behind
a typing challenge so you can't casually undo a block mid-scroll.

## Install (unpacked, developer mode)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `lockin-extension` folder.
5. Pin the extension (puzzle-piece icon → pin) for quick access.

## How it works

- **Groups**: bundle related sites (e.g. "Social media" → x.com,
  instagram.com, reddit.com) and block/unblock them as a unit.
- **Permanent vs. scheduled**:
  - *Permanent* blocks stay on until you disable them.
  - *Scheduled* blocks pick specific days of the week plus a "from / until"
    time window (e.g. weekdays, 9:00–17:00). The group only blocks its sites
    during that window and automatically opens back up outside it — no need
    to remember to turn it off. Windows that cross midnight (e.g. 22:00 →
    06:00) work too. You can still turn a scheduled group off entirely
    ("Disable") if you don't want it to block at all, even during its
    window, and "Edit hours" lets you change the days/times later (typing
    challenge required if edit lock is on, since it can be used to loosen
    an existing block).
- **Edit lock**: the toggle at the top of the dashboard. When it's **on**,
  these actions require typing out a randomly-picked paragraph first (no
  copy, no paste — you have to actually type it):
  - Disabling an active block
  - Deleting a group
  - Removing a single site from a group
  - Turning edit lock back **off**

  Adding new sites or groups is always free — the friction only applies to
  actions that would let a distraction back in.
- **Blocked page**: visiting a blocked site redirects to a local page showing
  which group blocked it and, for scheduled blocks, its window. There's
  no quick-unblock button there on purpose — go to the dashboard for that.

## Layout

```
manifest.json          entry points only; everything it names lives under src/
env.js                 local dev flag, git-ignored and optional (see below)
icons/                 extension + page icons
fonts/                 self-hosted webfonts
src/
  background.js        service worker: owns the declarativeNetRequest rules
  shared/              used by more than one page
    storage.js         the only place chrome.storage keys are named
    domains.js         hostname parsing and matching
    schedule.js        block-by-hours logic, day list, time formatting
    challenge.js       the paragraphs and the fuzzy match
    dev-mode.js        reads the env.js flag
  styles/
    fonts.css          @font-face for the bundled fonts
    tokens.css         palette + the light/dark theme mappings
    base.css           reset, page ground, button system
  pages/
    popup/ options/ blocked/     one folder per page: html + js + css
```

Pages are ES modules (`<script type="module">`), and so is the service worker,
so every dependency is an explicit `import` rather than an implicit
script-tag ordering. Each page picks its palette with `class="theme-light"` or
`class="theme-dark"` on `<html>`; nothing outside `styles/` defines a color
variable.

Fonts are bundled rather than linked from `fonts.googleapis.com`, so the pages
render offline, no third-party request fires every time a blocked page loads,
and nothing leaks about when the extension is used. Only the `latin` and
`latin-ext` subsets are shipped, and `unicode-range` means the browser loads
only the faces a page actually needs. To refresh them, download the `woff2`
files that Google's `css2` endpoint points at and regenerate
`src/styles/fonts.css` to match.

## Dev mode

While working on the extension, typing a whole paragraph every time you touch a
locked action gets old. Dev mode adds a keyboard escape hatch: the challenge
modal still appears exactly as usual, but **Ctrl+Shift+Enter** runs the pending
action without typing anything. Blocking itself is untouched — sites still get
blocked normally.

It is a single hand-edited flag in `env.js` at the repo root (it stays at the
root, outside `src/`, and is loaded as a plain script rather than a module so
that a missing file is simply "dev mode off" instead of a broken page):

```js
globalThis.LOCKIN_ENV = {
  DEV_MODE: true
};
```

Write `true` or `false`, save, and refresh the dashboard (F5) — no rebuild
step and no extension reload. The file is git-ignored, so the flag never ships
and never shows up in a diff; on a fresh clone just create it with the snippet
above. If `env.js` is missing entirely, dev mode is simply off.

While it is on, a banner shows in the dashboard and the popup, and the modal
itself spells out the shortcut, so it is never a silent state.

## Notes

- All data stays local in `chrome.storage.local` — nothing leaves your
  machine.
- The extension requests access to all sites because it needs to be able to
  redirect *any* domain you choose to block; it doesn't read page content.
- To change the icon, swap the PNGs in `icons/` — the three sizes the manifest
  references are `icon16.png`, `icon48.png` and `icon128.png`.
