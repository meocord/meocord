import { createRequire } from 'module'
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
})

// Resolved by the package's own name, as tools reading the installed version do; only the exports map decides it
describe('package.json', () => {
  it('is reachable as meocord/package.json', () => {
    const manifest = createRequire(import.meta.url)('meocord/package.json') as { name: string }

    expect(manifest.name).toBe('meocord')
  })
})
