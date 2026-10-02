import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { createRsbuild } from '@rsbuild/core'
import { vi } from 'vitest'
import { createRsbuildConfig } from '@src/build/rsbuild-config.js'

// A 1x1 PNG, and a second one with other bytes under the same name
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const OTHER_PNG = Buffer.concat([PNG, Buffer.from([0])])

const roots: string[] = []
afterAll(() => roots.forEach(root => rmSync(root, { recursive: true, force: true })))

/** Writes an app whose main.ts imports `imports`, builds it for production, and returns its directory. */
async function build(files: Record<string, string | Buffer>, imports: string[]): Promise<string> {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'meocord-assets-')))
  roots.push(root)
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  writeFileSync(path.join(root, 'tsconfig.json'), '{}')
  writeFileSync(
    path.join(root, 'src', 'main.ts'),
    imports.map((file, index) => `import asset${index} from './${file}'`).join('\n') +
      `\nconsole.log(JSON.stringify([${imports.map((_, index) => `asset${index}`).join(', ')}]))\n`,
  )
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  try {
    const rsbuild = await createRsbuild({ cwd: root, config: { ...createRsbuildConfig({ mode: 'production' }), performance: { printFileSize: false } } })
    await rsbuild.build()
  } finally {
    cwd.mockRestore()
  }
  return root
}

describe('asset imports in a build', () => {
  // A bot reads its assets from disk, so every kind lands in dist/assets under its own name, as assets.d.ts says
  it('writes every imported file to dist/assets under its own name, the path its import gives', async () => {
    const files = { 'src/icon.png': PNG, 'src/guide.pdf': '%PDF-1.4', 'src/notes.txt': 'hello', 'src/clip.mp3': 'ID3' }
    const root = await build(files, ['icon.png', 'guide.pdf', 'notes.txt', 'clip.mp3'])

    const written = readdirSync(path.join(root, 'dist', 'assets')).sort()
    const imported = JSON.parse(execFileSync('node', [path.join(root, 'dist', 'main.js')], { encoding: 'utf8' }).trim()) as string[]

    expect(written).toEqual(['clip.mp3', 'guide.pdf', 'icon.png', 'notes.txt'])
    expect(imported.map(file => path.relative(path.join(root, 'dist'), file).replace(/\\/g, '/'))).toEqual([
      'assets/icon.png',
      'assets/guide.pdf',
      'assets/notes.txt',
      'assets/clip.mp3',
    ])
  }, 60_000)

  // Names stay stable, so two files of one name in different folders cannot both have it: the build stops, naming it
  it('stops the build at two imported files that would share a name', async () => {
    const files = { 'src/a/logo.png': PNG, 'src/b/logo.png': OTHER_PNG }

    await expect(build(files, ['a/logo.png', 'b/logo.png'])).rejects.toThrow()
  }, 60_000)
})
