import path from 'path'
import { Logger } from '@src/common/index.js'
import {
  assertFilesAbsent,
  buildTemplate,
  createDirectoryIfNotExists,
  writeFiles,
  validateAndFormatName,
} from '@src/util/generator-cli.util.js'

export class GuardGeneratorHelper {
  private readonly logger: Logger

  constructor(private readonly appName: string) {
    this.logger = new Logger(this.appName)
  }

  /**
   * Generates a guard and its spec. The name may contain slashes for nested directories.
   * @throws Exits the process when the name is missing or invalid.
   */
  generateGuard(guardName?: string): string[] {
    if (!guardName) {
      this.logger.error('Guard name is required.')
      process.exit(1)
    }

    const { parts, kebabCaseName, className } = validateAndFormatName(guardName)

    const guardDir = path.join(process.cwd(), 'src', 'guards', ...parts)
    const guardFile = path.join(guardDir, `${kebabCaseName}.guard.ts`)
    const specFile = path.join(guardDir, `${kebabCaseName}.guard.spec.ts`)
    // Both files checked before either is written, so an existing guard is never replaced.
    assertFilesAbsent([guardFile, specFile])

    const guardTemplate = buildTemplate(className, 'guard.template', { kebabCaseName })
    const specTemplate = buildTemplate(className, 'guard.spec.template', { kebabCaseName })

    createDirectoryIfNotExists(guardDir)
    return writeFiles([
      [guardFile, guardTemplate],
      [specFile, specTemplate],
    ])
  }
}
