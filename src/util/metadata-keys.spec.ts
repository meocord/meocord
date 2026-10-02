import path from 'path'
import ts from 'typescript'

const SRC = path.resolve(import.meta.dirname, '..')

/** The keys of other tools MeoCord reads or writes: TypeScript's parameter types and inversify's two. */
const FOREIGN_KEYS = new Set([
  'design:paramtypes',
  '@inversifyjs/core/classIsInjectableFlagReflectKey',
  '@inversifyjs/core/classMetadataReflectKey',
])

/** Where a call passes on a key its caller chose, by file and the function it is in: never one of MeoCord's own. */
const USER_KEY_SITES: Record<string, string> = {
  'common/decorator.ts': 'SetMetadata',
  'common/metadata.ts': 'createMetadata',
  'common/execution-context.ts': 'getAll',
}

/** Whether a call is in the one function of its file that passes on its caller's key. */
const isUserKeySite = (file: string, node: ts.Node): boolean => file in USER_KEY_SITES && USER_KEY_SITES[file] === enclosingName(node)

/** The registry's keys, or none where there is no registry to read. */
async function registryKeys(): Promise<string[]> {
  try {
    const { META } = (await import('@src/util/metadata-keys.js')) as { META: Record<string, string> }
    return Object.values(META)
  } catch {
    return []
  }
}

/** The name of the function or method a node is in, skipping the anonymous ones between. */
function enclosingName(node: ts.Node): string | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) return current.name.getText()
  }
  return undefined
}

/** The string values a key's type can take, or undefined when one of them is no string literal, such as a symbol. */
function stringValues(type: ts.Type): string[] | undefined {
  const parts = type.isUnion() ? type.types : [type]
  const values: string[] = []
  for (const part of parts) {
    if (!part.isStringLiteral()) return undefined
    values.push(part.value)
  }
  return values
}

describe('the metadata keys MeoCord keeps', () => {
  it('each begin with meocord:, once', async () => {
    const keys = await registryKeys()

    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter(key => !key.startsWith('meocord:'))).toEqual([])
    expect(new Set(keys).size).toBe(keys.length)
  })

  // Typed, so a key passed through a helper's parameter counts by what it can be, and a new key outside the registry fails
  it('are the only keys src passes to Reflect, apart from other tools’ and a key its caller chose', async () => {
    const allowed = new Set([...(await registryKeys()), ...FOREIGN_KEYS])
    const config = ts.getParsedCommandLineOfConfigFile(path.resolve(SRC, '..', 'tsconfig.json'), {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: diagnostic => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    })!
    const files = config.fileNames.filter(file => file.startsWith(SRC) && !/\.(spec|test-d)\.ts$/.test(file))
    const program = ts.createProgram(files, config.options)
    const checker = program.getTypeChecker()

    const offending: string[] = []
    for (const file of files) {
      const source = program.getSourceFile(file)!
      const relative = path.relative(SRC, file).split(path.sep).join('/')
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText() === 'Reflect' &&
          /Metadata$/.test(node.expression.name.text) &&
          node.arguments.length > 0 &&
          !isUserKeySite(relative, node)
        ) {
          const [key] = node.arguments
          const values = stringValues(checker.getTypeAtLocation(key!))
          if (!values || values.some(value => !allowed.has(value))) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart())
            offending.push(`${relative}:${line + 1}: ${key!.getText()}`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }

    expect(offending).toEqual([])
  }, 60_000)
})
