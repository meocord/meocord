import { vi } from 'vitest'

const { config } = vi.hoisted(() => ({ config: { current: undefined as { commands?: object } | undefined } }))
vi.mock('@src/util/meocord-config-loader.util.js', () => ({ loadMeoCordConfig: () => config.current }))

import {
  ApplicationCommandType,
  ChatInputCommandInteraction,
  ContextMenuCommandBuilder,
  Guild,
  RESTJSONErrorCodes,
  SlashCommandBuilder,
} from 'discord.js'
import { commandMention } from '@src/common/command-mention.js'
import { COMMAND_REFETCH_INTERVAL_MS } from '@src/core/command-ids.js'
import { MeoCordApp } from '@src/core/meocord.app.js'
import { registerClientTheme } from '@src/core/theme-runtime.js'
import { Command, CommandBuilder, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { createMockInteraction } from '@src/testing/index.js'

const APP = '200000000000000001'
const GUILD = '300000000000000001'
const OTHER_GUILD = '300000000000000002'
const STAFF_GUILD = '300000000000000003'
const GLOBAL = `/applications/${APP}/commands`
const inGuild = (guild: string) => `/applications/${APP}/guilds/${guild}/commands`

@CommandBuilder(CommandType.SLASH)
class PingBuilder {
  build(name: string) {
    return new SlashCommandBuilder().setName(name).setDescription('Pong')
  }
}

@CommandBuilder(CommandType.SLASH)
class SettingsBuilder {
  build(name: string) {
    return new SlashCommandBuilder()
      .setName(name)
      .setDescription('Settings')
      .addSubcommand(sub => sub.setName('channel').setDescription('Channel'))
      .addSubcommandGroup(group => group.setName('roles').setDescription('Roles').addSubcommand(sub => sub.setName('add').setDescription('Add')))
  }
}

@CommandBuilder(CommandType.SLASH, { guilds: [STAFF_GUILD] })
class StaffBuilder {
  build(name: string) {
    return new SlashCommandBuilder().setName(name).setDescription('Staff only')
  }
}

@CommandBuilder(CommandType.CONTEXT_MENU)
class ReportBuilder {
  build(name: string) {
    return new ContextMenuCommandBuilder().setName(name).setType(ApplicationCommandType.User)
  }
}

@Controller()
class AppController {
  @Command('ping', PingBuilder)
  ping() {}

  @Command('settings', SettingsBuilder)
  @Command('settings channel', CommandType.SLASH)
  channel() {}

  @Command('settings roles add', CommandType.SLASH)
  addRole() {}

  @Command('staff', StaffBuilder)
  staff() {}

  @Command('Report', ReportBuilder)
  report() {}
}

/** Discord's command routes: each scope keeps what was put or added there, each command with its own ID. */
function fakeRest() {
  const scopes = new Map<string, { id: string; name: string }[]>()
  let next = 400000000000000000n
  const stamp = (command: { name: string }) => ({ ...command, id: String(next++), version: '1' })
  return {
    scopes,
    put: vi.fn(async (route: string, { body }: { body: { name: string }[] }) => {
      scopes.set(route, body.map(stamp))
      return scopes.get(route)
    }),
    get: vi.fn(async (route: string) => scopes.get(route) ?? []),
    /** Registers a command from elsewhere, as `meocord register` from another process does. */
    add<C extends { name: string }>(route: string, command: C) {
      const added = stamp(command)
      scopes.set(route, [...(scopes.get(route) ?? []).filter(found => found.name !== added.name), added])
      return added.id
    },
    idOf: (route: string, name: string) => scopes.get(route)?.find(command => command.name === name)?.id,
  }
}

const body = (name: string) => new SlashCommandBuilder().setName(name).setDescription(name).toJSON()
const settingsBody = () => new SettingsBuilder().build('settings').toJSON()

/** A bot whose client is ready and belongs to its app, as `MeoCordFactory.create` makes it, without a gateway. */
function bot({ ready = true, shard = false } = {}) {
  const rest = fakeRest()
  const listeners = new Map<string, ((...args: any[]) => any)[]>()
  const client = {
    rest,
    application: ready ? { id: APP } : null,
    user: { setActivity: vi.fn() },
    on: (event: string, listener: (...args: any[]) => any) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    login: vi.fn().mockResolvedValue('token'),
    ready: () => Promise.all((listeners.get('clientReady') ?? []).map(listener => listener(client))),
  }
  const container = { get: (cls: new () => unknown) => new cls(), isBound: () => false }
  const app = new MeoCordApp([AppController], container as any, client as any, 'token', undefined, undefined, undefined, undefined, undefined, undefined, false, shard)
  registerClientTheme(client, container as any)
  return { app, client, rest }
}

const interactionIn = (client: object, guildId: string | null) =>
  Object.assign(createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' }), { client, guildId })

beforeEach(() => {
  config.current = { commands: {} }
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('commandMention', () => {
  describe('from what the bot registered', () => {
    it('formats a command, a subcommand and a grouped subcommand with the IDs the registration answered, asking nothing more', async () => {
      const { app, client, rest } = bot()
      await app.registerCommands()
      rest.get.mockClear()

      await expect(commandMention('ping', client as any)).resolves.toBe(`</ping:${rest.idOf(GLOBAL, 'ping')}>`)
      await expect(commandMention('settings channel', client as any)).resolves.toBe(`</settings channel:${rest.idOf(GLOBAL, 'settings')}>`)
      await expect(commandMention('  settings   roles add ', client as any)).resolves.toBe(`</settings roles add:${rest.idOf(GLOBAL, 'settings')}>`)
      expect(rest.get).not.toHaveBeenCalled()
    })

    it('waits for a registration under way, and takes the IDs it answers', async () => {
      const { app, client, rest } = bot()
      const answer = Promise.withResolvers<void>()
      const put = rest.put.getMockImplementation()!
      rest.put.mockImplementationOnce(async (...args) => (await answer.promise, put(...args)))
      const registering = app.registerCommands()

      const mention = commandMention('ping', client as any)
      await vi.waitFor(() => expect(rest.put).toHaveBeenCalled())
      answer.resolve()
      await registering

      await expect(mention).resolves.toBe(`</ping:${rest.idOf(GLOBAL, 'ping')}>`)
      expect(rest.get).not.toHaveBeenCalled()
    })

    it('counts a registration as under way from before the ready hooks start', async () => {
      const { client, rest } = bot()
      const hook = vi.fn(() => commandMention('ping', client as any))
      const { app } = { app: new MeoCordApp([AppController], { get: () => ({ onReady: hook }), isBound: () => false } as any, client as any, 'token', undefined, undefined, undefined, undefined, [{ token: 'hook', name: 'Hook', dependencies: [] }] as any) }
      registerClientTheme(client, (app as any).container)
      await app.start()

      await client.ready()

      expect(hook).toHaveBeenCalledOnce()
      await expect(hook.mock.results[0].value).resolves.toBe(`</ping:${rest.idOf(GLOBAL, 'ping')}>`)
      expect(rest.get).not.toHaveBeenCalled()
    })
  })

  describe('where the bot never registered', () => {
    it.each([
      ['a shard process, whose manager registers', { shard: true }, {}],
      ['commands.register: false', {}, { register: false }],
    ])('in %s, lists a scope once on its first mention', async (_name, options, commands) => {
      config.current = { commands }
      const { client, rest } = bot(options)
      rest.add(GLOBAL, body('ping'))
      await client.ready()
      expect(rest.put).not.toHaveBeenCalled()

      await expect(commandMention('ping', client as any)).resolves.toBe(`</ping:${rest.idOf(GLOBAL, 'ping')}>`)
      await commandMention('ping', client as any)
      expect(rest.get.mock.calls).toEqual([[GLOBAL]])
    })

    it('finds a command registered from another process after the first lookup, by listing the scope again', async () => {
      const { client, rest } = bot()
      rest.add(GLOBAL, body('ping'))
      await commandMention('ping', client as any)
      const id = rest.add(GLOBAL, settingsBody())

      await expect(commandMention('settings channel', client as any)).resolves.toBe(`</settings channel:${id}>`)
      expect(rest.get.mock.calls).toEqual([[GLOBAL], [GLOBAL]])
    })

    it('lists a scope again on a miss at most once a minute', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const { client, rest } = bot()
      rest.add(GLOBAL, body('ping'))
      await commandMention('ping', client as any)

      await expect(commandMention('settings channel', client as any)).rejects.toThrow('is not registered')
      await expect(commandMention('settings channel', client as any)).rejects.toThrow('is not registered')
      expect(rest.get).toHaveBeenCalledTimes(2)

      vi.setSystemTime(Date.now() + COMMAND_REFETCH_INTERVAL_MS - 1)
      await expect(commandMention('settings channel', client as any)).rejects.toThrow('is not registered')
      expect(rest.get).toHaveBeenCalledTimes(2)
      vi.setSystemTime(Date.now() + 1)
      const id = rest.add(GLOBAL, settingsBody())
      await expect(commandMention('settings channel', client as any)).resolves.toBe(`</settings channel:${id}>`)
      expect(rest.get).toHaveBeenCalledTimes(3)
    })

    describe('the requests a global command costs, mentioned in one guild every 5 s for ten minutes', () => {
      const mentionForTenMinutes = async (client: object) => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const interaction = interactionIn(client, GUILD)
        for (let second = 0; second < 600; second += 5) {
          vi.setSystemTime(second * 1000)
          await commandMention('ping', interaction as any)
        }
      }
      const byRoute = (rest: ReturnType<typeof fakeRest>) =>
        Object.fromEntries(Object.entries(Object.groupBy(rest.get.mock.calls.map(([route]) => route), route => route)).map(([route, calls]) => [route, calls!.length]))

      it('lists the guild once and the global scope once', async () => {
        const { client, rest } = bot()
        rest.add(GLOBAL, body('ping'))

        await mentionForTenMinutes(client)

        expect(byRoute(rest)).toEqual({ [inGuild(GUILD)]: 1, [GLOBAL]: 1 })
      })

      it("lists only the guild once the registration's answer holds the global scope", async () => {
        const { app, client, rest } = bot()
        await app.registerCommands()
        rest.get.mockClear()

        await mentionForTenMinutes(client)

        expect(byRoute(rest)).toEqual({ [inGuild(GUILD)]: 1 })
      })
    })

    it('lists every scope again when none holds the path the build declares', async () => {
      const { client, rest } = bot()
      rest.add(GLOBAL, { ...body('settings'), options: [{ type: 1, name: 'channel', description: 'c' }] })

      await expect(commandMention('settings roles add', interactionIn(client, GUILD) as any)).rejects.toThrow('has no "settings roles add"')
      await expect(commandMention('settings roles add', interactionIn(client, GUILD) as any)).rejects.toThrow('has no "settings roles add"')

      // The first lookup lists both; the second, finding the path nowhere, lists both again, the guild first
      expect(rest.get.mock.calls).toEqual([[inGuild(GUILD)], [GLOBAL], [inGuild(GUILD)], [GLOBAL]])
    })

    it("shares another mention's listing of a scope it would list again, rather than skipping the scope", async () => {
      const { client, rest } = bot()
      rest.add(GLOBAL, body('ping'))
      await commandMention('ping', client as any)
      const gate = Promise.withResolvers<void>()
      rest.get.mockImplementationOnce(async route => {
        await gate.promise
        return rest.scopes.get(route) ?? []
      })

      const first = commandMention('settings channel', client as any)
      await vi.waitFor(() => expect(rest.get).toHaveBeenCalledTimes(2))
      const second = commandMention('settings channel', client as any)
      const id = rest.add(GLOBAL, settingsBody())
      gate.resolve()

      await expect(first).resolves.toBe(`</settings channel:${id}>`)
      await expect(second).resolves.toBe(`</settings channel:${id}>`)
      expect(rest.get).toHaveBeenCalledTimes(2)
    })

    it('shares one listing between mentions made at once', async () => {
      const { client, rest } = bot()
      rest.add(GLOBAL, body('ping'))

      await Promise.all([commandMention('ping', client as any), commandMention('ping', client as any)])

      expect(rest.get).toHaveBeenCalledOnce()
    })
  })

  describe('where the reader can use it', () => {
    it("takes the target's guild's command over the global one", async () => {
      const { client, rest } = bot()
      rest.add(GLOBAL, body('ping'))
      const local = rest.add(inGuild(GUILD), body('ping'))

      await expect(commandMention('ping', interactionIn(client, GUILD) as any)).resolves.toBe(`</ping:${local}>`)
    })

    it("falls back to the global command, from a message's or a guild's guild", async () => {
      const { client, rest } = bot()
      const global = rest.add(GLOBAL, body('ping'))
      const guild = Object.assign(Object.create(Guild.prototype), { client, id: GUILD })
      const message = { client, guildId: GUILD }

      await expect(commandMention('ping', guild)).resolves.toBe(`</ping:${global}>`)
      await expect(commandMention('ping', message as any)).resolves.toBe(`</ping:${global}>`)
      // Each scope listed once: the second mention resolves from what the first listed
      expect(rest.get.mock.calls).toEqual([[inGuild(GUILD)], [GLOBAL]])
    })

    it('reads a guild whose commands the bot may not list as holding none', async () => {
      const { client, rest } = bot()
      const global = rest.add(GLOBAL, body('ping'))
      rest.get.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('Missing Access'), { status: 403, code: RESTJSONErrorCodes.MissingAccess })))

      await expect(commandMention('ping', interactionIn(client, GUILD) as any)).resolves.toBe(`</ping:${global}>`)
    })

    // Missing Permissions, as Discord answers a bot whose access to a guild's commands was taken away
    const missingPermissions = () => Object.assign(new Error('Missing Permissions'), { status: 403, code: RESTJSONErrorCodes.MissingPermissions })
    const serverError = () => Object.assign(new Error('Internal Server Error'), { status: 500 })

    it.each([
      ['Missing Permissions', missingPermissions],
      ['a server error', serverError],
    ])('falls back to the global command when listing the guild fails with %s', async (_name, failure) => {
      const { client, rest } = bot()
      const global = rest.add(GLOBAL, body('ping'))
      rest.get.mockRejectedValueOnce(failure())

      await expect(commandMention('ping', interactionIn(client, GUILD) as any)).resolves.toBe(`</ping:${global}>`)
    })

    it('rejects with an error naming the failed listing when no other scope holds the command', async () => {
      const { client, rest } = bot()
      const failure = serverError()
      rest.get.mockRejectedValueOnce(failure)

      const rejection = commandMention('ping', client as any)

      await expect(rejection).rejects.toThrow(
        'commandMention could not list the commands registered globally (Error: Internal Server Error), and no other scope holds "ping".',
      )
      await expect(rejection).rejects.toMatchObject({ cause: failure })
    })

    it('says a command is not registered once a listing that failed succeeds', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const { client, rest } = bot()
      rest.get.mockRejectedValueOnce(serverError())
      await expect(commandMention('ping', client as any)).rejects.toThrow('could not list the commands registered globally')

      vi.setSystemTime(Date.now() + COMMAND_REFETCH_INTERVAL_MS)

      await expect(commandMention('ping', client as any)).rejects.toThrow('"ping" is not registered globally')
    })

    it('lists a scope whose listing failed again at most once a minute', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      const { client, rest } = bot()
      const global = rest.add(GLOBAL, body('ping'))
      rest.get.mockImplementation(route => Promise.reject(route === GLOBAL ? serverError() : missingPermissions()))

      for (let mention = 0; mention < 10; mention++) {
        await expect(commandMention('ping', interactionIn(client, GUILD) as any)).rejects.toThrow('could not list the commands registered in guild')
      }
      expect(rest.get.mock.calls).toEqual([[inGuild(GUILD)], [GLOBAL]])

      vi.setSystemTime(Date.now() + COMMAND_REFETCH_INTERVAL_MS)
      rest.get.mockImplementation(async route => rest.scopes.get(route) ?? [])
      await expect(commandMention('ping', interactionIn(client, GUILD) as any)).resolves.toBe(`</ping:${global}>`)
      expect(rest.get.mock.calls).toEqual([[inGuild(GUILD)], [GLOBAL], [inGuild(GUILD)], [GLOBAL]])
    })
  })

  describe('errors', () => {
    it.each([
      ['pong', RangeError, '"pong" names no command of this app\'s. Its slash commands are "ping", "settings" and "staff".'],
      ['settings colour', RangeError, '"settings colour" names "colour", which "settings" doesn\'t declare; it declares "channel" and "roles".'],
      ['settings roles remove', RangeError, '"settings roles remove" names "remove", which "settings roles" doesn\'t declare; it declares "add".'],
      ['ping extra', RangeError, '"ping extra" names "extra", which "ping" doesn\'t declare; it has no subcommands.'],
      ['Report', RangeError, '"Report" is a user context menu command, which has no mention; only a slash command has one.'],
      ['settings', RangeError, '"settings" has subcommands, and Discord runs only one of them; mention "settings channel" and "settings roles".'],
      ['settings roles', RangeError, '"settings roles" has subcommands, and Discord runs only one of them; mention "settings roles add".'],
      ['', RangeError, "takes a command's name"],
    ])('refuses %j with a %o, before asking Discord', async (path, kind, message) => {
      const { client, rest } = bot()

      const error = await commandMention(path, client as any).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(kind)
      expect((error as Error).message).toContain(message)
      expect(rest.get).not.toHaveBeenCalled()
    })

    it('says where it looked for a command registered nowhere, and how to register it', async () => {
      const { client } = bot()

      await expect(commandMention('ping', interactionIn(client, GUILD) as any)).rejects.toThrow(
        new Error(`commandMention: "ping" is not registered in guild ${GUILD} or globally. Run \`meocord register\` to register the commands this build declares.`),
      )
    })

    it('says the registered command lacks a path the build declares', async () => {
      const { client, rest } = bot()
      rest.add(GLOBAL, { ...body('settings'), options: [{ type: 1, name: 'channel', description: 'c' }] })

      await expect(commandMention('settings roles add', client as any)).rejects.toThrow(
        'the "settings" command registered globally has no "settings roles add", as when it was registered before that was added.',
      )
    })

    it.each([
      ['a client alone', (client: object) => client, 'for no guild'],
      ['a DM', (client: object) => interactionIn(client, null), 'for no guild'],
      ['another guild', (client: object) => interactionIn(client, OTHER_GUILD), `for guild ${OTHER_GUILD}`],
    ])('names the guilds a command is registered only to, for %s', async (_name, target, where) => {
      const { client } = bot()

      await expect(commandMention('staff', target(client) as any)).rejects.toThrow(
        `"staff" is registered only to guild ${STAFF_GUILD}, and this mention is ${where}, where no reader can use it.`,
      )
    })

    it('finds a guild-only command in its guild', async () => {
      const { client, rest } = bot()
      const id = rest.add(inGuild(STAFF_GUILD), body('staff'))

      await expect(commandMention('staff', interactionIn(client, STAFF_GUILD) as any)).resolves.toBe(`</staff:${id}>`)
    })

    it('waits for the client to be ready', async () => {
      const { client, rest } = bot({ ready: false })

      await expect(commandMention('ping', client as any)).rejects.toThrow('commandMention waits for the client to be ready')
      expect(rest.get).not.toHaveBeenCalled()
    })

    it('refuses a client that belongs to no MeoCord app', async () => {
      await expect(commandMention('ping', { application: { id: APP } } as any)).rejects.toThrow('commandMention: the client belongs to no MeoCord app.')
    })
  })
})
