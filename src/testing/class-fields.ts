import * as discord from 'discord.js'

/** A name discord.js's source assigns on an instance: `this.name =`, `??=` or `||=`, not a comparison. */
const ASSIGNED_FIELD = /this\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\?\?=|\|\|=)/g
/** A name discord.js defines on an instance with `Object.defineProperty(this, 'name', ...)`, such as `client`. */
const DEFINED_FIELD = /Object\.defineProperty\(\s*this\s*,\s*['"]([\w$]+)['"]/g
/**
 * A field set under a computed key, `this[key] =` or `Object.defineProperty(this, key, ...)`, whose names the source
 * doesn't spell out, such as AuthorizingIntegrationOwners' integration types.
 */
const COMPUTED_FIELD = /this\[(?:[^[\]]|\[[^[\]]*\])*\]\s*(?:=(?!=)|\?\?=|\|\|=)|Object\.defineProperty\(\s*this\s*,\s*(?![\s'"])/

/** Every class discord.js exports, and every class those extend, made once. */
let discordClasses: WeakSet<object> | undefined

function isDiscordClass(cls: object): boolean {
  if (!discordClasses) {
    discordClasses = new WeakSet()
    for (const value of Object.values(discord)) {
      for (let cls: unknown = value; typeof cls === 'function' && cls !== Function.prototype; cls = Object.getPrototypeOf(cls)) {
        discordClasses.add(cls)
      }
    }
  }
  return discordClasses.has(cls)
}

/** Each class's own field names, or `null` where its source gives none to read. */
const ownFields = new WeakMap<object, ReadonlySet<string> | null>()

function fieldsOf(cls: object): ReadonlySet<string> | null {
  if (ownFields.has(cls)) return ownFields.get(cls)!
  const source = Function.prototype.toString.call(cls as () => unknown)
  // Native code, a constructor function rather than a class, or a computed assignment gives no full list to read
  const readable = source.startsWith('class') && !source.includes('[native code]') && !COMPUTED_FIELD.test(source)
  const fields = readable ? namesIn(source) : null
  ownFields.set(cls, fields)
  return fields
}

function namesIn(source: string): ReadonlySet<string> {
  const names = new Set<string>()
  for (const [, name] of source.matchAll(ASSIGNED_FIELD)) names.add(name!)
  for (const [, name] of source.matchAll(DEFINED_FIELD)) names.add(name!)
  return names
}

/** Each instance's class chain's fields, by its prototype. */
const chainFields = new WeakMap<object, ReadonlySet<string> | null>()

/**
 * The names discord.js assigns on an instance of `prototype`'s class and the classes it extends, read from their
 * source once per class, so they follow the discord.js the application installed. `null` when the chain holds a class
 * discord.js does not define, such as an app's subclass, whose fields are declared in its body, or a class whose
 * source can't be read in full, such as one that assigns a computed key: a mock of it keeps a placeholder for a key
 * its class lacks.
 */
export function classFields(prototype: object | null): ReadonlySet<string> | null {
  // A plain object, such as a placeholder's own target, has no class to read
  if (prototype === null || prototype === Object.prototype) return null
  if (chainFields.has(prototype)) return chainFields.get(prototype)!
  let fields: Set<string> | null = new Set()
  for (let proto: object | null = prototype; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    const cls = (proto as { constructor?: unknown }).constructor
    const own = typeof cls === 'function' && Object.hasOwn(proto, 'constructor') && isDiscordClass(cls) ? fieldsOf(cls) : null
    if (own === null) {
      fields = null
      break
    }
    for (const name of own) fields.add(name)
  }
  chainFields.set(prototype, fields)
  return fields
}
