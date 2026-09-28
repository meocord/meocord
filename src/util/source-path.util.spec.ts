import { comparablePath, framePath } from '@src/util/source-path.util.js'

describe('framePath', () => {
  it.each([
    [false, 'file:///bots/shop/src/app.ts', '/bots/shop/src/app.ts'],
    [true, 'file:///C:/bots/shop/src/app.ts', 'C:\\bots\\shop\\src\\app.ts'],
    [false, '/bots/shop/src/app.ts', '/bots/shop/src/app.ts'],
    [true, 'C:\\bots\\shop\\src\\app.ts', 'C:\\bots\\shop\\src\\app.ts'],
  ])('converts a frame with windows %s: %s', (windows, name, expected) => {
    expect(framePath(name, windows)).toBe(expected)
  })

  // Called while an error is reported, so a frame it cannot convert must never turn into a second error
  it.each([
    [true, 'file:///bots/shop/node_modules/meocord/dist/esm/decorator/controller.decorator.js'],
    [true, 'file://server/share/app.ts'],
    [false, 'file://server/share/app.ts'],
    [false, 'file:///C:/bots/shop/src/app.ts'],
    [false, 'file:///bots/%2F/app.ts'],
    [true, 'file:///C:/bots/%5C/app.ts'],
    [false, 'node:internal/modules/esm/module_job'],
    [true, '<anonymous>'],
    [false, 'eval at <anonymous> (file:///bots/shop/dist/main.js'],
  ])('never throws with windows %s for %s, giving the name as it is when it cannot convert it', (windows, name) => {
    expect(() => framePath(name, windows)).not.toThrow()
    expect(typeof framePath(name, windows)).toBe('string')
  })
})

describe('comparablePath', () => {
  it('compares without case on Windows only', () => {
    expect(comparablePath('C:\\Bots', true)).toBe('c:\\bots')
    expect(comparablePath('/Bots', false)).toBe('/Bots')
  })
})
