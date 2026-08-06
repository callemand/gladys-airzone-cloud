import test from 'node:test';
import assert from 'node:assert/strict';

import { describeError } from '../src/errors.js';

test('describeError unwraps what the Node fetch hides', () => {
  // What a refused local API request really looks like: the useful part is the
  // cause, not the message.
  const cause = Object.assign(new Error('connect ECONNREFUSED 192.168.1.196:3000'), {
    code: 'ECONNREFUSED',
  });
  const error = Object.assign(new TypeError('fetch failed'), { cause });

  assert.equal(
    describeError(error),
    'fetch failed: connect ECONNREFUSED 192.168.1.196:3000 (ECONNREFUSED)',
  );
});

test('describeError handles a plain error, a code and a cause chain', () => {
  assert.equal(describeError(new Error('boom')), 'boom');
  assert.equal(
    describeError(Object.assign(new Error('nope'), { code: 'EHOSTUNREACH' })),
    'nope (EHOSTUNREACH)',
  );
  const deep = new Error('a', { cause: new Error('b', { cause: new Error('c') }) });
  assert.equal(describeError(deep), 'a: b: c');
});

test('describeError does not repeat an identical cause nor loop forever', () => {
  const repeated = new Error('same', { cause: new Error('same') });
  assert.equal(describeError(repeated), 'same');

  const cyclic = new Error('loop');
  cyclic.cause = cyclic;
  assert.equal(describeError(cyclic), 'loop');
});

test('describeError survives a missing error', () => {
  assert.equal(describeError(null), 'unknown error');
  assert.equal(describeError(undefined), 'unknown error');
  assert.equal(describeError('a string'), 'a string');
});
