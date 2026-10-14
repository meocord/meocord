---
'meocord': patch
---

A translation is now read by the default catalog's shapes. Where the default catalog has a group with an `other` message, such as `{ other: 'Other', label: 'Label' }`, a translation that keeps only `{ other: '…' }` is that group, not a plural:

- `t.locale('ru')('grp')` comes back as `grp`, with the development warning that it names a group, as the same key does on the default catalog; it returned the `other` text. `t.locale('ru')('grp.other')` still returns it.
- `expectCompleteCatalog` reports only the group's missing messages, and no longer says the group is not in the default catalog.
- A translation that gives a text where the default catalog has a group is reported as `grp should be a group, as the default is`, beside the group's missing messages, where `expectCompleteCatalog` said the group is not in the default catalog.

A translation that gives a plural where the default catalog has a plain message, as a catalog loaded from JSON may for a language that needs plural forms, is still read as that plural. The types refuse such a translation, and `expectCompleteCatalog` reports it as `should be a text, as the default is`.
