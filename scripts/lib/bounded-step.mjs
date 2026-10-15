// Runs one setup step as a group: the command and everything it starts. Once the budget passes, it stops the whole
// group, so no install or ESLint run it started is left running, and says so on fd 3, which the step can't write to.
// Plain JavaScript, so Node runs it as well as Bun. Arguments: budget in ms, `shell` or `direct`, the command, then
// its arguments.
import { spawn, spawnSync } from 'child_process'
import { writeSync } from 'fs'
import { constants } from 'os'

/** What it writes on fd 3 when it stopped the step at its budget. */
const STOPPED = 'stopped at budget'
/** Signals that stop the caller, as Ctrl+C does, which reach this process but not the step's own group. */
const STOPPING = ['SIGINT', 'SIGTERM', 'SIGHUP']

const [budgetMs, how, command, ...args] = process.argv.slice(2)
const posix = process.platform !== 'win32'
// Its own process group off Windows, so one signal reaches every process the step started
const child = spawn(command, args, { stdio: 'inherit', detached: posix, shell: how === 'shell' })

/** Sends the step and everything it started a signal: on Windows, stops them all. */
function stopAll(signal) {
  if (posix) {
    try {
      process.kill(-child.pid, signal)
    } catch {
      // Already gone
    }
  } else {
    // No process groups on Windows: /T stops the step and every process it started
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

const timer = setTimeout(() => {
  stopAll('SIGKILL')
  writeSync(3, STOPPED)
  process.exit(1)
}, Number(budgetMs))

// The step left its caller's group, so a signal that stops the caller reaches it through this process, as it would
// have reached it in that group
for (const signal of STOPPING) {
  process.on(signal, () => {
    stopAll(signal)
    process.exit(128 + constants.signals[signal])
  })
}

child.on('error', error => {
  clearTimeout(timer)
  console.error(error.message)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  clearTimeout(timer)
  process.exit(code ?? (signal ? 1 : 0))
})
