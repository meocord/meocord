export { MeoCordTestingModule, TestingModule, TestingModuleBuilder } from '@src/testing/meocord-testing-module.js'
export type {
  FromAppOptions,
  TestingModuleOptions,
  TestingModuleInitOptions,
  HandlerName,
  InvocationResult,
  DispatchedCall,
  DispatchedHandler,
  EmitResult,
} from '@src/testing/meocord-testing-module.js'

export {
  createMock,
  createMockInteraction,
  createChatInputOptions,
  createMockUser,
  createMockClient,
  createMockGuild,
  createMockMember,
  createMockRawMember,
  createMockChannel,
  createMockMessage,
} from '@src/testing/mock-interaction.js'
export type {
  DeepMocked,
  ChatInputOptions,
  MockGuildOverrides,
  MockMemberOverrides,
  MockMessageOverrides,
  MockProps,
  MockRawMemberOverrides,
} from '@src/testing/mock-interaction.js'

export { clearAllMocks, createMockFn, isMockFunction, resetAllMocks, useMockFn } from '@src/testing/mock-fn.js'
export { useStrictMocks } from '@src/testing/strict-mocks.js'
export { reportAllStartupErrors } from '@src/testing/startup-errors.js'
export type { Mock, MockedFunction, MockFnFactory, MockInstance, MockResult, MockSettledResult, MockState, RunnerMock } from '@src/testing/mock-fn.js'

export { resolveRoute, findRouteConflicts } from '@src/testing/routing.js'
export type { ComponentCommandType, MessageToResolve, ResolvedRoute, RouteConflict } from '@src/testing/routing.js'

export { createModalFields } from '@src/testing/modal-fields.js'

export { expectCompleteCatalog } from '@src/testing/catalog.js'

export { testCooldownStore } from '@src/testing/cooldown-store-suite.js'
export type { CooldownStoreSuiteFramework } from '@src/testing/cooldown-store-suite.js'

export { createExecutionContext } from '@src/testing/execution-context.js'
export type { ExecutionContextOptions } from '@src/testing/execution-context.js'

export { inspectHandler } from '@src/testing/inspect-handler.js'
export type {
  HandlerInspection,
  InspectedFilter,
  InspectedCooldown,
  InspectedGuard,
  InspectedInterceptor,
  InspectHandlerOptions,
} from '@src/testing/inspect-handler.js'

export { createDiscordError, getResponse } from '@src/testing/response.js'
export type { ResponseReport } from '@src/testing/response.js'
// The provider shapes the app takes, so a test lists what the app lists
export type {
  ClassProvider,
  FactoryProvider,
  Provider,
  ProviderToken,
  ValueProvider,
} from '@src/interface/provider.interface.js'

export { createMockTheme, withTheme } from '@src/testing/theme.js'
