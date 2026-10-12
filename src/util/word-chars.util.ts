/** Each character of a string, as a union; tail-recursive, so a long string stays within the compiler's depth. */
type Chars<S extends string, Found = never> = S extends `${infer First}${infer Rest}` ? Chars<Rest, Found | First> : Found

/** A character `\w` matches without the `u` flag: ASCII letters, digits and `_`. */
type WordChar = Chars<'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'>

/**
 * Whether a string is one or more word characters, as a `{name}` takes them in a message or a customId pattern. It
 * reads 16 at a time, so a name up to 16,000 characters long stays within the compiler's 1,000 steps of tail recursion.
 */
export type IsWord<S extends string> =
  S extends `${infer A}${infer B}${infer C}${infer D}${infer E}${infer F}${infer G}${infer H}${infer I}${infer J}${infer K}${infer L}${infer M}${infer N}${infer O}${infer P}${infer Rest}`
    ? [A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P] extends [WordChar]
      ? Rest extends ''
        ? true
        : IsWord<Rest>
      : false
    : S extends `${WordChar}${infer Rest}`
      ? Rest extends ''
        ? true
        : IsWord<Rest>
      : false
