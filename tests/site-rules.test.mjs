import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSiteInput, parseSiteList, siteMatches } from '../src/shared/domains.js';

test('site inputs preserve path and identifiers while removing tracking and fragments', () => {
  assert.equal(normalizeSiteInput('https://WWW.YouTube.com/watch?v=AbC&utm_source=test#details'), 'youtube.com/watch?v=AbC');
  assert.equal(normalizeSiteInput('EXAMPLE.com/Section/'), 'example.com/Section/');
  assert.equal(normalizeSiteInput('https://www.example.com/'), 'example.com');
  assert.deepEqual(parseSiteList('example.com, youtube.com/shorts/\nexample.com'), ['example.com', 'youtube.com/shorts/']);
});

test('invalid rules cannot silently turn into broader domain blocks', () => {
  for (const input of ['javascript:alert(1)', 'file:///tmp/a', 'https://user:secret@example.com/a', '*.com', 'hello world', 'https://example.com/a*']) {
    assert.equal(normalizeSiteInput(input), '', input);
    assert.throws(() => parseSiteList('example.com\n' + input));
  }
});

test('URL matching follows path prefixes, case, subdomains and query token subsets', () => {
  for (const [url, rule, expected] of [
    ['https://www.youtube.com/shorts/ABC', 'youtube.com/shorts/', true],
    ['https://youtube.com/watch?v=ABC', 'youtube.com/shorts/', false],
    ['https://youtube.com/Shorts/ABC', 'youtube.com/shorts/', false],
    ['http://youtube.com/watch?utm_source=x&v=ABC', 'youtube.com/watch?v=ABC', true],
    ['https://youtube.com/watch?v=abc', 'youtube.com/watch?v=ABC', false],
    ['https://youtube.com/watch?v=OTHER&v=ABC', 'youtube.com/watch?v=ABC', true],
    ['https://youtube.com.evil.test/watch?v=ABC', 'youtube.com/watch?v=ABC', false],
    ['https://example.com:8443/a', 'example.com:8443/a', true],
    ['https://example.com/a', 'example.com:8443/a', false],
    ['https://example.com/abc', 'example.com/a', true],
    ['chrome://settings/', 'example.com', false]
  ]) assert.equal(siteMatches(url, rule), expected, url + ' vs ' + rule);
});
