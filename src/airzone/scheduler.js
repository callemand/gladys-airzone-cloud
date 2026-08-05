// -----------------------------------------------------------------------------
// Request scheduler for the Airzone Cloud API.
//
// The Airzone Cloud API rate-limits an account globally (HTTP 429): it answers
// at most a few requests in parallel, and a burst (one status request per zone,
// on every poll cycle) is enough to get part of the burst rejected — silently,
// because a rejected poll only means "this zone has no fresh state" on the
// Gladys side.
//
// Every Airzone request therefore goes through this scheduler, which:
//   - caps the number of in-flight requests;
//   - can pause every pending request for a while (used on a 429, so the whole
//     account backs off and not only the request that was rejected).
// -----------------------------------------------------------------------------

/**
 * Sleep for the given duration.
 * @param {number} ms duration in milliseconds
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class RequestScheduler {
  /**
   * @param {object} options options
   * @param {number} [options.maxConcurrent] maximum number of in-flight requests
   */
  constructor({ maxConcurrent = 4 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.pausedUntil = 0;
    // Tasks waiting for a free slot, in submission order.
    this.waiting = [];
  }

  /**
   * Hold every request (pending and future) for the given duration.
   * @param {number} ms duration in milliseconds
   */
  pauseFor(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }

  /**
   * Run a task as soon as a slot is free and the scheduler is not paused.
   * @param {Function} task the task to run
   * @returns {Promise<*>} whatever the task resolves with
   */
  async run(task) {
    await this.#acquire();
    try {
      const pause = this.pausedUntil - Date.now();
      if (pause > 0) {
        await sleep(pause);
      }
      return await task();
    } finally {
      this.#release();
    }
  }

  async #acquire() {
    if (this.running < this.maxConcurrent) {
      this.running += 1;
      return;
    }
    await new Promise((resolve) => {
      this.waiting.push(resolve);
    });
    this.running += 1;
  }

  #release() {
    this.running -= 1;
    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }
}
