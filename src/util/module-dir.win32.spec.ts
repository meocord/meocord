import { vi } from 'vitest'

// findModulePackageDir as it runs on Windows: win32 paths, and a working directory on a drive
const { mockExistsSync } = vi.hoisted(() => ({ mockExistsSync: vi.fn() }))
vi.mock('path', async importOriginal => {
  const { win32 } = await importOriginal<typeof import('path')>()
  return { default: win32, ...win32 }
})
vi.mock('fs', () => ({ default: { existsSync: mockExistsSync }, existsSync: mockExistsSync }))
vi.spyOn(process, 'cwd').mockReturnValue('D:\\work')

const { findModulePackageDir } = await import('@src/util/common.util.js')

describe('findModulePackageDir on Windows', () => {
  beforeEach(() => mockExistsSync.mockReset())

  it.each([
    ['at the base directory', 'C:\\some\\project', 'C:\\some\\project\\node_modules\\lodash'],
    ['at the base directory given without a drive', '\\some\\project', '\\some\\project\\node_modules\\lodash'],
    ["in the drive root's node_modules", 'C:\\app\\bot', 'C:\\node_modules\\lodash'],
  ])('finds a module %s', (_where, baseDir, expected) => {
    mockExistsSync.mockImplementation((p: unknown) => p === expected)

    expect(findModulePackageDir('lodash', baseDir)).toBe(expected)
  })
})
