import {
  ActionRow,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonComponent,
  ButtonStyle,
  ChatInputCommandInteraction,
  Component,
  ComponentType,
  ContainerComponent,
  Embed,
  EmbedBuilder,
  StringSelectMenuComponent,
  TextDisplayComponent,
} from 'discord.js'
import { createMockInteraction, createMockMessage } from './mock-interaction.js'

const row = () => new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId('b').setLabel('B').setStyle(ButtonStyle.Primary))
const ROW_JSON = { type: ComponentType.ActionRow, components: [{ type: ComponentType.StringSelect, custom_id: 'pick', options: [{ label: 'A', value: 'a' }] }] }
const CONTAINER_JSON = { type: ComponentType.Container, components: [{ type: ComponentType.TextDisplay, content: 'Hello' }] }

describe("a mock message's components and embeds", () => {
  it("are discord.js's classes, built from a builder", () => {
    const message = createMockMessage({ components: [row()], embeds: [new EmbedBuilder().setTitle('T')] })
    const [first] = message.components as unknown as ActionRow<ButtonComponent>[]

    expect([first, first.type, first.components[0], first.components[0].customId]).toEqual([expect.any(ActionRow), ComponentType.ActionRow, expect.any(ButtonComponent), 'b'])
    expect([message.embeds[0], message.embeds[0].title]).toEqual([expect.any(Embed), 'T'])
  })

  it("are discord.js's classes, built from API JSON, Components V2 included", () => {
    const message = createMockMessage({ components: [ROW_JSON, CONTAINER_JSON] as never, embeds: [{ title: 'Raw' }] })
    const [select, container] = message.components as unknown as [ActionRow<StringSelectMenuComponent>, ContainerComponent]

    expect([select.components[0], select.components[0].customId]).toEqual([expect.any(StringSelectMenuComponent), 'pick'])
    expect([container, container.components[0], (container.components[0] as TextDisplayComponent).content]).toEqual([
      expect.any(ContainerComponent),
      expect.any(TextDisplayComponent),
      'Hello',
    ])
    expect(message.embeds[0].title).toBe('Raw')
  })

  it("makes a type discord.js doesn't know a plain Component, as discord.js does", () => {
    const message = createMockMessage({ components: [{ type: 999, id: 7 }] as never })

    expect([message.components[0].constructor, message.components[0].type]).toEqual([Component, 999])
  })

  it('hold the JSON as it was when given, so a later change to the builder or the JSON is not seen', () => {
    const builder = row()
    const json = structuredClone(CONTAINER_JSON)
    const message = createMockMessage({ components: [builder, json] as never })
    builder.components[0].setCustomId('changed')
    json.components[0].content = 'Changed'

    expect(message.components.map(component => component.toJSON())).toEqual([row().toJSON(), CONTAINER_JSON])
  })

  it('keep a discord.js instance given as it is', () => {
    const embed = new (Embed as unknown as new (data: object) => Embed)({ title: 'Kept' })

    expect(createMockMessage({ embeds: [embed] }).embeds[0]).toBe(embed)
  })

  it("are discord.js's classes on what editReply() and fetchReply() return", async () => {
    const interaction = createMockInteraction(ChatInputCommandInteraction, { commandName: 'ping' })
    await interaction.reply({ components: [row()], embeds: [new EmbedBuilder().setTitle('Sent')] })

    for (const message of [await interaction.fetchReply(), await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('Edited')] })]) {
      expect([message.components[0], message.embeds[0]]).toEqual([expect.any(ActionRow), expect.any(Embed)])
    }
    expect((await interaction.fetchReply()).embeds[0].title).toBe('Edited')
  })
})
