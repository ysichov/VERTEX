"use strict";

/* One session of SAP takes one request at a time, and a second is refused as busy. What reads SAP for the reader's sake - the
   analysis's points, the variables of the place the cursor is in, the source a link opens - goes through a gate: one request
   after another; a session that is busy with something else is waited for, a few times, and only then reported; and a request
   that is made again and again (the variables, as the cursor moves) keeps only its newest while an older one is still waiting. */
function createGate({ retries = 12, delay = 250 } = {}) {
  let chain = Promise.resolve();
  const busy = error => /session is busy/i.test(String(error && error.message));
  async function whenFree(run) {
    for (let attempt = 0; ; attempt++) {
      try { return await run(); }
      catch (error) {
        if (!busy(error) || attempt >= retries) { throw error; }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  function gated(run) {
    const result = chain.then(() => whenFree(run));
    chain = result.catch(() => {});
    return result;
  }
  /* A kind of request of which only the newest matters: an older one that has not started is answered { superseded: true }. */
  function newest(run) {
    let waiting = null;
    return request => new Promise((resolve, reject) => {
      if (waiting) { waiting.resolve({ superseded: true }); }
      const job = waiting = { resolve };
      gated(async () => {
        if (waiting !== job) { return { superseded: true }; }
        waiting = null;
        return run(request);
      }).then(resolve, reject);
    });
  }
  return { gated, newest, whenFree };
}

module.exports = { createGate };
