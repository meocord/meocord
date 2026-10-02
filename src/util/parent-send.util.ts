/** How long a message to the parent process may take to be sent before the parent is taken to be gone. */
export const PARENT_SEND_TIMEOUT_MS = 1000

/**
 * Sends a message over the IPC channel to the parent process and waits until it is sent, or `PARENT_SEND_TIMEOUT_MS`:
 * Bun does not call back once the parent is gone, where Node calls back with an error, and a closed channel may throw.
 * The timer is unref'd, so it never keeps the process alive by itself.
 */
export async function sendToParent(message: unknown): Promise<void> {
  if (!process.send) return
  const sent = new Promise<void>(resolve => {
    try {
      process.send!(message, undefined, {}, () => resolve())
    } catch {
      resolve()
    }
  })
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<void>(resolve => {
    timer = setTimeout(resolve, PARENT_SEND_TIMEOUT_MS)
    timer.unref()
  })
  await Promise.race([sent, timedOut])
  clearTimeout(timer)
}
