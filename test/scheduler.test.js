import test from 'node:test';
import assert from 'node:assert/strict';

import { RequestScheduler, sleep } from '../src/airzone/scheduler.js';

test('RequestScheduler', async (t) => {
  await t.test('never runs more tasks than the configured limit', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 2 });
    let inFlight = 0;
    let maxInFlight = 0;
    const order = [];

    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        scheduler.run(async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await sleep(10);
          order.push(index);
          inFlight -= 1;
        }),
      ),
    );

    assert.equal(maxInFlight, 2);
    assert.equal(inFlight, 0);
    // Tasks are started in submission order.
    assert.deepEqual(order.slice(0, 2), [0, 1]);
  });

  await t.test('a failing task frees its slot', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 1 });
    await assert.rejects(
      () =>
        scheduler.run(() => {
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.equal(await scheduler.run(async () => 'ok'), 'ok');
  });

  await t.test('pauseFor holds the tasks that have not started yet', async () => {
    const scheduler = new RequestScheduler({ maxConcurrent: 4 });
    scheduler.pauseFor(60);
    const start = Date.now();
    await scheduler.run(async () => {});
    assert.ok(Date.now() - start >= 50, 'the task waited for the pause to expire');
  });
});
