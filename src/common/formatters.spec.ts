import path from 'path'
import * as discord from 'discord.js'
import ts from 'typescript'
import * as common from '@src/common/index.js'
import { WARM_UP_TIMEOUT_MS } from '@src/spec-timeouts.js'

/**
 * discord.js's formatters meocord/common doesn't re-export, each with why. One a discord.js minor adds waits here, with
 * that version, until the peer range's floor reaches it: an ES module's `export { x } from 'discord.js'` fails to load
 * on a discord.js without `x`.
 */
const NOT_REEXPORTED: Record<string, string> = {
  version: "@discordjs/formatters' own version, where discord.js exports its own under the same name",
  underscore: 'deprecated in favour of underline',
}

const ROOT = path.resolve(import.meta.dirname, '../..')

describe("discord.js's formatters", () => {
  let formatters: Map<string, ts.Symbol>
  let reexported: Map<string, ts.Symbol>
  // One program over meocord/common and discord.js, which resolves @discordjs/formatters as discord.js does
  beforeAll(() => {
    const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile)
    const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT)
    const entry = path.join(ROOT, 'src/common/index.ts')
    const discordTypes = ts.resolveModuleName('discord.js', entry, options, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule!.resolvedFileName
    const program = ts.createProgram([entry, discordTypes], { ...options, noEmit: true })
    const checker = program.getTypeChecker()
    const exportsOf = (file: string) =>
      new Map(
        checker
          .getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)!)!)
          .map(symbol => [symbol.name, symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol] as const),
      )
    const fromFormatters = (symbol: ts.Symbol) =>
      symbol.declarations?.some(node => node.getSourceFile().fileName.split(path.sep).join('/').includes('/@discordjs/formatters/')) ?? false
    formatters = new Map([...exportsOf(discordTypes)].filter(([, symbol]) => fromFormatters(symbol)))
    reexported = new Map([...exportsOf(entry)].filter(([, symbol]) => fromFormatters(symbol)))
  }, WARM_UP_TIMEOUT_MS)

  it('are each re-exported from meocord/common as discord.js exports them, or left out with a reason', () => {
    const missing = [...formatters.keys()].filter(name => reexported.get(name) !== formatters.get(name) && !(name in NOT_REEXPORTED))

    expect({ missing, reexportedLeftOut: Object.keys(NOT_REEXPORTED).filter(name => reexported.has(name)) }).toEqual({ missing: [], reexportedLeftOut: [] })
    expect(reexported.size).toBe([...formatters.keys()].filter(name => !(name in NOT_REEXPORTED)).length)
  })

  it("are discord.js's own functions at runtime", () => {
    const values = Object.entries(common).filter(([name]) => formatters.has(name))

    expect(values.filter(([name, value]) => value !== discord[name as keyof typeof discord]).map(([name]) => name)).toEqual([])
    expect(values.length).toBe(44)
    expect(common.userMention('1')).toBe('<@1>')
  })
})
