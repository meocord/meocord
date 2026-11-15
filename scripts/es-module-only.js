/**
 * The ES-module-only dependencies MeoCord's CommonJS build bundles, so that `require()` loads `dist/cjs` without
 * Node's VM modules, which jest otherwise needs. The ES module build imports them from `node_modules`. Read by
 * `rollup.config.js` and `scripts/third-party-notices.ts`; `check:dist-cjs` fails when `dist/cjs` requires one this
 * list misses.
 */
import { readFileSync } from 'fs'
import path from 'path'

/** The dependencies `dist/cjs` bundles, with everything they depend on in turn. */
export const ES_MODULE_ONLY_DEPENDENCIES = ['chalk', 'inversify']

/** The package a bare specifier names: `@scope/name` or `name`, without a subpath. */
export function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * Every package the CommonJS build bundles, sorted: each of {@link ES_MODULE_ONLY_DEPENDENCIES} and their
 * `dependencies`, read from the packages installed under `root`. Peer dependencies stay the application's.
 */
export function bundledPackages(root) {
  const found = new Set()
  const pending = [...ES_MODULE_ONLY_DEPENDENCIES]
  while (pending.length > 0) {
    const name = pending.pop()
    if (found.has(name)) continue
    found.add(name)
    const manifest = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'))
    pending.push(...Object.keys(manifest.dependencies ?? {}))
  }
  return [...found].sort()
}
