import { describe, it, expect } from 'vitest'
import cron from 'node-cron'

describe('actual supported runtime dependencies', () => {
  it('fires a real synthetic cron callback and stops it without external work', async () => {
    let count = 0
    const task = cron.schedule('* * * * * *', () => { count++ })
    try {
      const deadline = Date.now() + 4000
      while (count === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
      expect(count).toBeGreaterThan(0)
      await task.stop()
      const stopped = count
      await new Promise(resolve => setTimeout(resolve, 1100))
      expect(count).toBe(stopped)
    } finally { await task.destroy() }
  }, 7000)

  it('retains cron validation used by scheduling routes', () => {
    expect(cron.validate('*/5 * * * *')).toBe(true)
    expect(cron.validate('not a cron')).toBe(false)
  })

  it('imports the actual Transformers pipeline and environment without downloading a model', async () => {
    const transformers = await import('@huggingface/transformers')
    expect(typeof transformers.pipeline).toBe('function')
    expect(transformers.env).toHaveProperty('cacheDir')
  }, 10000)
})
