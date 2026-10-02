import { describe, expectTypeOf, it } from 'vitest'
import { type ExecutionContext } from '@src/common/index.js'
import { Interceptor, MeoCord, Observer, Service } from '@src/decorator/index.js'
import { type CallHandler, type DispatchObserver, type DispatchOutcome, type DispatchResult, type InterceptorInterface } from '@src/interface/index.js'
import { MeoCordTestingModule } from '@src/testing/index.js'

/**
 * Runs under `vitest --typecheck`. The negative cases use `@ts-expect-error`,
 * which fails once the rejected form starts compiling.
 */

/** The part of OpenTelemetry's tracer the observers guide's tracing example uses. */
interface Span {
  setAttribute(key: string, value: string): this
  end(): void
}
declare const tracer: {
  startSpan(name: string): Span
  startActiveSpan<T>(name: string, run: (span: Span) => T): T
}

@Service()
class MetricsService {
  record(_type: string, _handler: string, _outcome: DispatchOutcome, _durationMs: number): void {
    // Only its type is under test
  }
}

@Service()
class AuditService {
  write(_handler: string | undefined, _outcome: DispatchOutcome, _error: unknown): void {
    // Only its type is under test
  }
}

describe('@Observer', () => {
  it('takes a class with onSettled, sync or async', () => {
    @Observer()
    class Sync implements DispatchObserver {
      onSettled(_context: ExecutionContext, _result: DispatchResult): void {
        // Only its type is under test
      }
    }

    @Observer()
    class Async implements DispatchObserver {
      async onSettled(): Promise<void> {
        // Only its type is under test
      }
    }
    void [Sync, Async]
  })

  it('takes the context types it is told about', () => {
    @Observer({ types: ['interaction', 'autocomplete'] })
    class Interactions implements DispatchObserver {
      onSettled(): void {
        // Only its type is under test
      }
    }
    void Interactions

    // @ts-expect-error 'command' is not a context type
    @Observer({ types: ['command'] })
    class Wrong implements DispatchObserver {
      onSettled(): void {
        // Only its type is under test
      }
    }
    void Wrong
  })

  it('refuses a class without onSettled', () => {
    // @ts-expect-error an observer needs onSettled
    @Observer()
    class NotAnObserver {}
    void NotAnObserver
  })

  it('describes the result', () => {
    expectTypeOf<DispatchOutcome>().toEqualTypeOf<'ran' | 'denied' | 'cooldown' | 'invalid' | 'refused' | 'error' | 'not-found'>()
    expectTypeOf<DispatchResult>().toEqualTypeOf<{
      outcome: DispatchOutcome
      startedAt: number
      durationMs: number
      deniedBy?: abstract new (...args: any[]) => unknown
      response?: 'replied' | 'deferred' | 'unanswered'
      error?: unknown
      handled: boolean
    }>()
    expectTypeOf<DispatchObserver['onStart']>().toEqualTypeOf<((context: ExecutionContext) => void) | undefined>()
  })

  it('is listed by @MeoCord and the testing module, which refuses a class that is not an observer', () => {
    @Observer()
    class Audit implements DispatchObserver {
      onSettled(): void {
        // Only its type is under test
      }
    }
    class Plain {}

    @MeoCord({ controllers: [], clientOptions: { intents: [] }, observers: [Audit] })
    class App {}
    void App

    MeoCordTestingModule.create({ observers: [Audit] })
    // @ts-expect-error not an observer
    MeoCordTestingModule.create({ observers: [Plain] })
  })

  it('compiles an observer that injects a service and records each call', () => {
    @Observer()
    class MetricsObserver implements DispatchObserver {
      constructor(private readonly metrics: MetricsService) {}

      onSettled(context: ExecutionContext, { outcome, durationMs }: DispatchResult) {
        this.metrics.record(context.getType(), context.getHandlerName() ?? 'unrouted', outcome, durationMs)
      }
    }
    void MetricsObserver
  })

  it('compiles an observer listed in @MeoCord that audits the calls that did not run', () => {
    @Observer()
    class AuditObserver implements DispatchObserver {
      constructor(private readonly audit: AuditService) {}

      onSettled(context: ExecutionContext, { outcome, error }: DispatchResult) {
        if (outcome !== 'ran') this.audit.write(context.getHandlerName(), outcome, error)
      }
    }

    @MeoCord({ controllers: [], observers: [AuditObserver], clientOptions: { intents: [] } })
    class App {}
    void App
  })

  it("compiles the observers guide's tracing example", () => {
    // The call's own span, from the moment it arrives, whatever the outcome
    @Observer()
    class CallSpanObserver implements DispatchObserver {
      private readonly spans = new WeakMap<ExecutionContext, Span>()

      onStart(context: ExecutionContext) {
        this.spans.set(context, tracer.startSpan(`${context.getType()} ${context.getHandlerName()}`))
      }

      onSettled(context: ExecutionContext, { outcome }: DispatchResult) {
        const span = this.spans.get(context)
        span?.setAttribute('meocord.outcome', outcome)
        span?.end()
      }
    }

    // The handler's span, active while it runs, so the spans it starts nest under it
    @Interceptor()
    class HandlerSpanInterceptor implements InterceptorInterface {
      async intercept(context: ExecutionContext, next: CallHandler) {
        return tracer.startActiveSpan(`handler ${context.getHandlerName()}`, async span => {
          try {
            return await next.handle()
          } finally {
            span.end()
          }
        })
      }
    }
    void [CallSpanObserver, HandlerSpanInterceptor]
  })
})
