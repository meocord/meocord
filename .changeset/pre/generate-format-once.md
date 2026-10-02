---
'meocord': patch
---

`meocord generate` formats the files it writes with your project's ESLint in one run, and says so. Before, it started a separate ESLint for each file, all at once. Each built your project's type information, and the command sat silent until the slowest finished: about 2.3 times the CPU for a controller with its spec and builder, enough to stall `generate` on a busy machine. Now it prints "Formatting with your project's ESLint..." after the files are created and waits for that one run. If ESLint can't run, or reports problems it can't fix, `generate` says so, and the files stay as written either way.
