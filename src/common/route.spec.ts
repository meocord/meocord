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

  it('refuses a missing, empty or unknown value, and an id that is empty or over 100 characters', () => {
    const build = ticket.build as (values?: Record<string, unknown>) => string

    expect(() => build({ id: '1' })).toThrow("route('ticket/{id}/{action}').build() needs a value for {action}.")
    expect(() => build({ id: '', action: 'close' })).toThrow('got an empty {id}')
    expect(() => build({ id: '1', action: 'close', reason: 'spam' })).toThrow("route('ticket/{id}/{action}') has no param {reason}.")
    expect(() => ticket.build({ id: 'x'.repeat(90), action: 'close' })).toThrow(RangeError)
    expect(() => route('').build()).toThrow(new RangeError("route('').build() made an empty customId; Discord's customIds are 1 to 100 characters."))
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
    expect(() => route('card/{id}/{id}')).toThrow('Invalid pattern "card/{id}/{id}": {id} appears twice; give each param its own name.')
    expect(() => route('card/{1}')).toThrow('Invalid pattern "card/{1}": {1} starts with a digit; start a param\'s name with a letter or _.')
  })
})

describe('Route.match', () => {
  it("reads a customId's params, a typed one as its value, and undefined for one it doesn't match", () => {
    const closeTicket = route('ticket/{id:int}/close')

    expect(closeTicket.match('ticket/42/close')).toEqual({ id: 42 })
    // 'new' is not an int
    expect(closeTicket.match('ticket/new/close')).toBeUndefined()
    expect(closeTicket.match('poll/1')).toBeUndefined()
    expect(closeTicket.match('')).toBeUndefined()
    expect(route('refresh').match('refresh')).toEqual({})
  })

  it('reads each segment type as its handler receives it', () => {
    const settings = route('s/{text}/{count:int}/{ratio:number}/{on:bool}/{user:snowflake}/{session:uuid}/{order:asc|desc}')
    const session = '0f8fad5b-d9cb-469f-a165-70867728950e'

    expect(settings.match(`s/hi/-3/2.5/yes/123456789012345678/${session}/desc`)).toStrictEqual({
      text: 'hi',
      count: -3,
      ratio: 2.5,
      on: true,
      user: '123456789012345678',
      session,
      order: 'desc',
    })
    expect(settings.match(`s/hi/-3/2.5/yes/123456789012345678/${session}/up`)).toBeUndefined()
    expect(settings.match(`s/hi/1.5/2.5/yes/123456789012345678/${session}/asc`)).toBeUndefined()
  })

  it('reads back a value with / and % as build was given it', () => {
    const values = { id: 'a/b%2F%', action: '100%/' }

    expect(ticket.match(ticket.build(values))).toStrictEqual(values)
  })

  // Written by hand, apart from the reading dispatch and match share: what build writes, and what an id reads as
  it.each<[string, string, unknown, string, string, unknown]>([
    // name, pattern, value built, id it builds, id written by hand, what that id reads as
    ['untyped text', 'r/{v}', 'abc', 'r/abc', 'r/a b', 'a b'],
    ['string', 'r/{v:string}', 'a b', 'r/a b', 'r/xyz', 'xyz'],
    ['int', 'r/{v:int}', -12, 'r/-12', 'r/7', 7],
    ['number', 'r/{v:number}', 2.5, 'r/2.5', 'r/-0.25', -0.25],
    ['bool', 'r/{v:bool}', true, 'r/true', 'r/yes', true],
    ['snowflake', 'r/{v:snowflake}', '123456789012345678', 'r/123456789012345678', 'r/80351110224678912', '80351110224678912'],
    ['uuid', 'r/{v:uuid}', '0f8fad5b-d9cb-469f-a165-70867728950e', 'r/0f8fad5b-d9cb-469f-a165-70867728950e', 'r/7c9e6679-7425-40de-944b-e07fc1f90ae7', '7c9e6679-7425-40de-944b-e07fc1f90ae7'],
    ['a choice', 'r/{v:asc|desc}', 'desc', 'r/desc', 'r/asc', 'asc'],
    ['%2F as text', 'r/{v}', '%2F', 'r/%252F', 'r/%252F', '%2F'],
    ['%25 as text', 'r/{v}', '%25', 'r/%2525', 'r/%2525', '%25'],
    ['a lower-case %2f', 'r/{v}', '%2f', 'r/%252f', 'r/a%2fb', 'a/b'],
    ['%%2F2F, decoded once', 'r/{v}', '%%2F2F', 'r/%25%252F2F', 'r/%%2F2F', '%/2F'],
    ['/', 'r/{v}', 'a/b', 'r/a%2Fb', 'r/%2F', '/'],
    ['unicode', 'r/{v}', 'héllo ✓', 'r/héllo ✓', 'r/日本', '日本'],
  ])('builds and reads %s', (_name, pattern, value, built, written, read) => {
    const r = route(pattern) as unknown as { build: (values: { v: unknown }) => string; match: (customId: string) => unknown }

    expect(r.build({ v: value })).toBe(built)
    expect(r.match(built)).toStrictEqual({ v: value })
    expect(r.match(written)).toStrictEqual({ v: read })
  })

  it('gives the params dispatch hands the handler for the same customId', async () => {
    const customId = ticket.build({ id: 'x/%', action: 'close' })
    await module.dispatch(click(customId))

    expect(received).toEqual([ticket.match(customId)])
  })

  // A more specific pattern ranks first in the app, and match still reads its own route
  it('reads its own route for a customId a more specific pattern takes in the app', async () => {
    await module.dispatch(click('ticket/new/close'))

    expect(received).toEqual([{ new: { action: 'close' } }])
    expect(ticket.match('ticket/new/close')).toStrictEqual({ id: 'new', action: 'close' })
    expect(newTicket.match('ticket/new/close')).toStrictEqual({ action: 'close' })
  })
})
