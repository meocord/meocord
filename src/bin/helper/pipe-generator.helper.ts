import path from 'path'
import { Logger } from '@src/common/index.js'
import {
  assertFilesAbsent,
  buildTemplate,
  createDirectoryIfNotExists,
  writeFiles,
  validateAndFormatName,
} from '@src/util/generator-cli.util.js'

export class PipeGeneratorHelper {
  private readonly logger: Logger

  constructor(private readonly appName: string) {
    this.logger = new Logger(this.appName)
  }

  /**
   * Generates a pipe and its spec. The name may contain slashes for nested directories.
   * @throws Exits the process when the name is missing or invalid.
   */
  generatePipe(pipeName?: string): string[] {
    if (!pipeName) {
      this.logger.error('Pipe name is required.')
      process.exit(1)
    }

    const { parts, kebabCaseName, className } = validateAndFormatName(pipeName)

    const pipeDir = path.join(process.cwd(), 'src', 'pipes', ...parts)
    const pipeFile = path.join(pipeDir, `${kebabCaseName}.pipe.ts`)
    const specFile = path.join(pipeDir, `${kebabCaseName}.pipe.spec.ts`)
    // Both files checked before either is written, so an existing pipe is never replaced.
    assertFilesAbsent([pipeFile, specFile])

    const pipeTemplate = buildTemplate(className, 'pipe.template', { kebabCaseName })
    const specTemplate = buildTemplate(className, 'pipe.spec.template', { kebabCaseName })

    createDirectoryIfNotExists(pipeDir)
    return writeFiles([
      [pipeFile, pipeTemplate],
      [specFile, specTemplate],
    ])
  }
}
