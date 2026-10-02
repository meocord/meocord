---
'meocord': patch
---

On Windows, `meocord generate` in a project installed with npm, yarn or pnpm reported "Failed to create" and exited 1 for every file, though the file was written. Its formatting step spawned `node_modules/.bin/eslint.cmd`, which Node refuses to start without a shell. The project's ESLint now runs through the same runtime as the CLI. A formatting failure never marks a written file as failed.
