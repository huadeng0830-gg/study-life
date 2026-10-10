import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bootAuditFailures } from '../scripts/audit/boot-verdict.mjs'
import { contrastRatio, fontSizeLowerBoundPx, largeTextThreshold } from '../scripts/audit-contrast.mjs'
import { splitCssRules, styleBlocksOf } from '../scripts/css-rules.mjs'

const opened = { navigationCount: 1, probe: { appMounted: true, placeholder: false, errorScreen: false } }

describe('engineering audit boot verdict', () => {
  it('requires an opened application, including after one bounded recovery reload', () => {
    expect(bootAuditFailures(opened)).toEqual([])
    expect(bootAuditFailures({ ...opened, navigationCount: 2 })).toEqual([])
    expect(bootAuditFailures({ ...opened, navigationCount: 0 })).not.toEqual([])
    expect(bootAuditFailures({ ...opened, navigationCount: 3 })).not.toEqual([])
  })

  it('rejects a silent blank page and a mounted application still displaying its startup screen', () => {
    expect(bootAuditFailures({ navigationCount: 1, probe: { appMounted: false } })).not.toEqual([])
    expect(bootAuditFailures({ ...opened, probe: { ...opened.probe, placeholder: true } })).not.toEqual([])
    expect(bootAuditFailures({ ...opened, probe: { ...opened.probe, errorScreen: true } })).not.toEqual([])
  })

  it.each(['consoleErrors', 'exceptions', 'networkErrors'])('rejects an opened page with %s', (kind) => {
    expect(bootAuditFailures({ ...opened, [kind]: ['fictional failure'] })).not.toEqual([])
  })
})

describe('engineering audit contrast thresholds', () => {
  it.each([
    'calc(30px + -20px)',
    'calc(30px + 1vw - 30px)',
    'calc(30px + var(--possibly-negative))',
    'calc(30px + (10px - 25px))',
  ])('does not relax contrast based on an unproven lower bound in %s', (fontSize) => {
    expect(fontSizeLowerBoundPx(fontSize)).toBeNull()
    expect(largeTextThreshold({ fontSize })).toBe(4.5)
  })
})

describe('startup and recovery text contrast', () => {
  it.each(['.startup-loading__copy span', '.startup-steps li', '.startup-error p'])('keeps readable small text in %s before the application loads', (selector) => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const styles = splitCssRules(styleBlocksOf(html).map(block => block.css).join('\n'))
    expect(styles.ok).toBe(true)
    const surface = styles.rules.find(rule => rule.selector.split(',').includes('.startup-loading'))
    const foreground = styles.rules.find(rule => rule.selector === selector)
    const background = /(?:^|;)background:(#[\da-f]+)/i.exec(surface.body)?.[1]
    const color = /(?:^|;)color:(#[\da-f]+)/i.exec(foreground.body)?.[1]
    expect(background).toBeTruthy()
    expect(color).toBeTruthy()
    expect(contrastRatio(color, background)).toBeGreaterThanOrEqual(4.5)
  })
})
