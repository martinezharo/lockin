import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSiteInput, parseSiteList, siteMatches, isPathException, exceptionFitsDomains } from '../src/shared/domains.js';

test('site inputs preserve path, identifiers and fragments while removing tracking', () => {
  assert.equal(normalizeSiteInput('https://WWW.YouTube.com/watch?v=AbC&utm_source=test#details'), 'youtube.com/watch?v=AbC#details');
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

test('exceptions must be specific pages inside a contained rule', () => {
  assert.equal(isPathException('chatgpt.com/codex/cloud/settings/analytics'), true);
  assert.equal(isPathException('chatgpt.com'), false);
  assert.equal(isPathException('chatgpt.com/#settings'), false);
  assert.equal(exceptionFitsDomains('chatgpt.com/codex/cloud/settings/analytics', ['chatgpt.com']), true);
  assert.equal(exceptionFitsDomains('other.example/path', ['chatgpt.com']), false);
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
    ['https://chatgpt.com/#settings/Personalization', 'chatgpt.com/#settings/Personalization', true],
    ['https://chatgpt.com/#settings/Personalization/memory', 'chatgpt.com/#settings/Personalization', true],
    ['https://chatgpt.com/#settings/General', 'chatgpt.com/#settings/Personalization', false],
    ['chrome://settings/', 'example.com', false]
  ]) assert.equal(siteMatches(url, rule), expected, url + ' vs ' + rule);
});
