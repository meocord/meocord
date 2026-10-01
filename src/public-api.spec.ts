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

/** Every name each entry's declarations export, read by the compiler as a consumer's would read them. */
function declaredNames(): Record<string, string[]> {
  const root = path.resolve(import.meta.dirname, '..')
  const { config } = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root)
  const files = Object.values(ENTRY_FILES).map(file => path.join(root, file))
  const program = ts.createProgram(files, { ...options, noEmit: true })
  const checker = program.getTypeChecker()
  return Object.fromEntries(
    Object.entries(ENTRY_FILES).map(([entry, file]) => {
      const module = checker.getSymbolAtLocation(program.getSourceFile(path.join(root, file))!)!
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
    let declared: Record<string, string[]>
    // One program over every entry point, so the checker runs once
    beforeAll(() => {
      declared = declaredNames()
    }, 60_000)

    it.each(Object.keys(TYPE_NAMES))('%s declares exactly its runtime exports and its public types', entry => {
      expect(declared[entry]).toEqual([...(PUBLIC_API[entry] ?? []), ...TYPE_NAMES[entry]].sort())
    })

    it('meocord/eslint declares, for import and require, the names it exports at runtime', async () => {
      const esm = await import('../meocord.eslint.mjs')
      const cjs = createRequire(import.meta.url)('../meocord.eslint.cjs') as object

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
