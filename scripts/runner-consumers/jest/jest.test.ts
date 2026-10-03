import { describe, expect, it, jest } from '@jest/globals'
import { clickGreet } from './shared/module.js'

describe('meocord/testing under jest', () => {
  it("dispatches a mock interaction, and jest's matchers read meocord's mocks", async () => {
    const text = jest.fn(() => 'from jest')
    const { click, outcome } = await clickGreet(text)

    expect(outcome.ran).toBe(true)
    expect(text).toHaveBeenCalled()
    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'from jest' }))
  })
})
