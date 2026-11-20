import { spawn } from 'node:child_process'
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as ts from 'typescript'
import {
  addedProblems,
  type AppListing,
  importSpecifier,
  listingProblemMessage,
  listInApp,
  listInAppSource,
  projectTypeScript,
} from '@src/bin/app-listing.js'
import { ESLintBudget, lintFile } from '@src/util/generator-cli.util.js'

const REPO = path.resolve(import.meta.dirname, '..', '..')
const TEMPLATE = readFileSync(path.join(REPO, 'src', 'bin', 'app-template', 'src', 'app.ts.template'), 'utf8')

const TICKET: AppListing = { className: 'TicketButtonController', list: 'controllers', specifier: '@src/controllers/button/ticket.button.controller' }
const AUDIT: AppListing = { className: 'AuditObserver', list: 'observers', specifier: '@src/observers/audit.observer' }

/** The syntax errors TypeScript finds in a file. */
const syntaxErrors = (text: string) =>
  (ts.transpileModule(text, { reportDiagnostics: true, compilerOptions: { experimentalDecorators: true } }).diagnostics ?? []).map(each =>
    ts.flattenDiagnosticMessageText(each.messageText, '\n'),
  )

const edited = (source: string, listing: AppListing) => {
  const edit = listInAppSource(ts, source, listing)
  if (!('text' in edit)) throw new Error(`no edit: ${JSON.stringify(edit)}`)
  return edit.text
}

/** An app file around the given `@MeoCord` options. */
const app = (options: string, imports = "import { MeoCord } from 'meocord/decorator'\n") => `${imports}\n@MeoCord(${options})\nexport default class App {}\n`

describe('listInAppSource', () => {
  it("adds a controller to the template's list and its import after the last one, changing no other line", () => {
    const text = edited(TEMPLATE, TICKET)

    expect(text).toContain(
      "import { AppPresenter } from '@src/presenters/app.presenter'\nimport { TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n",
    )
    expect(text).toContain('    // Modal Submit\n    SampleModalSubmitController,\n    TicketButtonController,\n  ],')
    const added = text.split('\n').filter(line => !TEMPLATE.split('\n').includes(line))
    expect(added).toEqual(["import { TicketButtonController } from '@src/controllers/button/ticket.button.controller'", '    TicketButtonController,'])
  })

  it('adds observers to the options when they have none', () => {
    const text = edited(TEMPLATE, AUDIT)

    expect(text).toContain('  presenter: AppPresenter,\n  observers: [AuditObserver],\n})')
  })

  it('puts the entry inside an empty list', () => {
    expect(edited(app('{ controllers: [], clientOptions: { intents: [] } }'), TICKET)).toContain('@MeoCord({ controllers: [TicketButtonController], clientOptions')
  })

  it('copies the separator of a list on one line', () => {
    const source = app('{ controllers: [A, B], clientOptions: { intents: [] } }')

    expect(edited(source, TICKET)).toContain('controllers: [A, B, TicketButtonController],')
  })

  it('keeps a one-per-line list without a trailing comma without one, and a comment after the last entry with it', () => {
    const source = app('{\n  controllers: [\n    A,\n    B // the last\n  ],\n  clientOptions: { intents: [] },\n}')

    expect(edited(source, TICKET)).toContain('  controllers: [\n    A,\n    B, // the last\n    TicketButtonController\n  ],')
  })

  it('adds observers to options on one line', () => {
    expect(edited(app('{ controllers: [], clientOptions: { intents: [] } }'), AUDIT)).toContain(
      '@MeoCord({ controllers: [], clientOptions: { intents: [] }, observers: [AuditObserver] })',
    )
  })

  it("writes the import in the file's quotes and semicolons", () => {
    const source = app('{ controllers: [] };', 'import { MeoCord } from "meocord/decorator";\n')

    expect(edited(source, TICKET)).toContain('import { MeoCord } from "meocord/decorator";\nimport { TicketButtonController } from "@src/controllers/button/ticket.button.controller";\n')
  })

  it('keeps CRLF line endings', () => {
    const source = TEMPLATE.replace(/\n/g, '\r\n')
    const text = edited(source, TICKET)

    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(text).toContain('SampleModalSubmitController,\r\n    TicketButtonController,\r\n')
  })

  it('leaves a class already imported and listed alone', () => {
    expect(listInAppSource(ts, edited(TEMPLATE, TICKET), TICKET)).toEqual({ listed: true })
  })

  it('only lists a class already imported', () => {
    const source = app(
      '{ controllers: [] }',
      "import { MeoCord } from 'meocord/decorator'\nimport { TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n",
    )
    const text = edited(source, TICKET)

    expect(text.match(/import \{ TicketButtonController \}/g)).toHaveLength(1)
    expect(text).toContain('controllers: [TicketButtonController]')
  })

  it('only imports a class already listed', () => {
    const text = edited(app('{ controllers: [TicketButtonController] }'), TICKET)

    expect(text).toContain("import { TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n")
    expect(text.match(/TicketButtonController/g)).toHaveLength(2)
  })

  it('puts the comma after the last entry, not after the new one, in a list with no trailing comma', () => {
    const text = edited(app('{\n  controllers: [\n    A,\n    B\n  ],\n}'), TICKET)

    expect(text).toContain('  controllers: [\n    A,\n    B,\n    TicketButtonController\n  ],')
    expect(syntaxErrors(text)).toEqual([])
  })

  it('puts the comma after the last property when observers is added to options with no trailing comma', () => {
    const text = edited(app('{\n  controllers: [],\n  presenter: P\n}'), AUDIT)

    expect(text).toContain('  presenter: P,\n  observers: [AuditObserver]\n})')
    expect(syntaxErrors(text)).toEqual([])
  })

  it('adds below the last entry of a list whose first entry sits on the bracket line', () => {
    const text = edited(app('{ controllers: [A,\n    B], clientOptions: { intents: [] } }'), TICKET)

    expect(text).toContain('controllers: [A,\n    B,\n    TicketButtonController]')
    expect(syntaxErrors(text)).toEqual([])
  })

  it("indents a new line by the last line's leading whitespace alone, copying none of its entries", () => {
    const text = edited(app('{\n  controllers: [\n    A, B,\n  ],\n}'), TICKET)

    expect(text).toContain('  controllers: [\n    A, B,\n    TicketButtonController,\n  ],')
    expect(text.match(/\bA\b/g)).toHaveLength(1)
  })

  it('adds to a list over lines that holds only a comment, below the comment at its indentation', () => {
    const text = edited(app('{\n  controllers: [\n    // none yet\n  ],\n}'), TICKET)

    expect(text).toContain('  controllers: [\n    // none yet\n    TicketButtonController,\n  ],')
  })

  it("adds the import after a comment on the last import's line, which stays there", () => {
    const text = edited(app('{ controllers: [] }', "import { MeoCord } from 'meocord/decorator' // the decorator\n"), TICKET)

    expect(text).toContain(
      "import { MeoCord } from 'meocord/decorator' // the decorator\nimport { TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n",
    )
  })

  it('reads a computed key written as a string as the list it names', () => {
    const text = edited(app("{ ['controllers']: [A], clientOptions: { intents: [] } }"), TICKET)

    expect(text).toContain("['controllers']: [A, TicketButtonController]")
    // No second list under the plain name
    expect(text).not.toContain('controllers:')
  })

  it.each([
    [
      'a list over lines whose last entry has a comment holding commas before its trailing comma',
      '{\n  controllers: [\n    A,\n    B /* kept last: see docs, issue 12 */,\n  ],\n}',
      '    B /* kept last: see docs, issue 12 */,\n    TicketButtonController,\n  ],',
    ],
    ['a list on one line with such a comment', '{ controllers: [A, B /* b, c */,] }', '[A, B /* b, c */, TicketButtonController,]'],
    ['a line comment holding a comma, with the trailing comma on the next line', '{\n  controllers: [\n    A,\n    B // x, y\n    ,\n  ],\n}', '    B // x, y\n    ,\n    TicketButtonController,\n  ],'],
    ['a comment holding a comma between the last two entries on one line', '{ controllers: [A /* x, y */, B] }', '[A /* x, y */, B, TicketButtonController]'],
  ])('finds the commas with the scanner, never in a comment, for %s', (_name, options, expected) => {
    const text = edited(app(options), TICKET)

    expect(text).toContain(expected)
    expect(syntaxErrors(text)).toEqual([])
  })

  it('counts an import of the class file by another specifier, as a relative path, as the import', () => {
    const relative = './controllers/button/ticket.button.controller'
    const source = app('{ controllers: [TicketButtonController] }', `import { MeoCord } from 'meocord/decorator'\nimport { TicketButtonController } from '${relative}'\n`)

    expect(listInAppSource(ts, source, { ...TICKET, isClassFile: specifier => specifier === relative })).toEqual({ listed: true })
  })

  const OTHER = 'src/app.ts already has a TicketButtonController that is not the generated class'
  it.each([
    ['a type-only import of it', "import type { TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n"],
    ['a type-only element of an import', "import { type TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n"],
    ['an import of the name from another module', "import { TicketButtonController } from './legacy'\n"],
    ['another export imported under the name', "import { Other as TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n"],
    ['a default import under the name', "import TicketButtonController from '@src/controllers/button/ticket.button.controller'\n"],
    ['a namespace import under the name', "import * as TicketButtonController from './legacy'\n"],
    ['a class of its own by the name', 'class TicketButtonController {}\n'],
    ['a variable of its own by the name', 'const TicketButtonController = null\n'],
  ])('changes nothing when the name is already bound, by %s', (_name, binding) => {
    for (const list of ['[]', '[TicketButtonController]']) {
      const source = app(`{ controllers: ${list} }`, `import { MeoCord } from 'meocord/decorator'\n${binding}`)

      expect(listInAppSource(ts, source, TICKET)).toEqual({ problem: OTHER })
    }
  })

  it.each([
    ['a computed key it cannot read', app('{ [LIST]: [A], clientOptions: { intents: [] } }')],
    ['a spread', app('{ ...base, clientOptions: { intents: [] } }')],
  ])('adds no list beside %s, which may already be that list', (_name, source) => {
    expect(listInAppSource(ts, source, TICKET)).toEqual({ problem: "@MeoCord's options have a spread or a computed key that may already hold controllers" })
  })

  it.each([
    ['a list held in a variable', app('{ controllers: allControllers }'), 'controllers is not a list written in place'],
    ['a list built by a call', app('{ controllers: load() }'), 'controllers is not a list written in place'],
    ['a shorthand list', app('{ controllers }'), 'controllers is not a list written in place'],
    ['a list with a spread', app('{ controllers: [...featureControllers, A] }'), 'controllers holds a spread, whose list TicketButtonController may belong in instead'],
    ['no @MeoCord', 'export default class App {}\n', 'src/app.ts has no @MeoCord({ … }) with an object literal'],
    ['@MeoCord with options from a variable', app('options'), 'src/app.ts has no @MeoCord({ … }) with an object literal'],
  ])('changes nothing for %s', (_name, source, problem) => {
    expect(listInAppSource(ts, source, TICKET)).toEqual({ problem })
  })
})

describe('addedProblems', () => {
  const X = { rule: 'local/x', message: 'X' }
  const Y = { rule: 'local/y', message: 'Y' }

  it('counts each rule and message as often as it appears', () => {
    expect(addedProblems([X], [X, X, Y])).toEqual([X, Y])
    expect(addedProblems([X, Y], [Y, X])).toEqual([])
  })

  it('finds the new error when one is traded for another', () => {
    expect(addedProblems([X], [Y])).toEqual([Y])
  })
})

describe('listInApp', () => {
  let root: string
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  const linkTypeScript = () => {
    mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    symlinkSync(path.join(REPO, 'node_modules', 'typescript'), path.join(root, 'node_modules', 'typescript'), 'junction')
  }
  const classFile = () => path.join(root, 'src', 'controllers', 'button', 'ticket.button.controller.ts')
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'meocord-app-listing-'))
    write('package.json', '{}')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("edits src/app.ts with the project's own TypeScript, importing through its @src alias", async () => {
    linkTypeScript()
    write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@src/*': ['src/*'] } } }))
    write('src/app.ts', TEMPLATE)

    // This project has no ESLint, so the edit is made and said to be unchecked
    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({ added: true, unchecked: 'your project has no ESLint' })
    expect(readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe(edited(TEMPLATE, TICKET))
  })

  it('imports relatively where tsconfig.json maps no alias to the file', () => {
    write('tsconfig.json', JSON.stringify({ compilerOptions: {} }))

    expect(importSpecifier(root, classFile())).toBe('./controllers/button/ticket.button.controller')
  })

  it.each([
    ['src/app.ts is missing', () => linkTypeScript(), 'src/app.ts is missing'],
    ['typescript is not installed', () => write('src/app.ts', TEMPLATE), "this project's typescript could not be loaded"],
  ])('changes nothing when %s', async (_name, arrange, problem) => {
    arrange()

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({ problem })
  })

  // TypeScript 7 exports only its version from its main entry
  it('refuses a typescript with no compiler API on its main entry, leaving the file as it was', async () => {
    write('node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', version: '7.0.2', main: 'index.js' }))
    write('node_modules/typescript/index.js', "module.exports = { version: '7.0.2' }\n")
    write('src/app.ts', TEMPLATE)

    expect(projectTypeScript(root)).toEqual({ problem: "this project's typescript (7.0.2) has no compiler API on its main entry" })
    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({
      problem: "this project's typescript (7.0.2) has no compiler API on its main entry",
    })
    expect(readFileSync(path.join(root, 'src', 'app.ts'), 'utf8')).toBe(TEMPLATE)
  })

  /**
   * An ESLint for the project, in `dir`, that lints the file it is given as the real one does with a typed config, from
   * disk whatever stdin holds, and reports the messages `check` gives for its text to its `--output-file`, or stdout
   * without one. `before` runs first, as a config's own code does.
   */
  const fakeESLint = (check: string, dir = '.', before = '') => {
    write(`${dir}/node_modules/eslint/package.json`, JSON.stringify({ name: 'eslint', bin: { eslint: 'bin.js' }, exports: { './package.json': './package.json' } }))
    write(
      `${dir}/node_modules/eslint/bin.js`,
      `${before}
const args = process.argv.slice(2)
const file = args.at(-1)
const text = require('fs').readFileSync(file, 'utf8')
const messages = (${check})(text).map(([ruleId, message]) => ({ ruleId, message, severity: 2 }))
const output = args.indexOf('--output-file')
const report = JSON.stringify([{ filePath: file, messages }])
if (output === -1) console.log(report)
else require('fs').writeFileSync(args[output + 1], report)
process.exitCode = messages.length > 0 ? 1 : 0
`,
    )
  }
  /** Prettier's print width, as a check: one error per line longer than `width`. */
  const widerThan = (width: number) => `text => text.split('\\n').filter(line => line.length > ${width}).map(() => ['prettier/prettier', 'Too wide'])`
  /** A rule of the project's own: one error while the file names no ticket button. */
  const NEEDS_TICKET = "text => (text.includes('TicketButtonController') ? [] : [['local/needs-ticket', 'List the ticket button']])"
  const appFile = () => path.join(root, 'src', 'app.ts')

  it("refuses an edit that would fail the project's ESLint, leaving the file byte for byte", async () => {
    linkTypeScript()
    fakeESLint(widerThan(60))
    const source = app('{ controllers: [A], clientOptions: {} }')
    write('src/app.ts', source)

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({
      problem: "the edit would fail your project's ESLint (prettier/prettier: Too wide)",
    })
    expect(readFileSync(appFile(), 'utf8')).toBe(source)
  })

  it("makes an edit the project's ESLint passes", async () => {
    linkTypeScript()
    fakeESLint(widerThan(200))
    write('src/app.ts', app('{ controllers: [A], clientOptions: {} }'))

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({ added: true })
  })

  it('keeps an edit when the only errors after it are ones the file already had', async () => {
    linkTypeScript()
    fakeESLint("text => (text.includes('TODO') ? [['local/no-todo', 'Finish the TODO']] : [])")
    write('src/app.ts', app('{ controllers: [A], clientOptions: {} }', "import { MeoCord } from 'meocord/decorator'\n// TODO: more\n"))

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({ added: true })
    expect(readFileSync(appFile(), 'utf8')).toContain('controllers: [A, TicketButtonController]')
  })

  it('refuses an edit that trades an error of the file for a new one, though the count stays the same', async () => {
    linkTypeScript()
    fakeESLint(`text => [...(${NEEDS_TICKET})(text), ...(${widerThan(60)})(text)]`)
    const source = app('{ controllers: [A], clientOptions: {} }')
    write('src/app.ts', source)

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({
      problem: "the edit would fail your project's ESLint (prettier/prettier: Too wide)",
    })
    expect(readFileSync(appFile(), 'utf8')).toBe(source)
  })

  it("lints with an ESLint a workspace keeps in a parent folder's node_modules", async () => {
    const workspace = root
    root = path.join(workspace, 'bot')
    write('package.json', '{}')
    linkTypeScript()
    fakeESLint(widerThan(60), '..')
    const source = app('{ controllers: [A], clientOptions: {} }')
    write('src/app.ts', source)

    try {
      expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({
        problem: "the edit would fail your project's ESLint (prettier/prettier: Too wide)",
      })
    } finally {
      root = workspace
    }
  })

  it.each([
    ['the project has no ESLint', () => {}, 'your project has no ESLint'],
    [
      'its ESLint cannot run',
      () => {
        write('node_modules/eslint/package.json', JSON.stringify({ name: 'eslint', bin: { eslint: 'bin.js' } }))
        write('node_modules/eslint/bin.js', "console.error('Oops! Something went wrong! :(\\n\\nESLint: 10.0.0\\n\\nSyntaxError: eslint.config.ts: Unexpected token')\nprocess.exitCode = 2\n")
      },
      'ESLint could not run (SyntaxError: eslint.config.ts: Unexpected token)',
    ],
  ])('lists the class and says it went unchecked when %s', async (_name, arrange, unchecked) => {
    linkTypeScript()
    arrange()
    write('src/app.ts', app('{ controllers: [A], clientOptions: {} }'))

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({ added: true, unchecked })
    expect(readFileSync(appFile(), 'utf8')).toContain('controllers: [A, TicketButtonController]')
  })

  it('stops an ESLint that never finishes, and says the file went unchecked', async () => {
    write('node_modules/eslint/package.json', JSON.stringify({ name: 'eslint', bin: { eslint: 'bin.js' } }))
    write('node_modules/eslint/bin.js', 'setInterval(() => {}, 1000)\n')
    write('src/app.ts', app('{ controllers: [A] }'))

    expect(await lintFile(appFile(), root, new ESLintBudget(300))).toEqual({ unchecked: 'ESLint did not finish within 0.3 s and was stopped' })
  })

  it("reads the report from ESLint's output file, so a config that prints does not leave the edit unchecked", async () => {
    linkTypeScript()
    fakeESLint(widerThan(60), '.', "console.log('Loaded the config')")
    const source = app('{ controllers: [A], clientOptions: {} }')
    write('src/app.ts', source)

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({
      problem: "the edit would fail your project's ESLint (prettier/prettier: Too wide)",
    })
  })

  /** What identifies a file and what an edit must leave of it: its inode, mode and links. */
  const identity = (file: string) => {
    const { ino, mode, nlink } = statSync(file, { bigint: true })
    return { ino, mode: mode & 0o7777n, nlink }
  }
  /** A modification time with microseconds, which a restore that kept only milliseconds would lose. */
  const LONG_AGO = 1_767_225_600.123456
  /** How far a file's modification time is from `LONG_AGO`, in nanoseconds: Node can't set nanoseconds. */
  const offLongAgo = (file: string) => {
    const off = statSync(file, { bigint: true }).mtimeNs - 1_767_225_600_123_456_000n
    return Number(off < 0n ? -off : off)
  }
  /** As close as a time put back through `utimes` can come. */
  const MICROSECOND_NS = 1_000
  const posix = process.platform !== 'win32'
  /** On Windows a mode keeps only the read-only bit, and an inode is not a POSIX one: those are compared off Windows. */
  const posixIdentity = (file: string) => {
    const { ino, mode } = identity(file)
    return posix ? { ino, mode } : {}
  }

  it('writes an edit into the file, keeping its inode, mode and hard links', async () => {
    linkTypeScript()
    fakeESLint(widerThan(200))
    write('src/app.ts', app('{ controllers: [A], clientOptions: {} }'))
    chmodSync(appFile(), 0o755)
    linkSync(appFile(), path.join(root, 'app-link.ts'))
    const before = posixIdentity(appFile())

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({ added: true })
    expect(posixIdentity(appFile())).toEqual(before)
    if (posix) expect(identity(appFile()).mode).toBe(0o755n)
    expect(readFileSync(path.join(root, 'app-link.ts'), 'utf8')).toContain('controllers: [A, TicketButtonController]')
  })

  // A symlink needs a privilege on Windows that a test can't count on
  it.skipIf(!posix)('writes through a symlinked src/app.ts to its target, leaving the link', async () => {
    linkTypeScript()
    fakeESLint(widerThan(200))
    write('app-real.ts', app('{ controllers: [A], clientOptions: {} }'))
    mkdirSync(path.join(root, 'src'), { recursive: true })
    symlinkSync(path.join('..', 'app-real.ts'), appFile())

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({ added: true })
    expect(lstatSync(appFile()).isSymbolicLink()).toBe(true)
    expect(readFileSync(path.join(root, 'app-real.ts'), 'utf8')).toContain('controllers: [A, TicketButtonController]')
  })

  // Root may write any file, so the refusal can't be seen as root
  it.skipIf(process.getuid?.() === 0)('refuses a src/app.ts it may not write, as a plain write would, changing nothing', async () => {
    linkTypeScript()
    fakeESLint(widerThan(200))
    const source = app('{ controllers: [A], clientOptions: {} }')
    write('src/app.ts', source)
    chmodSync(appFile(), 0o444)
    const before = identity(appFile())

    try {
      const result = await listInApp(root, classFile(), 'TicketButtonController', 'controllers')
      // Windows refuses a read-only file with EPERM
      expect(result).toEqual({ problem: expect.stringMatching(/^src\/app\.ts could not be written \((EACCES|EPERM)/) })
      expect(identity(appFile())).toEqual(before)
      expect(readFileSync(appFile(), 'utf8')).toBe(source)
    } finally {
      // Windows won't remove a read-only file
      chmodSync(appFile(), 0o644)
    }
  })

  it("leaves a refused edit's file as it was, its inode, mode and modification time within a microsecond too", async () => {
    linkTypeScript()
    fakeESLint(widerThan(60))
    const source = app('{ controllers: [A], clientOptions: {} }')
    write('src/app.ts', source)
    chmodSync(appFile(), 0o600)
    utimesSync(appFile(), LONG_AGO, LONG_AGO)
    const before = posixIdentity(appFile())

    expect(await listInApp(root, classFile(), 'TicketButtonController', 'controllers')).toEqual({
      problem: "the edit would fail your project's ESLint (prettier/prettier: Too wide)",
    })
    expect(posixIdentity(appFile())).toEqual(before)
    expect(offLongAgo(appFile())).toBeLessThan(MICROSECOND_NS)
    expect(readFileSync(appFile(), 'utf8')).toBe(source)
  })

  /** How long a signal test may take: a run that does not end on the signal fails at this */
  const SIGNAL_TIMEOUT_MS = 20_000

  // On Windows a signal sent to a child process ends it at once, so no handler runs; Ctrl+C in a console, which a test
  // can't send, does reach it
  it.skipIf(!posix).each(['SIGINT', 'SIGTERM'] as const)(
    'puts src/app.ts back and stops ESLint when %s arrives while the edit is being checked',
    async signal => {
      linkTypeScript()
      // An ESLint that says it has begun, with the edit on disk, then takes far longer than the test
      fakeESLint(widerThan(60), '.', `require('fs').writeFileSync(${JSON.stringify(path.join(root, 'eslint.pid'))}, String(process.pid)); setTimeout(() => {}, 60_000)`)
      const source = app('{ controllers: [A], clientOptions: {} }')
      write('src/app.ts', source)
      utimesSync(appFile(), LONG_AGO, LONG_AGO)
      const before = identity(appFile())
      // ESLint's output folder, where the test can see it, which the signal must not leave behind
      const tmp = path.join(root, 'tmp')
      mkdirSync(tmp)
      const outputDirs = () => readdirSync(tmp).filter(name => name.startsWith('meocord-eslint-'))
      write(
        'list.ts',
        `import { listInApp } from ${JSON.stringify(path.join(REPO, 'src', 'bin', 'app-listing.ts'))}
await listInApp(${JSON.stringify(root)}, ${JSON.stringify(classFile())}, 'TicketButtonController', 'controllers')
console.log('listed')
`,
      )
      // The repository's tsconfig, for its experimental decorators: Bun reads the one in its cwd, and the root has none
      const child = spawn(process.versions.bun ? process.execPath : 'bun', [`--tsconfig-override=${path.join(REPO, 'tsconfig.json')}`, 'list.ts'], { cwd: root, env: { ...process.env, TMPDIR: tmp }, stdio: ['ignore', 'pipe', 'inherit'] })
      let stdout = ''
      child.stdout.on('data', chunk => (stdout += chunk))
      const exited = new Promise<NodeJS.Signals | null>(resolve => child.on('exit', (_code, received) => resolve(received)))
      const pidFile = path.join(root, 'eslint.pid')
      while (!existsSync(pidFile) || readFileSync(pidFile, 'utf8') === '') await new Promise(resolve => setTimeout(resolve, 20))
      expect(readFileSync(appFile(), 'utf8')).toContain('TicketButtonController')
      expect(outputDirs()).toHaveLength(1)

      child.kill(signal)

      expect(await exited).toBe(signal)
      expect(stdout).toBe('')
      expect(readFileSync(appFile(), 'utf8')).toBe(source)
      expect(identity(appFile())).toEqual(before)
      expect(offLongAgo(appFile())).toBeLessThan(MICROSECOND_NS)
      expect(outputDirs()).toEqual([])
      // Killed as the command ends; give the system a moment to remove it
      const eslint = Number(readFileSync(pidFile, 'utf8'))
      const alive = () => {
        try {
          process.kill(eslint, 0)
          return true
        } catch {
          return false
        }
      }
      for (let tries = 0; alive() && tries < 100; tries++) await new Promise(resolve => setTimeout(resolve, 20))
      expect(alive()).toBe(false)
    },
    SIGNAL_TIMEOUT_MS,
  )

  it('prints the two lines to add when it changes nothing', () => {
    write('tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@src/*': ['src/*'] } } }))

    expect(listingProblemMessage(root, classFile(), 'TicketButtonController', 'controllers', 'controllers is not a list written in place')).toBe(
      'Could not add TicketButtonController to src/app.ts: controllers is not a list written in place. Add:\n' +
        "  import { TicketButtonController } from '@src/controllers/button/ticket.button.controller'\n" +
        '  TicketButtonController, in @MeoCord({ controllers })',
    )
  })
})
