const test = require('node:test')
const assert = require('node:assert/strict')
const { createSerialOperationQueue } = require('./operation-queue.cjs')

test('serializes operations and continues after a rejected task', async () => {
  const queue = createSerialOperationQueue()
  const events = []
  let releaseFirst
  const first = queue.run(
    () =>
      new Promise((resolve) => {
        events.push('first:start')
        releaseFirst = () => {
          events.push('first:end')
          resolve('first')
        }
      }),
  )
  const second = queue.run(async () => {
    events.push('second:start')
    throw new Error('second failure')
  })
  const third = queue.run(() => {
    events.push('third:start')
    return 'third'
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['first:start'])
  releaseFirst()

  assert.equal(await first, 'first')
  await assert.rejects(second, /second failure/)
  assert.equal(await third, 'third')
  assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'third:start'])
})
