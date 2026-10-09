import { ButtonInteraction } from 'discord.js'
import { route } from '@src/common/index.js'
import { Command, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction, findRouteConflicts, MeoCordTestingModule, resolveRoute } from '@src/testing/index.js'
import { MeoCord } from '@src/decorator/index.js'
import { buildComponentRoutes } from '@src/core/component-routes.js'

const ticket = route('ticket/{id}/{action}')
const newTicket = route('ticket/new/{action}')
const received: unknown[] = []

@Controller()
class TicketController {
  @Command(ticket, CommandType.BUTTON)
  handle(_interaction: ButtonInteraction, params: { id: string; action: string }) {
    received.push(params)
  }

  // More literal text than ticket/{id}/{action}, so it ranks first, as its string would
  @Command(newTicket, CommandType.BUTTON)
  create(_interaction: ButtonInteraction, params: { action: string }) {
    received.push({ new: params })
  }
}

@MeoCord({ controllers: [TicketController], clientOptions: { intents: [] } })
class App {}

const module = MeoCordTestingModule.create({ controllers: [TicketController] }).compile()
const click = (customId: string) => createMockInteraction(ButtonInteraction, { customId })

beforeEach(() => {
  received.length = 0
})

describe('route', () => {
  it('builds a customId with each value in its segment', () => {
    expect(ticket.build({ id: 42, action: 'close' })).toBe('ticket/42/close')
    expect(ticket.build({ id: 123456789012345678n, action: 'close' })).toBe('ticket/123456789012345678/close')
    expect(route('refresh').build()).toBe('refresh')
    expect(`${ticket}`).toBe('ticket/{id}/{action}')
  })

  it("routes the id it builds to the route's handler, which receives the values as given", async () => {
    const id = ticket.build({ id: 'a/b%c', action: 'close' })

    expect(id).toBe('ticket/a%2Fb%25c/close')
    await module.invoke(TicketController, 'handle', click(id))
    expect(received).toEqual([{ id: 'a/b%c', action: 'close' }])
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: id })?.params).toEqual({ id: 'a/b%c', action: 'close' })
  })

  it('ranks and checks routes as it does their patterns', () => {
    expect(resolveRoute(App, { type: CommandType.BUTTON, customId: newTicket.build({ action: 'open' }) })?.handler).toBe(
      TicketController.prototype.create,
    )
    // The literal `new` ranks it first, so the pair is no conflict
    expect(findRouteConflicts(App)).toEqual([])
  })

  it('is refused beside a route or string of the same shape, as the string would be', () => {
    @Controller()
    class Other {
      @Command(route('ticket/{ref}/{step}'), CommandType.BUTTON)
      other() {
        return undefined
      }
    }

    expect(() => buildComponentRoutes([TicketController, Other])).toThrow(/^TicketController\.handle: .* in Other\.other match the same/)
  })

  it('refuses a missing, empty or unknown value, and an id over 100 characters', () => {
    const build = ticket.build as (values?: Record<string, unknown>) => string

    expect(() => build({ id: '1' })).toThrow("route('ticket/{id}/{action}').build() needs a value for {action}.")
    expect(() => build({ id: '', action: 'close' })).toThrow('got an empty {id}')
    expect(() => build({ id: '1', action: 'close', reason: 'spam' })).toThrow("route('ticket/{id}/{action}') has no param {reason}.")
    expect(() => ticket.build({ id: 'x'.repeat(90), action: 'close' })).toThrow(RangeError)
  })

  it('refuses a snowflake or a uuid given as anything but text, as a number may have lost digits already', () => {
    const member = route('member/{id:snowflake}/{session:uuid}')
    const build = member.build as (values: Record<string, unknown>) => string
    const session = '0f8fad5b-d9cb-469f-a165-70867728950e'

    // 12345678901234567 reaches build() as 12345678901234568, a valid snowflake of another member
    expect(() => build({ id: 12345678901234567, session })).toThrow(
      "route('member/{id:snowflake}/{session:uuid}').build() got the number 12345678901234568 for {id:snowflake}, which " +
        'takes its value as a string. A number may have lost digits already: pass the ID as text, such as user.id.',
    )
    expect(() => build({ id: 12345678901234567n, session })).toThrow('got the bigint 12345678901234567 for {id:snowflake}')
    expect(() => build({ id: '12345678901234567', session: 42 })).toThrow(
      "route('member/{id:snowflake}/{session:uuid}').build() got the number 42 for {session:uuid}, which takes its value as a string.",
    )
  })

  it('refuses a pattern @Command would refuse, where it is made', () => {
    expect(() => route('ticket-{id}')).toThrow('must occupy a whole segment')
  })
})
