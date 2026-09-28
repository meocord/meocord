import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { refuse } from '@src/util/refusal.util.js'

/**
 * File written beside a bundle that carries native addons, naming the platform it was built for.
 */
export const PLATFORM_MANIFEST = 'meocord.platform.json'

/** The operating system, CPU and C library a native binary is compiled against. */
export interface BuildPlatform {
  platform: string
  arch: string
  /** Linux only. Alpine images use musl, most others glibc, and a binary for one fails on the other. */
  libc?: 'glibc' | 'musl'
}

/** The C library this process runs against, when the runtime can say. */
function detectLibc(): BuildPlatform['libc'] {
  if (process.platform !== 'linux') return undefined
  try {
    const report = process.report?.getReport?.() as { header?: { glibcVersionRuntime?: string } } | undefined
    if (!report?.header) return undefined
    return report.header.glibcVersionRuntime ? 'glibc' : 'musl'
  } catch {
    return undefined
  }
}

/** The platform this process is running on. */
export function currentPlatform(): BuildPlatform {
  const libc = detectLibc()
  return { platform: process.platform, arch: process.arch, ...(libc && { libc }) }
}

/** `linux-x64 (glibc)`, `darwin-arm64`. */
export function describePlatform({ platform, arch, libc }: BuildPlatform): string {
  return `${platform}-${arch}${libc ? ` (${libc})` : ''}`
}

/**
 * Whether native binaries built for one platform can load on another.
 *
 * The C library is compared only when both sides are known, so a runtime that cannot report it
 * is not refused on a guess.
 */
export function isSamePlatform(built: BuildPlatform, running: BuildPlatform): boolean {
  if (built.platform !== running.platform || built.arch !== running.arch) return false
  return !built.libc || !running.libc || built.libc === running.libc
}

/** Records the platform a bundle's native addons were built for. */
export function writePlatformManifest(distDir: string): void {
  writeFileSync(path.join(distDir, PLATFORM_MANIFEST), `${JSON.stringify(currentPlatform(), null, 2)}\n`)
}

/**
 * Stops a bundle from starting on a platform its native addons were not built for, with one clear
 * message instead of a linker error on the first command that loads an addon.
 * @param distDir - Directory holding the manifest. Defaults to the entry script's directory.
 */
export function assertBuiltForThisPlatform(distDir = process.argv[1] ? path.dirname(process.argv[1]) : undefined): void {
  if (!distDir) return
  const manifest = path.join(distDir, PLATFORM_MANIFEST)
  if (!existsSync(manifest)) return

  let built: BuildPlatform
  try {
    built = JSON.parse(readFileSync(manifest, 'utf8'))
  } catch {
    return
  }

  const running = currentPlatform()
  if (isSamePlatform(built, running)) return

  throw refuse(new Error(
    `${path.basename(distDir)}: this build carries native addons compiled for ${describePlatform(built)}, but is ` +
      `running on ${describePlatform(running)}. Compiled binaries only load on the platform they were built for. ` +
      'Build on the same platform you deploy to -- for a container, run `meocord build` inside the image.',
  ))
}
