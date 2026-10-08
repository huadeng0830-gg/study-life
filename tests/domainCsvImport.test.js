import { describe, expect, it } from 'vitest'
import { parseDomainCsvFile } from '../src/composables/domainCsvImport.js'

function csvBuffer(preambleCount, dataCount) {
  const lines = [
    ...Array.from({ length: preambleCount }, (_, index) => `导出信息 ${index + 1}`),
    'title',
    ...Array.from({ length: dataCount }, (_, index) => `待办 ${index + 1}`),
  ]
  const bytes = new TextEncoder().encode(lines.join('\n'))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

describe('domain CSV row bound', () => {
  it('keeps the 2000-row import cap after a header near the end of its scan window', () => {
    const exactlyAtLimit = parseDomainCsvFile(csvBuffer(39, 2000))
    expect(exactlyAtLimit.rows).toHaveLength(2000)
    expect(exactlyAtLimit.truncated).toBe(false)

    const overLimit = parseDomainCsvFile(csvBuffer(39, 2001))
    expect(overLimit.rows).toHaveLength(2000)
    expect(overLimit.truncated).toBe(true)
  })
})
