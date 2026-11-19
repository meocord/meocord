import { afterEach, beforeEach } from 'vitest'

// Each test starts and ends with the process's exit code cleared, so no test reads a code another set, and a code the
// last test sets doesn't end the test process with it. The clear is 0: Node clears the code on
// `process.exitCode = undefined`, but Bun keeps the old one, and a process with 0 exits as one with none, which is how
// the shipped code clears a code it set.
const clear = () => {
  process.exitCode = 0
}
beforeEach(clear)
afterEach(clear)
