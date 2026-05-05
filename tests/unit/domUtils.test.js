import { test } from 'node:test';
import assert from 'node:assert/strict';

import { jsx, listify, pluralize, queryParams } from '../../src/domUtils.js';

test('queryParams encodes a single key/value', () => {
  assert.equal(queryParams({ a: 'b' }), '?a=b');
});

test('queryParams joins multiple keys with &', () => {
  assert.equal(queryParams({ a: '1', b: '2' }), '?a=1&b=2');
});

test('queryParams URL-encodes special characters in keys and values', () => {
  assert.equal(queryParams({ 'a&b': 'c=d' }), '?a%26b=c%3Dd');
  assert.equal(queryParams({ q: 'hello world' }), '?q=hello%20world');
});

test('queryParams handles an empty object', () => {
  assert.equal(queryParams({}), '?');
});

test('listify wraps items in an unordered list by default', () => {
  const out = listify(['a', 'b'], false);
  assert.equal(out, '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
});

test('listify uses <ol> when isOrdered is true', () => {
  const out = listify(['x'], true);
  assert.equal(out, '<ol>\n<li>x</li>\n</ol>');
});

test('listify produces valid HTML for an empty array', () => {
  assert.equal(listify([], false), '<ul>\n</ul>');
  assert.equal(listify([], true), '<ol>\n</ol>');
});

test('pluralize: singular has no plural suffix', () => {
  assert.equal(pluralize(1, 'cat').trim(), '1 cat');
});

test('pluralize: plural appends s', () => {
  assert.equal(pluralize(2, 'cat').trim(), '2 cats');
});

test('pluralize: zero is treated as plural', () => {
  // 0 !== 1, so the plural branch fires.
  assert.equal(pluralize(0, 'cat').trim(), '0 cats');
});

test('jsx interpolates numbers and strings', () => {
  const a = 5;
  const b = 'cat';
  assert.equal(jsx`x=${a}, y=${b}`, 'x=5, y=cat');
});

test('jsx joins arrays with no separator', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(jsx`${items}`, 'abc');
});

test('jsx skips values that are not string/number/array', () => {
  assert.equal(jsx`a=${true}b`, 'a=b');
  assert.equal(jsx`a=${null}b`, 'a=b');
  assert.equal(jsx`a=${undefined}b`, 'a=b');
  assert.equal(jsx`a=${{ k: 'v' }}b`, 'a=b');
});

test('jsx returns empty string for an empty template', () => {
  assert.equal(jsx``, '');
});
