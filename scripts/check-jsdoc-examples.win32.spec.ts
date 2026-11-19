import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

// staleDocsLinks as it runs on Windows: win32 paths under a drive, read from a temporary directory standing in for it
const disk = vi.hoisted(() => ({ root: 'D:\\work', dir: '' }))
vi.mock('path', async importOriginal => {
  const { win32 } = await importOriginal<typeof import('path')>()
  return { default: win32, ...win32 }
})
vi.mock('fs', async importOriginal => {
  const fs = await importOriginal<typeof import('fs')>()
  const onDisk = (file: unknown) =>
    typeof file === 'string' && file.startsWith(disk.root) ? disk.dir + file.slice(disk.root.length).replaceAll('\\', '/') : file
  const readdirSync = ((file: unknown, ...rest: unknown[]) => (fs.readdirSync as (...args: unknown[]) => unknown)(onDisk(file), ...rest)) as typeof fs.readdirSync
  const readFileSync = ((file: unknown, ...rest: unknown[]) => (fs.readFileSync as (...args: unknown[]) => unknown)(onDisk(file), ...rest)) as typeof fs.readFileSync
  const writeFileSync = ((file: unknown, ...rest: unknown[]) => (fs.writeFileSync as (...args: unknown[]) => unknown)(onDisk(file), ...rest)) as typeof fs.writeFileSync
  const io = { readdirSync, readFileSync, writeFileSync }
  return { ...fs, ...io, default: { ...fs, ...io } }
})

const { staleDocsLinks } = await import('./check-jsdoc-examples.js')

const SOURCE = 'src/common/guarded.ts'
const TEMPLATE = 'src/bin/app-template/README.md.template'
const link = (line: string) => `https://meocord.dev/docs/${line}/guards#writing-your-own`

beforeAll(() => {
  disk.dir = mkdtempSync(path.posix.join(tmpdir(), 'docs-links-win32-'))
  for (const file of [SOURCE, TEMPLATE]) {
    mkdirSync(path.posix.dirname(path.posix.join(disk.dir, file)), { recursive: true })
    writeFileSync(path.posix.join(disk.dir, file), `See ${link('4.2')}.\n`)
  }
})
afterAll(() => rmSync(disk.dir, { recursive: true, force: true }))

describe('staleDocsLinks on Windows', () => {
  it('names each file by its path from the root with forward slashes, as on every other system', () => {
    expect(staleDocsLinks('4.3', false, disk.root).sort()).toEqual([
      `${TEMPLATE}:1: links docs/4.2; link docs/4.3, the package's line, or run with --fix.`,
      `${SOURCE}:1: links docs/4.2; link docs/4.3, the package's line, or run with --fix.`,
    ])
    expect(staleDocsLinks('4.3', true, disk.root).sort()).toEqual([TEMPLATE, SOURCE])
    expect(readFileSync(path.posix.join(disk.dir, SOURCE), 'utf8')).toBe(`See ${link('4.3')}.\n`)
  })
})
