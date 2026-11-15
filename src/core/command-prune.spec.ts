import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { ApplicationCommandType, RESTJSONErrorCodes, Routes } from 'discord.js'
import { PassThrough } from 'stream'
import { vi } from 'vitest'
import { type CollectedCommand } from '@src/core/command-identity.js'
import { Command, CommandBuilder, Controller } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import {
  GUILD_PAGE_LIMIT,
  INVALID_REQUEST_CAP,
  INVALID_REQUEST_WINDOW_MS,
  pruneAfterRegistration,
  type PruneConsent,
  pruneCommands,
  type PruneOptions,
  PROGRESS_EVERY,
  terminalConsent,
} from '@src/core/command-prune.js'

const APP = 'app'
const slash = (name: string): CollectedCommand => ({ name, body: { name, type: ApplicationCommandType.ChatInput } })
const DECLARED = [slash('ping'), slash('help'), { name: 'Report', body: { name: 'Report', type: ApplicationCommandType.User } }]

/** Discord as far as a prune asks it: the servers the bot is in, and each server's commands. */
function fakeDiscord(servers: { id: string; name: string; commands?: { name: string; type?: number }[]; error?: unknown }[]) {
  const held = new Map(servers.map(({ id, commands = [] }) => [id, commands.map((command, index) => ({ id: `${id}-${index}`, type: 1, ...command }))]))
  const errors = new Map(servers.filter(({ error }) => error).map(({ id, error }) => [id, error]))
  const calls: string[] = []
  const guildOf = (route: string) => route.split('/')[4]
  return {
    calls,
    held,
    get: vi.fn(async (route: string, options?: { query?: URLSearchParams }) => {
      calls.push(`GET ${route}${options?.query ? `?${options.query}` : ''}`)
      if (route === '/users/@me/guilds') {
        const after = options?.query?.get('after')
        const limit = Number(options?.query?.get('limit'))
        const sorted = [...servers].sort((a, b) => (a.id < b.id ? -1 : 1))
        return sorted.filter(({ id }) => !after || id > after).slice(0, limit).map(({ id, name }) => ({ id, name }))
      }
      const guild = guildOf(route)
      if (errors.has(guild)) throw errors.get(guild)
      return held.get(guild) ?? []
    }),
    put: vi.fn(async (route: string, { body }: { body: unknown[] }) => {
      calls.push(`PUT ${route} ${JSON.stringify(body)}`)
      held.set(guildOf(route), [])
      return []
    }),
    delete: vi.fn(async (route: string) => {
      calls.push(`DELETE ${route}`)
      const guild = guildOf(route)
      held.set(guild, held.get(guild)!.filter(command => command.id !== route.split('/').pop()))
    }),
  }
}

const missingAccess = () => Object.assign(new Error('Missing Access'), { status: 403, code: RESTJSONErrorCodes.MissingAccess })

function prune(discord: ReturnType<typeof fakeDiscord>, overrides: Partial<PruneOptions> = {}) {
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const consent = vi.fn(async (): Promise<PruneConsent> => 'keep')
  const run = pruneCommands({ rest: discord, applicationId: APP, commands: DECLARED, skip: new Set(), mode: 'declared', consent, logger, ...overrides })
  const lines = () => logger.log.mock.calls.map(([line]) => String(line))
  const errors = () => logger.error.mock.calls.map(([line]) => String(line))
  return { run, logger, consent, lines, errors }
}

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'meocord-prune-'))
  mkdirSync(path.join(cwd, 'node_modules', '.cache', 'meocord'), { recursive: true })
  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

const record = (guild: string) => path.join(cwd, 'node_modules', '.cache', 'meocord', `commands-${APP}-guild-${guild}.json`)

describe('pruneCommands', () => {
  it('removes, one DELETE each, the commands the build declares, and keeps and lists the others', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Test', commands: [{ name: 'ping' }, { name: 'legacy' }, { name: 'help' }] }])
    writeFileSync(record('1'), '{}')
    const { run, lines } = prune(discord)

    await expect(run).resolves.toBe(true)

    expect(discord.calls.filter(call => !call.startsWith('GET'))).toEqual([
      `DELETE /applications/${APP}/guilds/1/commands/1-0`,
      `DELETE /applications/${APP}/guilds/1/commands/1-2`,
    ])
    expect(discord.held.get('1')!.map(({ name }) => name)).toEqual(['legacy'])
    expect(lines()).toContain('Test (1): removed 2 (ping, help); kept 1 not declared by this build (legacy)')
    // A command is left there, so development's record of the server stays
    expect(existsSync(record('1'))).toBe(true)
  })

  it('deletes each listed command by id even when every command there is declared, and then forgets the record', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Test', commands: [{ name: 'ping' }, { name: 'Report', type: 2 }] }])
    writeFileSync(record('1'), '{}')
    const { run } = prune(discord)

    await expect(run).resolves.toBe(true)

    expect(discord.calls.filter(call => !call.startsWith('GET'))).toEqual([
      `DELETE /applications/${APP}/guilds/1/commands/1-0`,
      `DELETE /applications/${APP}/guilds/1/commands/1-1`,
    ])
    expect(existsSync(record('1'))).toBe(false)
  })

  it('leaves a command registered in the server after the listing', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Test', commands: [{ name: 'ping' }] }])
    const list = discord.get.getMockImplementation()!
    discord.get.mockImplementation(async (route, options) => {
      const answer = await list(route, options)
      // A production bot registers here between the listing and the removal
      if (route.endsWith('/guilds/1/commands')) discord.held.set('1', [...discord.held.get('1')!, { id: '1-new', name: 'help', type: 1 }])
      return answer
    })
    const { run } = prune(discord)

    await expect(run).resolves.toBe(true)
    expect(discord.held.get('1')!.map(({ name }) => name)).toEqual(['help'])
  })

  it('tells commands apart by name and type, so a same-named command of another type is kept', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Test', commands: [{ name: 'Report', type: 3 }, { name: 'ping' }] }])
    const { run, lines } = prune(discord)
    await run

    expect(lines()).toContain('Test (1): removed 1 (ping); kept 1 not declared by this build (Report)')
  })

  it('fails a server whose listing is not a list of commands, naming it, and forgets nothing', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Odd' }, { id: '2', name: 'Fine', commands: [{ name: 'ping' }] }])
    const list = discord.get.getMockImplementation()!
    discord.get.mockImplementation(async (route, options) => (route === Routes.applicationGuildCommands(APP, '1') ? ({ message: 'not a list' } as never) : list(route, options)))
    writeFileSync(record('1'), '{}')
    const { run, errors } = prune(discord)

    await expect(run).resolves.toBe(false)
    expect(errors()).toContain('--prune failed in Odd (1): Discord answered its command listing with something other than a list of commands.')
    expect(existsSync(record('1'))).toBe(true)
    expect(discord.held.get('2')).toEqual([])
  })

  it('forgets the record of a server found empty, and logs no line for it', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Empty' }])
    writeFileSync(record('1'), '{}')
    const { run, lines } = prune(discord)
    await run

    expect(existsSync(record('1'))).toBe(false)
    expect(lines().some(line => line.startsWith('Empty'))).toBe(false)
  })

  it('pages the servers with after at the page limit, and skips the ones registration owns', async () => {
    const servers = Array.from({ length: GUILD_PAGE_LIMIT + 1 }, (_, index) => ({ id: String(1000 + index), name: `S${index}` }))
    const discord = fakeDiscord(servers)
    const { run, lines } = prune(discord, { skip: new Set(['1000', '1001']) })
    await run

    const pages = discord.calls.filter(call => call.startsWith('GET /users/@me/guilds'))
    expect(pages).toEqual([`GET /users/@me/guilds?limit=${GUILD_PAGE_LIMIT}`, `GET /users/@me/guilds?limit=${GUILD_PAGE_LIMIT}&after=${1000 + GUILD_PAGE_LIMIT - 1}`])
    expect(discord.calls.filter(call => call.includes('/guilds/1000/') || call.includes('/guilds/1001/'))).toEqual([])
    expect(lines()).toContain(`Checking ${GUILD_PAGE_LIMIT - 1} servers the configuration doesn't name…`)
    expect(lines()).toContain(`Checked ${PROGRESS_EVERY} of ${GUILD_PAGE_LIMIT - 1} servers…`)
  })

  it('resumes the paging after the server --after names', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'A' }, { id: '2', name: 'B' }])
    const { run } = prune(discord, { after: '1' })
    await run

    expect(discord.calls).toEqual([`GET /users/@me/guilds?limit=${GUILD_PAGE_LIMIT}&after=1`, `GET /applications/${APP}/guilds/2/commands`])
  })

  it('checks the servers --prune-guild adds, whether or not the bot is in them, once each', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'In', commands: [{ name: 'ping' }] }])
    discord.held.set('9', [{ id: '9-0', name: 'help', type: 1 }])
    const { run, lines } = prune(discord, { extraGuilds: ['9', '1'] })
    await run

    expect(lines()).toContain('Server 9: removed 1 (help)')
    expect(discord.calls.filter(call => call === `GET /applications/${APP}/guilds/1/commands`)).toHaveLength(1)
  })

  it('counts a 403 with Missing Access as no command access, not a failure', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Locked', error: missingAccess() }])
    const { run, lines } = prune(discord)

    await expect(run).resolves.toBe(true)
    expect(lines()).toContain('--prune removed 0 commands, kept 0 not declared by this build, found 1 server without command access, and failed in 0.')
  })

  it('names each server it failed in, and fails the run', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Down', error: Object.assign(new Error('Internal Server Error'), { status: 500 }) }])
    const { run, errors } = prune(discord)

    await expect(run).resolves.toBe(false)
    expect(errors()).toContain('--prune failed in Down (1): Internal Server Error')
  })

  it('removes nothing, and says what it would, when it only reports', async () => {
    const discord = fakeDiscord([{ id: '1', name: 'Test', commands: [{ name: 'ping' }, { name: 'legacy' }] }])
    writeFileSync(record('1'), '{}')
    const { run, lines } = prune(discord, { reportOnly: 'a dry run.' })

    await expect(run).resolves.toBe(true)
    expect(discord.calls.every(call => call.startsWith('GET'))).toBe(true)
    expect(existsSync(record('1'))).toBe(true)
    expect(lines()).toEqual(expect.arrayContaining(['--prune only reports what it would remove: a dry run.', 'Test (1): would remove 1 (ping); kept 1 not declared by this build (legacy)']))
  })

  it('prints the cost up front, and says servers the bot is not in need --prune-guild', async () => {
    const { run, lines } = prune(fakeDiscord([]))
    await run

    expect(lines()[0]).toBe(`--prune costs one request per page of ${GUILD_PAGE_LIMIT} servers, one per server checked, and one per command removed.`)
    expect(lines().at(-1)).toBe('Servers the bot is not in are checked only with --prune-guild <id>.')
  })

  describe('all', () => {
    const servers = () => fakeDiscord([{ id: '1', name: 'Test', commands: [{ name: 'ping' }, { name: 'legacy' }] }])

    it('asks once, listing the undeclared commands, and clears with one PUT of [] on yes', async () => {
      const discord = servers()
      const consent = vi.fn(async () => 'remove' as const)
      const { run, lines } = prune(discord, { mode: 'all', consent })

      await expect(run).resolves.toBe(true)
      expect(consent).toHaveBeenCalledExactlyOnceWith(['Test (1): legacy'])
      expect(discord.calls.filter(call => !call.startsWith('GET'))).toEqual([`PUT /applications/${APP}/guilds/1/commands []`])
      expect(lines()).toContain('Test (1): removed 2 (ping, legacy)')
    })

    it('removes only the declared ones on no', async () => {
      const discord = servers()
      const keep = vi.fn(async () => 'keep' as const)
      const { run } = prune(discord, { mode: 'all', consent: keep })

      await expect(run).resolves.toBe(true)
      expect(keep).toHaveBeenCalledExactlyOnceWith(['Test (1): legacy'])
      expect(discord.held.get('1')!.map(({ name }) => name)).toEqual(['legacy'])
    })

    it('fails, keeping them, when it may not ask and was not told yes', async () => {
      const discord = servers()
      const { run, errors } = prune(discord, { mode: 'all', consent: vi.fn(async () => 'refused' as const) })

      await expect(run).resolves.toBe(false)
      expect(discord.held.get('1')!.map(({ name }) => name)).toEqual(['legacy'])
      expect(errors()).toContain('--prune all removed none of the commands not declared by this build: it can only ask in a terminal. Pass --yes to remove them.')
    })

    it.each([
      [false, 'Test (1): would remove 1 (ping); would ask before removing 1 not declared by this build (legacy)', 'would ask before removing 1 not declared by this build'],
      [true, 'Test (1): would remove 2 (ping, legacy)', 'would remove 2 commands'],
    ])('reports, as a dry run with --yes %s, what the real run would do, asking no one', async (consented, line, summary) => {
      const discord = servers()
      const consent = vi.fn(async () => 'remove' as const)
      const { run, lines } = prune(discord, { mode: 'all', reportOnly: 'a dry run.', consented, consent })

      await expect(run).resolves.toBe(true)
      expect(consent).not.toHaveBeenCalled()
      expect(discord.calls.every(call => call.startsWith('GET'))).toBe(true)
      expect(lines()).toContain(line)
      expect(lines().find(text => text.startsWith('--prune would remove'))).toContain(summary)
    })
  })

  describe('the invalid-request cap', () => {
    it(`stops at ${INVALID_REQUEST_CAP} answers of 401 or 403 in the window, naming where to go on`, async () => {
      const locked = Array.from({ length: INVALID_REQUEST_CAP + 5 }, (_, index) => ({ id: String(10_000 + index), name: `L${index}`, error: missingAccess() }))
      const discord = fakeDiscord(locked)
      const { run, errors } = prune(discord, { now: () => 0 })

      await expect(run).resolves.toBe(false)
      // The server whose answer reached the cap is checked again on resuming, as it was not handled
      const lastHandled = String(10_000 + INVALID_REQUEST_CAP - 2)
      expect(discord.calls.filter(call => call.includes('/commands'))).toHaveLength(INVALID_REQUEST_CAP)
      expect(errors().join('\n')).toContain(`Run \`meocord register --prune --after ${lastHandled}\` later to go on.`)
    })

    it('resumes from a server whose failed removal reached the cap, so its declared commands are removed then', async () => {
      const locked = Array.from({ length: INVALID_REQUEST_CAP - 1 }, (_, index) => ({ id: String(10_000 + index), name: `L${index}`, error: missingAccess() }))
      const discord = fakeDiscord([...locked, { id: '20000', name: 'Busy', commands: [{ name: 'ping' }] }])
      discord.delete.mockRejectedValueOnce(Object.assign(new Error('Missing Permissions'), { status: 403, code: RESTJSONErrorCodes.MissingPermissions }))
      const { run, errors } = prune(discord, { now: () => 0 })

      await expect(run).resolves.toBe(false)
      expect(discord.delete).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommand(APP, '20000', '20000-0'))
      expect(errors().join('\n')).toContain(`Run \`meocord register --prune --after ${String(10_000 + INVALID_REQUEST_CAP - 2)}\` later to go on.`)
    })

    it('resumes all from before the first server it set aside for consent, which it had not handled', async () => {
      const locked = Array.from({ length: INVALID_REQUEST_CAP }, (_, index) => ({ id: String(10_000 + index), name: `L${index}`, error: missingAccess() }))
      const discord = fakeDiscord([
        { id: '01000', name: 'Clean' },
        { id: '02000', name: 'Mixed', commands: [{ name: 'ping' }, { name: 'legacy' }] },
        ...locked,
      ])
      const consent = vi.fn(async () => 'remove' as const)
      const { run, errors } = prune(discord, { mode: 'all', consent, extraGuilds: ['9'], now: () => 0 })

      await expect(run).resolves.toBe(false)
      expect(consent).not.toHaveBeenCalled()
      expect(discord.held.get('02000')!.map(({ name }) => name)).toEqual(['ping', 'legacy'])
      expect(errors().join('\n')).toContain('It had not yet handled Mixed (02000). Run `meocord register --prune all --after 01000 --prune-guild 9` later to go on.')
    })

    // Spaced so the first answer has left the window by the time the cap's worth have come
    it('counts only the answers within the window', async () => {
      const locked = Array.from({ length: INVALID_REQUEST_CAP + 5 }, (_, index) => ({ id: String(10_000 + index), name: `L${index}`, error: missingAccess() }))
      let clock = 0
      const { run } = prune(fakeDiscord(locked), { now: () => (clock += Math.ceil(INVALID_REQUEST_WINDOW_MS / (INVALID_REQUEST_CAP - 1))) })

      await expect(run).resolves.toBe(true)
    })
  })
})

describe('pruneAfterRegistration', () => {
  @CommandBuilder(CommandType.SLASH, { guilds: ['4'] })
  class StaffBuilder {
    build = () => ({ toJSON: () => ({ name: 'staff', type: 1, description: 'staff' }) }) as any
  }
  @CommandBuilder(CommandType.SLASH)
  class PingBuilder {
    build = () => ({ toJSON: () => ({ name: 'ping', type: 1, description: 'ping' }) }) as any
  }
  @Controller()
  class AppController {
    @Command('ping', PingBuilder as any)
    ping() {}

    @Command('staff', StaffBuilder as any)
    staff() {}
  }

  const servers = ['1', '2', '3', '4', '5'].map(id => ({ id, name: `S${id}`, commands: [{ name: 'ping' }] }))
  const run = (discord: ReturnType<typeof fakeDiscord>, overrides: Partial<Parameters<typeof pruneAfterRegistration>[0]> = {}) => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    const result = pruneAfterRegistration({
      rest: discord,
      applicationId: APP,
      controllerClasses: [AppController],
      development: false,
      request: { mode: 'declared', guilds: [], dryRun: false, yes: false },
      registered: true,
      logger,
      ...overrides,
    })
    return { result, logger }
  }
  const checked = (discord: ReturnType<typeof fakeDiscord>) =>
    discord.calls.filter(call => call.startsWith('GET /applications')).map(call => call.split('/')[4])

  it('prunes nothing after a failed registration, and fails', async () => {
    const discord = fakeDiscord(servers)
    const { result, logger } = run(discord, { registered: false })

    await expect(result).resolves.toBe(false)
    expect(discord.calls).toEqual([])
    expect(logger.error).toHaveBeenCalledWith('--prune did not run, as registration failed: removing the old copies now could leave members with neither.')
  })

  it('skips the servers the configuration names and the one this run sent to', async () => {
    const discord = fakeDiscord(servers)
    const { result } = run(discord, { config: { guilds: ['1'], developmentGuild: '2' }, onlyGuild: '3' })

    await expect(result).resolves.toBe(true)
    // 3 is where --guild sent; 1 and 2 the configuration names; 4 a builder's guilds name
    expect(checked(discord)).toEqual(['5'])
  })

  it('only reports under development to a developmentGuild, and with --dry-run even after no registration', async () => {
    for (const overrides of [
      { development: true, config: { developmentGuild: '2' } },
      { registered: false, request: { mode: 'declared' as const, guilds: [], dryRun: true, yes: false } },
    ]) {
      const discord = fakeDiscord(servers)
      const { result, logger } = run(discord, overrides)

      await expect(result).resolves.toBe(true)
      expect(discord.calls.every(call => call.startsWith('GET'))).toBe(true)
      expect(logger.log.mock.calls.map(([line]) => line)).toContain('S5 (5): would remove 1 (ping)')
    }
  })

  it('fails, saying so, when the servers cannot be listed', async () => {
    const discord = fakeDiscord([])
    discord.get.mockRejectedValueOnce(Object.assign(new Error('Service Unavailable'), { status: 503 }))
    const { result, logger } = run(discord)

    await expect(result).resolves.toBe(false)
    expect(logger.error).toHaveBeenCalledWith('--prune could not list the servers the bot is in:', expect.objectContaining({ status: 503 }))
  })
})

describe('terminalConsent', () => {
  const terminal = (tty: boolean, answer = '') => {
    const input = Object.assign(new PassThrough(), { isTTY: tty })
    const output = Object.assign(new PassThrough(), { isTTY: tty })
    if (answer) setImmediate(() => input.write(`${answer}\n`))
    return { input, output }
  }
  const logger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

  it('lists the commands, then removes them without asking given --yes', async () => {
    const log = logger()
    await expect(terminalConsent(true, log, terminal(true))(['Test (1): legacy'])).resolves.toBe('remove')
    expect(log.warn).toHaveBeenCalledWith('--prune all also removes the commands not declared by this build:\n  Test (1): legacy')
  })

  it.each([
    ['y', 'remove'],
    ['YES', 'remove'],
    ['n', 'keep'],
    ['', 'keep'],
  ])('asks once in a terminal: %j is %s', async (answer, consent) => {
    const asked = terminal(true, answer || ' ')
    await expect(terminalConsent(false, logger(), asked)(['Test (1): legacy'])).resolves.toBe(consent)
  })

  it('refuses outside a terminal without --yes', async () => {
    await expect(terminalConsent(false, logger(), terminal(false))(['Test (1): legacy'])).resolves.toBe('refused')
  })
})
