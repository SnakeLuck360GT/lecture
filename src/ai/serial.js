// One-at-a-time queues per model (owner: aryan).
// B-007: a whisper call aborted by a model reload. B-016: "Cannot set new job" when the tracker and the
// library embedded at the same time. A QVAC model runs one job at a time, so every call to a given model
// goes through its own queue. Different models still run in parallel.
const queues = new Map() // key -> { tail, pending }
const queue = (key) => {
  if (!queues.has(key)) queues.set(key, { tail: Promise.resolve(), pending: 0 })
  return queues.get(key)
}

/** Is anything queued or running on this model? */
export const busy = (key) => queue(key).pending > 0

/** Run fn() after every earlier call on the same key has settled. Errors never block the queue. */
export function serial (key, fn) {
  const qq = queue(key)
  qq.pending++
  const run = qq.tail.then(fn, fn)
  qq.tail = run.catch(() => {}).finally(() => { qq.pending-- })
  return run
}
