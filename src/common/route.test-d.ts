import { describe, expectTypeOf, it } from 'vitest'
import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type User,
  type UserSelectMenuInteraction,
} from 'discord.js'
import { route, type Route, type RouteMatch, type RouteParams } from '@src/common/index.js'
import { Command, UsePipe, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type PipeInterface, type Piped, type StandardSchemaV1 } from '@src/interface/index.js'

/** Runs under `vitest --typecheck`: what a route's `build` takes, and that `@Command` takes a route. */

describe('route', () => {
  it("matches a customId into the values the route's handler receives", () => {
    const settings = route('s/{text}/{count:int}/{ratio:number}/{on:bool}/{user:snowflake}/{session:uuid}/{order:asc|desc}')

    expectTypeOf(settings.match('s')).toEqualTypeOf<
      { text: string; count: number; ratio: number; on: boolean; user: string; session: string; order: 'asc' | 'desc' } | undefined
    >()
    expectTypeOf(settings.match('s')).toEqualTypeOf<RouteMatch<typeof settings.pattern> | undefined>()
    expectTypeOf(route('refresh').match('refresh')).toEqualTypeOf<Record<never, never> | undefined>()
    // @ts-expect-error the pattern has no {reason}
    void settings.match('s')?.reason
  })

  it('types each param as its handler receives it, and a pattern without params as an empty object', () => {
    expectTypeOf<RouteMatch<'ticket/{id:int}/close'>>().toEqualTypeOf<{ id: number }>()
    expectTypeOf<RouteMatch<'t/{a}'>>().toEqualTypeOf<{ a: string }>()
    expectTypeOf<RouteMatch<'t/{a:string}'>>().toEqualTypeOf<{ a: string }>()
    expectTypeOf<RouteMatch<'t/{a:int}'>>().toEqualTypeOf<{ a: number }>()
    expectTypeOf<RouteMatch<'t/{a:number}'>>().toEqualTypeOf<{ a: number }>()
    expectTypeOf<RouteMatch<'t/{a:bool}'>>().toEqualTypeOf<{ a: boolean }>()
    expectTypeOf<RouteMatch<'t/{a:snowflake}'>>().toEqualTypeOf<{ a: string }>()
    expectTypeOf<RouteMatch<'t/{a:uuid}'>>().toEqualTypeOf<{ a: string }>()
    expectTypeOf<RouteMatch<'t/{a:on|off}'>>().toEqualTypeOf<{ a: 'on' | 'off' }>()
    expectTypeOf<RouteMatch<'refresh'>>().toEqualTypeOf<Record<never, never>>()
  })

  it("types a handler's params, which the route's check takes", () => {
    const close = route('ticket/{id:int}/{order:asc|desc}')
    class Tickets {
      @Command(close, CommandType.BUTTON)
      close(_interaction: ButtonInteraction, _params: RouteMatch<typeof close.pattern>) {
        return undefined
      }

      @Command('ticket/{id:int}/{order:asc|desc}', CommandType.BUTTON)
      byString(_interaction: ButtonInteraction, _params: RouteMatch<'ticket/{id:int}/{order:asc|desc}'>) {
        return undefined
      }
    }
    expectTypeOf(Tickets).toBeConstructibleWith()
  })

  it('needs match on a Route written by hand', () => {
    // @ts-expect-error match is required, as route() makes it
    const handWritten: Route<'refresh'> = { pattern: 'refresh', build: () => 'refresh', toString: () => 'refresh' }
    void handWritten
  })

  it("takes one value for each of the pattern's params, and no others", () => {
    const ticket = route('ticket/{id}/{action}')

    expectTypeOf(ticket.build({ id: '42', action: 'close' })).toEqualTypeOf<string>()
    ticket.build({ id: 42n, action: 'close' })
    // @ts-expect-error a param is missing
    ticket.build({ id: '42' })
    // @ts-expect-error the pattern has no {reason}
    ticket.build({ id: '42', action: 'close', reason: 'spam' })
    // @ts-expect-error values are required
    ticket.build()
  })

  it('takes nothing for a pattern without params', () => {
    const refresh = route('refresh')

    expectTypeOf(refresh.build()).toEqualTypeOf<string>()
    // @ts-expect-error the pattern has no params
    refresh.build({ id: '1' })
  })

  // As the runtime reads it: a name of ASCII letters, digits and _, so `{café}` is the pattern's own text
  it('takes a brace pair whose name is no word as literal text, not a param', () => {
    expectTypeOf<RouteParams<'x/{café}'>>().toEqualTypeOf<never>()
    expectTypeOf<RouteParams<'x/{a b}/{id}'>>().toEqualTypeOf<'id'>()
    expectTypeOf<RouteParams<'x/{{id}}'>>().toEqualTypeOf<'id'>()
    // A type holds no `/`, which ends the segment, so `{id:a/b}` is text too
    expectTypeOf<RouteParams<'x/{id:a/b}'>>().toEqualTypeOf<never>()
    expectTypeOf<RouteParams<'x/{id}/{page:int}'>>().toEqualTypeOf<'id' | 'page'>()
    expectTypeOf(route('x/{café}').build()).toEqualTypeOf<string>()
    // @ts-expect-error {café} is no param
    route('x/{café}').build({ café: '1' })
  })

  it('keeps its pattern as a literal type', () => {
    expectTypeOf(route('ticket/{id}').pattern).toEqualTypeOf<'ticket/{id}'>()
  })

  it('is what @Command takes in place of the pattern', () => {
    const ticket = route('ticket/{id}')

    class Tickets {
      @Command(ticket, CommandType.BUTTON)
      open(_interaction: ButtonInteraction, _params: { id: string }) {
        return undefined
      }
    }
    expectTypeOf(Tickets).toBeConstructibleWith()
  })
})

class Account {
  uid = ''
}
class AccountPipe implements PipeInterface<string, Account> {
  transform(uid: string) {
    return Object.assign(new Account(), { uid })
  }
}
declare const uidSchema: StandardSchemaV1<unknown, { uid: string }>
const ticket = route('ticket/{id}')
const profile = route('profile/{uid}')

describe('@Command(route) and the handler params', () => {
  it('takes params that name only what the route captures', () => {
    class Tickets {
      @Command(ticket, CommandType.BUTTON)
      open(_interaction: ButtonInteraction, _params: { id: string }) {
        return undefined
      }

      @Command(ticket, CommandType.BUTTON)
      noParams(_interaction: ButtonInteraction) {
        return undefined
      }

      @Command(ticket, CommandType.BUTTON)
      optional(_interaction: ButtonInteraction, _params: { id: string; note?: string }) {
        return undefined
      }
    }
    expectTypeOf(Tickets).toBeConstructibleWith()
  })

  it('refuses a key the route does not capture, such as a misspelt one', () => {
    class Tickets {
      // @ts-expect-error the route captures {id}, not {ticketId}
      @Command(ticket, CommandType.BUTTON)
      open(_interaction: ButtonInteraction, _params: { ticketId: string }) {
        return undefined
      }
    }
    expectTypeOf(Tickets).toBeConstructibleWith()
  })

  it('refuses a param the pattern does not capture', () => {
    const narrowed = route('ticket/{id}')
    class Tickets {
      // @ts-expect-error {action} is not in 'ticket/{id}'
      @Command(narrowed, CommandType.BUTTON)
      act(_interaction: ButtonInteraction, _params: { id: string; action: string }) {
        return undefined
      }
    }
    expectTypeOf(Tickets).toBeConstructibleWith()
  })

  it('leaves value types to @Validate and pipes', () => {
    class Profiles {
      @Command(profile, CommandType.BUTTON)
      @Validate(uidSchema, { pipes: { uid: AccountPipe } })
      piped(_interaction: ButtonInteraction, _params: { uid: Account }) {
        return undefined
      }

      @Command(profile, CommandType.BUTTON)
      @UsePipe('uid', AccountPipe)
      separate(_interaction: ButtonInteraction, _params: { uid: Piped<Account> }) {
        return undefined
      }
    }
    expectTypeOf(Profiles).toBeConstructibleWith()
  })

  it("allows a select menu's choices beside the route's params", () => {
    const poll = route('poll/{id}')
    class Polls {
      @Command(poll, CommandType.SELECT_MENU)
      vote(_interaction: StringSelectMenuInteraction, _params: { id: string; values: string[] }) {
        return undefined
      }

      @Command(poll, CommandType.USER_SELECT_MENU)
      assign(_interaction: UserSelectMenuInteraction, _params: { id: string; values: string[]; users: unknown[] }) {
        return undefined
      }

      // @ts-expect-error a string select menu has no users
      @Command(poll, CommandType.SELECT_MENU)
      users(_interaction: StringSelectMenuInteraction, _params: { id: string; users: unknown[] }) {
        return undefined
      }
    }
    expectTypeOf(Polls).toBeConstructibleWith()
  })

  it("allows a modal's fields, which the pattern cannot name", () => {
    const report = route('report/{id}')
    class Reports {
      @Command(report, CommandType.MODAL_SUBMIT)
      submit(_interaction: ModalSubmitInteraction, _params: { id: string; reason: string }) {
        return undefined
      }
    }
    expectTypeOf(Reports).toBeConstructibleWith()
  })

  it("leaves a command's options unchecked, since only components route by customId", () => {
    const ping = route('ping')
    class Commands {
      @Command(ping, CommandType.SLASH)
      ping(_interaction: ChatInputCommandInteraction, _params: { user: User }) {
        return undefined
      }
    }
    expectTypeOf(Commands).toBeConstructibleWith()
  })
})

describe('typed customId params', () => {
  const counter = route('counter/{count:int}/{order:asc|desc}/{open:bool}')

  it('names each param without its type, and builds from values of their types', () => {
    expectTypeOf<Parameters<typeof counter.build>[0]>().toEqualTypeOf<{ count: number; order: 'asc' | 'desc'; open: boolean }>()
    counter.build({ count: 1, order: 'asc', open: true })
    // @ts-expect-error {count:int} takes a number
    counter.build({ count: '1', order: 'asc', open: true })
    // @ts-expect-error {order:asc|desc} takes one of its words
    counter.build({ count: 1, order: 'up', open: true })
  })

  it('checks a typed param the handler declares against its value, for a route and a plain string', () => {
    class Counters {
      @Command(counter, CommandType.BUTTON)
      typed(_interaction: ButtonInteraction, _params: { count: number; order: 'asc' | 'desc'; open: boolean }) {
        return undefined
      }

      // @ts-expect-error {count:int} gives a number
      @Command(counter, CommandType.BUTTON)
      wrong(_interaction: ButtonInteraction, _params: { count: string }) {
        return undefined
      }

      @Command('page/{page:int}', CommandType.BUTTON)
      plain(_interaction: ButtonInteraction, _params: { page: number }) {
        return undefined
      }

      // @ts-expect-error {page:int} gives a number
      @Command('page/{page:int}', CommandType.BUTTON)
      plainWrong(_interaction: ButtonInteraction, _params: { page: string }) {
        return undefined
      }
    }
    expectTypeOf(Counters).toBeConstructibleWith()
  })
})

describe('snowflake and uuid params', () => {
  it('build each from its text, and give the handler the text', () => {
    const member = route('member/{id:snowflake}/{session:uuid}')

    member.build({ id: '1234567890123456789', session: '0f8fad5b-d9cb-469f-a165-70867728950e' })
    // @ts-expect-error a snowflake is built from its text, which keeps every digit
    member.build({ id: 1234567890123456789, session: '0f8fad5b-d9cb-469f-a165-70867728950e' })

    class Members {
      @Command(member, CommandType.BUTTON)
      show(_interaction: ButtonInteraction, _params: { id: string; session: string }) {
        return undefined
      }

      // @ts-expect-error the handler gets a snowflake as text, not a number
      @Command(member, CommandType.BUTTON)
      wrong(_interaction: ButtonInteraction, _params: { id: number; session: string }) {
        return undefined
      }
    }
    expectTypeOf(Members).toBeConstructibleWith()
  })
})
