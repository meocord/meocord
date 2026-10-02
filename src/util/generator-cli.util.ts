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
  // Shared by every generator, so the messages name no kind of component
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
 * Creates a file, and says whether it did. The write is exclusive, so an existing file is never replaced; a failed
 * write sets a non-zero exit code.
 */
export function generateFile(filePath: string, content: string): boolean {
  const relative = path.relative(process.cwd(), filePath)
  try {
    fs.writeFileSync(filePath, content, { flag: 'wx' })
  } catch (error) {
    process.exitCode = 1
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      logger.error(`${relative} already exists; left it untouched.`)
      return false
    }
    logger.error(`Failed to create ${relative}`, error)
    return false
  }
  logger.log(`Created ${relative}`)
  return true
}

/** Creates each file in order with {@link generateFile}, and returns the paths of those it created. */
export function writeFiles(files: readonly (readonly [filePath: string, content: string])[]): string[] {
  return files.filter(([filePath, content]) => generateFile(filePath, content)).map(([filePath]) => filePath)
}

/**
 * Formats the written files with the project's own ESLint in one run, so its type information is built once, and
 * resolves when it ends. A failed run or a rule the template breaks is warned about, never fatal; with no local
 * ESLint it does nothing, rather than download one through `npx`.
 */
export async function formatGeneratedFiles(filePaths: readonly string[]): Promise<void> {
  const script = filePaths.length > 0 ? localESLintScript() : undefined
  if (!script) return

  logger.log("Formatting with your project's ESLint...")
  const failure = await new Promise<string | undefined>(resolve => {
    try {
      execFile(process.execPath, [script, '--fix', ...filePaths], (error, _stdout, stderr) => {
        if (!error) return resolve(undefined)
        // ESLint exits 1 for problems left after fixing, and 2 when it could not run
        if (error.code === 1) return resolve('ESLint reports problems it could not fix; run it on the files to see them.')
        resolve(eslintFailure(stderr) ?? firstLine(error.message))
      })
    } catch (error) {
      resolve(firstLine(error instanceof Error ? error.message : String(error)))
    }
  })
  if (failure !== undefined) logger.warn(`Could not format the generated files: ${failure}`)
}

/** The lines of `text` that say anything, trimmed. */
const linesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)

/** The first line of `text` that says anything, which names the cause. */
const firstLine = (text: string): string | undefined => linesOf(text)[0]

/**
 * What ESLint says stopped it. A fatal error prints "Oops! Something went wrong! :(" and "ESLint: <version>" before
 * the cause, so the cause is the line after the version; other output names it on its first line.
 */
function eslintFailure(stderr: string): string | undefined {
  const lines = linesOf(stderr)
  const version = lines.findIndex(line => /^ESLint: \S+$/.test(line))
  if (version !== -1 && version + 1 < lines.length) return lines[version + 1]
  return lines.find(line => !line.startsWith('Oops! Something went wrong')) ?? lines[0]
}

/**
 * The project's own ESLint, as the script its package names for `eslint`, run with this runtime rather than through
 * `node_modules/.bin`, whose Windows `.cmd` shim can't be spawned without a shell.
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
