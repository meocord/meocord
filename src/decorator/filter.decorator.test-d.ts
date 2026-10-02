import { describe, it } from 'vitest'
import { type ExecutionContext } from '@src/common/index.js'
import { Catch } from '@src/decorator/index.js'
import { type ExceptionFilter } from '@src/interface/index.js'

/** Runs under `vitest --typecheck`: a filter typed by the error its `@Catch` names. */

class RateLimitedError extends Error {
  constructor(readonly retryAfter: number) {
    super('Rate limited')
  }
}

describe('ExceptionFilter', () => {
  it('compiles a filter typed by the error its @Catch names', () => {
    @Catch(RateLimitedError)
    class RateLimitedFilter implements ExceptionFilter<RateLimitedError> {
      async catch(error: RateLimitedError, context: ExecutionContext) {
        // Private, and right wherever the answer stands: a reply, the deferred reply edited, or a follow-up
        await context.response?.error(error, { message: `Slow down: try again in ${error.retryAfter}s.` })
      }
    }
    void RateLimitedFilter
  })
})
