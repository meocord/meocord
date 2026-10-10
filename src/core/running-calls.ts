import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The calls an app is running, which shutdown waits for before the `onShutdown` hooks. A call that asks the app to
 * stop is excused, so a handler awaiting `app.stop()` never waits for itself.
 */
export class RunningCalls {
  private readonly current = new AsyncLocalStorage<object>()
  /** Each call under way, by its token, with the name a log gives it. */
  private readonly calls = new Map<object, string>()
  private readonly excused = new WeakSet<object>()
  private changed?: PromiseWithResolvers<void>

  /** Runs `run` as a call named `label`, tracked until it settles. */
  run<T>(label: string, run: () => Promise<T>): Promise<T> {
    const token = {}
    this.calls.set(token, label)
    const done = this.current.run(token, run)
    const settle = () => {
      this.calls.delete(token)
      this.notify()
    }
    done.then(settle, settle)
    return done
  }

  /** Excuses the call this runs in, and any it runs within, from the wait; outside a call, nothing. */
  excuseCurrent(): void {
    const token = this.current.getStore()
    if (!token || !this.calls.has(token)) return
    this.excused.add(token)
    this.notify()
  }

  /** The names of the calls a wait would still wait for. */
  running(): string[] {
    return [...this.calls].filter(([token]) => !this.excused.has(token)).map(([, label]) => label)
  }

  /** Settles once every call not excused has, those that start or are excused meanwhile included. */
  async settled(): Promise<void> {
    while (this.running().length > 0) await (this.changed ??= Promise.withResolvers<void>()).promise
  }

  private notify(): void {
    this.changed?.resolve()
    this.changed = undefined
  }
}
