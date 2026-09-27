## What changed

<!-- What this does and why. Link the issue it closes, if there is one. -->

## Release impact

<!--
A change that reaches the published package carries its own release note. Run
`bun run changeset` and commit the file it writes. Judge by what a consumer installs, not by
which file you edited — JSDoc compiles into the shipped .d.ts, so fixing a wrong @example is a
`patch`. See CONTRIBUTING.md.
-->

- [ ] `major` — makes a working bot stop working
- [ ] `minor` — new capability, nothing existing breaks
- [ ] `patch` — fix, performance, or a correction to what ships
- [ ] No changeset: nothing here reaches the published package

## Checklist

- [ ] `bun run lint` passes
- [ ] `bun run test` passes
- [ ] Tests cover the new behaviour, or this changes no behaviour
- [ ] If `src/bin/` was touched: `bun run build && bun run verify:generated` passes
- [ ] A changeset is committed, or this reaches nothing a consumer installs
- [ ] Public API changes are reflected in the JSDoc a user reads in their editor, and in the guides on meocord.dev through a meocord/docs pull request
- [ ] No plans, specs or other process files are committed
