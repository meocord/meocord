import { vi } from 'vitest'

const { compiled } = vi.hoisted(() => ({ compiled: [] as string[] }))

// Records each pattern compiled, wherever it is compiled from
vi.mock('@src/decorator/controller.decorator.js', async importOriginal => {
  const actual = await importOriginal<typeof import('@src/decorator/controller.decorator.js')>()
  return {
    ...actual,
    createRegexFromPattern: (pattern: string) => {
      compiled.push(pattern)
      return actual.createRegexFromPattern(pattern)
    },
  }
})

const { route } = await import('@src/common/route.js')

// A route made inside a handler is made on every call, so reading a customId with it compiles nothing more and keeps
// nothing per pattern
it('compiles its pattern once, where it is made, and match compiles nothing', () => {
  const ticket = route('ticket/{id:int}/close')
  const poll = route('poll/{choice}')
  expect(compiled).toEqual(['ticket/{id:int}/close', 'poll/{choice}'])

  expect(ticket.match('ticket/1/close')).toEqual({ id: 1 })
  expect(ticket.match('ticket/2/close')).toEqual({ id: 2 })
  expect(poll.match('poll/yes')).toEqual({ choice: 'yes' })
  expect(poll.match('ticket/1/close')).toBeUndefined()

  expect(compiled).toEqual(['ticket/{id:int}/close', 'poll/{choice}'])
})
