function createSerialOperationQueue() {
  let pending = Promise.resolve()

  function run(task) {
    if (typeof task !== 'function') throw new Error('操作任务必须是函数')
    const current = pending.then(task, task)
    pending = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  return { run }
}

module.exports = { createSerialOperationQueue }
