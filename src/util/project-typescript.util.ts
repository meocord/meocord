import { createRequire } from 'module'
import path from 'path'

/** The `typescript` package the project installed, which meocord does not depend on, or undefined without one. */
export function projectTypeScript(cwd: string): typeof import('typescript') | undefined {
  try {
    return createRequire(path.join(cwd, 'package.json'))('typescript') as typeof import('typescript')
  } catch {
    return undefined
  }
}
