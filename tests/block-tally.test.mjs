import test from 'node:test';
import assert from 'node:assert/strict';

import { addBlock, tallyFor, blockTallyLine, repeatOffenderLine, EMPTY_TALLY } from '../src/shared/tally.js';
import { todayKey } from '../src/shared/usage.js';

const NOW = new Date(2026, 7, 25, 16, 20).getTime();
const TOMORROW = new Date(2026, 7, 26, 9, 0).getTime();

// Deterministic "random": always the first line of the tier.
const first = () => 0;

test('the first block of the day starts the count', () => {
  const tally = addBlock(null, 'x.com', NOW);
  assert.deepEqual(tally, { date: todayKey(NOW), total: 1, domains: { 'x.com': 1 } });
});

test('further blocks add to the total and to their own tunnel', () => {
  let tally = addBlock(null, 'x.com', NOW);
  tally = addBlock(tally, 'x.com', NOW);
  tally = addBlock(tally, 'reddit.com', NOW);

  assert.equal(tally.total, 3);
  assert.deepEqual(tally.domains, { 'x.com': 2, 'reddit.com': 1 });
});

test('yesterday is not carried into today', () => {
  const yesterday = addBlock(null, 'x.com', NOW);
  const today = addBlock(yesterday, 'x.com', TOMORROW);

  assert.equal(today.date, todayKey(TOMORROW));
  assert.equal(today.total, 1);
  assert.deepEqual(today.domains, { 'x.com': 1 });
});

test('a stale tally reads as an empty one', () => {
  const yesterday = addBlock(null, 'x.com', NOW);
  assert.deepEqual(tallyFor(yesterday, TOMORROW), EMPTY_TALLY);
  assert.deepEqual(tallyFor(null, NOW), EMPTY_TALLY);
});

test('a redirect with no domain still counts', () => {
  const tally = addBlock(null, '', NOW);
  assert.equal(tally.total, 1);
  assert.deepEqual(tally.domains, {});
});

/* ---------- the copy ---------- */

test('the tally line escalates with the count', () => {
  assert.match(blockTallyLine(1, first), /first one today/);
  assert.match(blockTallyLine(2, first), /twice today/);
  assert.match(blockTallyLine(14, first), /hobby, not an accident/);
  assert.match(blockTallyLine(200, first), /villain era/);
});

test('the tally line fills the count in', () => {
  assert.match(blockTallyLine(9, first), /^9 today/);
  assert.doesNotMatch(blockTallyLine(9, first), /\{n\}/);
});

test('there is nothing to say about zero blocks', () => {
  assert.equal(blockTallyLine(0, first), '');
});

test('every tier has a line for every count it covers', () => {
  for (let n = 1; n <= 60; n++) {
    assert.notEqual(blockTallyLine(n, first), '', `no line for ${n}`);
  }
});

/* ---------- the repeat-offender sub-line ---------- */

test('one tunnel doing most of the damage gets named', () => {
  const tally = { date: todayKey(NOW), total: 6, domains: { 'x.com': 5, 'reddit.com': 1 } };
  assert.equal(repeatOffenderLine(tally, 'x.com', NOW), '5 of those 6 were this exact tunnel 🎯');
});

test('a single-tunnel day says so', () => {
  const tally = { date: todayKey(NOW), total: 4, domains: { 'x.com': 4 } };
  assert.equal(repeatOffenderLine(tally, 'x.com', NOW), 'all 4 of them right here 🎯');
});

test('a handful of scattered blocks is not worth a sub-line', () => {
  const tally = { date: todayKey(NOW), total: 3, domains: { 'x.com': 1, 'reddit.com': 1, 'twitch.tv': 1 } };
  assert.equal(repeatOffenderLine(tally, 'x.com', NOW), '');
});
