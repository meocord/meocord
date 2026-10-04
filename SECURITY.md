# Security Policy

## Supported versions

Security fixes land on the latest minor of the current major line and are published to npm as a
patch release. Older majors are not backported.

| Version               | Supported                           |
| --------------------- | ----------------------------------- |
| Latest minor of 4.x   | Yes                                 |
| Earlier minors of 4.x | No: upgrade to the latest 4.x minor |
| < 4.0                 | No                                  |

An earlier minor whose fix is not backported is deprecated on npm, with the advisory it is affected by.

Prerelease channels (`alpha`, `beta`) are not covered — move to `latest` before reporting.

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security problem.**

Report it privately through GitHub:
[Report a vulnerability](https://github.com/meocord/meocord/security/advisories/new).

If that is unavailable to you, email <ukasyahrz@outlook.com> with `MeoCord security` in the subject.

Useful to include:

- The MeoCord version, and the discord.js and Node or Bun versions it runs against
- What an attacker gains — token disclosure, arbitrary code execution, privilege escalation past a
  guard, and so on
- A minimal reproduction, ideally a controller and the interaction that triggers it

## What to expect

- An acknowledgement within 7 days
- An assessment, and a fix or an explanation of why it is not a vulnerability, within 30 days
- Credit in the release notes and the advisory, unless you prefer otherwise

This is a single-maintainer project. Those are targets held in good faith, not a contractual SLA.
Please hold off on public disclosure until a fix is published, or 90 days have passed.

## Scope

In scope: anything in the published `meocord` package — the framework runtime, the decorators and
guard pipeline, the CLI, and the templates it generates.

Out of scope, because they are not MeoCord's to fix:

- Vulnerabilities in `discord.js`, Node, Bun, or other dependencies — report those upstream. If a
  MeoCord default makes an upstream issue materially worse, that part is in scope.
- Leaking your own bot token by committing `.env` or logging `meocord.config.ts`
- Bots built with MeoCord that are misconfigured — for example a controller with no `@UseGuard`
  where one was needed
