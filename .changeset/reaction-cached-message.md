---
'meocord': patch
---

A reaction no longer re-fetches its message from Discord's API when the bot already holds it whole. Every reaction add and remove cost one request, queued behind Discord's rate limits, so a reaction-role or poll message delayed every handler under a burst of reactions. Now `reaction.message` is the copy the gateway keeps current, fetched first only when the bot holds the message by its id alone, and a reaction that arrives without its count (with `Partials.Reaction`) is fetched once, so `reaction.count` is no longer `null`.

This changes 4.0's behaviour, which fetched the message for every reaction. The cached copy differs from a fresh fetch only rarely: after a reconnect that could not resume and so missed an edit, or for a poll's counts when the bot lacks the `GuildMessagePolls` intent. A handler that needs the message straight from Discord calls `await reaction.message.fetch()` itself.
