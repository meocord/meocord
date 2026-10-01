import path from 'path'
import { Logger } from '@src/common/index.js'
import {
  assertFilesAbsent,
  buildTemplate,
  createDirectoryIfNotExists,
  writeFiles,
  validateAndFormatName,
} from '@src/util/generator-cli.util.js'

export class ObserverGeneratorHelper {
  private readonly logger: Logger

  constructor(private readonly appName: string) {
    this.logger = new Logger(this.appName)
  }

  /**
   * Generates an observer and its spec. The name may contain slashes for nested directories.
   * @throws Exits the process when the name is missing or invalid.
   */
  generateObserver(observerName?: string): string[] {
    if (!observerName) {
      this.logger.error('Observer name is required.')
      process.exit(1)
    }

    const { parts, kebabCaseName, className } = validateAndFormatName(observerName)

    const observerDir = path.join(process.cwd(), 'src', 'observers', ...parts)
    const observerFile = path.join(observerDir, `${kebabCaseName}.observer.ts`)
    const specFile = path.join(observerDir, `${kebabCaseName}.observer.spec.ts`)
    // Both files checked before either is written, so an existing observer is never replaced.
    assertFilesAbsent([observerFile, specFile])

    const observerTemplate = buildTemplate(className, 'observer.template', { kebabCaseName })
    const specTemplate = buildTemplate(className, 'observer.spec.template', { kebabCaseName })

    createDirectoryIfNotExists(observerDir)
    return writeFiles([
      [observerFile, observerTemplate],
      [specFile, specTemplate],
    ])
  }
}
