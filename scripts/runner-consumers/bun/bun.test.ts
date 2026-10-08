import { describe, expect, it, mock } from 'bun:test'
import { createMock, useMockFn } from 'meocord/testing'
import { clickGreet } from './shared/module.js'

// Bun's matchers accept only Bun's own mocks, so meocord makes its mocks with bun's mock
useMockFn(mock)

describe('meocord/testing under bun test', () => {
  it("dispatches a mock interaction, and meocord's mocks record their calls in .mock.calls", async () => {
    const text = mock(() => 'from bun')
    const { click, outcome } = await clickGreet(text)

    expect(outcome.ran).toBe(true)
    expect(text).toHaveBeenCalled()
    expect(click.update.mock.calls).toHaveLength(1)
    expect(click.update.mock.calls[0][0]).toMatchObject({ content: 'from bun' })
  })

  it("bun's mock matchers read meocord's mocks, a method's and a mocked interface's alike", async () => {
    const { click } = await clickGreet(() => 'from bun')
    const logger = createMock<{ log(line: string): void }>()
    logger.log('clicked')

    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'from bun' }))
    expect(logger.log).toHaveBeenCalledWith('clicked')
  })
})
