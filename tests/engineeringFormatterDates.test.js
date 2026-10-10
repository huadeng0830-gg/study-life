// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const formatterUrl = new URL('../src/utils/formatters.js', import.meta.url).href

describe('账本相对日期遵循本地日历', () => {
  it.each([
    ['America/New_York', '2027-03-15T00:30:00-04:00', '2027-03-14', 240],
    ['Europe/Berlin', '2027-03-29T00:30:00+02:00', '2027-03-28', -120],
    ['America/New_York', '2027-11-08T00:30:00-05:00', '2027-11-07', 300],
    ['Asia/Shanghai', '2027-01-01T00:30:00+08:00', '2026-12-31', -480],
  ])('%s 在 %s 将前一个日历日标为昨天', (timezone, instant, previousDay, offset) => {
    // A new Node process makes TZ effective on every supported test platform.
    // Only the clock is controlled; the actual formatter and native timezone run.
    const code = `
      import { dayLabel, dateText } from ${JSON.stringify(formatterUrl)};
      const NativeDate = Date;
      const fixed = NativeDate.parse(${JSON.stringify(instant)});
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
        static now() { return fixed; }
      };
      console.log(JSON.stringify({ today: dayLabel(dateText()), previous: dayLabel(${JSON.stringify(previousDay)}), offset: new Date().getTimezoneOffset() }));
    `
    const actual = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 10000,
    }))
    expect(actual).toEqual({ today: '今天', previous: '昨天', offset })
  })
})
