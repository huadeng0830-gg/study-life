// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskProgress } from '../src/composables/taskProgress.js'

describe('长任务状态模型', () => {
  beforeEach(() => vi.useFakeTimers())

  it('快速完成的任务不展开复杂进度，慢任务才显示', () => {
    const quick = useTaskProgress()
    quick.start({ title: '快速保存', steps: ['保存'] })
    quick.finish()
    expect(quick.state.active).toBe(false)

    const slow = useTaskProgress()
    slow.start({ title: '慢任务', steps: ['处理'] })
    vi.advanceTimersByTime(700)
    expect(slow.state.visible).toBe(true)
  })

  it('按真实步骤推进并保留部分结果', () => {
    const task = useTaskProgress()
    task.start({ title: '识别作息表', steps: [{ id: 'read', label: '读取图片' }, { id: 'parse', label: '解析结构' }] })
    task.setStep('read', 'running')
    task.setStep('read', 'completed', '图片读取完成')
    task.setPartial({ 校区: 2 }, '识别出两个校区')
    task.setStep('parse', 'running')
    task.finish('识别完成')
    expect(task.state.steps.map((step) => step.status)).toEqual(['completed', 'completed'])
    expect(task.state.partial).toEqual({ 校区: 2 })
    expect(task.state.status).toBe('completed')
  })

  it('显示真实用时并能判断长时间无活动', () => {
    const task = useTaskProgress()
    task.start({ title: '慢任务', steps: ['等待响应'] })
    task.setStep('等待响应', 'running')
    vi.advanceTimersByTime(16_000)
    expect(task.elapsedSeconds.value).toBe(16)
    expect(task.isStalled.value).toBe(true)
    task.continueWaiting()
    expect(task.isStalled.value).toBe(false)
    vi.advanceTimersByTime(15_000)
    expect(task.isStalled.value).toBe(true)
  })

  it('失败时保留前面已完成步骤与部分结果', () => {
    const task = useTaskProgress()
    task.start({ title: '导入', steps: [{ id: 'read', label: '读取' }, { id: 'validate', label: '校验' }] })
    task.setStep('read', 'completed')
    task.setPartial({ 已读取: 5 })
    task.fail('validate', new Error('第 3 行校验失败'), { retainedResult: true })
    expect(task.state.steps[0].status).toBe('completed')
    expect(task.state.steps[1].status).toBe('failed')
    expect(task.state.retainedResult).toBe(true)
  })

  it('识别引擎就绪后结构提取失败仍保留引擎完成状态', () => {
    const task = useTaskProgress()
    task.start({
      title: '识别作息表',
      steps: [
        { id: 'engine', label: '准备识别引擎' },
        { id: 'structure', label: '识别表格结构' },
        { id: 'extract', label: '提取节次与时间' },
      ],
    })
    task.setStep('engine', 'completed', '识别引擎已就绪')
    task.setStep('structure', 'completed', '表格结构已恢复')
    task.setStep('extract', 'running')
    task.fail('extract', '未能恢复“节次—时间”结构')
    expect(task.state.steps.map((step) => step.status)).toEqual(['completed', 'completed', 'failed'])
  })

  it('取消会调用底层取消函数且不会留下运行状态', async () => {
    const abort = vi.fn()
    const task = useTaskProgress()
    task.start({ title: 'OCR', steps: [{ id: 'engine', label: '引擎' }], cancel: abort })
    task.setStep('engine', 'running')
    await task.cancel()
    expect(abort).toHaveBeenCalledOnce()
    expect(task.state.status).toBe('cancelled')
    expect(task.state.steps[0].status).toBe('cancelled')
  })

  it('取消多阶段任务时保留已产生的部分结果', async () => {
    const task = useTaskProgress()
    task.start({ title: '批量识别', steps: ['读取', '识别'], cancel: vi.fn() })
    task.setStep('识别', 'running')
    task.setPartial({ 图片: '1/3' })
    await task.cancel()
    expect(task.state.retainedResult).toBe(true)
    expect(task.state.latestActivity).toContain('结果仍然保留')
  })

  it('取消后忽略晚到的完成与失败回调', async () => {
    const task = useTaskProgress()
    task.start({ title: 'OCR', steps: ['识别'], cancel: vi.fn() })
    task.setStep('识别', 'running')
    await task.cancel()
    task.finish('晚到的完成')
    task.fail('识别', '晚到的失败')
    task.setPartial({ 图片: '2/3' }, '晚到的部分结果')
    task.activity('晚到的 Worker 活动')
    expect(task.state.status).toBe('cancelled')
    expect(task.state.latestActivity).toContain('任务已取消')
    expect(task.state.partial).toBeNull()
  })

  it('连续任务会清理上一次状态', () => {
    const task = useTaskProgress()
    task.start({ title: '第一次', steps: ['A'] })
    task.fail('A', '失败')
    task.start({ title: '第二次', steps: ['B'] })
    expect(task.state.title).toBe('第二次')
    expect(task.state.error).toBe('')
    expect(task.state.steps).toHaveLength(1)
    expect(task.state.steps[0].status).toBe('waiting')
  })
})
