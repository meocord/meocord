import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { Logger } from '@src/common/index.js'
import { camelCase, kebabCase, startCase } from 'lodash-es'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = new Logger('MeoCord')

/**
 * Converts a name to a PascalCase class name.
 * @throws Exits the process when the result is not a valid class name.
 */
export function toClassName(originalName: string): string {
  const className = startCase(camelCase(originalName)).replace(/\s/g, '')

  const classNameRegex = /^[A-Z][A-Za-z0-9]*$/
  if (!classNameRegex.test(className)) {
    logger.error(`Invalid class name "${originalName}". Must start with a letter and contain alphanumeric characters.`)
    process.exit(1)
  }

  return className
}

/**
 * Splits a name like `admin/ban` into its folders, its kebab-case file name, its class name from the whole
 * path (`AdminBan`), and its command name (`admin-ban`).
 * @throws Exits the process when the name is missing or invalid.
 */
export function validateAndFormatName(originalName?: string): {
  parts: string[]
  kebabCaseName: string
  className: string
  commandName: string
} {
  // Shared by every generator -- controllers, services and guards -- so the messages name none.
  if (!originalName) {
    logger.error('A name is required.')
    process.exit(1)
  }

  const parts = originalName.split('/')
  const fileName = parts.pop()
  if (!fileName) {
    logger.error(`Invalid name: "${originalName}".`)
    process.exit(1)
  }

  const kebabCaseName = kebabCase(fileName)
  // The whole path, so admin/ban and ban are AdminBan and Ban: two classes of one name would collide
  // under process sharding and in cooldown keys
  const className = toClassName([...parts, fileName].join(' '))

  return { parts, kebabCaseName, className, commandName: commandNameFor(parts, kebabCaseName) }
}

/**
 * The Discord command name a generated controller registers: the whole path, so `admin/ban` becomes
 * `admin-ban`, since command names are global to the application while files are kept apart by folder.
 */
export function commandNameFor(parts: string[], kebabCaseName: string): string {
  return [...parts.map(part => kebabCase(part)), kebabCaseName].filter(Boolean).join('-')
}

/**
 * Exits before a generator writes anything if any file it would write already exists, so a refusal
 * never leaves half a component behind or replaces an edited file.
 */
export function assertFilesAbsent(filePaths: string[]): void {
  const existing = filePaths.filter(filePath => fs.existsSync(filePath))
  if (existing.length === 0) return

  const names = existing.map(filePath => path.relative(process.cwd(), filePath)).join(', ')
  logger.error(
    `Refusing to overwrite ${existing.length === 1 ? 'an existing file' : 'existing files'}: ${names}. ` +
      'Nothing was generated. Choose another name, or move the existing file first.',
  )
  process.exit(1)
}

/** Creates a directory and its parents if it does not exist. */
export function createDirectoryIfNotExists(directory: string) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true })
  }
}

/**
 * Creates a file and formats it with the project's ESLint. The write is exclusive, so an existing file
 * is never replaced; a failed write sets a non-zero exit code, and formatting, which comes after it,
 * never does.
 */
export function generateFile(filePath: string, content: string): void {
  const relative = path.relative(process.cwd(), filePath)
  try {
    fs.writeFileSync(filePath, content, { flag: 'wx' })
  } catch (error) {
    process.exitCode = 1
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      logger.error(`${relative} already exists; left it untouched.`)
      return
    }
    logger.error(`Failed to create ${relative}`, error)
    return
  }
  logger.log(`Created ${relative}`)
  formatWithLocalESLint(filePath)
}

/**
 * Formats a generated file with the project's own ESLint, when it has one.
 *
 * Reaching for `npx` instead would start downloading ESLint into a project that
 * deliberately does not have it, once per generated file, with no way to see it happen —
 * the call is not awaited. A project with its own rules still gets them applied.
 */
function formatWithLocalESLint(filePath: string): void {
  const script = localESLintScript()
  if (!script) return

  try {
    execFile(process.execPath, [script, '--fix', filePath], () => {
      // Formatting is a courtesy; a project whose rules reject the template should still
      // end up with the file it asked for.
    })
  } catch {
    // Nor one that cannot start: the file is written either way
  }
}

/**
 * The project's own ESLint, as the script its package names for `eslint`, run with this runtime rather than through
 * `node_modules/.bin`: a Windows `.cmd` shim can't be spawned without a shell, so it failed there with EINVAL.
 */
function localESLintScript(): string | undefined {
  const manifest = path.resolve(process.cwd(), 'node_modules', 'eslint', 'package.json')
  if (!fs.existsSync(manifest)) return undefined
  try {
    const { bin } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { bin?: string | Record<string, string> }
    const script = typeof bin === 'string' ? bin : bin?.eslint
    return script ? path.resolve(path.dirname(manifest), script) : undefined
  } catch {
    return undefined
  }
}

/** Renders a builder template, replacing `{{className}}` and any `extra` placeholders. */
export function buildTemplate(className: string, templateFileName: string, extra: Record<string, string> = {}): string {
  const filePath = path.resolve(__dirname, '..', 'bin', 'builder-template', templateFileName)
  let template = fs.readFileSync(filePath, 'utf-8')

  for (const [key, value] of Object.entries({ className, ...extra })) {
    template = template.replaceAll(`{{${key}}}`, value)
  }

  return template
}

/** Renders a template file, replacing each `{{name}}` placeholder with its value. */
export function populateTemplate(filePath: string, variables: Record<string, string>): string {
  let template = fs.readFileSync(filePath, 'utf-8')
  for (const [key, value] of Object.entries(variables)) {
    template = template.replaceAll(`{{${key}}}`, value)
  }
  return template
}
