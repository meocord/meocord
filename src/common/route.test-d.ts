import { describe, expectTypeOf, it } from 'vitest'
import {
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type User,
  type UserSelectMenuInteraction,
} from 'discord.js'
import { route } from '@src/common/index.js'
import { Command, UsePipe, Validate } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type PipeInterface, type Piped, type StandardSchemaV1 } from '@src/interface/index.js'

/** Runs under `vitest --typecheck`: what a route's `build` takes, and that `@Command` takes a route. */

describe('route', () => {
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
