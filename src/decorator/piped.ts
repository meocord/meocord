import { type PIPED_BRAND } from '@src/interface/standard-schema.interface.js'

/** Whether a handler's param is marked `Piped<T>`, so the checks of what a call gives leave it to its pipe. */
export type IsPiped<T> = typeof PIPED_BRAND extends keyof T ? true : false

/** A handler's params with each key marked `Piped<T>` left to its pipe, as `unknown`, for a check of what a call gives. */
export type Unpiped<P> = { [K in keyof P]: IsPiped<P[K]> extends true ? unknown : P[K] }
