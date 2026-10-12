---
'meocord': patch
---

The `sourceMappedStacks` JSDoc now says what it maps under Bun: `error.stack`, and so every trace MeoCord's `Logger` prints. What Bun prints itself, for an uncaught error, an unhandled rejection or `console.error(error)` before `error.stack` is read, keeps the positions in `dist`. Under Node, every trace is mapped, as before. Mapping Bun's own output is tracked in #717.
