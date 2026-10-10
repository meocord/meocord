---
'meocord': patch
---

`meocord create` folds accented letters into the app's folder and package name instead of dropping them: "Café Bot" gives `cafe-bot`, where it gave `caf-bot`, and "Straße" gives `strasse`. A name with no Latin letters or digits, such as one written only in another script, is refused with a message that says it needs Latin letters or digits.
