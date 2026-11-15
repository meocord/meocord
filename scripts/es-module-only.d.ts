/** The ES-module-only dependencies MeoCord's CommonJS build bundles. */
export declare const ES_MODULE_ONLY_DEPENDENCIES: readonly string[]

/** The package a bare specifier names: `@scope/name` or `name`, without a subpath. */
export declare function packageNameOf(specifier: string): string

/** Every package the CommonJS build bundles, sorted: the ES-module-only dependencies and their `dependencies`. */
export declare function bundledPackages(root: string): string[]
