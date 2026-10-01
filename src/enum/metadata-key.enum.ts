/**
 * The reflect-metadata keys MeoCord reads and writes, its own and the ones Inversify and TypeScript set.
 *
 * @deprecated Since 4.1, and removed in the next major version (5.0). Internal: nothing replaces it. Read and write
 * your own metadata with `createMetadata` and `ExecutionContext.get`.
 *
 * @internal
 */
export const enum MetadataKey {
  /**
   * Set by Inversify 8's `injectable()` decorator.
   */
  Injectable = '@inversifyjs/core/classIsInjectableFlagReflectKey',

  /**
   * Stores the Inversify `Container` instance on a controller class.
   * Set by `MeoCordFactory.create()`, read by `@UseGuard` at runtime.
   */
  Container = 'inversify:container',

  /**
   * Stores the `@MeoCord()` options object on the app class.
   * Read by `MeoCordFactory.create()` to wire up the container.
   */
  AppOptions = 'meocord:app-options',

  /**
   * TypeScript compiler-emitted metadata listing constructor parameter types.
   * Requires `"emitDecoratorMetadata": true` in tsconfig.
   */
  ParamTypes = 'design:paramtypes',

  /**
   * The guards `@UseGuard` runs before a method, stored on the method: class-level guards first,
   * then method-level ones, in the order they run.
   */
  Guards = 'guards',

  /**
   * Stores the `CommandType` on a `@CommandBuilder` class.
   */
  CommandType = 'commandType',
}
