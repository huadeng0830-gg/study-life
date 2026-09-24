// @vitest-environment happy-dom
//
// 农历纪念日的**内存镜像必须跟随存储**（第五十四轮新增的守卫，防的是一条真实缺陷）。
//
// 【缺陷是什么】`festive.js` 故意不 import 存储层（它被 node 环境的纯函数测试直接 import，
// 把 store 的事件循环带进依赖图会让那批测试报废），所以农历纪念日走
// `lunarAnniversaries.js` 的模块内存镜像。第一版镜像是"**只补水一次**"：
// `function hydrateMirror() { if (mirrored) return ... }`。它能过掉所有"面板写、面板读"的
// 测试，但在**别人写**的路径上全错：
//
//   - 云同步合并：`cloudSync.commitStoredValues()` → `store/core.js:restoreStoredValues()`。
//     那个函数只更新**注册过的** `storedRefs`（`useStoredRef` 建的），模块自己的镜像不在其中，
//     而且这条路径**不会重新载入页面**（备份恢复与本地迁移导入会 reload，所以它们没事）。
//   - 另一个标签页直接改 localStorage。
//
// 结果是最难查的那种不一致：**设置面板显示新数据，首页仍按旧镜像点亮**——用户看到的是
// "恢复成功了但首页没变"，会以为恢复失败。
//
// 【判据形态】这个文件里的"外部写入"一律**直接写 localStorage**，绝不调用面板的
// publish —— 这正是 `restoreStoredValues` 的写法。第 4 条是判别力对照：把旧实现的核心
// 逻辑原样复刻出来，证明同一份夹具在旧实现下**必然读到旧值**（否则这个文件就是摆设）。

import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LUNAR_ANNIVERSARY_KEY,
  publishLunarAnniversaries,
  readLunarAnniversaries,
  resetLunarAnniversaryMirror,
} from '../src/composables/lunarAnniversaries.js'

const MODULE_PATH = resolve(import.meta.dirname, '..', 'src', 'composables', 'lunarAnniversaries.js')

/** 造一条合法的农历纪念日（形状取自模块的归一化契约）。 */
const entry = (id, label = id) => ({ id, label, lunarMonth: 5, lunarDay: 5, isLeapMonth: false })

/** 模拟"外部写者"：直接写存储，不经过任何模块 API。 */
const externalWrite = (list) => localStorage.setItem(LUNAR_ANNIVERSARY_KEY, JSON.stringify(list))

beforeEach(() => {
  localStorage.clear()
  resetLunarAnniversaryMirror()
})

describe('存储是真源：外部写入必须被读到', () => {
  it('外部改 sl_festive_lunar 后，再次读取必须看到新值', () => {
    externalWrite([entry('a')])
    expect(readLunarAnniversaries(), '首次读取没从存储补水').toHaveLength(1)

    // 这一步就是云同步合并 / 另一个标签页会做的事。
    externalWrite([entry('a'), entry('b')])
    expect(readLunarAnniversaries(), '外部写入被内存镜像挡住了（旧实现会在这里读到 1 条）').toHaveLength(2)
    expect(readLunarAnniversaries().map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('外部把条目删掉后，读取必须跟着变短（不能继续拿着旧镜像）', () => {
    externalWrite([entry('a'), entry('b')])
    expect(readLunarAnniversaries()).toHaveLength(2)

    externalWrite([entry('b')])
    expect(readLunarAnniversaries().map((item) => item.id), '删除没被看见').toEqual(['b'])
  })

  it('外部把键整个清空后，读取必须回到空', () => {
    externalWrite([entry('a')])
    expect(readLunarAnniversaries()).toHaveLength(1)

    localStorage.removeItem(LUNAR_ANNIVERSARY_KEY)
    expect(readLunarAnniversaries(), '键被清空后仍返回旧镜像').toHaveLength(0)
  })

  it('外部写入损坏数据时不会抛错，读取退化成空而不是旧值', () => {
    externalWrite([entry('a')])
    expect(readLunarAnniversaries()).toHaveLength(1)

    localStorage.setItem(LUNAR_ANNIVERSARY_KEY, '{不是 JSON')
    expect(() => readLunarAnniversaries()).not.toThrow()
    expect(readLunarAnniversaries()).toHaveLength(0)
  })

  it('判别力对照：把"只补水一次"的旧实现复刻出来，同一份夹具必然读到旧值', () => {
    // 旧实现的核心就是这两行：一个布尔锁 + 一次性赋值。
    let mirroredOnce = false
    let mirror = []
    const oldRead = () => {
      if (!mirroredOnce) {
        mirroredOnce = true
        const raw = localStorage.getItem(LUNAR_ANNIVERSARY_KEY)
        mirror = raw === null ? [] : JSON.parse(raw)
      }
      return mirror
    }

    externalWrite([entry('a')])
    expect(oldRead()).toHaveLength(1)
    externalWrite([entry('a'), entry('b')])
    // 旧实现在这里**读不到**第二条 —— 证明上面的判据不是空转。
    expect(oldRead(), '旧实现在这份夹具下竟然读到了新值，说明这个夹具没有判别力').toHaveLength(1)
  })
})

describe('面板发布的即时生效没有被这次修法牺牲', () => {
  it('先写存储再发布（面板的真实顺序）：读取得到新值', () => {
    externalWrite([entry('a')])
    expect(readLunarAnniversaries()).toHaveLength(1)

    const next = [entry('a'), entry('b')]
    externalWrite(next)
    publishLunarAnniversaries(next)
    expect(readLunarAnniversaries()).toHaveLength(2)
  })

  it('发布后立刻读取（存储还没被写的顺序）：即时反馈仍然生效', () => {
    externalWrite([entry('a')])
    expect(readLunarAnniversaries()).toHaveLength(1)

    // 存储仍是一份旧串，但面板刚发布了新列表 → 这一次读取必须看到新值。
    publishLunarAnniversaries([entry('a'), entry('b')])
    expect(readLunarAnniversaries(), '发布的即时生效被回读覆盖了').toHaveLength(2)
  })
})

describe('源码棘轮：补水判据必须比对存储原始串', () => {
  /** 剥掉注释：本模块的注释里就写着"只补水一次"，否则扫到的是散文而不是代码。 */
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('hydrateMirror 比对 mirroredRaw（而不是一个一次性布尔锁）', () => {
    const code = stripComments(readFileSync(MODULE_PATH, 'utf8'))
    expect(code, '补水不再比对存储原始串').toMatch(/raw === mirroredRaw/)
    expect(code, '又出现了一次性补水锁：外部写入会再次被挡住').not.toMatch(/if \(mirrored\) return/)
  })

  it('判别力对照：同一套判据喂给旧实现必须命中', () => {
    const oldSource = 'function hydrateMirror() { if (mirrored) return\n  mirrored = true }'
    const code = stripComments(oldSource)
    expect(/if \(mirrored\) return/.test(code), '旧实现没被这套判据抓住').toBe(true)
    expect(/raw === mirroredRaw/.test(code)).toBe(false)
  })
})

describe('两个机制之间的键名不许漂移', () => {
  // 现在有两套互补机制：
  //   ① 本模块的"读取时跟随存储"（保证**正确性**：任何写者都会被看见）；
  //   ② 存储层的发布钩子（`store/core.js` 在 rest 完成后与跨标签页 storage 事件里
  //      发布镜像 —— 保证**即时性/响应式**：lunarMirror 是个 ref，发布才会让依赖它的
  //      computed 重新求值，否则要等下一次别的渲染原因）。
  // 两者都靠键名对上。而存储层是用**动态 import** 拿发布函数的（避免静态依赖），
  // 键名在那里可能是字面量 —— 一旦键名漂移，钩子会**静默失效**（不报错、只是不生效）。
  const storeSource = readFileSync(resolve(import.meta.dirname, '..', 'src', 'composables', 'store', 'core.js'), 'utf8')

  it('存储层要么引用键名常量，要么写上与常量一致的字面量', () => {
    const hasConstant = storeSource.includes('LUNAR_ANNIVERSARY_KEY')
    const hasLiteral = storeSource.includes(`'${LUNAR_ANNIVERSARY_KEY}'`)
    expect(
      hasConstant || hasLiteral,
      '存储层既没引用键名常量、也没写上正确的字面量：发布钩子会静默失效'
    ).toBe(true)
  })

  it('判别力对照：键名写错时这条判据必须为假', () => {
    const typo = "const nextValue = values['sl_festive_lunar_typo']"
    const hasConstant = typo.includes('LUNAR_ANNIVERSARY_KEY')
    const hasLiteral = typo.includes(`'${LUNAR_ANNIVERSARY_KEY}'`)
    expect(hasConstant || hasLiteral, '写错键名的夹具没被抓住').toBe(false)
  })
})