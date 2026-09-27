import { describe, expectTypeOf, it } from 'vitest'
import { type GuildMember, type Message, type Role, type User } from 'discord.js'
import { MeoCord, MessageHandler } from '@src/decorator/index.js'
import { type EntityRef, type MessageScope, type ParamRefsOf, type ParamsOf } from '@src/interface/index.js'
import { type MessageHandlerEntry } from '@src/core/index.js'

/** Runs under `vitest --typecheck`: what `@MessageHandler` and `@MeoCord({ messages })` accept. */

describe('@MessageHandler params', () => {
  it('passes a patterned handler its params as the second argument, typed by the handler', () => {
    class Dice {
      @MessageHandler('roll {sides} {note...?}')
      async roll(_message: Message, _params: { sides: string; note?: string }) {
        return undefined
      }

      @MessageHandler('roll {sides}')
      async validated(_message: Message, _params: { sides: number }) {
        return undefined
      }

      @MessageHandler('roll {sides}')
      async messageOnly(_message: Message) {
        return undefined
      }

      @MessageHandler('roll {sides}')
      async none() {
        return undefined
      }

      // @ts-expect-error params are an object
      @MessageHandler('roll {sides}')
      async notAnObject(_message: Message, _params: string) {
        return undefined
      }
    }
    void Dice
  })

  it('passes a listener the message alone', () => {
    class Listener {
      @MessageHandler()
      async everything(_message: Message) {
        return undefined
      }

      // @ts-expect-error a listener has no pattern, so no params
      @MessageHandler()
      async withParams(_message: Message, _params: { sides: string }) {
        return undefined
      }
    }
    void Listener
  })

  it("takes a handler's own prefix and case rule", () => {
    class Options {
      @MessageHandler('hello', { prefix: false })
      async raw() {
        return undefined
      }

      @MessageHandler('ping', { prefix: '?' })
      async one() {
        return undefined
      }

      @MessageHandler('ping', { prefix: ['?', '??'], caseSensitive: true })
      async many() {
        return undefined
      }

      // @ts-expect-error prefix is false, a string or a list of strings
      @MessageHandler('ping', { prefix: true })
      async wrong() {
        return undefined
      }

      // @ts-expect-error a handler's prefix is fixed; only the app's may be a function
      @MessageHandler('ping', { prefix: () => '!' })
      async fn() {
        return undefined
      }
    }
    void Options
  })

  it('takes aliases, a description and a scope', () => {
    class Described {
      @MessageHandler('mute {target:member}', { aliases: ['m'], description: 'Times a member out.', scope: 'guild' })
      async mute(_m: Message, _p: { target: GuildMember }) {
        return undefined
      }

      // @ts-expect-error scope is 'guild', 'dm' or 'any'
      @MessageHandler('inbox', { scope: 'server' })
      async inbox() {
        return undefined
      }

      // @ts-expect-error aliases are a list of words
      @MessageHandler('inbox', { aliases: 'i' })
      async alias() {
        return undefined
      }
    }
    void Described
    expectTypeOf<MessageHandlerEntry['usage']>().toEqualTypeOf<(prefix?: string) => string | undefined>()
    expectTypeOf<MessageHandlerEntry['scope']>().toEqualTypeOf<MessageScope>()
  })
})

describe("mention: 'only'", () => {
  it("is taken by the app and a handler, and no other string is", () => {
    @MeoCord({ controllers: [], clientOptions: { intents: [] }, messages: { mention: 'only' } })
    class MentionOnly {}
    void MentionOnly

    // @ts-expect-error mention is true, false or 'only'
    @MeoCord({ controllers: [], clientOptions: { intents: [] }, messages: { mention: 'always' } })
    class Wrong {}
    void Wrong

    class Status {
      @MessageHandler('status', { mention: 'only' })
      async status() {
        return undefined
      }

      // @ts-expect-error a handler's mention is 'only'; the app's option covers the rest
      @MessageHandler('ping', { mention: true })
      async ping() {
        return undefined
      }
    }
    void Status
  })
})

describe('@MeoCord({ messages })', () => {
  it('takes prefixes as a string, a list, or a function of the message', () => {
    @MeoCord({ controllers: [], clientOptions: { intents: [] }, messages: { prefix: '!', mention: true, caseSensitive: false } })
    class One {}

    @MeoCord({ controllers: [], clientOptions: { intents: [] }, messages: { prefix: ['!', '?'] } })
    class Many {}

    @MeoCord({
      controllers: [],
      clientOptions: { intents: [] },
      messages: { prefix: async (message: Message) => (message.guildId ? ['?'] : '!') },
    })
    class PerGuild {}

    // @ts-expect-error a prefix is text
    @MeoCord({ controllers: [], clientOptions: { intents: [] }, messages: { prefix: 1 } })
    class Wrong {}

    void [One, Many, PerGuild, Wrong]
  })
})

declare module '@src/interface/index.js' {
  interface MessageParamTypes {
    color: number
  }
}

describe('@MessageHandler typed params', () => {
  it('types each param from the pattern, and checks the handler against it', () => {
    class Typed {
      @MessageHandler('ban {target:member} {duration:duration?} {reason...?}')
      async ban(_m: Message, _p: { target: GuildMember; duration?: number; reason?: string }) {
        return undefined
      }

      @MessageHandler('paint {shade:color} {mode:on|off}')
      async paint(_m: Message, _p: { shade: number; mode: 'on' | 'off' }) {
        return undefined
      }

      // A param with no type is text, which @Validate or a pipe may turn into anything
      @MessageHandler('roll {sides}')
      async roll(_m: Message, _p: { sides: number }) {
        return undefined
      }

      // Any params at all are not checked
      @MessageHandler('echo {text...}')
      async echo(_m: Message, _p: Record<string, string>) {
        return undefined
      }

      // A wider type than the param's value is fine
      @MessageHandler('who {target:user}')
      async who(_m: Message, _p: { target: User | GuildMember }) {
        return undefined
      }

      // @ts-expect-error a name the pattern does not have
      @MessageHandler('dice {sides:int}')
      async typo(_m: Message, _p: { sids: number }) {
        return undefined
      }

      // @ts-expect-error a type the param's value is not
      @MessageHandler('pay {to:member} {amount:int}')
      async wrongType(_m: Message, _p: { to: GuildMember; amount: string }) {
        return undefined
      }

      // @ts-expect-error an optional typed param declared as always there
      @MessageHandler('avatar {who:user?}')
      async required(_m: Message, _p: { who: User }) {
        return undefined
      }

      @MessageHandler('purge {count:int} {--bots} {--from:user?}')
      async purge(_m: Message, _p: { count: number; bots: boolean; from?: User }) {
        return undefined
      }

      // @ts-expect-error a flag without a type is a boolean
      @MessageHandler('purge {count:int} {--bots}')
      async flagText(_m: Message, _p: { count: number; bots: string }) {
        return undefined
      }

      // @ts-expect-error a typed rest is a list
      @MessageHandler('kick {targets:member...}')
      async list(_m: Message, _p: { targets: GuildMember }) {
        return undefined
      }

      // @ts-expect-error a word the choices do not have
      @MessageHandler('mode {m:on|off}')
      async choice(_m: Message, _p: { m: 'on' | 'auto' }) {
        return undefined
      }
    }
    void Typed
  })

  it('reads the params guards see with ParamRefsOf: entities as refs, everything else as its value', () => {
    type Refs = ParamRefsOf<'ban {target:member} {days:int?} {--by:user?} {also:role...?} {mode:on|off?}'>
    expectTypeOf<Refs['target']>().toEqualTypeOf<EntityRef<GuildMember>>()
    expectTypeOf<Refs['days']>().toEqualTypeOf<number | undefined>()
    expectTypeOf<Refs['by']>().toEqualTypeOf<EntityRef<User> | undefined>()
    expectTypeOf<Refs['also']>().toEqualTypeOf<EntityRef<Role>[] | undefined>()
    expectTypeOf<Refs['mode']>().toEqualTypeOf<'on' | 'off' | undefined>()
    // An app's own type is its value, or the ref its parse gives
    expectTypeOf<ParamRefsOf<'paint {shade:color}'>['shade']>().toEqualTypeOf<number | EntityRef<number>>()

    class BanGuard {
      async canActivate(message: Message, { target }: ParamRefsOf<'ban {target:member} {reason...?}'>) {
        if (!message.member?.permissions.has('BanMembers')) return false
        const member = target.cached ?? (await target.resolve())
        return !member || member.roles.highest.position < message.member.roles.highest.position
      }
    }
    void BanGuard
  })

  it('reads the params a pattern gives with ParamsOf', () => {
    expectTypeOf<ParamsOf<'ban {target:member} {duration:duration?} {reason...?}'>>().toEqualTypeOf<
      { target: GuildMember } & { duration?: number; reason?: string }
    >()
    expectTypeOf<ParamsOf<'hello'>>().toEqualTypeOf<{} & {}>()
    expectTypeOf<ParamsOf<'purge {count:int} {--bots} {--from:user?} {ids:member...?}'>>().toEqualTypeOf<
      { count: number; bots: boolean } & { from?: User; ids?: GuildMember[] }
    >()
    // Compared flattened: a literal `{ ... } & {}` reduces to its left side, while ParamsOf's two mapped halves
    // stay an intersection, which expectTypeOf tells apart from a plain object. Flattening keeps each key's
    // modifiers, so a readonly array, an optional key or an index signature would still fail here.
    type Flat<T> = { [K in keyof T]: T[K] }
    expectTypeOf<Flat<ParamsOf<'poll {question} {options:string...}'>>>().toEqualTypeOf<{ question: string; options: string[] }>()
  })
})
