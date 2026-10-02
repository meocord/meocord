import path from 'path'
import { Logger } from '@src/common/index.js'
import {
  assertFilesAbsent,
  buildTemplate,
  createDirectoryIfNotExists,
  writeFiles,
  validateAndFormatName,
} from '@src/util/generator-cli.util.js'

export class InterceptorGeneratorHelper {
  private readonly logger: Logger

  constructor(private readonly appName: string) {
    this.logger = new Logger(this.appName)
  }

  /**
   * Generates an interceptor and its spec. The name may contain slashes for nested directories.
   * @throws Exits the process when the name is missing or invalid, or a file it would write exists.
   */
  generateInterceptor(interceptorName?: string): string[] {
    if (!interceptorName) {
      this.logger.error('Interceptor name is required.')
      process.exit(1)
    }

    const { parts, kebabCaseName, className } = validateAndFormatName(interceptorName)

    const interceptorDir = path.join(process.cwd(), 'src', 'interceptors', ...parts)
    const interceptorFile = path.join(interceptorDir, `${kebabCaseName}.interceptor.ts`)
    const specFile = path.join(interceptorDir, `${kebabCaseName}.interceptor.spec.ts`)
    // Both files checked before either is written, so an existing interceptor is never replaced.
    assertFilesAbsent([interceptorFile, specFile])

    const interceptorTemplate = buildTemplate(className, 'interceptor.template', { kebabCaseName })
    const specTemplate = buildTemplate(className, 'interceptor.spec.template', { kebabCaseName })

    createDirectoryIfNotExists(interceptorDir)
    return writeFiles([
      [interceptorFile, interceptorTemplate],
      [specFile, specTemplate],
    ])
  }
}
