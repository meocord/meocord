# AGENTS.md

Operating guide for AI agents working on MeoCord. Read it before your first change; it records how
this repository is built, verified, reviewed and released. Human contributors should read
[CONTRIBUTING.md](CONTRIBUTING.md), which this file assumes.

This file changes only with the maintainer's approval: do not edit it; propose changes instead. Keep
it short — link to CONTRIBUTING.md or the code rather than copying into it.

## 0. Agent setup

`AGENTS.md` is the only agent instruction file in this repository. A tool that reads a different
file links it locally before working; the link and tool directories such as `.claude/` are ignored
by git and never committed.

```bash
ln -s AGENTS.md CLAUDE.md
```

**AI use.** Using AI tools to work on MeoCord is allowed. The person who submits a change is its
author and is responsible for it — its correctness, its review and everything it ships — exactly
as for code written by hand. Changes therefore carry only that person's authorship.

## 1. Project at a glance

MeoCord is a decorator-based Discord bot framework built on discord.js: controllers, services,
guards and dependency injection (inversify), a CLI that scaffolds and builds applications, and a
testing toolkit.

| Item          | Value                                                                       |
| ------------- | --------------------------------------------------------------------------- |
| Package       | `meocord` on npm (unscoped), MIT                                            |
| Repository    | `meocord/meocord`, default branch `main`                                    |
| Consumers run | Node.js `>=22.13` or Bun; peer deps `discord.js ^14`, `dotenv ^18`          |
| Repo tooling  | Bun (install, scripts, tests), rollup (library build), Rsbuild (app builds) |
| Tests         | Vitest, colocated `*.spec.ts`, type-level `*.test-d.ts`                     |
| Releases      | changesets; publishing via npm trusted publishing with provenance           |

## 2. Commands

| Command                                     | Use it to                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bun install`                               | Install dependencies (CI uses `--frozen-lockfile`)                                                   |
| `bun run lint`                              | Format Markdown/templates, ESLint `--fix`, typecheck src, tests, eslint                              |
| `bun run test`                              | Run the suite, including `*.test-d.ts` type assertions                                               |
| `bun run test:coverage`                     | Run with coverage; thresholds are enforced in CI                                                     |
| `bun run build`                             | Clean `dist/` and build ESM, CJS and `.d.ts`/`.d.cts` declarations                                   |
| `bun run build && bun run verify:generated` | Generate a real app from `dist`, install it, and run its typecheck, tests, coverage, builds and lint |
| `bun run notices:check`                     | Fail if THIRD_PARTY_NOTICES.md is out of date (`bun run notices` rewrites)                           |
| `bun run changeset`                         | Write a release note for a change that reaches the published package                                 |

The pre-commit hook runs `bun run lint`. Do not bypass it for code changes.

## 3. Repository map

| Path                          | Contents                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `src/core/`                   | `MeoCordFactory`, `MeoCordApp` (lifecycle, dispatch), `component-routes`                   |
| `src/decorator/`              | `@MeoCord`, `@Controller`, `@Command`, `@Autocomplete`, `@Guard`, ...                      |
| `src/common/`                 | `Logger`, `applyDecorators`, `SetMetadata`, `Theme`                                        |
| `src/interface/`, `src/enum/` | Public types and enums                                                                     |
| `src/testing/`                | `meocord/testing`: testing module, mocks, `resolveRoute`                                   |
| `src/build/`                  | Rsbuild config and native-addon packing for `bundleDependencies`                           |
| `src/bin/`                    | The CLI, generators, `app-template/` and `builder-template/`                               |
| `src/util/`                   | Internal helpers: config loading, routing keys, runtime detection, ...                     |
| `scripts/`                    | `verify-generated.ts`, `third-party-notices.ts`                                            |
| `README.md`                   | Landing page on GitHub and npm: intro, install, one example, links to meocord.dev          |
| `docs/MIGRATING.md`           | Pointer to the upgrade guide on meocord.dev; its headings keep old changelog links landing |
| `.changeset/`                 | Pending release notes and changesets config                                                |

## 4. Architecture essentials

- **Public API** is exactly what the package entry points export: `meocord/core`, `/decorator`,
  `/common`, `/interface`, `/enum`, `/testing`, `/eslint`. `src/public-api.spec.ts` pins the
  runtime and type exports of each; adding or removing a name there is an API decision, and removing
  one is a breaking change. Entry indexes use named exports, never `export *`.
- **Types ship twice**: `.d.ts` for `import` and `.d.cts` for `require`. Keep both conditions in
  the `exports` map when adding an entry point.
- **Configuration**: a built bot loads only `dist/meocord.config.mjs` with `require()` and imports
  no transpiler (`util/meocord-config-loader.util.ts`). Reading `meocord.config.ts` through jiti is
  CLI-only (`util/meocord-source-config.util.ts`). Never import jiti from runtime code.
- **Component routing** lives in `core/component-routes.ts`: one table across all controllers,
  most specific pattern first, filtered by component type. Dispatch and `resolveRoute` share it;
  change routing there, never in a copy.
- **Startup**: `start()` rejects on a failed login and sets `process.exitCode = 1` first, clearing
  it on a later successful login only if it set it.
- **Builds** use Rsbuild (`build/rsbuild-config.ts`). Asset imports resolve to absolute paths under
  `dist` in both dev and production. `bundleDependencies` packs native addons into
  `dist/node_modules`, only for the build platform (`os`/`cpu`/`libc`), and writes a platform
  manifest checked at startup.
- **Templates**: generated code must pass the generated app's own `lint` with no help from its
  ESLint `--fix`. The app template's `tsconfig.json` includes `meocord.config.ts` with `noEmit`.

## 5. Coding conventions

### Comments

- Describe the code as it is now: what it does and why. No history — never "used to", "no longer",
  "formerly", "in older versions", or mentions of past releases. Hypotheticals are fine ("without
  this, the process would exit 0"). The story of a fix belongs in the commit message and changeset.
- **Private code** (anything not reachable through an entry point, plus specs, scripts, config and
  templates): one line when one line carries it; four lines at most when the information is needed.
- **Public API**: professional JSDoc — a summary, a short description, `@param`/`@returns`, and an
  `@example` when it helps. Clean and structured, never verbose. It is what users see on hover.
- Runtime messages aimed at migrating users may name what changed.

### Code

- TypeScript, ESM, strict. Match the surrounding code's naming, idiom and comment density.
- Bun is repository tooling only. Shipped code (`src/`, templates) uses only APIs Node also has — no
  `Bun.*`, `bun:*` or Bun-only `import.meta` properties; ESLint rejects them in `src/`.
- Keep public types free of internal shapes (no `regex`, `specificity` or metadata maps).
- New behaviour needs tests; a bug fix needs a test that fails without the fix. Prefer building
  real decorated controllers over mocking the framework.
- Prefer a structural fix over a band-aid where one is possible: change the order, data structure
  or contract that lets a problem happen, not a cap, retry or special case around it. A safety net
  may sit beside a structural fix, never in place of one; if only a band-aid is practical, say so.

## 6. Verification

Run before every PR: `bun run lint` and `bun run test`. Additionally:

| If you touched                            | Also run                                                        |
| ----------------------------------------- | --------------------------------------------------------------- |
| `src/bin/`, templates, generators         | `bun run build && bun run verify:generated`                     |
| Exports, entry points, `rollup.config.js` | `bun run build`, then check `dist/types` (`.d.ts` and `.d.cts`) |
| Dependencies                              | `bun run notices:check`, `bun audit`                            |
| Build, config loading, dispatch, startup  | A lifecycle check in a generated app (below)                    |

Typechecks and render assertions have missed real bugs in this project. For anything that changes
what an application experiences, generate an app from the built package and run it: install,
`lint`, `test`, `build --dev` and `--prod`, and `start` with a missing and an invalid token.

## 7. Changesets and releases

- A change that reaches the published package carries a changeset (`bun run changeset`). Judge the
  bump by what a consumer installs: `major` breaks a working bot, `minor` adds capability, `patch`
  fixes or corrects what ships (JSDoc compiles into `.d.ts`, so a wrong `@example` is a patch).
  Docs, CI and test-only changes take none. Commit prefixes do not decide releases.
- Write release notes for the person upgrading: what changed and what they do about it, linking the
  upgrade guide at `https://meocord.dev/docs/<line>/migrating#<anchor>` for breaking changes, and other
  documentation at `https://meocord.dev/docs/<line>/<page>`, never a README anchor.
- Merging to `main` publishes nothing. The workflow opens a `chore: release` pull request; **merging
  that pull request publishes to npm**.

**Agents never publish.** Specifically, never:

- merge a `chore: release` pull request, or push to the `changeset-release/main` branch;
- run the Release workflow by hand (`workflow_dispatch`) — a push run can start minutes late, and a
  duplicate run races the real one;
- run `npm publish`, `npm dist-tag`, `npm deprecate` or any command that writes to the registry;
- enter credentials or tokens anywhere.

Releases happen only on the maintainer's explicit go-ahead, performed by the supervisor.

## 8. Git and pull requests

- Branch from up-to-date `main`: `feat/…`, `fix/…`, `chore/…`, `docs/…`. One topic per branch.
- Conventional commit subjects (`fix(scope): …`, `feat(testing): …`, `!` for breaking), with a body
  explaining what was wrong, what changed and how it was verified.
- Open a PR against `main` using the PR template; link the issue it closes (`Closes #n`).
- Branch protection: linear history, required checks `Lint`, `Test`, `Build`, `Coverage`, `Windows`, `Redis`.
  PRs land through the merge queue, which rebases them onto `main`, re-runs the checks and merges.
- No AI residue — see below.
- Commits, PRs and code say nothing about how the work was organised — see section 9.
- Never force-push `main`, and never rewrite a branch someone else is working on.

### No AI residue

The repository holds only what the project maintains: source, tests, configuration, and
documentation written for users and contributors. Anything a tool or workflow produces for its own
process stays out of it — plans, specs, design documents, brainstorming, task lists, progress notes,
prompts, reports, and skill output such as superpowers plans and specs. Keep those in a scratch
directory outside the repository.

Such files describe work in progress, so they go stale as soon as the work lands, and nobody
maintains them. The lasting record of a change is its commit message, its PR and its changeset.
`docs/superpowers/` and `docs/plans/` are ignored by git as a safeguard.

## 9. Working as a team of agents

Work may be split between one **supervisor** session and several **worker** sessions. Session names
are local to whoever runs them and do not belong in this file or anywhere else in the project.

**Workers**

- Take tasks only from the supervisor. Work on your own branch; never touch another worker's
  branch or files outside your task.
- Open a PR, then report to the supervisor: the PR link, what changed, what you verified (commands
  and results), and anything left undone or uncertain. Report failures plainly, with the output.
- Do not merge. The supervisor reviews and merges, one PR at a time.
- When blocked or unsure about scope, API shape or a release implication, ask the supervisor
  instead of guessing.

**Keep coordination out of the project**

Everything that lands in the repository or on GitHub reads as the project's own work, written for
its users and maintainers. Code, comments, commit messages, branch names, PR titles and bodies,
changesets, issue comments and release notes never mention:

- agents, sessions, workers or the supervisor, by role or by name;
- task assignments, hand-offs, review rounds or instructions received;
- internal reasoning, drafts, or how a change was arrived at, beyond what a reviewer needs to
  understand the change itself;
- AI tools or models, including attribution lines such as `Co-Authored-By` — the submitter is the
  author (see section 0).

Coordination happens between sessions and stays there.

**Supervisor**

- Assigns self-contained tasks with a branch name, a definition of done and the relevant sections
  of this file.
- Reviews every PR against sections 4–8, for AI residue and for any trace of coordination, runs
  the verification itself, and merges in sequence so branches rebase once rather than repeatedly.
- Owns releases, and only on the maintainer's go-ahead.

## 10. Documentation

- Every Markdown file is formatted by prettier (`bun run lint` does it).
- The guides, the upgrade guide and the API reference live on meocord.dev, in the meocord/docs
  repository. A user-facing change updates them there, in a meocord/docs pull request, and the JSDoc
  here, which the API reference is generated from.
- The README is the landing page. It holds no guide content, and its example compiles
  (`check:jsdoc-examples` checks it).
- `docs/MIGRATING.md` and the README's "Moved sections" keep headings that published changelogs link
  to. Never rename or remove one; each points at the same section on meocord.dev.
- Code examples in JSDoc must compile against the current API.
