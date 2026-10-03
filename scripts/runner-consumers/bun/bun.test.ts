import { describe, expect, it, mock, test } from 'bun:test'
import { clickGreet } from './shared/module.js'

describe('meocord/testing under bun test', () => {
  it("dispatches a mock interaction, and meocord's mocks record their calls in .mock.calls", async () => {
    const text = mock(() => 'from bun')
    const { click, outcome } = await clickGreet(text)

    expect(outcome.ran).toBe(true)
    expect(text).toHaveBeenCalled()
    expect(click.update.mock.calls).toHaveLength(1)
    expect(click.update.mock.calls[0][0]).toMatchObject({ content: 'from bun' })
  })

  // Bun's matchers accept only Bun's own mocks, which meocord's are not yet. This fails today, as `failing` expects;
  // once meocord's mocks satisfy bun's matchers, it passes, and bun reports that it should no longer be marked failing
  test.failing("bun's mock matchers read meocord's mocks", async () => {
    const { click } = await clickGreet(() => 'from bun')

    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'from bun' }))
  })
})
