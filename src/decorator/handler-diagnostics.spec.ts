import path from 'path'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PROBE = path.join(ROOT, 'src', 'decorator', '__diagnostics-probe__.ts')

// Each handler is refused, and an editor shows the first lines of why: the designed message has to be among them
const probe = `
import { type ButtonInteraction, type Message, type StringSelectMenuInteraction } from 'discord.js'
import { Command, MessageHandler } from '@src/decorator/index.js'
import { CommandType } from '@src/enum/index.js'

export class Probe {
  @MessageHandler('roll {sides:int}')
  unknownParam(_message: Message, _params: { side: number }) {}

  @MessageHandler('roll {sides:int}')
  wrongType(_message: Message, _params: { sides: string }) {}

  @Command('counter/{count:int}', CommandType.BUTTON)
  wrongSegment(_interaction: ButtonInteraction, _params: { count: string }) {}

  @Command('stats/{id}', CommandType.BUTTON)
  unknownKey(_interaction: ButtonInteraction, _params: { uid: string }) {}

  @Command('pick', CommandType.SELECT_MENU)
  wrongChoice(_interaction: StringSelectMenuInteraction, _params: { values: number[] }) {}
}
`

/** Each diagnostic in the probe, by the method it is on, as its lines of text. */
function diagnostics(): Record<string, string[]> {
  const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT)
  const host = ts.createCompilerHost({ ...options, noEmit: true })
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, language, ...rest) =>
    path.resolve(file) === PROBE ? ts.createSourceFile(file, probe, language) : getSourceFile(file, language, ...rest)
  const fileExists = host.fileExists.bind(host)
  host.fileExists = file => path.resolve(file) === PROBE || fileExists(file)
  const program = ts.createProgram({ rootNames: [PROBE], options: { ...options, noEmit: true }, host })
  const source = program.getSourceFile(PROBE)!
  return Object.fromEntries(
    ts.getPreEmitDiagnostics(program, source).map(diagnostic => {
      const method = /^\s*(\w+)\(/m.exec(probe.slice(diagnostic.start!).split('\n').slice(1).join('\n'))![1]
      return [method, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')]
    }),
  )
}

describe("a handler whose params do not fit its pattern's", () => {
  let found: Record<string, string[]>
  beforeAll(() => {
    found = diagnostics()
  }, 60_000)

  it.each([
    // A key the pattern lacks is no pipe's, so its refusal leaves Piped<T> out
    ['unknownParam', `The handler's params do not fit the pattern": {`, 2],
    ['wrongType', "The handler's params do not fit the pattern; a key a pipe produces is marked Piped<T>", 2],
    ['wrongSegment', "The handler's params give a typed customId param a type its value does not fit; a key a pipe produces is marked Piped<T>", 3],
    ['wrongChoice', "The handler's params give a select menu's choices a type their values do not fit; a key a pipe produces is marked Piped<T>", 3],
    ['unknownKey', "The handler's params name keys its pattern does not capture", 3],
  ])('%s is refused, naming why within its first lines', (method, message, within) => {
    const lines = found[method]

    expect(lines?.[0]).toContain('Unable to resolve signature of method decorator')
    expect(lines.slice(0, within).join('\n')).toContain(message)
  })
})
