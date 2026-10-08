import { describe, expect, it, jest } from '@jest/globals'
import { isMockFunction, useMockFn } from 'meocord/testing'
import { clickGreet } from './shared/module.js'

useMockFn(jest.fn)

describe('meocord/testing under jest', () => {
  it("dispatches a mock interaction, and jest's matchers read meocord's mocks", async () => {
    const text = jest.fn(() => 'from jest')
    const { click, outcome } = await clickGreet(text)

    expect(outcome.ran).toBe(true)
    expect(text).toHaveBeenCalled()
    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'from jest' }))
    expect(jest.isMockFunction(click.update) && isMockFunction(click.update)).toBe(true)
  })
})
