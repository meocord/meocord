import path from 'path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { documentationProblems, exportedSymbols, importSources, publicSymbols } from './public-symbols.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')
// In memory, under the repository, so `'discord.js'` resolves to its installed declarations as the built package's do
const ownDir = path.join(repoRoot, '.public-symbols-fixture')
const entryFile = path.join(ownDir, 'index.d.ts')
const ENTRY = `export { userMention } from 'discord.js'

/** Says hello. */
export declare function greet(): string

/**
 * Says the time.
 *
 * @group Utilities
 */
export declare function time(): string
`

/** The fixture entry and discord.js, compiled together as the check compiles the package. */
function fixtureProgram(): { program: ts.Program; discordTypes: string } {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  }
  const discordTypes = ts.resolveModuleName('discord.js', entryFile, options, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule!.resolvedFileName
  const host = ts.createCompilerHost(options)
  const read = host.getSourceFile.bind(host)
  host.getSourceFile = (name, language) => (path.resolve(name) === entryFile ? ts.createSourceFile(name, ENTRY, language) : read(name, language))
  host.fileExists = name => path.resolve(name) === entryFile || ts.sys.fileExists(name)
  return { program: ts.createProgram([entryFile, discordTypes], options, host), discordTypes }
}

describe('public symbols', () => {
  const { program, discordTypes } = fixtureProgram()
  const symbols = publicSymbols(program, new Map([['meocord/fixture', entryFile]]), ownDir)
  const byName = (name: string) => [...symbols.values()].find(item => item.name === name)!

  it('needs nothing of a symbol declared outside the package, and a @group of its own', () => {
    const checker = program.getTypeChecker()

    expect({
      userMention: [byName('userMention').external, documentationProblems(checker, byName('userMention'))],
      greet: [byName('greet').external, documentationProblems(checker, byName('greet'))],
    }).toEqual({
      userMention: [true, []],
      greet: [false, ["meocord/fixture's greet has no @group tag; give its declaration a JSDoc comment of its own with one."]],
    })
  })

  it("imports a name from the package alone when discord.js's export of it is the same symbol, and refuses two", () => {
    const sources = importSources(symbols, { 'discord.js': exportedSymbols(program, discordTypes) })

    expect({ userMention: [...sources.get('userMention')!], time: [...sources.get('time')!].sort() }).toEqual({
      userMention: ['meocord/fixture'],
      time: ['discord.js', 'meocord/fixture'],
    })
  })
})
