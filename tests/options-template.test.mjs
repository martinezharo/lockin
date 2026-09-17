import test from 'node:test';
import assert from 'node:assert/strict';

import { zoneRowHtml } from '../src/pages/options/templates.js';

const group = {
  id: 'social',
  name: 'Scroll & share',
  domains: ['example.com'],
  exceptions: ['example.com/always-open'],
  enabled: true,
  schedule: null,
  limit: { minutes: 30 },
  createdAt: 1
};

test('an open zone renders an editable, escaped name', () => {
  const html = zoneRowHtml(group, Date.now(), new Set([group.id]), {}, null);

  assert.match(html, /data-zone-name-input="social"/);
  assert.match(html, /value="Scroll &amp; share"/);
  assert.match(html, /data-action="save-name"/);
  assert.match(html, /Always allowed/);
  assert.match(html, /example\.com\/always-open/);
  assert.match(html, /1 free pass/);
});

test('a collapsed zone does not render its name editor', () => {
  const html = zoneRowHtml(group, Date.now(), new Set(), {}, null);

  assert.doesNotMatch(html, /data-zone-name-input/);
});
