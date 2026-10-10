import fs from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'

describe('engineering audit: crop image coordinate container', () => {
  it('keeps the percent-based selection on the centered image-sized stage at narrow widths', () => {
    const source = fs.readFileSync('src/components/schedule/ImageCropModal.vue', 'utf8')
    const { descriptor } = parse(source)
    const rules = postcss.parse(descriptor.styles.map((style) => style.content).join('\n'))
    const declarations = {}
    rules.walkRules('.crop-stage', (rule) => rule.walkDecls((decl) => { declarations[decl.prop] = decl.value }))
    expect(declarations.width).toBe('fit-content')
    expect(declarations['max-width']).toBe('100%')
    expect(declarations['align-self']).toBe('center')
  })
})
