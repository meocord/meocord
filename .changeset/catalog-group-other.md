---
'meocord': patch
---

A catalog group whose keys include `other`, such as `reasons: { spam: 'Spam', other: 'Other' }`, is read as a group, as the types and `expectCompleteCatalog` read it. Reading the group's own key, `t('reasons')`, shows the key with the development warning, as any other group does, where it showed the `other` text. Only untyped code, such as code reading a JSON catalog, can make that call; to show the text, read `t('reasons.other')`. A plural is an object whose every key is a plural category, and a translation's plural without an `other` form still falls back to the next catalog.
