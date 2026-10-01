---
'meocord': patch
---

A `@MessageHandler(pattern)` handler whose params don't fit its pattern is now explained in three lines rather than twenty-four. The decorator had one form for each way a handler can be declared, so TypeScript explained the mismatch against every form, and the reason, such as a param the pattern lacks, came last. It now has one form, and the second line names the params that don't fit and what the pattern gives each: `"The handler's params do not fit the pattern": { side: { readonly 'not a param of the pattern': "side" } }`. What compiles is unchanged.
