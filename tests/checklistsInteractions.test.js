// @vitest-environment happy-dom
import { createApp, h, isShallow, nextTick } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ListsView from '../src/views/ListsView.vue'
import { useChecklistCommands } from '../src/composables/checklists.js'
import { clearAnnouncement } from '../src/composables/liveRegion.js'
import { registerMirrorTeardown } from './helpers/mirrorTeardown.js'

registerMirrorTeardown()
const commands = useChecklistCommands()
let app
let host
let router
beforeEach(() => { commands.lists.value = [] })
afterEach(() => {
  app?.unmount(); host?.remove(); document.body.innerHTML = ''; clearAnnouncement()
  commands.lists.value = []; app = null; host = null
})
async function settle() { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 15)); await nextTick() }
async function boot(path = '/lists') {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/lists', component: ListsView }] })
  await router.push(path)
  host = document.createElement('div'); document.body.appendChild(host)
  app = createApp({ render: () => h(RouterView) }); app.use(router).mount(host)
  await settle()
}
function byText(text, root = document) { return [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text) }
async function click(button) { expect(button).toBeTruthy(); button.click(); await settle() }
async function fill(input, value) { expect(input).toBeTruthy(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await settle() }
async function choose(select, value) { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await settle() }
function itemNames() { return [...host.querySelectorAll('.item-title b')].map((node) => node.textContent) }
async function selectList(name) { await click([...host.querySelectorAll('.list-tab')].find((button) => button.querySelector('b').textContent === name)) }
function seed() {
  const first = commands.createList({ name: '示例采购', type: 'shopping', budget: 20, items: [{ name: '牛奶', price: 10, quantity: 2, category: '食品', note: '低糖' }, { name: '水果', quantity: 0.5, unit: 'kg', category: '食品' }, { name: '纸巾', done: true, price: 5, category: '日用品' }] })
  const second = commands.createList({ name: '示例出行', type: 'travel', items: [{ name: '身份证' }] })
  return { first, second }
}

describe('清单实际交互', () => {
  it('显式提交的浅层存储即时刷新新增事项、分类、删除及完成排序', async () => {
    const { first } = seed(); await boot()
    expect(isShallow(commands.lists)).toBe(true)
    await fill(host.querySelector('.quick-add input'), '保鲜袋')
    await click(byText('添加', host.querySelector('.quick-add')))
    expect(itemNames()).toEqual(['牛奶', '水果', '保鲜袋', '纸巾'])
    const added = first.items.find((item) => item.name === '保鲜袋')
    commands.updateItem(first.id, added.id, { category: '自定义分类' })
    await settle()
    expect([...host.querySelector('[aria-label="按分类筛选"]').options].map((option) => option.value)).toContain('自定义分类')
    await click(host.querySelector('[aria-label="将牛奶标记为已完成"]'))
    expect(itemNames()).toEqual(['水果', '保鲜袋', '牛奶', '纸巾'])
    commands.deleteItem(first.id, added.id)
    await settle()
    expect(itemNames()).toEqual(['水果', '牛奶', '纸巾'])
    commands.createItems(first.id, [{ name: '毛巾' }, { name: '垃圾袋' }])
    await settle()
    expect(itemNames()).toEqual(['水果', '毛巾', '垃圾袋', '牛奶', '纸巾'])
  })

  it('从模板创建一份可编辑的清单，自动带入类型和事项', async () => {
    await boot()
    await click([...host.querySelectorAll('.starter-card')].find((button) => button.textContent.includes('短途出行')))
    expect(document.querySelector('#lists-name').value).toBe('短途出行')
    await fill(document.querySelector('#lists-name'), '示例周末出行')
    await click(byText('创建清单'))
    expect(commands.lists.value[0]).toMatchObject({ name: '示例周末出行', type: 'travel' })
    expect(commands.lists.value[0].items).toHaveLength(6)
    expect(itemNames()).toContain('充电宝')
    expect(document.querySelector('#checklist-list-form')).toBeNull()
  })

  it('多行添加预览会去重，保存后清除遮挡新事项的筛选，整批可撤销', async () => {
    const { first } = seed(); await boot()
    await fill(host.querySelector('[aria-label="搜索当前清单事项"]'), '牛奶')
    await click(byText('批量添加', host.querySelector('.quick-add')))
    await fill(document.querySelector('#lists-bulk-text'), '- 牛奶\n- [x] 面包\n苹果\n苹果')
    expect(document.querySelector('.bulk-summary').textContent).toContain('将添加 2 项')
    expect(document.querySelector('.bulk-summary').textContent).toContain('跳过 2 项')
    await click(byText('添加 2 项'))
    expect(first.items).toHaveLength(5)
    expect(first.items.find((item) => item.name === '面包').done).toBe(true)
    expect(host.querySelector('[aria-label="搜索当前清单事项"]').value).toBe('')
    expect(itemNames()).toContain('苹果')
    await click(byText('撤销'))
    expect(first.items.map((item) => item.name)).toEqual(['牛奶', '水果', '纸巾'])
  })

  it('切换清单后撤销删除，恢复到原清单和原位置', async () => {
    const { first, second } = seed(); await boot()
    await click(host.querySelector('[aria-label="编辑牛奶"]'))
    await click(byText('删除事项'))
    await click(byText('确认删除'))
    expect(first.items.map((item) => item.name)).toEqual(['水果', '纸巾'])
    await selectList(second.name)
    await click(byText('撤销'))
    expect(first.items.map((item) => item.name)).toEqual(['牛奶', '水果', '纸巾'])
    expect(second.items.map((item) => item.name)).toEqual(['身份证'])
    expect(host.querySelector('#active-list-title').textContent).toBe(first.name)
  })

  it('清除已完成项后切换清单，撤销仍恢复原清单', async () => {
    const { first, second } = seed(); await boot()
    await click(byText('清除已完成'))
    await click(byText('确认删除'))
    await selectList(second.name)
    await click(byText('撤销'))
    expect(first.items[2]).toMatchObject({ name: '纸巾', done: true })
    expect(second.items).toHaveLength(1)
  })

  it('全选只作用于当前筛选结果，批量完成可撤销', async () => {
    const { first } = seed(); await boot()
    await choose(host.querySelector('[aria-label="按分类筛选"]'), '食品')
    await click(byText('批量管理'))
    await click(host.querySelector('.select-visible input'))
    expect(host.querySelector('.selected-count').textContent).toContain('2')
    await click(byText('标记完成'))
    expect(first.items.map((item) => item.done)).toEqual([true, true, true])
    await click(byText('撤销'))
    expect(first.items.map((item) => item.done)).toEqual([false, false, true])
  })

  it('购物小数数量可保存，非法数量会明确报错并聚焦该字段', async () => {
    const { first } = seed(); await boot()
    expect(host.querySelector('.shopping-insight').textContent).toContain('1 项未估价')
    expect(host.querySelector('.shopping-insight').textContent).toContain('超出 ¥5.00')
    await click(host.querySelector('[aria-label="编辑水果"]'))
    await fill(document.querySelector('#lists-item-quantity'), '0')
    await click(byText('保存修改'))
    expect(document.querySelector('#lists-item-error').textContent).toContain('数量')
    expect(document.activeElement.id).toBe('lists-item-quantity')
    expect(first.items[1].quantity).toBe(0.5)
    await fill(document.querySelector('#lists-item-quantity'), '0.75')
    await fill(document.querySelector('#lists-item-price'), '12')
    await click(byText('保存修改'))
    expect(first.items[1]).toMatchObject({ quantity: 0.75, price: 12 })
    expect(host.querySelector('.summary-money').textContent).toBe('¥34.00')
  })

  it('切换清单保留各自的快速输入草稿，搜索排序不改原顺序', async () => {
    const { first, second } = seed(); await boot()
    await fill(host.querySelector('.quick-add input'), '还没添加的事项')
    await selectList(second.name)
    expect(host.querySelector('.quick-add input').value).toBe('')
    await selectList(first.name)
    expect(host.querySelector('.quick-add input').value).toBe('还没添加的事项')
    await choose(host.querySelector('[aria-label="清单事项排序"]'), 'amount')
    expect(itemNames()).toEqual(['牛奶', '纸巾', '水果'])
    await fill(host.querySelector('[aria-label="搜索当前清单事项"]'), '低糖')
    expect(itemNames()).toEqual(['牛奶'])
    expect(first.items.map((item) => item.name)).toEqual(['牛奶', '水果', '纸巾'])
  })

  it('重置勾选保留内容，撤销只恢复原来的完成项', async () => {
    const { first } = seed(); await boot()
    await click(host.querySelector('.more-menu summary'))
    await click(byText('重置勾选，再次使用'))
    await click(byText('重置勾选'))
    expect(first.items.map((item) => item.done)).toEqual([false, false, false])
    await click(byText('撤销'))
    expect(first.items.map((item) => item.done)).toEqual([false, false, true])
    expect(first.items[0]).toMatchObject({ quantity: 2, price: 10, note: '低糖' })
  })

  it('带定位参数进入时打开正确清单的事项，随后清理参数', async () => {
    const { second } = seed()
    await boot(`/lists?focus=${second.items[0].id}`)
    expect(host.querySelector('#active-list-title').textContent).toBe(second.name)
    expect(document.querySelector('#lists-item-name').value).toBe('身份证')
    expect(router.currentRoute.value.query.focus).toBeUndefined()
  })
})
