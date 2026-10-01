/**
 * Checks that the built declarations export what the source entry points declare, for both conditions:
 * `dist/types/<entry>/index.d.ts` for `import` and `index.d.cts` for `require`. src/public-api.spec.ts pins the
 * source's names; this proves the build ships exactly those, so a bundling change cannot drop or add one.
 *
 * Run after `bun run build`.
 */
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRIES = ['core', 'decorator', 'common', 'interface', 'enum', 'testing']

/** The names each file's module exports, read by one program over all of them. */
function exportedNames(files: readonly string[], options: ts.CompilerOptions): Map<string, string[]> {
  const program = ts.createProgram(files, { ...options, noEmit: true })
  const checker = program.getTypeChecker()
  return new Map(
    files.map(file => {
      const source = program.getSourceFile(file)
      const module = source && checker.getSymbolAtLocation(source)
      if (!module) throw new Error(`${path.relative(repoRoot, file)} is not a module the compiler can read`)
      return [file, checker.getExportsOfModule(module).map(symbol => symbol.name).sort()]
    }),
  )
}

const { config } = ts.readConfigFile(path.join(repoRoot, 'tsconfig.json'), ts.sys.readFile)
const { options } = ts.parseJsonConfigFileContent(config, ts.sys, repoRoot)
const sources = ENTRIES.map(entry => path.join(repoRoot, 'src', entry, 'index.ts'))
const declared = exportedNames(sources, options)

const builds = ENTRIES.flatMap(entry => ['index.d.ts', 'index.d.cts'].map(file => path.join(repoRoot, 'dist', 'types', entry, file)))
const missing = builds.filter(file => !existsSync(file))
if (missing.length > 0) {
  console.error(`No built declarations at ${missing.map(file => path.relative(repoRoot, file)).join(', ')}. Run bun run build first.`)
  process.exit(1)
}
// As a consumer's compiler reads them: each condition's file under NodeNext, with the libraries skipped
const shipped = exportedNames(builds, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true })

const problems: string[] = []
ENTRIES.forEach((entry, index) => {
  const expected = declared.get(sources[index])!
  for (const file of ['index.d.ts', 'index.d.cts']) {
    const built = path.join(repoRoot, 'dist', 'types', entry, file)
    const names = shipped.get(built)!
    const lost = expected.filter(name => !names.includes(name))
    const added = names.filter(name => !expected.includes(name))
    if (lost.length > 0) problems.push(`meocord/${entry} (${file}) does not export ${lost.join(', ')}, which src/${entry}/index.ts declares`)
    if (added.length > 0) problems.push(`meocord/${entry} (${file}) exports ${added.join(', ')}, which src/${entry}/index.ts does not declare`)
  }
})

if (problems.length > 0) {
  console.error(`The built declarations differ from the source entry points:\n${problems.map(problem => `  - ${problem}`).join('\n')}`)
  process.exit(1)
}
const count = [...declared.values()].reduce((sum, names) => sum + names.length, 0)
console.log(`The built declarations export the ${count} names the source entry points declare, for import and require.`)
