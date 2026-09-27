# Contributing to MeoCord

Thanks for taking the time. Issues, questions, and pull requests are all welcome.

## Table of Contents

- [Getting set up](#getting-set-up)
- [Making a change](#making-a-change)
- [AI-assisted contributions](#ai-assisted-contributions)
- [What the checks do](#what-the-checks-do)
- [Writing JSDoc](#writing-jsdoc)
- [Checking against real Discord](#checking-against-real-discord)
- [Changesets and releases](#changesets-and-releases)
- [Reporting bugs](#reporting-bugs)
- [Security issues](#security-issues)

## Getting set up

MeoCord builds and tests with [Bun](https://bun.sh), and ships to consumers running Node `>=22.13`.
Bun is the repository's tooling only: the code MeoCord ships — `src/`, and the application templates —
runs on whichever runtime the application chooses, so it uses Node APIs and no Bun-only ones such as
`Bun.serve`, `Bun.file` or `bun:*` modules. `bun run lint` rejects them in `src/`.

```bash
git clone https://github.com/meocord/meocord.git
cd meocord
bun install
bun run test
```

| Command                    | What it does                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `bun run test`             | Runs the suite, including the `*.test-d.ts` type-level assertions                                 |
| `bun run test:watch`       | Same, in watch mode                                                                               |
| `bun run test:coverage`    | Runs the suite with istanbul coverage and enforces the thresholds                                 |
| `bun run test:mutation`    | Mutation-tests the core modules with Stryker, by hand and not in CI; name modules to run a few    |
| `bun run lint`             | Formats, fixes lint, then typechecks the source, test, and eslint projects                        |
| `bun run build`            | Clears `dist/`, builds ESM, CJS, and type declarations through rollup, and writes `dist/cli.json` |
| `bun run verify:generated` | Generates an app from the packed build and runs its own checks — see below                        |
| `bun run cli:scenarios`    | Runs the packed CLI through what must work and what must fail clearly — see below                 |
| `bun run test:e2e`         | Runs a smoke app against real Discord with a test application — see below                         |
| `bun run changeset`        | Records a release note for your change — see below                                                |
| `bun run notices`          | Regenerates THIRD_PARTY_NOTICES.md after a dependency is added or removed                         |

## Making a change

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/your-feature`.
3. Write a test first where there is behaviour to pin down.
4. If the change reaches the published package, run `bun run changeset` and commit the file it writes.
5. Run `bun run lint` and `bun run test` before pushing.
6. If you touched anything under `src/bin/`, also run `bun run build && bun run verify:generated`. If you
   changed a public symbol's JSDoc, run `bun run build && bun run check:jsdoc-examples`.
7. If you added or removed a dependency, run `bun run notices` and commit the result. CI fails when it is out of date.
8. Push and open a pull request against `main`.

Include a description of what changed and why, and add tests for any new behaviour. CI runs everything
above, so nothing is lost if you forget a step — running it locally is just faster than waiting.

Approved pull requests land through GitHub's merge queue: the queue rebases each one onto the latest
`main`, runs the required checks again, and merges it with a rebase merge, so `main` keeps a linear
history and every commit on it has passed CI.

Files carry no license header: the [LICENSE](./LICENSE) at the root covers the whole repository.

## AI-assisted contributions

Using AI tools is welcome. Whoever submits a change is its author and is responsible for it — for
its correctness, its tests and everything it ships — exactly as for code written by hand, so
commits carry only the submitter's authorship.

Keep the repository to what the project maintains. Plans, specs, design notes, task lists and other
output a tool produces for its own process stay outside it; they go stale as soon as the work lands.

Agents working on the repository follow [AGENTS.md](AGENTS.md). It changes only with the
maintainer's approval: a pull request that edits it fails CI until the maintainer adds the
`agents-md-approved` label.

## What the checks do

Two classes of bug in this codebase slip past the obvious check, and two jobs exist because of them.

**`verify:generated`** packs `dist` as npm would publish it, generates an application with every
component in it, installs it from the tarball, and runs the application's own checks: ESLint without
`--fix`, both tsconfigs, `test`, `test:coverage`, `build --dev` and `build --prod`. It also generates one
controller of every type flat and nested, in separate projects, and typechecks each. The application
lives in the system temp directory, so it cannot resolve anything from the repository's `node_modules`,
and it needs network access for the install. Asserting on the text a template renders says nothing about
whether that text lints, compiles, tests or builds; shipped bugs have hidden in each of those gaps.

**`cli:scenarios`** installs an application from the packed build and runs the real CLI through scenarios that must succeed and scenarios that must fail: each asserts the exit code, what the output says, and which files were written or left alone. It also fails a scenario that leaves a process running. Run it after `bun run build`; `--only <text>` picks scenarios by name, `--windows` runs the subset that also runs on Windows. `--tier slow` runs the slower scenarios: an application installed with npm, the bun runtime, bundled builds run without `node_modules`, process sharding, and stop signals in each start mode, sent to the process group as Ctrl+C is and to the CLI alone as Docker, pm2 and systemd send them. They reach Discord with a token it refuses, so they need the network; they run on every pull request and queued merge, in a job of their own reported under the `Test` check, before every release, and nightly, with `--tier all` running both tiers. An unknown tier, or a selection that matches no scenario, fails before anything is installed. Add a scenario whenever a command gains a flag or a failure gains a message.

**The Windows job** installs the packed tarball globally and drives the CLI through the `.cmd` shim npm
writes from the interpreter line. Nothing on a POSIX runner exercises that path, and generation is what
walks and writes file paths, so it is also run where the separator and case rules differ.

## Writing JSDoc

A public symbol's JSDoc is read in two places: on hover in an editor, and as the symbol's page in the API
reference, which the docs site generates from the published `.d.ts`. So it is short enough for a hover and
structured enough for the generator. On hover the whole comment fits a screen, about 30 lines.

````ts
/**
 * Runs guards before a handler, or before every handler of a controller.
 *
 * Use it to decide whether a call may run at all: who may use a command, where, or on whose message. To limit
 * how often a handler runs, use {@link Cooldown}; to check its input, {@link Validate}.
 *
 * @remarks
 * The handler runs only when every guard allows the call. …
 *
 * @param entries - Guard classes, or `{ provide, params? }` to give one use of a guard its params.
 * @throws Error when an entry is neither a guard class nor `{ provide, params? }`, as the decorator applies.
 *
 * @example
 * ```ts
 * @Command('trade', CommandType.SLASH)
 * @UseGuard(StaffGuard, { provide: ChannelGuard, params: { channelIds: ['123456789012345678'] } })
 * async trade(interaction: ChatInputCommandInteraction) {
 *   await respond(interaction).send('Trade opened.')
 * }
 * ```
 *
 * @pipeline guards after the global guards, a controller's before a method's
 * @group Decorators
 * @category Pipeline stages
 * @see {@link Guard}
 */
````

- **Summary:** the first paragraph, one sentence. A function or decorator starts with a verb, a type
  with a noun phrase. The reference shows the first paragraph as the summary, so a second sentence starts the next
  paragraph.
- **When to use:** the paragraphs after it, at most three sentences: what it is for, and what to use instead,
  linked.
- **`@remarks`:** how it works and its gotchas, when there are any. Anything longer belongs in the guide, linked
  with `@see`.
- **Options** are documented on the options type's own properties, one sentence each, with `@defaultValue` for a
  default, not in `@param`. The reference builds its options table from them, so every property and method of a
  documented interface has a comment of its own.
- **`@param`** says what each positional parameter is; **`@returns`** is there only when the type does not say it;
  **`@throws`** says when it refuses something, and what to do about it.
- **`@example`:** one, in a fenced `ts` block, at most 12 lines of real code. Every decorator, function and class
  has one; a type may skip it. See below for how it is compiled.
- **`@pipeline <stage> [clause]`:** where a symbol that runs in the pipeline runs. The stage is one of, in the
  order a call runs: `observers`, `filters`, `defer`, `parse`, `guards`, `cooldown-check`, `fetch`,
  `interceptors`, `validation`, `pipes`, `cooldowns`, `lock`, `handler`. A symbol that runs in two places takes
  one tag per place.
- **`@group`:** the section of the API reference, and its URL. Every public symbol has one of `Controllers`,
  `Decorators`, `Responses`, `Utilities`, `Testing`, `Configuration`, `CLI`, `Types`.
- **`@category`:** an optional subgroup: for `Decorators`, `App`, `Controllers`, `Handlers`, `Pipeline stages` or
  `Params`; for `Responses`, `Errors` or `Presenters`; for `Utilities`, `Localisation` or `Cooldown stores`; for
  `Configuration`, `Config file`, `App options` or `ESLint`; for `Testing`, `Module`, `Mocks` or `Inspection`.
- **`@see`:** up to four related symbols, `{@link Symbol}`, or guide pages by their `https://meocord.dev/docs/4.1/…`
  URL: the line of the package's own version, so a reader lands on pages for the version they installed. The check
  fails a link to another line, and `bun run check:jsdoc-examples --fix` moves every link to the package's line, as
  a new minor version needs.
- **`@deprecated`** links its replacement; **`@internal`** marks an export that is not public API.
- Leave out what is derived: signatures and types, the entry point, the version a symbol first appeared in, and
  anchors.

Write as for any comment here: the code as it is now, with no history.

### Examples compile

`bun run check:jsdoc-examples`, after `bun run build`, compiles the example of every public symbol that has a
`@group` against `dist`, and CI runs it. It compiles the README's `typescript` blocks the same way, so the landing
page's example works as a reader copies it; a README block imports what it uses, each import on one line. So an
example:

- **has no imports.** A name exported by one of meocord's entry points or by discord.js is imported for it; a name
  both export is an error, not a guess.
- **may be class members.** A snippet of decorated methods, with a constructor for what it injects, is compiled
  inside a `@Controller()` class; module code before the first member, such as a decorator it defines, stays
  outside it.
- **may use a fixture**, declared in `scripts/jsdoc-examples/fixtures.ts`: the guards `StaffGuard` and
  `ChannelGuard` (with `params: { channelIds }`), `TimingInterceptor`, `CooldownFilter` (for `CooldownError`),
  `TrimPipe`, and `ProfileService` (`render(userId)` gives an `EmbedBuilder`). An example uses one as a dependency,
  applying it or injecting it, and never extends it; each means what the guide's example of the same name does. A
  new fixture goes in that file with its first use.
- **may import a library it shows,** such as `import { z } from 'zod'`, in its first lines. The library is a dev
  dependency of the repository.
- declares anything else it uses.

A symbol with a `@group` follows all of this: the check also fails when its summary is more than one sentence or
missing, when it is not a type and has no example, or when an interface's own property or method has no comment.
`--coverage` also lists the public symbols that do not follow this yet: a missing `@group`, summary or example. A
symbol marked `@internal` is left out of both, as the reference leaves it out.

In an editor, a decorator example shows a stray `@Command —` inside its code on hover: TypeScript's JSDoc parser
takes a line starting with `@` for a tag, even in a code fence. The API reference and the checker read the fence
correctly, so write decorators as they are.

## Checking against real Discord

`bun run test:e2e` runs a small bot against Discord itself: the smoke app in `test/e2e/app`, installed
from the packed build as `verify:generated` installs its application. Mocks and render checks cannot say
whether Discord accepts what MeoCord sends, so these checks do. Run it after `bun run build`. Without
credentials it prints why it skipped and exits 0.

It checks, in order:

- the bot logs in, and `onReady` runs in dependency order, told the process is primary;
- `ShardContext.call` reaches the process;
- exactly the smoke command is registered in the test server, and `clearOther` leaves no global command;
- with a helper bot, `@On('messageCreate')` receives its message, and `@ReactionHandler` with
  `bots: true` its reaction, while one without `bots: true` ignores it.
  `@MessageHandler` ignores messages from bots, so that one is marked for a person to check;
- with a helper bot, the theme on real ids: a listener's reply, read back from Discord, carries the
  app's theme, the listener class's `@UseTheme`, the test server's and the helper bot's from `themeFor`,
  merged, and a `UserError` it throws is answered with that theme's warning emoji (`replyEmoji`);
- SIGINT sent to the CLI alone, as Docker, pm2 and systemd send it, runs `onShutdown` in reverse
  dependency order and exits 0, leaving no process behind;
- with process sharding and two shards: a process per shard, primary only on shard 0, `ShardContext.call`
  reaching both, commands registered once and left exactly as they were (same ids and versions), and
  SIGINT shutting every shard down through `onShutdown`, leaving no process behind.

The command set is stable, so each run's registration is an idempotent bulk update rather than a delete
and re-create, which keeps the test application well inside Discord's limits. The script passes the bot
its token in the environment of the processes it starts and prints no token; output it shows has them
replaced.

### Setting up a test application

> [!WARNING]
> Use an application and a server made only for testing. The checks register and remove commands and
> the manual run registers global ones, which would replace a real bot's.

1. In the [Developer Portal](https://discord.com/developers/applications), create an application for
   testing.
2. On **Installation**, tick both **User Install** and **Guild Install**, choose the Discord-provided
   install link, give Guild Install the `applications.commands` and `bot` scopes with the **View
   Channels**, **Send Messages**, **Embed Links**, **Attach Files** and **Read Message History**
   permissions, and User Install the `applications.commands` scope. Embed Links and Attach Files are
   for the error and loading views and the attachments the bot sends through the channel once a token
   has expired. Together those permissions are `117760`; **Add Reactions** and **Use External Emojis**,
   which make `379968`, are not needed. With your application's id, the install links are:

   ```text
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=117760&integration_type=0
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=applications.commands&integration_type=1
   ```

   The first adds the bot to a server; the second installs the application to your account.

3. On **Bot**, reset the token and keep it for `.env`. Turn on the **Message Content Intent**; the smoke
   app asks for it, and login fails without it.
4. Create a server for testing and add the bot through the install link. In Discord's settings, turn on
   **Advanced > Developer Mode** so **Copy Server ID** and **Copy Channel ID** appear.
5. Optionally, create a second application as the helper bot. It needs no intents: the script drives it
   over REST. Add it to the test server with the `bot` scope and **View Channels**, **Send Messages**,
   **Add Reactions** and **Read Message History** in the channel it will use. It deletes its message
   when the check ends.
6. Copy `.env.example` to `.env` at the repository root and fill it in. git ignores `.env`, and Bun loads
   it into the environment of every `bun run` in the repository, the tests, lint and builds included, not
   only `test:e2e`; nothing in the repository prints the environment as a whole.

| Variable                       | Required | Value                                                     |
| ------------------------------ | -------- | --------------------------------------------------------- |
| `MEOCORD_E2E_BOT_TOKEN`        | yes      | The test application's bot token                          |
| `MEOCORD_E2E_GUILD_ID`         | yes      | The test server's id                                      |
| `MEOCORD_E2E_CHANNEL_ID`       | no       | A text channel in the test server, for the helper bot     |
| `MEOCORD_E2E_HELPER_BOT_TOKEN` | no       | The helper bot's token; with the channel, runs its checks |

### The manual checklist

What a person sees in Discord cannot be read back over the API, so `respond()` and `@Defer` are
checked by hand. `bun run test:e2e --manual` builds the smoke app, registers its checklist commands
globally, the only scope a user install reaches everywhere, prints the install links and runs until
Ctrl+C, showing the bot's output. Install the application to your account through the second link too.
It first clears the test server's own commands, so each command appears there once; the next automated
run removes the global commands and registers the server's again.

You need a second Discord account for the stranger's click, a server the bot is not in, and a group DM.
`/e2e-panel` answers with where it was used and whether the bot is there, then a panel of buttons. Run
it in each of the four contexts, and work through the steps in each:

| Context                                     | The panel says                               |
| ------------------------------------------- | -------------------------------------------- |
| The test server                             | `Where: guild; bot present: true`            |
| A server without the bot, as a user install | `Where: guild; bot present: false`           |
| The bot's DMs                               | `Where: bot-dm; bot present: true`           |
| A DM with someone else, or a group DM       | `Where: private-channel; bot present: false` |

1. **`/e2e-panel`**: a "thinking…" state, then the panel, with the context as above.
2. **Eager, 2s**: at once, every button is disabled, the clicked one shows ⏳, and "⏳ Working on it…" is
   added. Two seconds later the text says "Eager: updated", the buttons are back and the loading view
   is gone.
3. **Auto, fast**: the text updates at once, with no disabled buttons or loading view in between.
4. **Auto, 3s**: nothing for about a second and a half, then the lock as in step 2, then the update and
   the buttons back.
5. **Concurrent clicks**: click **Slow A, 5s**, then **Slow B, 5s** within a couple of seconds. Each is
   disabled with ⏳ once clicked while the other buttons stay usable, and each comes back when its own
   five seconds end, A first. The loading view stays until both have ended.
6. **Follow-up only, 2s**: the lock as in step 2, then two seconds later a private "Follow-up only: sent"
   message, and the panel comes back as it was: its buttons usable, the loading view gone. The handler
   answers only with a follow-up, so nothing but `@Defer` puts the panel back.
7. **A stranger's click**: from the second account, click **Owner only**. Only they see "Only the user
   who opened this panel can use this button.", and the panel does not change, not even briefly. When
   you click it, the lock appears and the text says "Owner only: handled for its owner".
8. **The error, public**: click **Fail**. You see a private "Oops!" message with "An error occurred
   while executing the command.", and the panel comes back as it was.
9. **The error, appended**: run `/e2e-panel private:True` and click **Fail** on that private panel. The
   error is added to the private panel itself rather than sent as a separate message.
10. **The error, edit in place**: run `/e2e-private-fail`. Its private "thinking…" reply turns into the
    error message after a second.
11. **Optional, the 15-minute expiry**: click **Answer after 15 min** and wait 15½ minutes. Where the bot
    is present, the panel then says "Answered after the token expired" and its buttons come back, sent
    through the channel since the interaction's token has expired. Where it is not, the panel stays
    locked and the bot's output logs why.

For a private Components V2 card, run `/e2e-card`: a card only you see, with an uploaded image, a select
whose default is **Dark**, and three buttons. Wait for each step to settle before the next. The first step
comes right after the card is sent, when the lock's edit has Discord process the image again:

1. **Select, follow-up only**: pick **Light**. The card locks, a private "Select, follow-up only: picked
   light" message follows, and the card comes back as it was: its image, its buttons usable, and the select
   showing **Dark** again rather than the pick.
2. **Follow-up only**: the lock, a private "Card, follow-up only: sent" message, and the card back as it was.
3. **Slow, 3s**: the lock for three seconds, then the card back as it was, with no message.
4. **Fail**: the lock, a private "Oops!" message, and the card back as it was.

For message handlers, send `e2e ping` in the test server: the bot answers "pong".

For the theme, run `/e2e-theme` in the test server, where the server's theme makes the primary colour
`#B04A9C`, and in the bot's DMs, where it is the app's `#5865F2`. A bot cannot start an interaction, so
these are checked by a person:

1. **`/e2e-theme`**: four embeds. The two without a colour, the plain one and the `EmbedBuilder`, have a
   bar in the primary colour; `0` has none; `#26A042` keeps its green.
2. **Containers**: a follow-up with two containers. The one without an accent has a bar in the primary
   colour; the one with a `null` accent has none.
3. **Follow-up**: an embed with a bar in the primary colour.
4. **Loading, 3s**: the button shows ⏳ and the "Working on it…" view has a bar in the primary colour
   until the three seconds end.
5. **Fail**: a private "Oops!" message in the theme's `danger`, `#E3606D`.
6. **Refuse**: a private "Oops!" message in the theme's `warning`, `#B08400`.
7. **Collector**: click **Collected** on the follow-up within a minute. It becomes an embed with a bar in
   the primary colour.

The manual run registers `/e2e-theme` globally with the checklist's commands; the next automated run
removes them.

### In CI

The **Real Discord** job runs `test:e2e` on pull requests from branches of this repository, on pushes to
`main` and `beta`, and nightly. Its values are secrets of the `e2e` GitHub environment, under the same
names as `.env`, and reach only the step that runs the script, which also masks both tokens. The job
can read the repository and nothing more, requests no OIDC token and keeps no git credentials. Runs
share the `discord-e2e` concurrency group, so only one logs in as the test bot at a time, and a
running check is never cancelled for another. It is not a required check, so an outage at Discord blocks
no merge. Pull requests from forks get no secrets: for them a separate job explains the skip. Without
the environment's secrets, the job passes with the skip message. With the test bot's but without the
helper bot's, the job skips the helper bot's checks, as a contributor's run does, and adds a warning to the
run saying which secrets to set, so a passing job never hides that they did not run.

## Changesets and releases

Releases run on [changesets](https://github.com/changesets/changesets). A change a consumer
would notice carries its own release note, written by you, in a file under `.changeset/`:

```bash
bun run changeset
```

The prompt asks for a bump and a description, then writes a markdown file. Commit it with your
change.

| Bump    | For                                                        |
| ------- | ---------------------------------------------------------- |
| `patch` | A fix, a performance change, or a correction to what ships |
| `minor` | New capability that does not break an existing bot         |
| `major` | Anything that makes a working bot stop working             |

**Not every pull request needs one.** A change that never reaches the published package — README
edits, CI configuration, tests, internal refactors — has nothing to tell a user, so it ships with
no changeset. Judge by what a consumer installs, not by which file you edited: JSDoc compiles into
the shipped `.d.ts` and is what a user reads in their editor, so correcting a wrong `@example` is a
`patch` even though you only touched a comment.

Getting it wrong is recoverable. A changeset is a file, so a forgotten or mis-sized one is fixed by
committing another — nothing depends on a commit message being right the first time.

### How a release happens

Merging to `main` does not publish. A bot collects every pending changeset into a release pull
request titled `chore: release`, showing the version it computed and the changelog it will write.
**Merging that pull request is what publishes to npm.** It stays open and keeps absorbing changes
until you decide to ship, so batching several changes into one release is the default rather than
something you have to arrange.

Publishing uses npm trusted publishing — the registry issues short-lived credentials to the
workflow, so no npm token is stored anywhere — and every release carries a provenance attestation.

The release pull request is opened by the workflow. With only the workflow's own token, GitHub holds
its CI runs until a maintainer approves them from the pull request's Checks tab, and branch
protection keeps it unmergeable until they pass. A `RELEASE_TOKEN` secret in the `Production`
environment removes that step: a fine-grained personal access token for this repository alone, with
read and write access to Contents and Pull requests. The release pull request is then opened as that
identity and its checks start on their own.

Prereleases use changesets' pre mode, on `main`:

```bash
bunx changeset pre enter beta
```

Committing the resulting `.changeset/pre.json` switches the release pull request to prerelease
versions — `4.0.0-beta.0`, then `4.0.0-beta.1` — published under the `beta` dist-tag rather than
`latest`, so `npm install meocord` keeps resolving the stable release. Changesets keep landing as
usual in the meantime. To ship the stable version, commit the result of:

```bash
bunx changeset pre exit
```

and the next release pull request versions `4.0.0` from everything collected during the beta.

## Reporting bugs

Open an [issue](https://github.com/meocord/meocord/issues/new/choose). The bug form asks for the
MeoCord, discord.js, Node, and runtime versions, because behaviour genuinely differs across them.

A minimal controller that reproduces the problem is worth more than a description of it.

New issues start as `status: needs triage`. A maintainer adds its `type:` and `area:` labels and moves
it to `status: confirmed`, `status: needs reproduction` or `status: needs info`. Issues labelled
`good first issue` or `help wanted` are open for anyone to take on — say so in the issue first.

## Security issues

Do not open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md).
