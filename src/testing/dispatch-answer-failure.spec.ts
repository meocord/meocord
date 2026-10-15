import 'reflect-metadata'
import { ChatInputCommandInteraction, type Message } from 'discord.js'
import { vi } from 'vitest'
import { Logger } from '@src/common/logger.js'
import { forgetDeprecationWarnings } from '@src/common/deprecation.js'
import { GuardDeniedError, UserError } from '@src/common/index.js'
import { Command, Controller, Guard, MeoCord, MessageHandler, Observer, UseGuard } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'
import { type DispatchResult, type PresentedError, type ResponsePresenter } from '@src/interface/index.js'
import { createMockInteraction, createMockMessage, MeoCordTestingModule } from './index.js'
import { forgetStrictMocks, useStrictMocks } from './strict-mocks.js'

const heard: { outcome: string; deniedBy?: string; error?: string }[] = []
let logged: string[]
let warned: string[]
beforeEach(() => {
  forgetStrictMocks()
  forgetDeprecationWarnings()
  heard.length = 0
  logged = []
  warned = []
  vi.spyOn(Logger.prototype, 'warn').mockImplementation((text: unknown) => void warned.push(String(text)))
  vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => forgetStrictMocks())

const BROKEN = 'presenter broke'

@Observer()
class Audit {
  onSettled(_context: unknown, result: DispatchResult) {
    heard.push({ outcome: result.outcome, deniedBy: result.deniedBy?.name, error: (result.error as Error | undefined)?.message })
  }
}

@Guard()
class StaffOnly {
  canActivate(): boolean {
    throw new GuardDeniedError('Staff only')
  }
}

@Controller()
class Moderation {
  @Command('ban', CommandType.SLASH)
  @UseGuard(StaffOnly)
  ban() {}

  @Command('kick', CommandType.SLASH)
  kick() {
    throw new Error('handler blew')
  }

  @Command('bad', CommandType.SLASH)
  bad() {
    throw new UserError('bad')
  }

  @Command('good', CommandType.SLASH)
  good() {
    throw new UserError('good')
  }

  @MessageHandler('warn')
  warn(_message: Message) {
    throw new UserError('bad')
  }
}

// Its views can't be drawn for the words 'bad', nor for a guard's or a fault's
class BrokenPresenter implements ResponsePresenter {
  loading() {
    return { text: 'Working' }
  }
  error(_context: unknown, { message }: PresentedError) {
    if (message === 'good') return { text: message }
    throw new TypeError(BROKEN)
  }
  messageError(): never {
    throw new TypeError(BROKEN)
  }
}

@MeoCord({
  controllers: [Moderation],
  observers: [Audit],
  presenter: BrokenPresenter,
  messages: { prefix: '!' },
  clientOptions: { intents: [] },
})
class App {}

const compile = () => MeoCordTestingModule.fromApp(App).compile()
const command = (commandName: string) => createMockInteraction(ChatInputCommandInteraction, { commandName })
const failedWrites = () => logged.filter(line => line.startsWith('Could not write'))

const MODES = [
  ['in default mode', () => undefined],
  ['under useStrictMocks()', () => useStrictMocks()],
] as const
const TWICE = /^dispatch\(\) here reports a call whose answer MeoCord couldn't build with the call's own outcome.*under useStrictMocks\(\) the call is reported once, as 'error'\.$/
const broke = (deniedBy?: string) => ({ outcome: 'error', deniedBy, error: BROKEN })

// Default mode keeps how a test heard such a call, with a warning; strict mocks report it once, as the bot does
describe('a dispatched call whose answer fails to build', () => {
  it.each([
    ['in default mode', () => undefined, [{ outcome: 'denied', deniedBy: 'StaffOnly', error: 'Staff only' }, broke()], [TWICE]],
    ['under useStrictMocks()', () => useStrictMocks(), [broke('StaffOnly')], []],
  ] as const)("is reported as the mode has it when a guard refused it, the guard named under strict mocks, %s", async (_, mode, reports, warnings) => {
    mode()
    await expect(compile().dispatch(command('ban'))).rejects.toThrow(BROKEN)

    expect(heard).toEqual(reports)
    expect(failedWrites()).toHaveLength(reports.length)
    expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))
  })

  it.each([
    ['in default mode', () => undefined, [{ outcome: 'error', deniedBy: undefined, error: 'handler blew' }, broke()]],
    ['under useStrictMocks()', () => useStrictMocks(), [broke()]],
  ] as const)("is reported as the mode has it when a handler threw, with the answer's fault under strict mocks, %s", async (_, mode, reports) => {
    mode()
    await expect(compile().dispatch(command('kick'))).rejects.toThrow(BROKEN)

    expect(heard).toEqual(reports)
    expect(failedWrites()).toHaveLength(reports.length)
  })

  it.each([
    ['in default mode', () => undefined, [{ outcome: 'refused', deniedBy: undefined, error: 'bad' }], [TWICE]],
    ['under useStrictMocks()', () => useStrictMocks(), [broke()], []],
  ] as const)('is reported once for a message command, as an error under strict mocks, %s', async (_, mode, reports, warnings) => {
    mode()
    await expect(compile().dispatch(createMockMessage({ content: '!warn' }))).rejects.toThrow(BROKEN)

    expect(heard).toEqual(reports)
    expect(failedWrites()).toHaveLength(1)
    expect(warned).toEqual(warnings.map(text => expect.stringMatching(text)))
  })

  it.each(MODES)('rejects only the call it belongs to, when two run at once on one module, %s', async (_, mode) => {
    mode()
    const module = compile()
    const [bad, good] = await Promise.allSettled([module.dispatch(command('bad')), module.dispatch(command('good'))])

    expect([bad.status, (bad as PromiseRejectedResult).reason?.message, good.status]).toEqual(['rejected', BROKEN, 'fulfilled'])
  })
})
