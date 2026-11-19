import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * The calls an app is running, which shutdown waits for before the `onShutdown` hooks. A call that asks the app to
 * stop is excused, so a handler awaiting `app.stop()` never waits for itself.
 */
export class RunningCalls {
  private readonly currentToken = new AsyncLocalStorage<object>()
  /** Each call under way, by its token, with the name a log gives it. */
  private readonly calls = new Map<object, string>()
  /** Each call's name, kept once it settles, for a line naming a call a stop dropped. */
  private readonly labels = new WeakMap<object, string>()
  private readonly excused = new WeakSet<object>()
  /** The calls a stop dropped before they started, which no wait waits for and the running calls leave out. */
  private readonly dropped = new WeakSet<object>()
  private changed?: PromiseWithResolvers<void>

  /** Runs `run` as a call named `label`, tracked until it settles. */
  run<T>(label: string, run: () => Promise<T>): Promise<T> {
    const token = {}
    this.calls.set(token, label)
    this.labels.set(token, label)
    const done = this.currentToken.run(token, run)
    const settle = () => {
      this.calls.delete(token)
      this.notify()
    }
    done.then(settle, settle)
    return done
  }

  /** Excuses the call this runs in, and any it runs within, from the wait; outside a call, nothing. */
  excuseCurrent(): void {
    const token = this.currentToken.getStore()
    if (!token || !this.calls.has(token)) return
    this.excused.add(token)
    this.notify()
  }

  /** The call this runs in, as {@link drop} takes it; outside a call, `undefined`. */
  current(): object | undefined {
    return this.currentToken.getStore()
  }

  /** Takes `call`, which a stop dropped before it started, off the calls a wait waits for; gives the name it ran under. */
  drop(call: object): string | undefined {
    this.dropped.add(call)
    this.notify()
    return this.labels.get(call)
  }

  /** The names of the calls a wait would still wait for. */
  running(): string[] {
    return [...this.calls].filter(([token]) => !this.excused.has(token) && !this.dropped.has(token)).map(([, label]) => label)
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
