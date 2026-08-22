# Lock In — Site Blocker 👹

A Chrome extension (Manifest V3) for **tiny mammal containment**: block distracting
sites on a schedule or after a daily allowance runs out, organize them into
groups, and lock the settings behind a typing challenge so impulsive
future-you cannot casually negotiate the distractions back in.

The serious bit underneath the propaganda is simple: make the useful decision
once, then add enough friction that you do not have to remake it every seven
minutes.

## Install (unpacked, developer mode)

1. Unzip this folder somewhere permanent (don't delete it after installing —
   Chrome loads the extension directly from these files).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `lockin-extension` folder.
5. Pin the extension (puzzle-piece icon → pin) for quick access to containment HQ.

## How it works

- **Containment zones (groups)**: bundle related sites (e.g. "Scroll pit" →
  x.com, instagram.com, reddit.com) and arm/disarm them as a unit.
- **Containment rules**: each zone carries two rules, both optional and
  independent of each other:
  - *Scheduled hours* picks specific days of the week plus a "gates close /
    gates reopen" window (e.g. weekdays, 9:00–17:00). The zone only blocks its
    sites during that window and automatically opens back up outside it. Windows
    that cross midnight (e.g. 22:00 → 06:00) work too.
  - *Daily allowance* caps how long the sites may be used while the gates are
    open (e.g. 30 minutes). Time is counted only while one of the zone's sites is
    the active tab of the focused window; when the allowance runs out the zone
    shuts until midnight — the open tab included, not just the next visit.
  - At least one rule is required to create a zone. A zone can use either rule
    on its own or both together; an empty rule set is rejected and never saved.
  - Any zone can also be disarmed entirely. Editing rules is lock-gated because
    later gate hours, a bigger allowance, or a rule switched off can all weaken
    an existing block.
  - Each card shows what its rules are doing right now: a status line, and for
    zones with an allowance a meter counting down the time left today.
- **Edit lock**: when it is **on**, anything that opens an escape route requires
  typing a randomly picked propaganda paragraph by hand first. No copy, no
  paste. The protected actions are:
  - Disarming an active block
  - Deleting a containment zone
  - Releasing a single site from a zone
  - Changing a zone's rules — gate hours or daily allowance
  - Turning edit lock back **off**

  Adding new sites or zones is always free. Tiny mammal bureaucracy only appears
  when the requested action can make distractions easier to reach.
- **Blocked page**: visiting a blocked site redirects to a local containment page
  that shows which zone caught the domain and why: the active window for a
  scheduled block, or a spent allowance waiting on midnight. It also serves a random short piece of tiny-mammal propaganda. There is
  intentionally no quick-unblock button there; appeals go through the dashboard.
- **Popup**: shows how many zones and domains are currently active, whether edit
  lock is sealed, and a shortcut to containment HQ.

## Voice / tiny mammal doctrine

The UI deliberately speaks like an overfunded containment agency responsible for
one distractible tiny mammal. The recurring vocabulary is consistent across the
extension:

- sites are **forbidden tunnels**
- groups are **containment zones**
- blocking is **containment**
- disabling a block is **disarming** it
- scheduled start/end times are when the **gates close/reopen**
- a daily usage cap is an **allowance**, and running out of it is **spending** it
- the dashboard is **containment HQ**
- locked changes are **appeals / paperwork**
- productive work remains, regrettably, **the mines** 👹⛏️

No personal names or user-specific references are baked into the copy. The joke
works for any tiny mammal reckless enough to install it.

## Layout

```
manifest.json          entry points only; everything it names lives under src/
env.example.js         template for the local dev flag (see below)
env.js                 local dev flag, git-ignored and optional (see below)
icons/                 extension + page icons
fonts/                 self-hosted webfonts
src/
  background.js        service worker: owns the declarativeNetRequest rules
  tracker.js           service worker: times allowances against the active tab
  shared/              used by more than one page
    storage.js         the only place chrome.storage keys are named
    domains.js         hostname parsing and matching
    schedule.js        containment rules, day list, time formatting
    usage.js           daily allowance bookkeeping and duration formatting
    challenge.js       unlock paragraphs, blocked slogans and fuzzy matching
    dev-mode.js        reads the env.js flag
  styles/
    fonts.css          @font-face for the bundled fonts
    tokens.css         palette + the light/dark theme mappings
    base.css           reset, page ground, button system
  pages/
    popup/ options/ blocked/     one folder per page: html + js + css
```

Pages are ES modules (`<script type="module">`), and so is the service worker,
so every dependency is an explicit `import` rather than an implicit script-tag
ordering. Each page picks its palette with `class="theme-light"` or
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

While working on the extension, typing an entire propaganda paragraph every time
you touch a locked action gets old. Dev mode gives the developer tiny mammal a
forbidden administrative override: the challenge modal still appears exactly as
usual, but **Ctrl+Shift+Enter** runs the pending action without typing anything.
Blocking itself is untouched; sites still get contained normally.

It is a single hand-edited flag in `env.js` at the repo root (it stays at the
root, outside `src/`, and is loaded as a plain script rather than a module so
that a missing file is simply "dev mode off" instead of a broken page). On a
fresh clone, copy the template that ships with the repo:

```bash
cp env.example.js env.js
```

The whole file is one line:

```js
globalThis.LOCKIN_DEV = true;
```

Write `true` or `false`, save, and refresh the dashboard (F5) — no rebuild step
and no extension reload. `env.js` is git-ignored, so the flag never ships and
never shows up in a diff, while `env.example.js` stays committed at `false`. If
`env.js` is missing entirely, dev mode is simply off.

While it is on, a banner shows in the dashboard and popup, and the modal itself
spells out the shortcut, so the elevated mammal privileges are never silent.

## Notes

- All data stays local in `chrome.storage.local` — nothing leaves your machine.
- The extension requests access to all sites because it needs to be able to
  redirect *any* domain you choose to block; it does not read page content. The
  `tabs` permission is what lets daily allowances see which site is in the
  active tab — the hostname is all that is used, and it never leaves the device.
- The propaganda is presentation only. Blocking, schedules, storage and domain
  matching remain ordinary deterministic extension logic.
- To change the icon, swap the PNGs in `icons/` — the three sizes the manifest
  references are `icon16.png`, `icon48.png` and `icon128.png`.
