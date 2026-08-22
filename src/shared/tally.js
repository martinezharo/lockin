// Lock In — the blocked-page counter: how many times the tiny mammal has been
// turned away today, and how to say so.
//
// This is the one number the extension records that is not needed for
// blocking. It exists purely so the blocked page can be a scoreboard instead
// of a wall, so it is deliberately cheap: one key, one day, reset by simply
// noticing the date has changed.
//
//   tally  { date: 'YYYY-MM-DD', total: 12, domains: { 'x.com': 7 } }
//
// The shaping is pure; storage.js owns reading and writing it.

import { todayKey } from './usage.js';

export const EMPTY_TALLY = { total: 0, domains: {} };

// Yesterday's count is not carried over and not deducted — a stale entry
// simply reads as today's zero, exactly like usage.js treats banked time.
export function tallyFor(tally, now = Date.now()) {
  if (!tally || tally.date !== todayKey(now)) return EMPTY_TALLY;
  return { total: tally.total || 0, domains: tally.domains || {} };
}

export function addBlock(tally, domain, now = Date.now()) {
  const today = tallyFor(tally, now);
  const next = {
    date: todayKey(now),
    total: today.total + 1,
    domains: { ...today.domains }
  };
  if (domain) next.domains[domain] = (next.domains[domain] || 0) + 1;
  return next;
}

/* ---------- Saying the number out loud ----------
   A bare "12 today" is a fact; the point of counting is that it should feel
   like being gently perceived. Tiers escalate from mild interest to open
   documentation, and `{n}` is filled in with the count. */

const TALLY_TIERS = [
  {
    upTo: 1,
    lines: [
      'first one today 🐭 we all start somewhere',
      'block no. 1 today. simply gathering data 📋',
      'one (1) attempt logged. rookie numbers, honestly'
    ]
  },
  {
    upTo: 2,
    lines: [
      'twice today. a pattern is forming 👀',
      "that's two. not a crisis. yet.",
      'attempt {n} of the day. the goblin looks up 👹'
    ]
  },
  {
    upTo: 4,
    lines: [
      '{n} times today and it is not even personal, it is muscle memory 🫠',
      '{n} today. tiny mammal is being SO normal about this',
      '{n} today. the hand moved on its own again, apparently'
    ]
  },
  {
    upTo: 7,
    lines: [
      '{n} today. bestie. the feed is not going to change 💀',
      '{n} today and the day is not over. bold.',
      '{n} times. at what point is this a personality 🫠'
    ]
  },
  {
    upTo: 11,
    lines: [
      '{n} today. this is your roman empire, apparently 👹',
      '{n} attempts. genuinely impressive stamina for such a small creature',
      '{n} today. the perimeter is holding but it is tired 🚧'
    ]
  },
  {
    upTo: 19,
    lines: [
      '{n} today. at this point it is a hobby, not an accident 🎯',
      '{n} today. the goblin has started a spreadsheet 📊👹',
      '{n} attempts logged. tiny mammal is speedrunning something'
    ]
  },
  {
    upTo: Infinity,
    lines: [
      '{n} today. villain era unlocked 👹 the goblin is taking notes',
      '{n} today. we have stopped counting and started documenting 🗂️',
      '{n} attempts. this is no longer a blocker, it is a biographer 📖👹'
    ]
  }
];

export function blockTallyLine(count, pick = Math.random) {
  if (count <= 0) return '';
  const tier = TALLY_TIERS.find((t) => count <= t.upTo) || TALLY_TIERS[TALLY_TIERS.length - 1];
  const line = tier.lines[Math.floor(pick() * tier.lines.length)] || tier.lines[0];
  return line.replace(/\{n\}/g, String(count));
}

// Only worth saying when one tunnel is doing most of the work and there is
// more than one attempt to compare it against.
export function repeatOffenderLine(tally, domain, now = Date.now()) {
  const { total, domains } = tallyFor(tally, now);
  const count = domains[domain] || 0;
  if (!domain || count < 3 || total < 4) return '';
  if (count === total) return `all ${total} of them right here 🎯`;
  return `${count} of those ${total} were this exact tunnel 🎯`;
}
