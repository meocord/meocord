import { describe, expect, it, vi } from 'vitest'
import { useMockFn } from 'meocord/testing'
import { absentKeyWarnings, clickGreet } from './shared/module.js'

useMockFn(vi.fn)

describe('meocord/testing under vitest', () => {
  it("dispatches a mock interaction, and vitest's matchers read meocord's mocks", async () => {
    const text = vi.fn(() => 'from vitest')
    const { click, outcome } = await clickGreet(text)

    expect(outcome.ran).toBe(true)
    expect(text).toHaveBeenCalled()
    expect(click.update).toHaveBeenCalledWith(expect.objectContaining({ content: 'from vitest' }))
    // Made with vi.fn, so Vitest's own mock API reaches it
    vi.mocked(click.update).mockClear()
    expect(click.update.mock.calls).toEqual([])
  })

  it("warns only about the key the test reads on purpose that its mock's class lacks", async () => {
    expect(await absentKeyWarnings()).toEqual(['ButtonInteraction.notAThing'])
  })
})
