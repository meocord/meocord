---
'meocord': patch
---

When a theme, or one of its groups, isn't a plain object, the refusal now advises a database row's plain form, such as Mongoose's `toObject()` or Sequelize's `get({ plain: true })`, or an object literal of the values you set. It suggested `{ ...value }` before, which for a database row copies the row's own fields instead of the theme: the copy passes the check and sets nothing. A test that pins the refusal's full text sees the new advice.
