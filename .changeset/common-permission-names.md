---
'meocord': minor
---

`meocord/common` exports `permissionNames(permissions, target?, options?)`, which names permissions as a server owner reads them in Discord's role settings: `permissionNames(['ManageMessages', 'BanMembers'])` is `['Ban Members', 'Manage Messages']`, in bit order, and `{ join: 'and' }` gives `Ban Members and Manage Messages`, joined as a list in the labels' language. The labels are Discord's own wording, commas included, such as `Kick, Approve, and Reject Members`. Given an interaction or a message, it names them in that user's or server's language through your app's translator; given a `Locale`, through `options.t`. A bit with two flag names, such as `1 << 30`, gives one label; a bit with no label gives its flag name, and a bit discord.js doesn't name gives `Unknown permission (1 << n)`. See [Formatting](https://meocord.dev/docs/4.3/formatting).

The labels are new MeoCord texts in a `meocord.permissions` group, by flag name, which an app's catalog translates like the others. See [Localisation](https://meocord.dev/docs/4.3/localisation).
