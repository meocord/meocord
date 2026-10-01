import { createRequire } from 'module'
import path from 'path'
import ts from 'typescript'
import * as common from '@src/common/index.js'
import * as core from '@src/core/index.js'
import * as decorator from '@src/decorator/index.js'
import * as enums from '@src/enum/index.js'
import * as testing from '@src/testing/index.js'

// The runtime exports of each entry point. A new name here is a public API addition, and removing
// one breaks applications importing it, so either change is made here on purpose.
const PUBLIC_API: Record<string, string[]> = {
  'meocord/core': ['HandlerRegistry', 'MeoCordFactory', 'ShardContext'],
  'meocord/decorator': [
    'Autocomplete',
    'Catch',
    'Command',
    'CommandBuilder',
    'Controller',
    'Defer',
    'Cooldown',
    'Guard',
    'Inject',
    'Interceptor',
    'MeoCord',
    'MessageHandler',
    'Observer',
    'On',
    'Once',
    'Pipe',
    'ReactionHandler',
    'Service',
    'UseFilter',
    'UseGuard',
    'UseInterceptor',
    'UsePipe',
    'UseTheme',
    'Validate',
  ],
  'meocord/common': [
    'CommandNotFoundError',
    'CooldownError',
    'CooldownStore',
    'CooldownStoreError',
    'ExecutionContext',
    'GuardDeniedError',
    'Logger',
    'MemoryCooldownStore',
    'MessageUsageError',
    'RedisCooldownStore',
    'SetMetadata',
    'ShardedCooldownStore',
    'Theme',
    'ThemeCache',
    'Translator',
    'UserError',
    'ValidationError',
    'applyDecorators',
    'bindTheme',
    'cooldownMessage',
    'cooldownStoreMessage',
    'createMetadata',
    'createToken',
    'createTranslator',
    'defineCatalog',
    'factoryProvider',
    'getInstallContext',
    'isExplainedError',
    'respond',
    'route',
    'translateError',
    'useTheme',
  ],
  'meocord/enum': ['CommandType', 'MetadataKey', 'ReactionHandlerAction'],
  'meocord/testing': [
    'MeoCordTestingModule',
    'TestingModule',
    'TestingModuleBuilder',
    'clearAllMocks',
    'createChatInputOptions',
    'createDiscordError',
    'createExecutionContext',
    'createMock',
    'createMockChannel',
    'createMockClient',
    'createMockFn',
    'createMockGuild',
    'createMockInteraction',
    'createMockMember',
    'createMockMessage',
    'createMockTheme',
    'createMockUser',
    'createModalFields',
    'expectCompleteCatalog',
    'findRouteConflicts',
    'getResponse',
    'inspectHandler',
    'isMockFunction',
    'resetAllMocks',
    'resolveRoute',
    'testCooldownStore',
    'withTheme',
  ],
}

// The names each entry point declares beyond its runtime exports: its types, and `declare`d values with no runtime
// form. They are public API too, so adding or removing one is made here on purpose, as above.
const TYPE_NAMES: Record<string, string[]> = {
  'meocord/core': [
    'AutocompleteHandlerEntry',
    'CommandHandlerEntry',
    'ComponentHandlerEntry',
    'EventHandlerEntry',
    'HandlerEntry',
    'HandlerFilter',
    'HandlerKind',
    'MeoCordApplication',
    'MessageHandlerEntry',
    'ModalHandlerEntry',
    'ReactionHandlerEntry',
    'ShardCallResult',
  ],
  'meocord/decorator': [
    'DeferOptions',
  ],
  'meocord/common': [
    'CatalogDefinition',
    'CatalogShape',
    'CooldownBatchVerdict',
    'CooldownEntry',
    'CooldownLimit',
    'CooldownScope',
    'CooldownVerdict',
    'ExecutionContextType',
    'Injected',
    'InstallContext',
    'LocaleCatalog',
    'MessageKey',
    'MessageParams',
    'MessageUsageIssue',
    'MetadataDecorator',
    'PluralCategory',
    'PluralMessage',
    'Provided',
    'RedisCooldownStoreOptions',
    'RedisEval',
    'RedisEvalSha',
    'ResponseCall',
    'ResponseEditFlags',
    'ResponseEditPayload',
    'ResponseErrorOptions',
    'ResponseFlags',
    'ResponsePayload',
    'ResponsePhase',
    'ResponseSendOptions',
    'ResponseState',
    'Route',
    'RouteParams',
    'RouteValue',
    'RouteValues',
    'StringMessageKey',
    'Translate',
    'TranslatorOptions',
    'UserErrorOptions',
    'ValidationIssue',
  ],
  'meocord/interface': [
    'AutocompleteMetadata',
    'BuildableCommandType',
    'CallHandler',
    'CheckedParams',
    'ClassProvider',
    'CommandBuildResult',
    'CommandBuilderBase',
    'CommandBuilderConstructor',
    'CommandBuilderOptions',
    'CommandInteractionType',
    'CommandMetadata',
    'CommandRegistrationConfig',
    'ControllerOptions',
    'CooldownOptions',
    'CooldownStoreFailure',
    'DeepPartial',
    'DeepReadonly',
    'DispatchObserver',
    'DispatchOutcome',
    'DispatchResult',
    'EntityRef',
    'ExceptionFilter',
    'FactoryProvider',
    'GuardInterface',
    'GuildThemeTarget',
    'InferSchemaOutput',
    'InterceptorInterface',
    'MeoCordApplication',
    'MeoCordConfig',
    'MeoCordMessages',
    'MeoCordTheme',
    'MessageCommandOptions',
    'MessageHandlerOptions',
    'MessageHelp',
    'MessageHelpEntry',
    'MessageHelpOptions',
    'MessageHelpParam',
    'MessageParamType',
    'MessageParamTypes',
    'MessagePrefix',
    'MessageScope',
    'OnReady',
    'OnShutdown',
    'PIPED_BRAND',
    'ParamRefsOf',
    'ParamsOf',
    'PipeInterface',
    'Piped',
    'PresentedError',
    'Provider',
    'ProviderToken',
    'ReactionEvent',
    'ReactionHandlerOptions',
    'ReactionHandlerSettings',
    'ReadyInfo',
    'ReservedThemeRole',
    'ResponseContext',
    'ResponsePresenter',
    'ResponseView',
    'RootTheme',
    'RsbuildConfig',
    'ShardingConfig',
    'StageParams',
    'StandardSchemaV1',
    'StandardSchemaV1Issue',
    'StandardSchemaV1Props',
    'StandardSchemaV1Result',
    'ThemeButtonStyle',
    'ThemeButtons',
    'ThemeColors',
    'ThemeEmojis',
    'ThemeOverride',
    'ThemeResolvers',
    'Token',
    'UserThemeTarget',
    'ValueProvider',
  ],
  'meocord/enum': [],
  'meocord/testing': [
    'ChatInputOptions',
    'ClassProvider',
    'ComponentCommandType',
    'CooldownStoreSuiteFramework',
    'DeepMocked',
    'DispatchedCall',
    'DispatchedHandler',
    'EmitResult',
    'ExecutionContextOptions',
    'FactoryProvider',
    'FromAppOptions',
    'HandlerInspection',
    'HandlerName',
    'InspectHandlerOptions',
    'InspectedCooldown',
    'InspectedFilter',
    'InspectedGuard',
    'InspectedInterceptor',
    'InvocationResult',
    'MessageToResolve',
    'Mock',
    'MockGuildOverrides',
    'MockInstance',
    'MockMemberOverrides',
    'MockMessageOverrides',
    'MockProps',
    'MockResult',
    'MockState',
    'MockedFunction',
    'Provider',
    'ProviderToken',
    'ResolvedRoute',
    'ResponseReport',
    'RouteConflict',
    'TestingModuleInitOptions',
    'TestingModuleOptions',
    'ValueProvider',
  ],
}

// What goes in the next major version: each name here is removed, or for an internal one stops being exported. A
// behaviour deprecated without a name, such as retrying start() after a failed login, warns at runtime instead.
const DEPRECATED = [
  'AutocompleteMetadata',
  'CommandMetadata',
  'ExecutionContext.get',
  'ExecutionContext.getAll',
  'MetadataKey',
  'ReactionHandlerOptions',
  'ResponsePayload.ephemeral',
  'SetMetadata',
  'Theme',
  'Theme.errorColor',
  'Theme.infoColor',
  'Theme.primaryColor',
  'Theme.successColor',
  'Theme.warningColor',
]

// A tag names its replacement and why, or says the name is internal
const DEPRECATION_TAG =
  /^Since 4\.1, and removed in the next major version \(5\.0\)\. (Use `[^`]+` instead\. \S.*|Internal: nothing replaces it\.( \S.*)?)$/

const ENTRY_FILES: Record<string, string> = {
  'meocord/core': 'src/core/index.ts',
  'meocord/decorator': 'src/decorator/index.ts',
  'meocord/common': 'src/common/index.ts',
  'meocord/interface': 'src/interface/index.ts',
  'meocord/enum': 'src/enum/index.ts',
  'meocord/testing': 'src/testing/index.ts',
  'meocord/eslint (import)': 'meocord.eslint.d.ts',
  'meocord/eslint (require)': 'meocord.eslint.d.cts',
}

const ROOT = path.resolve(import.meta.dirname, '..')

/** One program over every entry point, read by the compiler as a consumer's would read it. */
function entryProgram(): ts.Program {
  const { config } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT)
  const host = ts.createCompilerHost({ ...options, noEmit: true }, true)
  // Comments are parsed in full, as an editor parses them, so `@deprecated` tags can be read
  host.jsDocParsingMode = ts.JSDocParsingMode.ParseAll
  return ts.createProgram({ rootNames: Object.values(ENTRY_FILES).map(file => path.join(ROOT, file)), options: { ...options, noEmit: true }, host })
}

/** Every name each entry's declarations export. */
function declaredNames(program: ts.Program): Record<string, string[]> {
  const checker = program.getTypeChecker()
  return Object.fromEntries(
    Object.entries(ENTRY_FILES).map(([entry, file]) => {
      const module = checker.getSymbolAtLocation(program.getSourceFile(path.join(ROOT, file))!)!
      const exported = checker.getExportsOfModule(module)
      // `export =` declares no names of its own: the value require() returns carries them as properties
      const names = exported.length
        ? exported
        : checker
            .getTypeOfSymbol(checker.getAliasedSymbol(module.exports!.get(ts.InternalSymbolName.ExportEquals)!))
            .getProperties()
            .filter(symbol => symbol.declarations?.every(node => !program.isSourceFileDefaultLibrary(node.getSourceFile())))
      return [entry, names.map(symbol => symbol.name).sort()]
    }),
  )
}

/** A declaration's name with those of the declarations it sits in, such as `Theme.primaryColor`. */
function qualifiedName(node: ts.Node): string {
  const names: string[] = []
  for (let at: ts.Node | undefined = node; at && !ts.isSourceFile(at); at = at.parent) {
    // A `const`'s comment is on its statement, and its name on the declaration inside
    const named = ts.isVariableStatement(at) ? at.declarationList.declarations[0] : (at as ts.NamedDeclaration)
    if (named.name && (ts.isIdentifier(named.name) || ts.isStringLiteral(named.name))) names.unshift(named.name.text)
  }
  return names.join('.')
}

/** Every `@deprecated` tag in the shipped source, by the name it is on, with its text on one line. */
function deprecatedTags(program: ts.Program): Record<string, string> {
  const tags: Record<string, string> = {}
  const visit = (node: ts.Node): void => {
    const tag = ts.getJSDocDeprecatedTag(node)
    if (tag && tag.parent.parent === node) {
      tags[qualifiedName(node)] = (ts.getTextOfJSDocComment(tag.comment) ?? '').replace(/\s+/g, ' ').trim()
    }
    ts.forEachChild(node, visit)
  }
  for (const file of program.getSourceFiles()) {
    if (!path.relative(ROOT, file.fileName).split(path.sep).includes('node_modules')) visit(file)
  }
  return tags
}

const modules: Record<string, object> = {
  'meocord/core': core,
  'meocord/decorator': decorator,
  'meocord/common': common,
  'meocord/enum': enums,
  'meocord/testing': testing,
}

describe('public API', () => {
  it.each(Object.keys(PUBLIC_API))('%s exports exactly its public names', entry => {
    expect(Object.keys(modules[entry]).sort()).toEqual([...PUBLIC_API[entry]].sort())
  })

  describe('declarations', () => {
    let program: ts.Program
    let declared: Record<string, string[]>
    let esm: object
    let cjs: object
    // One program over every entry point, so the checker runs once; the ESLint configs load every plugin they name
    beforeAll(async () => {
      program = entryProgram()
      declared = declaredNames(program)
      esm = await import('../meocord.eslint.mjs')
      cjs = createRequire(import.meta.url)('../meocord.eslint.cjs') as object
    }, 60_000)

    it.each(Object.keys(TYPE_NAMES))('%s declares exactly its runtime exports and its public types', entry => {
      expect(declared[entry]).toEqual([...(PUBLIC_API[entry] ?? []), ...TYPE_NAMES[entry]].sort())
    })

    it('deprecates exactly the names listed, each tagged with when it goes and what replaces it', () => {
      const tags = deprecatedTags(program)

      expect(Object.keys(tags).sort()).toEqual([...DEPRECATED].sort())
      for (const [name, text] of Object.entries(tags)) expect({ name, text }).toEqual({ name, text: expect.stringMatching(DEPRECATION_TAG) })
    })

    it('meocord/eslint declares, for import and require, the names it exports at runtime', () => {
      expect(Object.keys(esm).sort()).toEqual(['default', 'typescriptConfig'])
      expect(declared['meocord/eslint (import)']).toEqual(['default', 'typescriptConfig'])
      expect(Object.keys(cjs).filter(key => Number.isNaN(Number(key)))).toEqual(['typescriptConfig'])
      expect(declared['meocord/eslint (require)']).toEqual(['typescriptConfig'])
    })
  })
})

// Resolved by the package's own name, as tools reading the installed version do; only the exports map decides it
describe('package.json', () => {
  it('is reachable as meocord/package.json', () => {
    const manifest = createRequire(import.meta.url)('meocord/package.json') as { name: string }

    expect(manifest.name).toBe('meocord')
  })
})
