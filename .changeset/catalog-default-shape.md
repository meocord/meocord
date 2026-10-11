---
'meocord': patch
---

A translation is now read by the default catalog's shapes. Where the default catalog has a group with an `other` message, such as `{ other: 'Other', label: 'Label' }`, a translation that keeps only `{ other: '…' }` is that group, not a plural:

- `t.locale('ru')('grp')` comes back as `grp`, with the development warning that it names a group, as the same key does on the default catalog; it returned the `other` text. `t.locale('ru')('grp.other')` still returns it.
- `expectCompleteCatalog` reports only the group's missing messages, and no longer says the group is not in the default catalog.
- A translation that gives a text where the default catalog has a group is reported as `grp should be a group, as the default is`, beside the group's missing messages, where `expectCompleteCatalog` said the group is not in the default catalog.

A translation that gives a plural where the default catalog has a plain message now falls back to the next catalog, as a group given for a text does. The types already refuse such a translation, and `expectCompleteCatalog` already reports it, so only a catalog cast past the types read it before.
