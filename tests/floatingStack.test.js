// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import {
  attachFloatingSlot,
  createFloatingSlot,
  detachFloatingSlot,
  floatingSlotCount,
  resetFloatingStack,
  useFloatingOffset,
} from '../src/composables/floatingStack.js'

beforeEach(() => {
  resetFloatingStack()
})

describe('底部浮层堆叠', () => {
  it('每个坑位拿到稳定且互不相同的 id', () => {
    const a = createFloatingSlot()
    const b = createFloatingSlot()
    expect(a).not.toBe(b)
    expect(createFloatingSlot()).toBeGreaterThan(b)
  })

  it('先出现的浮层留在原位，后来的依次向上错开', async () => {
    const first = createFloatingSlot()
    const second = createFloatingSlot()
    const third = createFloatingSlot()
    const firstOffset = useFloatingOffset(first, 56)
    const secondOffset = useFloatingOffset(second, 56)
    const thirdOffset = useFloatingOffset(third, 56)

    expect(firstOffset.value).toBe(0)

    attachFloatingSlot(first)
    attachFloatingSlot(second)
    attachFloatingSlot(third)
    await nextTick()

    expect(firstOffset.value).toBe(0)
    expect(secondOffset.value).toBe(56)
    expect(thirdOffset.value).toBe(112)
  })

  it('浮层消失后，后面的坑位回落补位', async () => {
    const first = createFloatingSlot()
    const second = createFloatingSlot()
    const secondOffset = useFloatingOffset(second, 56)

    attachFloatingSlot(first)
    attachFloatingSlot(second)
    await nextTick()
    expect(secondOffset.value).toBe(56)

    detachFloatingSlot(first)
    await nextTick()
    expect(secondOffset.value).toBe(0)
    expect(floatingSlotCount()).toBe(1)
  })

  it('重复占位不会挤掉后面的浮层，未占位时偏移为 0', async () => {
    const first = createFloatingSlot()
    const second = createFloatingSlot()
    const secondOffset = useFloatingOffset(second, 56)

    expect(secondOffset.value).toBe(0)
    attachFloatingSlot(first)
    attachFloatingSlot(first)
    attachFloatingSlot(second)
    await nextTick()

    expect(floatingSlotCount()).toBe(2)
    expect(secondOffset.value).toBe(56)

    detachFloatingSlot(first)
    detachFloatingSlot(first)
    expect(floatingSlotCount()).toBe(1)
  })

  it('栈过深时封顶，不把提示顶出屏幕', async () => {
    const slots = Array.from({ length: 6 }, () => createFloatingSlot())
    for (const id of slots) attachFloatingSlot(id)
    await nextTick()

    expect(useFloatingOffset(slots[0], 56).value).toBe(0)
    expect(useFloatingOffset(slots[2], 56).value).toBe(112)
    // maxIndex 默认 2，第 3 个及以后不再继续抬高
    expect(useFloatingOffset(slots[3], 56).value).toBe(112)
    expect(useFloatingOffset(slots[5], 56).value).toBe(112)
  })

  it('未知坑位与空值不会抛错', () => {
    const id = createFloatingSlot()
    expect(useFloatingOffset(id, 56).value).toBe(0)
    expect(() => attachFloatingSlot(null)).not.toThrow()
    expect(() => detachFloatingSlot(undefined)).not.toThrow()
    expect(() => detachFloatingSlot(9999)).not.toThrow()
    expect(floatingSlotCount()).toBe(0)
  })
})