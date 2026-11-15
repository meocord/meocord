import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { checkDocs, type DocsReport } from './check-jsdoc-examples.js'

/** Compiling against @types/node takes a few seconds per program */
const COMPILE_TIMEOUT_MS = 120_000

/** An example: its fenced code, as a JSDoc comment indented by `indent` holds it. */
const example = (indent: string, code: string) =>
  [`${indent} * @example`, `${indent} * \`\`\`ts`, ...code.split('\n').map(line => `${indent} * ${line}`), `${indent} * \`\`\``].join('\n')
/** A JSDoc comment with a summary and one example per code. */
const doc = (indent: string, summary: string, ...codes: string[]) =>
  [`${indent}/**`, `${indent} * ${summary}`, ...codes.flatMap(code => [`${indent} *`, example(indent, code)]), `${indent} */`].join('\n')

let root: string
beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'jsdoc-examples-'))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

/**
 * Checks a package `pkg` of these declarations in a folder of its own, beside a package `foreign` of `foreign`'s,
 * which is not its own.
 */
function check(name: string, declarations: string, foreign = 'export {}\n'): DocsReport {
  const dir = path.join(root, name)
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    writeFileSync(path.join(dir, file), text)
  }
  write('package.json', JSON.stringify({ type: 'module' }))
  for (const [pkg, text] of [
    ['pkg', declarations],
    ['foreign', foreign],
  ]) {
    write(`node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, type: 'module', types: './index.d.ts' }))
    write(`node_modules/${pkg}/index.d.ts`, text)
  }
  return checkDocs({
    entries: new Map([['pkg', path.join(dir, 'node_modules/pkg/index.d.ts')]]),
    typesDir: path.join(dir, 'node_modules/pkg'),
    examplesDir: path.join(dir, 'examples'),
  })
}

/**
 * A package whose members' examples are wrong, or written as `right` corrects them, each at a place the check must
 * reach and name a type for. An `@internal` and a private member keep a wrong example, and so does a foreign class's
 * member, which the package's class inherits but does not declare.
 */
const declarations = (right: boolean) => `
import { Foreign, Gadget } from 'foreign'

${doc('', 'Counts.\n *\n * @group Utilities', 'new Counter().add(1)')}
export declare class Counter extends Tally {
${doc('  ', 'Adds to the count.', right ? 'new Counter().add(2)' : "new Counter().add('two')")}
  add(by: number): this
${doc('  ', 'Resets the count.\n   *\n   * @internal', 'new Counter().reset(true)')}
  reset(to: number): void
${doc('  ', 'A secret.', 'secret(true)')}
  private secret;
${doc('  ', 'The starting count.', right ? 'defaults: 42,' : "defaults: 'x',")}
  static defaults: number
${doc('  ', 'Makes a counter.', right ? 'Counter.create()' : 'Counter.create(1)')}
  static create(): Counter
${doc('  ', 'Picks by index.', 'new Counter().pick(1)')}
  pick(index: number): string
${doc('  ', 'Picks by name.', right ? "new Counter().pick('one')" : 'new Counter().pick(true)')}
  pick(name: string): string
${doc('  ', 'Runs twice.', 'new Counter().twice()', right ? 'new Counter().twice()' : 'new Counter().twice(1)')}
  twice(): void
${doc('  ', 'The label.', right ? "label = 'a'" : "label = 'c'")}
  label: 'a' | 'b'
}

declare class Tally {
${doc('  ', 'The count so far.', right ? 'const total: number = new Counter().total()' : 'const total: string = new Counter().total()')}
  total(): number
${doc('  ', 'A zero tally.', right ? 'Counter.zero()' : 'Counter.zero(1)')}
  static zero(): Tally
}

${doc('', 'Settings.\n *\n * @group Configuration')}
export interface Settings<T> {
  /** The name. */
  name: string
${doc('  ', 'How loud.', right ? "level: 'quiet';" : "level: 'loud';")}
  level?: 'quiet' | 'normal'
  /** Limits. */
  limits?: {
    /** Inner limits. */
    inner?: {
${doc('      ', 'The leaf.', right ? 'leaf: 5,' : "leaf: '5',")}
      leaf?: number
    }
  }
  /** Extras. */
  extra?: {
${doc('    ', 'A flag.', right ? 'flag: true,' : "flag: 'yes',")}
    flag?: boolean
  } | null
${doc('  ', 'Checks a value.', right ? 'check(value) {\n  return value !== undefined\n}' : 'check(value) {\n  return 1\n}')}
  check(value: T): boolean
${doc('  ', 'Resizes.')}
  resize(options: {
${doc('    ', 'The size.', right ? "size: 'small'," : "size: 'big',")}
    size?: 'small' | 'medium'
  }): void
}

${doc('', 'Options.\n *\n * @group Types')}
export type Options = {
${doc('  ', 'How many retries.', right ? 'retries: 3,' : "retries: '3',")}
  retries?: number
}

${doc('', 'A shape.\n *\n * @group Types')}
export type Shape =
  | {
${doc('      ', 'The radius.', right ? 'radius: 2,' : "radius: '2',")}
      radius?: number
    }
  | { side: number }

${doc('', 'The defaults.\n *\n * @group Configuration', 'defaults.timeout')}
export declare const defaults: {
${doc('  ', 'How long to wait.', right ? 'timeout: 10,' : "timeout: 'ten',")}
  timeout: number
}

${doc('', 'Tools.\n *\n * @group Utilities', 'Tools.run(1)')}
export declare namespace Tools {
${doc('  ', 'Runs.', right ? 'Tools.run(1)' : "Tools.run('1')")}
  function run(times: number): void
}

interface Hidden {
${doc('  ', 'A hint.', right ? "hint: 'x'," : 'hint: 1,')}
  hint?: string
}

${doc('', 'Visible.\n *\n * @group Types')}
export interface Visible extends Hidden {
  /** Its own. */
  own?: string
}

${doc('', 'A base.\n *\n * @group Utilities', 'new Base()')}
export declare class Base {
${doc('  ', 'Starts.', right ? 'new Derived().start()' : 'new Derived().start(1)')}
  start(): void
}

${doc('', 'A derived class.\n *\n * @group Utilities', 'new Derived()')}
export declare class Derived extends Base {}

${doc('', 'A widget.\n *\n * @group Utilities', 'new Widget()')}
export declare class Widget extends Foreign {}

export { Gadget }
`

/** A package the walk must not enter: a base class and a public symbol of another package, both with wrong examples. */
const foreign = `
export declare class Foreign {
${doc('  ', 'Not ours.', "const n: string = new Foreign().size()")}
  size(): number
}

${doc('', 'A gadget.\n *\n * @group Utilities', 'new Gadget()')}
export declare class Gadget {
${doc('  ', 'Not ours.', "const n: string = new Gadget().size()")}
  size(): number
}
`

describe('checkDocs on members and overloads', () => {
  let wrong: DocsReport
  let right: DocsReport

  beforeAll(() => {
    wrong = check('wrong', declarations(false), foreign)
    right = check('right', declarations(true), foreign)
  }, COMPILE_TIMEOUT_MS)

  it.each([
    ['a method', /^Counter\.add: its example, line 1: Argument of type 'string' is not assignable/],
    ['a static field written as in an object, against the class itself', /^Counter\.defaults: its example, line 1: Type 'string' is not assignable to type 'number'/],
    ['a static method', /^Counter\.create: its example, line 1: Expected 0 arguments, but got 1/],
    ['an overload signature, under its number', /^Counter\.pick \(signature 2\): its example, line 1: No overload matches this call/],
    ["a member's second example, under its number", /^Counter\.twice: its example 2, line 1: Expected 0 arguments, but got 1/],
    ['a class property set with =', /^Counter\.label: its example, line 1: Type '"c"' is not assignable/],
    ['a method inherited from a class that is not public', /^Counter\.total: its example, line 1: Type 'number' is not assignable to type 'string'/],
    ['a static method inherited from a class that is not public', /^Counter\.zero: its example, line 1: Expected 0 arguments, but got 1/],
    ["a generic interface's field ending in ;", /^Settings\.level: its example, line 1: Type '"loud"' is not assignable/],
    ['a field two optional objects deep', /^Settings\.limits\.inner\.leaf: its example, line 1: Type 'string' is not assignable to type 'number'/],
    ['a field of an object type or null', /^Settings\.extra\.flag: its example, line 1: Type 'string' is not assignable to type 'boolean/],
    ['a method implemented, its parameter typed by the interface', /^Settings\.check: its example, line 1: Type '\(value: any\) => number' is not assignable to type '\(value: any\) => boolean'/],
    ["a method parameter's field", /^Settings\.resize\.size: its example, line 1: Type '"big"' is not assignable/],
    ["a type alias's field", /^Options\.retries: its example, line 1: Type 'string' is not assignable to type 'number'/],
    ['a field of one object of a union', /^Shape\.radius: its example, line 1: Type 'string' is not assignable to type 'number'/],
    ["a constant's field", /^defaults\.timeout: its example, line 1: Type 'string' is not assignable to type 'number'/],
    ["a namespace's function", /^Tools\.run: its example, line 1: Argument of type 'string' is not assignable/],
    ['a field inherited from an interface that is not public', /^Visible\.hint: its example, line 1: Type 'number' is not assignable to type 'string'/],
    ["a public base's method, reached through it and its public subclass", /^Base\.start: its example, line 1: Expected 0 arguments, but got 1/],
  ])('reports the wrong example of %s', (_name, problem) => {
    expect(wrong.problems).toContainEqual(expect.stringMatching(problem))
  })

  it('reports nothing else, and nothing once every example is corrected', () => {
    expect(wrong.problems).toHaveLength(19)
    expect(right.problems).toEqual([])
  })

  // An @internal and a private member, and another package's classes, the one re-exported included, are left out with
  // their wrong examples; a member two public symbols reach is compiled once
  it('compiles every example once, and counts the members', () => {
    expect(right).toMatchObject({ examples: 27, memberExamples: 21 })
  })
})

describe('checkDocs on examples it cannot check', () => {
  let report: DocsReport

  beforeAll(() => {
    report = check(
      'refusals',
      `
${doc('', 'Finds.\n *\n * @group Utilities', 'new Finder()')}
export declare class Finder {
${doc('  ', 'Finds by options.')}
  find(options: {
${doc('    ', 'What to find by.', "by: 'id'")}
    by: 'id'
  }): void
${doc('  ', 'Finds by name.', "new Finder().find('x')")}
  find(name: string): void
${doc('  ', 'Takes a size.')}
  size(
${doc('    ', 'The size.', 'size(1)')}
    value: number,
  ): void
}

${doc('', 'Not filed.')}
export interface Unfiled {
${doc('  ', 'A field.', "x: 'not a number',")}
  x?: number
}

export {}
`,
    )
  }, COMPILE_TIMEOUT_MS)

  it("refuses a field written as a label where no chain of names reaches its type, as an overloaded method's parameter", () => {
    expect(report.problems).toContain(
      "Finder.find.by: its example: it reads as the label `by:`, which checks nothing, and no chain of names reaches the type holding by, which a piece of an object is checked against; write code that uses the member instead.",
    )
  })

  it('reports an example the walk does not reach, rather than skip it', () => {
    expect(report.problems).toContainEqual(expect.stringMatching(/^Finder: the @example at index\.d\.ts:\d+ is never compiled, as the check does not reach it/))
  })

  // A symbol with no @group is reported for that, and its members' examples wait for it
  it("reports a symbol with no @group, and leaves its members' examples", () => {
    expect(report.problems.filter(problem => problem.includes('Unfiled'))).toEqual([
      "pkg's Unfiled has no @group tag; give its declaration a JSDoc comment of its own with one.",
    ])
  })
})

/**
 * The forms a member's example takes, each a public declaration whose one member holds one example, right or wrong:
 * a wrong one is reported under the declaration's name, and a right one is not.
 */
const FORMS: Record<string, { body: (name: string) => string; right: boolean }> = {
  StaticNoComma: { body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', 'defaults: 42')}\n  static defaults: string\n}`, right: false },
  StaticComma: { body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', "defaults: 'x',")}\n  static defaults: string\n}`, right: true },
  ParamFieldNoComma: { body: n => `export interface ${n} {\n  /** Runs. */\n  run(options: {\n${doc('    ', 'Doc.', "size: 'big'")}\n    size?: number\n  }): void\n}`, right: false },
  ParamFieldComma: { body: n => `export interface ${n} {\n  /** Runs. */\n  run(options: {\n${doc('    ', 'Doc.', 'size: 3,')}\n    size?: number\n  }): void\n}`, right: true },
  NullUnionFieldNoComma: { body: n => `export interface ${n} {\n  /** Limits. */\n  limits?: {\n${doc('    ', 'Doc.', "perMinute: 'five'")}\n    perMinute?: number\n  } | null\n}`, right: false },
  NullUnionFieldComma: { body: n => `export interface ${n} {\n  /** Limits. */\n  limits?: {\n${doc('    ', 'Doc.', 'perMinute: 5,')}\n    perMinute?: number\n  } | null\n}`, right: true },
  AliasUnionFieldNoComma: { body: n => `export type ${n} = {\n${doc('  ', 'Doc.', 'kind: 3')}\n  kind: 'a'\n} | { other: number }`, right: false },
  AliasField: { body: n => `export type ${n} = {\n${doc('  ', 'Doc.', 'kind: 3,')}\n  kind: 'a'\n}`, right: false },
  ConstFieldNoComma: { body: n => `export declare const ${n}: {\n${doc('  ', 'Doc.', "port: 'x'")}\n  port: number\n}`, right: false },
  InterfaceFieldNoComma: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "level: 'loud'")}\n  level?: 'quiet'\n}`, right: false },
  InterfaceFieldSemicolon: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "level: 'loud';")}\n  level?: 'quiet'\n}`, right: false },
  InterfaceFieldSemicolonRight: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "level: 'quiet';")}\n  level?: 'quiet'\n}`, right: true },
  InterfaceFieldTwoStatements: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "level: 'loud'\nconsole.log(1)")}\n  level?: 'quiet'\n}`, right: false },
  NamespaceFunction: { body: n => `export declare namespace ${n} {\n${doc('  ', 'Doc.', `${n}.run('x')`)}\n  function run(n: number): void\n}`, right: false },
  ClassPropertyAsMember: { body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', "name = 'x'")}\n  name: string\n}`, right: true },
  ClassPropertyPiece: { body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', 'name: 7,')}\n  name: string\n}`, right: false },
  InterfaceMethodAsImplementation: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', 'onReady(n) {\n  return n + 1\n}')}\n  onReady(n: number): number\n}`, right: true },
  InterfaceMethodAsCall: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', `declare const c: ${n}\nc.onReady(1)`)}\n  onReady(n: number): number\n}`, right: true },
  Getter: { body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', `const n: string = new ${n}().size`)}\n  get size(): number\n}`, right: false },
  EnumMember: { body: n => `export declare enum ${n} {\n${doc('  ', 'Doc.', `const n: string = ${n}.One`)}\n  One = 1\n}`, right: false },
  IndexSignature: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', `const n: string = ({} as ${n})['x']`)}\n  [key: string]: number\n}`, right: false },
}

describe('checkDocs on the forms of a member example', () => {
  let problems: string[]

  beforeAll(() => {
    // Each declaration's own example compiles, so only its member's is under test
    const declarations = Object.entries(FORMS)
      .map(([name, { body }]) => `${doc('', `${name}.\n *\n * @group Types`, 'const ok = 1')}\n${body(name)}`)
      .join('\n\n')
    problems = check('forms', `export declare function Controller(): ClassDecorator\n\n${declarations}\n\nexport {}\n`).problems
  }, COMPILE_TIMEOUT_MS)

  it.each(Object.entries(FORMS))('%s', (name, { right }) => {
    const reported = problems.filter(problem => problem.startsWith(`${name}.`) || problem.startsWith(`${name}:`))
    if (right) expect(reported).toEqual([])
    else expect(reported.length).toBeGreaterThan(0)
  })
})

/** A member's comment with no example. */
const plain = (indent: string) => `${indent}/** Doc. */`
/** The refusal of a member written as in an object, or as a label, where no type holding it is named. */
const UNHELD = /which a piece of an object is checked against; write code that uses the member instead\.$/

/**
 * Where a member sits, each a public declaration whose member holds one example: a wrong one is reported under the
 * declaration's name, a right one is not, and one that can't be checked is refused with `problem`.
 */
const SHAPES: Record<string, { body: (name: string) => string; right: boolean; problem?: RegExp }> = {
  GenericFieldWrong: { body: n => `export interface ${n}<T> {\n${doc('  ', 'Doc.', "size: 'x',")}\n  size?: number\n${plain('  ')}\n  value?: T\n}`, right: false },
  GenericFieldRight: { body: n => `export interface ${n}<T> {\n${doc('  ', 'Doc.', 'size: 3,')}\n  size?: number\n${plain('  ')}\n  value?: T\n}`, right: true },
  StaticMethodParamWrong: { body: n => `export declare class ${n} {\n${plain('  ')}\n  static make(o: {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }): void\n}`, right: false },
  StaticMethodParamRight: { body: n => `export declare class ${n} {\n${plain('  ')}\n  static make(o: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }): void\n}`, right: true },
  CtorParamWrong: { body: n => `export declare class ${n} {\n${plain('  ')}\n  constructor(o: {\n${doc('    ', 'Doc.', "port: 'x',")}\n    port?: number\n  })\n}`, right: false },
  CtorParamRight: { body: n => `export declare class ${n}<T> {\n${plain('  ')}\n  constructor(o: {\n${doc('    ', 'Doc.', 'port: 3,')}\n    port?: number\n    value?: T\n  })\n}`, right: true },
  FunctionParamWrong: { body: n => `export declare function ${n}(o: {\n${doc('  ', 'Doc.', "n: 'x',")}\n  n?: number\n}): void`, right: false },
  FunctionParamRight: { body: n => `export declare function ${n}(o: {\n${doc('  ', 'Doc.', 'n: 3,')}\n  n?: number\n}): void`, right: true },
  SecondParamWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  run(a: string, o: {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }): void\n}`, right: false },
  SecondParamRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  run(a: string, o: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }): void\n}`, right: true },
  OptionalMethodParamRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  run?(o: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }): void\n}`, right: true },
  NestedNullableWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  a?: {\n${plain('    ')}\n    b?: {\n${doc('      ', 'Doc.', "c: 'x',")}\n      c?: number\n    } | null\n  }\n}`, right: false },
  ArrayFieldWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  items?: {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }[]\n}`, right: false },
  ArrayFieldRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  items?: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }[]\n}`, right: true },
  GenericArrayWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  items?: Array<{\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }>\n}`, right: false },
  GenericArrayRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  items?: Array<{\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }>\n}`, right: true },
  ReadonlyArrayWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  items?: readonly {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }[]\n}`, right: false },
  ReadonlyArrayOperatorRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  items?: readonly {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }[]\n}`, right: true },
  ReadonlyArrayRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  items?: ReadonlyArray<{\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }>\n}`, right: true },
  FunctionTypeParamWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  handler?: (o: {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }) => void\n}`, right: false },
  FunctionTypeParamRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  handler?: (o: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }) => void\n}`, right: true },
  ConstructorTypeParamWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  make?: new (o: {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }) => object\n}`, right: false },
  ConstructorTypeInstanceFieldWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  make?: new () => {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }\n}`, right: false },
  ConstructorTypeInstanceFieldRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  make?: new () => {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }\n}`, right: true },
  ReturnTypeFieldWrong: { body: n => `export declare function ${n}(): {\n${doc('  ', 'Doc.', "n: 'x',")}\n  n?: number\n}`, right: false },
  ReturnTypeFieldRight: { body: n => `export declare function ${n}(): {\n${doc('  ', 'Doc.', 'n: 3,')}\n  n?: number\n}`, right: true },
  MethodReturnFieldWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  get(): {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }\n}`, right: false },
  MethodReturnFieldRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  get(): {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }\n}`, right: true },
  FunctionTypeReturnFieldRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  make?: () => {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }\n}`, right: true },
  SetterWrong: { body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', "size: 'x',")}\n  set size(v: number)\n}`, right: false },
  SetterParamFieldWrong: { body: n => `export declare class ${n} {\n${plain('  ')}\n  set opts(v: {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  })\n}`, right: false },
  SetterParamFieldRight: { body: n => `export declare class ${n} {\n${plain('  ')}\n  set opts(v: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  })\n}`, right: true },
  GetterRight: { body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', 'size: 3,')}\n  get size(): number\n}`, right: true },
  IndexSignaturePiece: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', 'key: 3,')}\n  [key: string]: number\n}`, right: true },
  IndexSignatureLabel: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "key: 'x'")}\n  [key: string]: number\n}`, right: false },
  IndexSignatureFieldWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  [key: string]: {\n${doc('    ', 'Doc.', "n: 'x',")}\n    n?: number\n  }\n}`, right: false },
  IndexSignatureFieldRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  [key: string]: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }\n}`, right: true },
  CallSignatureLabel: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "n: 'x'")}\n  (n: number): void\n}`, right: false, problem: UNHELD },
  EnumLabel: { body: n => `export declare enum ${n} {\n${doc('  ', 'Doc.', "One: 'x'")}\n  One = 1\n}`, right: false, problem: UNHELD },
  OverloadedParamPiece: {
    body: n => `export interface ${n} {\n${plain('  ')}\n  run(o: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }): void\n${plain('  ')}\n  run(s: string): void\n}`,
    right: false,
    problem: /^OverloadedParamPiece\.run\.n: its example: it is written as in an object, but no chain of names reaches the type holding n, which a piece/,
  },
  OverloadedParamCode: {
    body: n => `export interface ${n} {\n${plain('  ')}\n  run(o: {\n${doc('    ', 'Doc.', `declare const m: ${n}\nm.run({ n: 3 })`)}\n    n?: number\n  }): void\n${plain('  ')}\n  run(s: string): void\n}`,
    right: true,
  },
  SymbolMethodWrong: {
    body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', '[Symbol.iterator]() {\n  return 1\n}')}\n  [Symbol.iterator](): Iterator<number>\n}`,
    right: false,
    problem: /^SymbolMethodWrong\.\[Symbol\.iterator\]: its example, line 1: Type '\(\) => number' is not assignable/,
  },
  SymbolMethodRight: {
    body: n => `export declare class ${n} {\n${doc('  ', 'Doc.', '*[Symbol.iterator]() {\n  yield 1\n}')}\n  [Symbol.iterator](): Iterator<number>\n}`,
    right: true,
  },
  SymbolMethodParamPiece: {
    body: n => `export declare class ${n} {\n${plain('  ')}\n  [Symbol.iterator](o?: {\n${doc('    ', 'Doc.', 'n: 3,')}\n    n?: number\n  }): Iterator<number>\n}`,
    right: false,
    problem: UNHELD,
  },
  PromiseReturnPiece: { body: n => `export declare function ${n}(): Promise<{\n${doc('  ', 'Doc.', 'n: 3,')}\n  n?: number\n}>`, right: false, problem: UNHELD },
  LabelOtherName: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "other: 'loud'")}\n  level?: 'quiet'\n}`, right: false },
  LabelInBraces: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "{ level: 'loud' }")}\n  level?: 'quiet'\n}`, right: false, problem: /it reads as the label `level:`, which checks nothing; write it as in an object/ },
  LabelInFunction: {
    body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "function f() {\n  other: 'loud'\n}")}\n  level?: 'quiet'\n}`,
    right: false,
    problem: /it labels a statement `other:`, which a member's example can't, as a member written as a label checks nothing; write the code without the label\.$/,
  },
  LoopLabelledWithMemberName: {
    body: n => `export interface ${n} {\n${doc('  ', 'Doc.', 'level: for (const a of [1]) {\n  if (a) break level\n}')}\n  level?: 'quiet'\n}`,
    right: false,
    problem: /^LoopLabelledWithMemberName\.level: its example: it labels a statement `level:`, which a member's example can't/,
  },
  IndexSignatureLoopLabel: {
    body: n => `export interface ${n} {\n${doc('  ', 'Doc.', 'outer: for (const a of [1]) {\n  if (a) break outer\n}')}\n  [key: string]: number\n}`,
    right: false,
    problem: /^IndexSignatureLoopLabel: its example: it labels a statement `outer:`, which a member's example can't/,
  },
  LabelledLoop: {
    body: n => `export interface ${n} {\n${doc('  ', 'Doc.', `declare const s: ${n}\nouter: for (const a of [1]) {\n  for (const b of [2]) if (a + b > 2) break outer\n}\nvoid s`)}\n  level?: 'quiet'\n}`,
    right: false,
    problem: /^LabelledLoop\.level: its example: it labels a statement `outer:`, which a member's example can't/,
  },
  LabelAfterCode: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "const x = 1\nlevel: 'loud'")}\n  level?: 'quiet'\n}`, right: false },
  QuotedKeyWrong: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "'my-key': 'x',")}\n  'my-key'?: number\n}`, right: false },
  QuotedKeyRight: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "'my-key': 3,")}\n  'my-key'?: number\n}`, right: true },
  NumericKeyWrong: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "0: 'x',")}\n  0?: number\n}`, right: false },
  NumericKeyRight: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', '0: 3,')}\n  0?: number\n}`, right: true },
  // The member keeps its own optionality, the others are optional
  RequiredGivenUndefined: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', 'b: undefined,')}\n  b: string\n}`, right: false },
  OptionalGivenUndefined: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', 'b: undefined,')}\n  b?: string\n}`, right: true },
  OthersRequiredLeftOut: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "b: 'x',")}\n  b: string\n${plain('  ')}\n  c: number\n}`, right: true },
  RequiredMethodImplemented: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', 'run(n) {\n  return n\n}')}\n  run(n: number): number\n${plain('  ')}\n  c: number\n}`, right: true },
  QuotedRequiredGivenUndefined: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', "'my-key': undefined,")}\n  'my-key': string\n}`, right: false },
  NumericRequiredGivenUndefined: { body: n => `export interface ${n} {\n${doc('  ', 'Doc.', '0: undefined,')}\n  0: string\n}`, right: false },
  UnionRequiredGivenUndefined: {
    body: n => `export interface ${n} {\n${plain('  ')}\n  shape?: {\n${doc('    ', 'Doc.', 'b: undefined,')}\n    b: string\n  } | { c: number }\n}`,
    right: false,
  },
  UnionFieldRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  shape?: {\n${doc('    ', 'Doc.', "b: 'x',")}\n    b: string\n  } | { c: number }\n}`, right: true },
  UnionFieldOnlyOtherShape: { body: n => `export interface ${n} {\n${plain('  ')}\n  shape?: {\n${doc('    ', 'Doc.', 'c: 3,')}\n    b: string\n  } | { c?: number }\n}`, right: false },
  UnionFieldOtherShape: { body: n => `export interface ${n} {\n${plain('  ')}\n  shape?: {\n${doc('    ', 'Doc.', 'b: 3,')}\n    b: string\n  } | { b: boolean }\n}`, right: false },
  IntersectionRequiredGivenUndefined: {
    body: n => `export interface ${n} {\n${plain('  ')}\n  opts?: {\n${doc('    ', 'Doc.', 'b: undefined,')}\n    b: string\n  } & { c?: number }\n}`,
    right: false,
  },
  IntersectionFieldRight: { body: n => `export interface ${n} {\n${plain('  ')}\n  opts?: {\n${doc('    ', 'Doc.', "b: 'x',")}\n    b: string\n  } & { c: number }\n}`, right: true },
  // Merged, re-exported, inherited and left-out declarations
  MergedInterfaceWrong: { body: n => `export interface ${n} {\n${plain('  ')}\n  a?: number\n}\nexport interface ${n} {\n${doc('  ', 'Doc.', 'b: 3,')}\n  b?: string\n}`, right: false },
  NamespaceMergeWrong: {
    body: n => `export interface ${n} {\n${plain('  ')}\n  a?: number\n}\nexport declare namespace ${n} {\n${doc('  ', 'Doc.', `${n}.f('x')`)}\n  function f(n: number): void\n}`,
    right: false,
  },
  ReExportAliasWrong: { body: n => `interface ${n}Inner {\n${doc('  ', 'Doc.', "a: 'x',")}\n  a?: number\n}\nexport type { ${n}Inner as ${n} }`, right: false },
  InheritedGenericWrong: { body: n => `export interface ${n} extends ${n}Base<number> {}\n/** Base. */\ninterface ${n}Base<T> {\n${doc('  ', 'Doc.', "v: 'x',")}\n  v?: T\n}`, right: false },
  OneLineInternalMember: { body: n => `export interface ${n} {\n  /** @internal */\n  inner?: {\n${doc('    ', 'Doc.', "a: 'x',")}\n    a?: number\n  }\n}`, right: true },
  TypeParameterConstraint: {
    body: n => `export interface ${n}<T extends {\n${doc('  ', 'Doc.', 'a: 3,')}\n  a?: number\n}> {\n${plain('  ')}\n  v?: T\n}`,
    right: false,
    problem: /is never compiled, as the check does not reach it/,
  },
}

describe('checkDocs on where a member sits', () => {
  let problems: string[]

  beforeAll(() => {
    // Each declaration's own example compiles, so only its member's is under test
    const declarations = Object.entries(SHAPES)
      .map(([name, { body }]) => `${doc('', `${name}.\n *\n * @group Types`, 'const ok = 1')}\n${body(name)}`)
      .join('\n\n')
    problems = check('shapes', `export declare function Controller(): ClassDecorator\n\n${declarations}\n\nexport {}\n`).problems
  }, COMPILE_TIMEOUT_MS)

  it.each(Object.entries(SHAPES))('%s', (name, { right, problem }) => {
    const reported = problems.filter(line => line.startsWith(`${name}.`) || line.startsWith(`${name}:`) || line.startsWith(`${name} `))
    if (right) expect(reported).toEqual([])
    else if (problem) expect(reported).toEqual([expect.stringMatching(problem)])
    else expect(reported.length).toBeGreaterThan(0)
  })
})

// A public symbol of the package may merge with an interface of another package, through a module augmentation: the
// other package's declaration and its members' examples are not the package's
it('leaves out the members another package declares on an interface the package merges with and exports', () => {
  const foreign = `export interface Merged {\n${doc('  ', 'Theirs.', "const wrong: number = 'not ours'")}\n  theirs?: number\n}\n`
  const merged = `import { Merged } from 'foreign'\ndeclare module 'foreign' {\n${doc('  ', 'Merged.\n   *\n   * @group Types')}\n  interface Merged {\n${doc('    ', 'Ours.', "ours: 'x',")}\n    ours?: string\n  }\n}\nexport { Merged }\n`

  const report = check('merged', merged, foreign)

  expect(report.problems).toEqual([])
  expect(report.memberExamples).toBe(1)
}, COMPILE_TIMEOUT_MS)
