import * as discord from 'discord.js'
import { AuthorizingIntegrationOwners, ButtonInteraction, Guild, Message, Sticker, TextChannel, User } from 'discord.js'
import { createMockChannel, createMockClient, createMockGuild, createMockInteraction, createMockMessage, createMockUser } from '@src/testing/index.js'
import { Logger } from '@src/common/index.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { themeTargets } from '@src/core/theme-resolvers.js'
import { asMockCode } from '@src/testing/mock-code.js'
import { quietReads } from '@src/util/quiet-reads.util.js'
import { classFields } from '@src/testing/class-fields.js'
import { forgetStrictMocks, useStrictMocks } from '@src/testing/strict-mocks.js'
import { CHECKED_CLASSES, declaredProperties, discordTypings } from '../../scripts/lib/declared-fields.js'

// A mock answers a key its discord.js class does not have as discord.js does under strict mocks: undefined, and `in`
// false; a key the class has, from its prototype or assigned by its source, answers as before (meocord#994)

beforeEach(() => forgetStrictMocks())
afterEach(() => {
  forgetStrictMocks()
  vi.restoreAllMocks()
})

/** A mock of each kind the issue names, and what it is asked about. */
const mocks = () => ({ message: createMockMessage(), channel: createMockChannel(TextChannel), user: createMockUser(), guild: createMockGuild() })
type Loose = Record<string, unknown> & { isRepliable?: () => boolean; isAutocomplete?: () => boolean }

describe('under strict mocks', () => {
  beforeEach(() => useStrictMocks())

  it('a message answers undefined for a property its class lacks', () => {
    const message = createMockMessage() as unknown as { isAutocomplete?: unknown; isRepliable?: () => boolean }
    expect(message.isAutocomplete).toBeUndefined()
    expect(message.isRepliable?.()).toBeUndefined()
  })

  it('a channel answers undefined for a property its class lacks', () => {
    const channel = createMockChannel(TextChannel) as unknown as { notAThing?: unknown }
    expect(channel.notAThing).toBeUndefined()
  })

  it("a message has its class's fields", () => {
    expect('content' in createMockMessage()).toBe(true)
  })

  it('answers isRepliable?.() and isAutocomplete?.() with undefined on a message, a channel, a user and a guild', () => {
    const answers = Object.entries(mocks()).map(([kind, mock]) => {
      const loose = mock as unknown as Loose
      return [kind, loose.isRepliable?.(), loose.isAutocomplete?.()]
    })

    expect(answers).toEqual([
      ['message', undefined, undefined],
      ['channel', undefined, undefined],
      ['user', undefined, undefined],
      ['guild', undefined, undefined],
    ])
  })

  it('reads a field the class has and the mock does not compute as before, and holds it `in`', () => {
    const message = createMockMessage() as unknown as Loose

    expect(message.nonce).toBeTypeOf('object')
    expect('nonce' in message).toBe(true)
  })

  it("reads a test's own property, given or assigned later", () => {
    const press = createMockInteraction(ButtonInteraction, { ticket: 'given' } as never) as unknown as Loose
    press.later = 'assigned'

    expect([press.ticket, press.later, 'ticket' in press, 'later' in press]).toEqual(['given', 'assigned', true, true])
  })

  it('answers `in` for an own key, a field, a prototype key and a key the class lacks', () => {
    const message = createMockMessage()

    expect(['id', 'content', 'reply', 'notAThing'].map(key => key in message)).toEqual([true, true, true, false])
  })

  it('keeps `then` undefined and symbols as the class has them', () => {
    const message = createMockMessage() as unknown as Record<PropertyKey, unknown>

    expect(message.then).toBeUndefined()
    expect('then' in message).toBe(false)
    expect(message[Symbol.toPrimitive]).toBeUndefined()
  })

  it('reads a key the class lacks again as undefined, then what a test assigns or defines, then undefined once deleted', () => {
    const message = createMockMessage() as unknown as Loose

    const reads = [message.notAThing, message.notAThing]
    message.notAThing = 'assigned'
    reads.push(message.notAThing, 'notAThing' in message)
    delete message.notAThing
    reads.push(message.notAThing, 'notAThing' in message)
    Object.defineProperty(message, 'notAThing', { value: 'defined', configurable: true })
    reads.push(message.notAThing)

    expect(reads).toEqual([undefined, undefined, 'assigned', true, undefined, false, 'defined'])
  })

  it('reads a key its class gains on the prototype after the mock read it absent, as discord.js does', () => {
    const prototype = Message.prototype as unknown as Record<string, unknown>
    const message = createMockMessage() as unknown as Loose
    const reads = [typeof message.appHelper]
    prototype.appHelper = function appHelper() {
      return 'helped'
    }
    try {
      reads.push(typeof message.appHelper, typeof (createMockMessage() as unknown as Loose).appHelper)
    } finally {
      delete prototype.appHelper
    }

    expect(reads).toEqual(['undefined', 'function', 'function'])
  })

  it('reads undefined for a key the prototype held and lost before the mock read it', () => {
    const prototype = Message.prototype as unknown as Record<string, unknown>
    const read = createMockMessage() as unknown as Loose
    const unread = createMockMessage() as unknown as Loose
    void read.lostHelper
    prototype.lostHelper = () => 'helped'
    delete prototype.lostHelper

    expect([read.lostHelper, unread.lostHelper]).toEqual([undefined, undefined])
  })

  it("runs the mock's own code unmarked, since nothing warns", () => {
    expect(asMockCode(() => quietReads())).toBe(false)
  })

  it('reads a key it found absent as a placeholder once strict mocks are forgotten', () => {
    const message = createMockMessage() as unknown as Loose
    void message.notAThing
    forgetStrictMocks()

    expect(message.notAThing).toBeTypeOf('object')
  })

  it("keeps a placeholder for a key a subclass's mock lacks, whose fields can't be read from its source", () => {
    // discord.js types Message's constructor private; an app's subclass extends the class all the same
    class Ticket extends (Message as unknown as new () => object) {
      note = 'open'
      describe(): string {
        return 'ticket'
      }
    }
    const ticket = createMockInteraction(Ticket as never) as unknown as Loose

    expect(ticket.describe).toBeTypeOf('function')
    expect(ticket.notAThing).toBeTypeOf('object')
    expect(ticket.isRepliable).toBeTypeOf('object')
  })

  it('keeps a placeholder for a class that sets fields under computed keys, which its source does not name', () => {
    const owners = createMockInteraction(AuthorizingIntegrationOwners as never) as unknown as Loose

    expect(classFields(AuthorizingIntegrationOwners.prototype)).toBeNull()
    expect(owners['0']).toBeTypeOf('object')
    expect(classFields(Message.prototype)).not.toBeNull()
  })

  it("keeps a placeholder for a class whose source can't be read", () => {
    const toString = Function.prototype.toString
    vi.spyOn(Function.prototype, 'toString').mockImplementation(function (this: () => unknown) {
      return (this as unknown) === Sticker ? 'function Sticker() { [native code] }' : toString.call(this)
    })
    const sticker = createMockInteraction(Sticker as never) as unknown as Loose

    expect(classFields(Sticker.prototype)).toBeNull()
    expect(sticker.notAThing).toBeTypeOf('object')
  })
})

describe('without strict mocks', () => {
  let warned: string[]
  const absentWarnings = () => warned.filter(text => text.includes('reads a placeholder here; discord.js'))

  beforeEach(() => {
    forgetDeprecationWarnings()
    warned = []
    vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  })

  it('keeps the placeholder for a key the class lacks, and `in` as it answers today', () => {
    const message = createMockMessage() as unknown as Loose

    expect(message.isAutocomplete).toBeTypeOf('object')
    expect(['id', 'content', 'reply', 'notAThing'].map(key => key in message)).toEqual([true, false, true, false])
  })

  it("warns once for a test's reads of keys the class lacks, naming the first, strict mocks and 5.0", () => {
    const message = createMockMessage() as unknown as Loose
    const channel = createMockChannel(TextChannel) as unknown as Loose

    void message.isAutocomplete
    void channel.notAThing
    void message.isAutocomplete

    expect(absentWarnings()).toEqual([
      "A mock Message's isAutocomplete reads a placeholder here; discord.js's Message has no isAutocomplete, and under " +
        'useStrictMocks() it reads undefined, as on discord.js. In the next major version (5.0) it does so without the ' +
        'call (https://github.com/meocord/meocord/issues/441).',
    ])
  })

  it('warns for no read of a key the class has, from its prototype, its source or the test', () => {
    const press = createMockInteraction(ButtonInteraction, { ticket: 'given' } as never) as unknown as Loose

    void [press.customId, press.reply, press.message, press.ticket, press.then]

    expect(absentWarnings()).toEqual([])
  })

  it("warns for no read by MeoCord, an event argument's server and user read for its theme", () => {
    expect(themeTargets([createMockUser(), createMockUser({ id: '21' })])).toEqual({ guildId: undefined, userId: '21' })
    expect(absentWarnings()).toEqual([])
  })

  it("warns for no read by the mock's own code, a user manager's DM channel", async () => {
    await createMockClient().users.createDM(undefined as never)

    expect(absentWarnings()).toEqual([])
  })

  it("marks the mock's own code while it runs, and no longer", () => {
    expect([asMockCode(() => quietReads()), quietReads()]).toEqual([true, false])
  })

  it('warns for no read the mock makes in discord.js code', () => {
    const message = createMockMessage() as unknown as Loose

    asMockCode(() => [message.isAutocomplete, message.isRepliable])

    expect(absentWarnings()).toEqual([])
  })

  it("warns once a test reads a key the class lacks that the mock's own code read first", () => {
    const message = createMockMessage() as unknown as Loose

    asMockCode(() => message.isAutocomplete)
    expect(absentWarnings()).toEqual([])
    void [message.isAutocomplete, message.isAutocomplete]

    expect(absentWarnings()).toEqual([expect.stringContaining("A mock Message's isAutocomplete reads a placeholder here")])
  })

  it('warns again of both for a placeholder its class lacks, read by a mock kept across tests that forget warnings', () => {
    const message = createMockMessage() as unknown as Loose
    void message.channel_id
    forgetDeprecationWarnings()
    warned = []

    void message.channel_id

    expect([warned.some(text => text.startsWith('Message.channel_id reads a placeholder')), absentWarnings().length]).toEqual([true, 1])
  })

  it("warns for no read of a subclass's mock, whose fields can't be read", () => {
    class Ticket extends (Message as unknown as new () => object) {}
    void (createMockInteraction(Ticket as never) as unknown as Loose).notAThing

    expect(absentWarnings()).toEqual([])
  })

  it('warns nothing under strict mocks, where the read gives undefined', () => {
    useStrictMocks()
    void (createMockMessage() as unknown as Loose).isAutocomplete

    expect(absentWarnings()).toEqual([])
  })
})

describe("the field scan against discord.js's typings", () => {
  it('finds every public property the typings declare, in the source or on the prototype', () => {
    const declared = declaredProperties(discordTypings(import.meta.url))
    const missed = CHECKED_CLASSES.map(name => {
      const prototype = (discord as unknown as Record<string, { prototype: object }>)[name]!.prototype
      const fields = classFields(prototype)!
      return [name, (declared[name] ?? []).filter(key => !fields.has(key) && !(key in prototype))]
    })

    expect(Object.keys(declared)).toHaveLength(CHECKED_CLASSES.length)
    expect(missed).toEqual(CHECKED_CLASSES.map(name => [name, []]))
  })

  it('reads a field of each class from its source', () => {
    expect([Message, Guild, User].map(cls => classFields(cls.prototype)?.has('id'))).toEqual([true, true, true])
  })
})
