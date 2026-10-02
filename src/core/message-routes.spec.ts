import { Controller, MessageHandler } from '@src/decorator/index.js'
import { buildMessageRoutes, matchMessageCommand, matchMessageRoute, parseMessagePattern, type MessageStarts } from '@src/core/message-routes.js'

const RAW: MessageStarts = { prefixes: [''] }

/** The params a pattern captures from content with no prefix, or `undefined` when it does not match. */
function capture(pattern: string, content: string, caseSensitive = false) {
  @Controller()
  class Only {
    @MessageHandler(pattern, { caseSensitive })
    handle() {}
  }
  return matchMessageRoute(buildMessageRoutes([Only]), content, RAW)?.params
}

describe('message patterns', () => {
  it('matches a plain pattern as the whole message, word for word', () => {
    expect(capture('hello', 'hello')).toEqual({})
    expect(capture('hello there', 'hello   there')).toEqual({})
    expect(capture('hello', 'hello there')).toBeUndefined()
    expect(capture('hello there', 'hello')).toBeUndefined()
  })

  it('captures one word per {name}', () => {
    expect(capture('roll {sides}', 'roll 20')).toEqual({ sides: '20' })
    expect(capture('give {user} {amount}', 'give ana 5')).toEqual({ user: 'ana', amount: '5' })
    expect(capture('roll {sides}', 'roll')).toBeUndefined()
    expect(capture('roll {sides}', 'roll 20 30')).toBeUndefined()
  })

  it('takes quoted words as one param, without the quotes, straight or curly', () => {
    expect(capture('tag {name} {value}', 'tag "two words" 5')).toEqual({ name: 'two words', value: '5' })
    expect(capture('tag {name}', 'tag “smart quotes”')).toEqual({ name: 'smart quotes' })
    expect(capture('tag {name}', 'tag ""')).toEqual({ name: '' })
  })

  it('reads a command word given in quotes, straight or curly, as the word', () => {
    @Controller()
    class Quoted {
      @MessageHandler('roll {sides}')
      roll() {}

      @MessageHandler('purge {count} {--bots}')
      purge() {}
    }
    const routes = buildMessageRoutes([Quoted], { prefix: '!' })
    const starts: MessageStarts = { prefixes: ['!'] }

    expect(matchMessageRoute(routes, '!"roll" 20', starts)?.params).toEqual({ sides: '20' })
    expect(matchMessageRoute(routes, '!“roll” 20', starts)?.params).toEqual({ sides: '20' })
    expect(matchMessageRoute(routes, '!“purge” 5 --bots', starts)?.params).toEqual({ count: '5', bots: '' })
    expect(matchMessageCommand(routes, '!“roll”', starts)).toMatchObject({ route: { method: 'roll' }, given: 0 })
  })

  it('reads an unclosed quote as an ordinary character', () => {
    expect(capture('tag {name} {value}', 'tag "open 5')).toEqual({ name: '"open', value: '5' })
  })

  it('gives {name...} the rest of the message as typed', () => {
    expect(capture('roll {sides} {note...}', 'roll 20 for  "initiative" ok')).toEqual({
      sides: '20',
      note: 'for  "initiative" ok',
    })
    expect(capture('say {text...}', 'say   hi')).toEqual({ text: 'hi' })
    expect(capture('say {text...}', 'say')).toBeUndefined()
  })

  it('leaves out an optional last param the message does not give', () => {
    expect(capture('ban {user} {reason?}', 'ban ana')).toEqual({ user: 'ana' })
    expect(capture('ban {user} {reason?}', 'ban ana spam')).toEqual({ user: 'ana', reason: 'spam' })
    expect(capture('ban {user} {reason?}', 'ban ana spam again')).toBeUndefined()
    expect(capture('ban {user} {reason...?}', 'ban ana')).toEqual({ user: 'ana' })
    expect(capture('ban {user} {reason...?}', 'ban ana spam again')).toEqual({ user: 'ana', reason: 'spam again' })
  })

  it('gives trailing optional params the words that fit them, left to right', () => {
    const ban = 'ban {target:member} {duration:duration?} {reason...?}'
    expect(capture(ban, 'ban <@200000000000000001> spamming again')).toEqual({ target: '<@200000000000000001>', reason: 'spamming again' })
    expect(capture(ban, 'ban <@200000000000000001> 7d spamming')).toEqual({ target: '<@200000000000000001>', duration: '7d', reason: 'spamming' })
    expect(capture(ban, 'ban <@200000000000000001> 7d')).toEqual({ target: '<@200000000000000001>', duration: '7d' })
    expect(capture(ban, 'ban <@200000000000000001>')).toEqual({ target: '<@200000000000000001>' })

    const lights = 'lights {mode:on|off?} {room?}'
    expect(capture(lights, 'lights kitchen')).toEqual({ room: 'kitchen' })
    expect(capture(lights, 'lights OFF kitchen')).toEqual({ mode: 'OFF', room: 'kitchen' })
    expect(capture(lights, 'lights on')).toEqual({ mode: 'on' })
    // The last optional takes any word, so a word of the wrong type is reported rather than dropped
    expect(capture('set {level:int?} {on:bool?}', 'set maybe')).toEqual({ on: 'maybe' })
  })

  it('matches no trailing optionals when words are left over, and minds case in choices when told to', () => {
    expect(capture('lights {mode:on|off?} {room?}', 'lights kitchen hall')).toBeUndefined()
    expect(capture('lights {mode:on|off?} {room?}', 'lights OFF kitchen', true)).toBeUndefined()
    expect(capture('x {a:int?} {b:bool?} {c...?}', 'x yes and more')).toEqual({ b: 'yes', c: 'and more' })
    expect(capture('x {a:int?} {b:bool?} {c...?}', 'x 3 more')).toEqual({ a: '3', c: 'more' })
  })

  it('reads flags anywhere after the command word, apart from the words', () => {
    const purge = 'purge {count:int} {--bots} {--from:user?}'
    expect(capture(purge, 'purge --bots 50')).toEqual({ count: '50', bots: '' })
    expect(capture(purge, 'purge 50 --from=<@1> --BOTS')).toEqual({ count: '50', from: '<@1>', bots: '' })
    expect(capture(purge, 'purge 50 --unknown')).toEqual({ count: '50' })
    expect(capture(purge, 'purge --bots')).toBeUndefined()
    expect(capture('remind {after} {--note:string?}', 'remind 10m --note="buy milk"')).toEqual({ after: '10m', note: 'buy milk' })
  })

  it('leaves the flags out of a rest, keeps a quoted flag as text, and reads no flags for a pattern without any', () => {
    expect(capture('note {text...} {--pin}', 'note buy  milk --pin now')).toEqual({ text: 'buy  milk now', pin: '' })
    expect(capture('note {text...} {--pin}', 'note line one\n--pin\nline two')).toEqual({ text: 'line one\nline two', pin: '' })
    expect(capture('note {text...} {--pin}', 'note a\n\nb --pin')).toEqual({ text: 'a\n\nb', pin: '' })
    expect(capture('note {text...} {--pin}', 'note "--pin" is a flag')).toEqual({ text: '"--pin" is a flag' })
    expect(capture('say {text...}', 'say --loud hello')).toEqual({ text: '--loud hello' })
    expect(capture('echo {word}', 'echo --x')).toEqual({ word: '--x' })
  })

  it('reads flags only in a message naming a command that has them, after its first word', () => {
    @Controller()
    class Mixed {
      @MessageHandler('purge {count} {--bots}')
      purge() {}

      @MessageHandler('say {text...}')
      say() {}
    }
    @Controller()
    class Poke {
      @MessageHandler('{target} {--ping}')
      poke() {}
    }
    const reach = (controllers: (new () => unknown)[], content: string) => {
      const matched = matchMessageRoute(buildMessageRoutes(controllers), content, RAW)
      return matched && [matched.route.method, matched.params]
    }

    expect(reach([Mixed], 'say --loud hi')).toEqual(['say', { text: '--loud hi' }])
    expect(reach([Mixed], 'purge 5 --bots')).toEqual(['purge', { count: '5', bots: '' }])
    expect(reach([Mixed], '--bots purge 5')).toBeUndefined()
    // A pattern that begins with a param may be named by any word, so every message is read for its flags
    expect(reach([Poke], 'ana --ping')).toEqual(['poke', { target: 'ana', ping: '' }])
    expect(reach([Poke], '--ping ana')).toEqual(['poke', { target: 'ana', ping: '' }])
  })

  it('reads a flag before the command words for no command, whatever other routes the app has', () => {
    @Controller()
    class Purge {
      @MessageHandler('purge {count} {--bots}')
      purge() {}
    }
    @Controller()
    class Poke {
      @MessageHandler('{target} {--ping}')
      poke() {}
    }
    const starts: MessageStarts = { prefixes: ['!'] }
    for (const controllers of [[Purge], [Purge, Poke]]) {
      const routes = buildMessageRoutes(controllers, { prefix: '!' })
      expect(matchMessageRoute(routes, '!--bots purge 5', starts)).toBeUndefined()
      expect(matchMessageCommand(routes, '!--bots purge', starts)).toBeUndefined()
      expect(matchMessageRoute(routes, '!purge 5 --bots', starts)?.params).toEqual({ count: '5', bots: '' })
    }
    const routes = buildMessageRoutes([Purge, Poke], { prefix: '!' })
    expect(matchMessageRoute(routes, '!--ping ana', starts)).toMatchObject({ route: { method: 'poke' }, params: { target: 'ana', ping: '' } })
  })

  it('gives the start a message used when it has flags', () => {
    @Controller()
    class Purge {
      @MessageHandler('purge {count} {--bots}')
      purge() {}
    }
    expect(matchMessageRoute(buildMessageRoutes([Purge]), '!  purge --bots 5', { prefixes: ['!'] })?.start).toBe('!  ')
  })

  it('refuses a flag whose name a message could not give, one not starting with a letter', () => {
    expect(() => parseMessagePattern('auth {--2fa}')).toThrow(/\{--2fa\}: a flag's name starts with a letter/)
    expect(() => parseMessagePattern('auth {--_x:int?}')).toThrow(/\{--_x:int\?\}: a flag's name starts with a letter/)
    expect(() => parseMessagePattern('auth {--x2_y}')).not.toThrow()
  })

  it('refuses an untyped flag marked optional, a name a param and a flag share, and a pattern of flags alone', () => {
    expect(() => parseMessagePattern('purge {--bots?}')).toThrow(/\{--bots\?\}: a flag without a type is optional already/)
    expect(() => parseMessagePattern('warn {user} {--user:user}')).toThrow(/\{user\} appears twice/)
    expect(() => parseMessagePattern('{--all}')).toThrow(/a pattern needs a word besides its flags/)
    expect(parseMessagePattern('purge {--bots} {count:int} {--from:user?}').flags).toEqual([
      { flag: 'bots', optional: false },
      { flag: 'from', type: 'user', optional: true },
    ])
  })

  it('refuses an untyped optional param before another, which would take every word', () => {
    expect(() => parseMessagePattern('ban {user} {days?} {reason...?}')).toThrow(/\{days\?\} comes before another optional param, so it needs a type/)
    expect(() => parseMessagePattern('ban {user} {days:string?} {reason?}')).toThrow(/\{days:string\?\} comes before another optional param/)
    expect(() => parseMessagePattern('ban {user} {days:int?} {reason...?}')).not.toThrow()
  })

  it('matches literal words in any case by default, and param values as written', () => {
    expect(capture('roll {sides}', 'ROLL D20')).toEqual({ sides: 'D20' })
    expect(capture('roll {sides}', 'ROLL 20', true)).toBeUndefined()
    expect(capture('Roll {sides}', 'Roll 20', true)).toEqual({ sides: '20' })
  })

  it('refuses a pattern that cannot be read', () => {
    expect(() => parseMessagePattern('say {text...} now')).toThrow(/\{text\.\.\.\} takes the rest of the message, so it must be last/)
    expect(() => parseMessagePattern('give {user} {user}')).toThrow(/\{user\} appears twice/)
    expect(() => parseMessagePattern('ban {reason?} {user}')).toThrow(/\{reason\?\} is optional, so only optional params may follow it; "\{user\}" is not/)
    expect(() => parseMessagePattern('ban {reason?} now')).toThrow(/only optional params may follow it; "now" is not/)
    expect(() => parseMessagePattern('roll d{sides}')).toThrow(/"d\{sides\}".*a whole word/)
    expect(() => parseMessagePattern('roll {si-des}')).toThrow(/"\{si-des\}".*a whole word/)
  })
})

describe('message route ranking', () => {
  @Controller()
  class Dice {
    @MessageHandler('{anything...}')
    anything() {}

    @MessageHandler('roll {sides} {note...}')
    rollWithNote() {}

    @MessageHandler('roll {sides}')
    roll() {}

    @MessageHandler('roll 20')
    rollTwenty() {}

    @MessageHandler('roll {sides} {times?}')
    rollTimes() {}

    @MessageHandler('{verb} 6')
    anyVerbSix() {}

    @MessageHandler('roll {a} {b}')
    rollTwo() {}
  }

  const routes = buildMessageRoutes([Dice])
  const winner = (content: string) => matchMessageRoute(routes, content, RAW)?.route.method

  it('prefers literal words over params, and more literal words over fewer', () => {
    expect(winner('roll 20')).toBe('rollTwenty')
    expect(winner('roll 12')).toBe('roll')
    expect(winner('hello world')).toBe('anything')
  })

  it('prefers a fixed number of words over the rest, and a given param over an optional one', () => {
    expect(winner('roll 12 3')).toBe('rollTwo')
    expect(winner('roll 12 for luck')).toBe('rollWithNote')
  })

  it('breaks a tie of equal rank by the first word that differs, literal first', () => {
    expect(winner('roll 6')).toBe('roll')
    expect(winner('flip 6')).toBe('anyVerbSix')
  })

  it('ranks across controllers, whatever order they are listed in', () => {
    @Controller()
    class Loose {
      @MessageHandler('roll {sides}')
      loose() {}
    }
    @Controller()
    class Exact {
      @MessageHandler('roll 20')
      exact() {}
    }
    for (const order of [
      [Loose, Exact],
      [Exact, Loose],
    ]) {
      expect(matchMessageRoute(buildMessageRoutes(order), 'roll 20', RAW)?.route.method).toBe('exact')
    }
  })

  it('refuses two patterns that match exactly the same messages', () => {
    @Controller()
    class First {
      @MessageHandler('roll {sides}')
      roll() {}
    }
    @Controller()
    class Second {
      @MessageHandler('ROLL {count}')
      alsoRoll() {}
    }
    expect(() => buildMessageRoutes([First, Second])).toThrow(
      /First\.roll: "roll \{sides\}" and "ROLL \{count\}" in Second\.alsoRoll match the same messages/,
    )
  })

  it('keeps one route for a handler declared under two spellings of one pattern', () => {
    @Controller()
    class Greeting {
      @MessageHandler('hello')
      @MessageHandler('Hello')
      greet() {}
    }
    const routes = buildMessageRoutes([Greeting])
    expect(routes.map(route => route.method)).toEqual(['greet'])
    expect(matchMessageRoute(routes, 'HELLO', RAW)?.route.method).toBe('greet')
  })

  it('tells apart patterns that differ only in case when both are case-sensitive, or in their prefix', () => {
    @Controller()
    class Cased {
      @MessageHandler('Roll', { caseSensitive: true })
      upper() {}

      @MessageHandler('roll', { caseSensitive: true })
      lower() {}

      @MessageHandler('roll', { prefix: '?' })
      question() {}
    }
    expect(() => buildMessageRoutes([Cased], { prefix: '!' })).not.toThrow()
  })

  it('matches an alias in place of the command words, with the same params, ranked as its own words are', () => {
    @Controller()
    class Config {
      @MessageHandler('config set {key} {value...}', { aliases: ['cs', 'cfg set'] })
      set() {}

      @MessageHandler('cs reload')
      reload() {}
    }
    const routes = buildMessageRoutes([Config])
    const reach = (content: string) => {
      const matched = matchMessageRoute(routes, content, RAW)
      return matched && [matched.route.method, matched.params]
    }

    expect(reach('config set lang en')).toEqual(['set', { key: 'lang', value: 'en' }])
    expect(reach('CS lang en')).toEqual(['set', { key: 'lang', value: 'en' }])
    expect(reach('cfg set prefix ?')).toEqual(['set', { key: 'prefix', value: '?' }])
    expect(reach('cs reload')).toEqual(['reload', {}])
    expect(routes.find(route => route.pattern === 'cs {key} {value...}')?.aliasOf).toBe('config set {key} {value...}')
  })

  it("keeps a handler's own pattern over an alias spelled the same, and refuses an alias another command has", () => {
    @Controller()
    class Same {
      @MessageHandler('ping', { aliases: ['PING'] })
      ping() {}
    }
    expect(buildMessageRoutes([Same]).map(route => [route.pattern, route.aliasOf])).toEqual([['ping', undefined]])

    @Controller()
    class Clash {
      @MessageHandler('ban {target}', { aliases: ['b'] })
      ban() {}

      @MessageHandler('b {page}')
      browse() {}
    }
    expect(() => buildMessageRoutes([Clash])).toThrow(/Clash\.ban: "b \{target\}", an alias of "ban \{target\}", and "b \{page\}" in Clash\.browse match the same messages/)
  })

  it('keeps flags written between the command words when it compiles an alias', () => {
    @Controller()
    class Config {
      @MessageHandler('config {--dry} set {key}', { aliases: ['cs'] })
      set() {}
    }
    const routes = buildMessageRoutes([Config])
    expect(routes.map(route => route.pattern)).toEqual(['config {--dry} set {key}', 'cs {--dry} {key}'])
    expect(matchMessageRoute(routes, 'cs lang --dry', RAW)?.params).toEqual({ key: 'lang', dry: '' })
  })

  it('refuses an alias that is not command words, for a pattern without them, and a scope that is not one', () => {
    const build = (pattern: string, options: object) => {
      @Controller()
      class Only {
        @MessageHandler(pattern, options)
        handle() {}
      }
      return () => buildMessageRoutes([Only])
    }
    expect(build('ban {target}', { aliases: ['b {x}'] })).toThrow(/Only\.handle: @MessageHandler\('ban \{target\}'\): "b \{x\}" is not an alias/)
    expect(build('ban {target}', { aliases: [' '] })).toThrow(/" " is not an alias/)
    expect(build('ban {target}', { aliases: 'b' })).toThrow(/aliases takes a list of command words/)
    expect(build('{word}', { aliases: ['w'] })).toThrow(/this one begins with a param/)
    expect(build('ban {target}', { scope: 'server' })).toThrow(/scope is 'guild', 'dm' or 'any', not "server"/)
    expect(build('ban {target:member}', { scope: 'dm' })).toThrow(/scope is 'dm', but \{target:member\} is found only in a server/)
    expect(build('whois {target:user}', { scope: 'dm' })).not.toThrow()
    expect(build('whois {--in:channel?}', { scope: 'dm' })).toThrow(/scope is 'dm', but \{--in:channel\} is found only in a server/)
    expect(build('status', { mention: true })).toThrow(/mention is 'only', not true/)
    expect(build('status', { mention: 'only', prefix: '?' })).not.toThrow()
    expect(build('status', { mention: 'only' })).not.toThrow()
  })

  it("refuses a handler's mention: 'only' beside the same pattern the app's mention: 'only' starts alike", () => {
    @Controller()
    class Own {
      @MessageHandler('status', { mention: 'only' })
      status() {}
    }
    @Controller()
    class App {
      @MessageHandler('status')
      status() {}
    }
    expect(() => buildMessageRoutes([Own, App], { mention: 'only' })).toThrow(/match the same messages, so only one of them could ever answer those/)
    // Under the app's prefix, both start with it in a DM, unless the one without mention: 'only' works in servers only
    expect(() => buildMessageRoutes([Own, App], { prefix: '!' })).toThrow(/match the same messages/)
    @Controller()
    class ServerOnly {
      @MessageHandler('status', { scope: 'guild' })
      status() {}
    }
    expect(() => buildMessageRoutes([Own, ServerOnly], { prefix: '!' })).not.toThrow()
  })

  it('keeps handlers of one pattern in scopes that do not overlap, and picks by where the message was sent', () => {
    @Controller()
    class Help {
      @MessageHandler('help', { scope: 'guild' })
      guild() {}

      @MessageHandler('help', { scope: 'dm' })
      dm() {}
    }
    @Controller()
    class Everywhere {
      @MessageHandler('help')
      any() {}
    }
    const routes = buildMessageRoutes([Help])
    const reach = (inGuild: boolean | undefined) => matchMessageRoute(routes, 'help', { ...RAW, inGuild })?.route.method

    expect([reach(true), reach(false)]).toEqual(['guild', 'dm'])
    expect(() => buildMessageRoutes([Help, Everywhere])).toThrow(/match the same messages/)
  })

  it('leaves listeners out of the table', () => {
    @Controller()
    class Listener {
      @MessageHandler()
      all() {}
    }
    expect(buildMessageRoutes([Listener])).toEqual([])
  })
})

describe('message starts', () => {
  @Controller()
  class Commands {
    @MessageHandler('roll {sides}')
    roll() {}

    @MessageHandler('hello', { prefix: false })
    hello() {}

    @MessageHandler('ping', { prefix: ['?', '??'] })
    ping() {}

    @MessageHandler('echo {text...}', { caseSensitive: true })
    echo() {}
  }

  const routes = buildMessageRoutes([Commands])
  const match = (content: string, starts: MessageStarts) => {
    const matched = matchMessageRoute(routes, content, starts)
    return matched && [matched.route.method, matched.params]
  }

  it('strips any of the prefixes, the longest first, with or without a space after it', () => {
    const starts: MessageStarts = { prefixes: ['!', 'bot '] }
    expect(match('!roll 20', starts)).toEqual(['roll', { sides: '20' }])
    expect(match('! roll 20', starts)).toEqual(['roll', { sides: '20' }])
    expect(match('bot roll 6', starts)).toEqual(['roll', { sides: '6' }])
    expect(match('roll 20', starts)).toBeUndefined()
    expect(match('!', starts)).toBeUndefined()
  })

  it('matches the prefix in any case unless the handler is case-sensitive', () => {
    expect(match('BOT roll 6', { prefixes: ['bot '] })).toEqual(['roll', { sides: '6' }])
    expect(match('BOT echo hi', { prefixes: ['bot '] })).toBeUndefined()
    expect(match('bot echo Hi', { prefixes: ['bot '] })).toEqual(['echo', { text: 'Hi' }])
  })

  it('accepts a mention of the bot as a start, alongside the prefixes', () => {
    const starts: MessageStarts = { prefixes: ['!'], mention: '111' }
    expect(match('<@111> roll 20', starts)).toEqual(['roll', { sides: '20' }])
    expect(match('<@!111>roll 20', starts)).toEqual(['roll', { sides: '20' }])
    expect(match('!roll 20', starts)).toEqual(['roll', { sides: '20' }])
    expect(match('<@222> roll 20', starts)).toBeUndefined()
  })

  it('keeps unprefixed messages matching when a mention is the only start configured', () => {
    const starts: MessageStarts = { prefixes: [''], mention: '111' }
    expect(match('roll 20', starts)).toEqual(['roll', { sides: '20' }])
    expect(match('<@111> roll 20', starts)).toEqual(['roll', { sides: '20' }])
  })

  it("uses a handler's own prefixes in place of the app's, keeping the mention", () => {
    const starts: MessageStarts = { prefixes: ['!'], mention: '111' }
    expect(match('?ping', starts)).toEqual(['ping', {}])
    expect(match('??ping', starts)).toEqual(['ping', {}])
    expect(match('!ping', starts)).toBeUndefined()
    expect(match('<@111> ping', starts)).toEqual(['ping', {}])
  })

  it("matches a handler whose own prefix is '' without one, beside handlers with and without prefixes", () => {
    @Controller()
    class Mixed {
      @MessageHandler('ping')
      ping() {}

      @MessageHandler('echo {text...}', { prefix: '' })
      echo() {}

      @MessageHandler('roll', { prefix: ['?', ''] })
      roll() {}

      @MessageHandler('hello', { prefix: false })
      hello() {}
    }
    const mixed = buildMessageRoutes([Mixed])
    const reach = (content: string) => matchMessageRoute(mixed, content, { prefixes: ['!'], mention: '111' })?.route.method

    expect(['!ping', 'echo hi', '<@111> echo hi', '?roll', 'roll', 'hello'].map(reach)).toEqual(['ping', 'echo', 'echo', 'roll', 'roll', 'hello'])
    expect(['ping', '!echo hi', 'chat that matches nothing'].map(reach)).toEqual([undefined, undefined, undefined])
  })

  it('matches a handler with prefix: false against the message as it is, never after a mention', () => {
    const starts: MessageStarts = { prefixes: ['!'], mention: '111' }
    expect(match('hello', starts)).toEqual(['hello', {}])
    expect(match('!hello', starts)).toBeUndefined()
    expect(match('<@111> hello', starts)).toBeUndefined()
  })
})
