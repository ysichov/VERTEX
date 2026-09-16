"use strict";

/** Run independent read-only jobs with bounded concurrency and per-job events. */
async function runParallel(jobs, worker, options) {
  const list = Array.from(jobs || []);
  const limit = Math.max(1, Number((options || {}).maxParallel) || 4);
  const emit = (options || {}).emit || function () {};
  const results = new Array(list.length);
  let next = 0;
  async function lane() {
    while (true) {
      const index = next++;
      if (index >= list.length) { return; }
      const job = list[index];
      emit({ type: "task.start", taskId: job.taskId, index, total: list.length });
      try {
        results[index] = await worker(job, { index, total: list.length });
        emit({ type: "task.finish", taskId: job.taskId, index, result: results[index] });
      } catch (error) {
        results[index] = { error: error.message || String(error) };
        emit({ type: "task.error", taskId: job.taskId, index, error: results[index].error });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, lane));
  return results;
}

module.exports = { runParallel };
