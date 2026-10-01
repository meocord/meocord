import { describe, it } from 'vitest'
import {
  type APIGuildMember,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type GuildMember,
  type MentionableSelectMenuInteraction,
  type Role,
  type RoleSelectMenuInteraction,
  type StringSelectMenuInteraction,
  type User,
  type UserSelectMenuInteraction,
} from 'discord.js'
import { route } from '@src/common/route.js'
import { Command } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'

/** Runs under `vitest --typecheck`: the params a component handler declares, checked against what a call gets. */
describe("a select menu's choices", () => {
  it('compile as the values discord.js resolves them to, as one of a union, or left out', () => {
    class Menus {
      @Command('pick', CommandType.SELECT_MENU)
      pick(_interaction: StringSelectMenuInteraction, { values }: { values: string[] }) {
        void values
      }

      @Command('who', CommandType.USER_SELECT_MENU)
      who(_interaction: UserSelectMenuInteraction, { users, members }: { users: User[]; members: GuildMember[] }) {
        void [users, members]
      }

      @Command('staff', CommandType.ROLE_SELECT_MENU)
      staff(_interaction: RoleSelectMenuInteraction, { roles }: { roles: readonly Role[] }) {
        void roles
      }

      @Command('where', CommandType.CHANNEL_SELECT_MENU)
      where(_interaction: ChannelSelectMenuInteraction, { values }: { values?: string[] }) {
        void values
      }

      @Command('any/{page}', CommandType.MENTIONABLE_SELECT_MENU)
      any(_interaction: MentionableSelectMenuInteraction, params: { page: string; members: (GuildMember | APIGuildMember)[] }) {
        void params
      }
    }
    void Menus
  })

  it('give way to a route param of the same name, as the handler gets the param', () => {
    class Menus {
      @Command('pick/{values}', CommandType.SELECT_MENU)
      pick(_interaction: StringSelectMenuInteraction, { values }: { values: string }) {
        void values
      }
    }
    void Menus
  })

  it('are refused with a type no choice can have', () => {
    class Menus {
      // @ts-expect-error a select menu's values are strings, one per choice
      @Command('pick', CommandType.SELECT_MENU)
      pick(_interaction: StringSelectMenuInteraction, { values }: { values: number }) {
        void values
      }

      // @ts-expect-error a user select's users are User objects, not their IDs
      @Command('who', CommandType.USER_SELECT_MENU)
      who(_interaction: UserSelectMenuInteraction, { users }: { users: string }) {
        void users
      }

      // @ts-expect-error a single value is not the list of them
      @Command('one', CommandType.SELECT_MENU)
      one(_interaction: StringSelectMenuInteraction, { values }: { values: string }) {
        void values
      }
    }
    void Menus
  })
})

describe("a plain-string pattern's params", () => {
  it('compile when each key is a param of the pattern, as with route()', () => {
    class Buttons {
      @Command('stats/{id}', CommandType.BUTTON)
      stats(_interaction: ButtonInteraction, { id }: { id: string }) {
        void id
      }

      @Command('card/{ownerId}/{count:int}', CommandType.BUTTON)
      card(_interaction: ButtonInteraction, params: { ownerId: string; count: number }) {
        void params
      }

      @Command(route('page/{n:int}'), CommandType.BUTTON)
      page(_interaction: ButtonInteraction, { n }: { n: number }) {
        void n
      }

      @Command('open', CommandType.BUTTON)
      open(_interaction: ButtonInteraction, params: Record<string, string>) {
        void params
      }
    }
    void Buttons
  })

  it('are refused for a key the pattern does not capture', () => {
    class Buttons {
      // @ts-expect-error the pattern captures id, not uid
      @Command('stats/{id}', CommandType.BUTTON)
      stats(_interaction: ButtonInteraction, { uid }: { uid: string }) {
        void uid
      }

      // @ts-expect-error a select menu gets its route's params and its choices, and nothing named page
      @Command('pick/{id}', CommandType.SELECT_MENU)
      pick(_interaction: StringSelectMenuInteraction, { page }: { page: string }) {
        void page
      }
    }
    void Buttons
  })
})
