import { describe, expect, it, vi } from 'vitest'
import { clickGreet } from './shared/module.js'

describe('meocord/testing under vitest', () => {
  it("dispatches a mock interaction, and vitest's matchers read meocord's mocks", async () => {
    const text = vi.fn(() => 'from vitest')
    const { click, outcome } = await clickGreet(text)

    expect(outcome.ran).toBe(true)
    expect(text).toHaveBeenCalled()
    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'from vitest' }))
  })
})
