import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'

/**
 * The discord.js classes whose mocks are checked against the typings: the ones a handler most often receives, so a
 * mock of each answers `in` for every property discord.js declares.
 */
export const CHECKED_CLASSES = [
  'Message',
  'ChatInputCommandInteraction',
  'ButtonInteraction',
  'AutocompleteInteraction',
  'ModalSubmitInteraction',
  'TextChannel',
  'DMChannel',
  'ThreadChannel',
  'VoiceChannel',
  'Guild',
  'GuildMember',
  'User',
  'Role',
  'MessageReaction',
  'Attachment',
  'Embed',
] as const

/** The typings of the discord.js `from` resolves: its entry is src/index.js, beside typings/. */
export function discordTypings(from: string): string {
  return path.join(path.dirname(createRequire(from).resolve('discord.js')), '..', 'typings', 'index.d.ts')
}

/**
 * Each checked class's public properties, methods and getters left out, as the typings at `typings` declare them on it
 * or what it extends.
 */
export function declaredProperties(typings: string): Record<string, string[]> {
  const program = ts.createProgram([typings], { skipLibCheck: true, noEmit: true })
  const checker = program.getTypeChecker()
  const declared: Record<string, string[]> = {}
  ts.forEachChild(program.getSourceFile(typings)!, function visit(node) {
    if (ts.isModuleDeclaration(node) && node.body) ts.forEachChild(node.body, visit)
    if (!ts.isClassDeclaration(node) || !node.name || !(CHECKED_CLASSES as readonly string[]).includes(node.name.text)) return
    const type = checker.getDeclaredTypeOfSymbol(checker.getSymbolAtLocation(node.name)!)
    const properties = checker.getPropertiesOfType(type).filter(symbol => {
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
      if (!declaration || ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration) || ts.isGetAccessor(declaration)) return false
      return !(ts.getCombinedModifierFlags(declaration as ts.Declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
    })
    declared[node.name.text] = properties.map(symbol => symbol.name)
  })
  return declared
}
