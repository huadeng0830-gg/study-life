// @vitest-environment happy-dom
/**
 * 裁切课表弹窗的键盘可用性（第四十七轮，WCAG 2.5.7 Dragging Movements + 2.1.1 Keyboard）。
 *
 * 【这条是真缺陷，但缺陷形态和一开始以为的不一样】写测试之前我读的是 `begin()`，
 * 于是推断"默认选区 0 宽 → 裁切按钮一直 disabled → 键盘用户完全走不通"。**这个推断是错的**：
 * `resetPreview` 把初始选区设成**整张图**（0/0/100/100），所以按钮一开始就是可用的，
 * 键盘用户能走完流程。真正的缺陷是**改不了**：整图选区宽 100%，平移会被夹住，
 * 也收不小——而"收小"恰恰是这个弹窗的主操作（提示里就写着"排除状态栏、广告"）。
 * 是测试把这个错误假设顶出来的，所以这套用例的价值不只是回归，也是**记录真实形态**。
 *
 * 【为什么用真实挂载】核心是"整图默认值 → 可用子区域"的状态迁移，只有真跑一遍才算验过。
 * 本仓不依赖 @vue/test-utils，挂载照 tests/helpers/mountApp.js 的做法：createApp + 手工 host。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import ImageCropModal from '../src/components/schedule/ImageCropModal.vue'

let app = null
afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

async function open() {
  // file 传 null：这样不会走 URL.createObjectURL（happy-dom 没有实现它），
  // 而键盘这条路本来也不需要图片像素——选区是纯百分比运算。
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp(ImageCropModal, { show: true, file: null })
  app.mount(host)
  await nextTick()
  return host
}

/** Modal 可能 teleport 到 body，所以统一从 document 查。 */
const q = (selector) => document.querySelector(selector)

async function press(key, { shift = false, ctrl = false } = {}) {
  const event = new KeyboardEvent('keydown', { key, shiftKey: shift, ctrlKey: ctrl, bubbles: true, cancelable: true })
  q('.crop-stage').dispatchEvent(event)
  await nextTick()
  return event
}

const readout = () => q('.crop-readout').textContent.trim()
const confirmBtn = () => q('.actions .btn-primary')

describe('裁切弹窗的键盘可达性', () => {
  it('裁切区域可聚焦、有角色和说明（读屏用户知道这是什么、怎么操作）', async () => {
    await open()
    const stage = q('.crop-stage')
    expect(stage.getAttribute('tabindex')).toBe('0')
    expect(stage.getAttribute('role')).toBe('group')
    expect(stage.getAttribute('aria-label')).toBeTruthy()
    const hintId = stage.getAttribute('aria-describedby')
    expect(hintId, '没有 aria-describedby，读屏用户听不到"怎么用键盘"').toBeTruthy()
    const hint = q(`#${hintId}`)
    expect(hint, `aria-describedby 指向的 #${hintId} 不存在`).toBeTruthy()
    // 说明里必须同时讲清三个键位语义，否则用户不知道该怎么收小
    expect(hint.textContent).toMatch(/方向键/)
    expect(hint.textContent).toMatch(/Shift/)
    expect(hint.textContent).toMatch(/Ctrl/)
  })

  it('初始选区是整张图：按钮可用，但尺寸改不了（这才是要修的缺陷形态）', async () => {
    await open()
    expect(readout()).toContain('100% × 100%')
    expect(confirmBtn().disabled, '整图选区本来就满足最小尺寸，按钮不该是禁用的').toBe(false)
    // 整图宽度 100%，平移无处可去——键盘此刻确实"按了没反应"
    await press('ArrowRight')
    expect(readout(), '第一次按方向键应该播种出可用子区域').not.toContain('100% × 100%')
  })

  it('第一次按方向键播种成合理子区域并同时移动', async () => {
    await open()
    await press('ArrowRight')
    expect(readout()).toContain('左 15%、上 20%、右 95%、下 80%')
    expect(readout()).toContain('80% × 60%')
    expect(confirmBtn().disabled).toBe(false)
  })

  it('方向键平移；Shift 往回收；Ctrl 往外扩', async () => {
    await open()
    await press('ArrowRight') // 播种 + 右移：左15 上20 右95 下80
    await press('ArrowRight', { shift: true }) // 右边往回收 95 → 90
    expect(readout()).toContain('右 90%')
    await press('ArrowRight', { ctrl: true }) // 右边往外扩 90 → 95
    expect(readout()).toContain('右 95%')
    await press('ArrowUp', { shift: true }) // 上边往回收 20 → 25
    expect(readout()).toContain('上 25%')
    await press('ArrowUp', { ctrl: true }) // 上边往外扩 25 → 20
    expect(readout()).toContain('上 20%')
    await press('ArrowDown', { shift: true }) // 下边往回收 80 → 75
    expect(readout()).toContain('下 75%')
    await press('ArrowLeft', { shift: true }) // 左边往回收 15 → 20
    expect(readout()).toContain('左 20%')
  })

  it('平移撞边就停住，尺寸保持不变', async () => {
    await open()
    await press('ArrowRight') // 播种 + 右移：宽 80%
    for (let i = 0; i < 40; i += 1) await press('ArrowRight')
    expect(readout()).toContain('右 100%')
    expect(readout()).toContain('左 20%')
    for (let i = 0; i < 40; i += 1) await press('ArrowLeft')
    expect(readout()).toContain('左 0%')
    expect(readout()).toContain('右 80%')
  })

  it('收小到 4% 就停住（与「裁切并识别」的最小尺寸限制一致）', async () => {
    await open()
    await press('ArrowRight') // 播种：左15 上20 右95 下80
    for (let i = 0; i < 40; i += 1) await press('ArrowLeft', { shift: true }) // 左边一直往右收
    expect(readout()).toContain('4%')
    expect(confirmBtn().disabled, '正好 4% 仍在允许范围内，按钮应保持可用').toBe(false)
    // 再收也收不动了：4% 是下限
    await press('ArrowLeft', { shift: true })
    expect(readout()).toContain('4%')
  })

  it('已经调整过的选区不会被"播种"顶掉（播种只认未动过的整图默认值）', async () => {
    await open()
    await press('ArrowRight') // 播种：80% × 60%
    for (let i = 0; i < 4; i += 1) await press('ArrowLeft', { shift: true }) // 收成 60% 宽
    expect(readout()).toContain('60% × 60%')
    await press('ArrowRight') // 再平移：尺寸必须保持 60%，若被重新播种就会变回 80%
    expect(readout(), '播种条件过宽：把用户已经调好的选区顶掉了').toContain('60% × 60%')
  })

  it('方向键会阻止页面滚动（否则按一下页面跟着跳）', async () => {
    await open()
    expect((await press('ArrowRight')).defaultPrevented).toBe(true)
    expect((await press('ArrowDown')).defaultPrevented).toBe(true)
  })

  it('其它按键一律不理会，也不拦默认行为、不播种', async () => {
    await open()
    const before = readout()
    expect((await press('Enter')).defaultPrevented).toBe(false)
    await press('a')
    await press('Escape')
    expect(readout()).toBe(before)
    expect(readout(), '非方向键不该生成子区域').toContain('100% × 100%')
  })

  it('选区读数用 aria-live 播报给读屏用户', async () => {
    await open()
    expect(q('.crop-readout').getAttribute('aria-live')).toBe('polite')
  })
})