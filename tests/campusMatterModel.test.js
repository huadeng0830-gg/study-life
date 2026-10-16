import { describe, expect, it } from 'vitest'
import { analyzeCampusMatter, matterSafetyText } from '../src/composables/campusMatterModel.js'

describe('怎么办的本地意图提示', () => {
  it('为室友噪音提供宿舍类建议，并只询问会改变建议的问题', () => {
    const result = analyzeCampusMatter('室友晚上打游戏太吵，我不知道该不该直接说。')
    expect(result).toMatchObject({ intent: 'decision', category: 'dormitory', relatedType: 'place' })
    expect(result.followUp).toMatchObject({ key: 'communication', question: '你之前和室友沟通过吗？' })
    expect(result.followUp.options).toContain('还没有')
  })

  it('把二手平板选择识别为消费决策，并提示一个可跳过的优先因素', () => {
    const result = analyzeCampusMatter('两个二手平板不知道买哪个，一个更便宜，一个性能好。')
    expect(result).toMatchObject({ intent: 'decision', category: 'purchase', relatedType: 'market_listing' })
    expect(result.followUp).toMatchObject({ key: 'priority', question: '你最看重哪一点？' })
    expect(result.searchTerms).toContain('平板')
  })

  it('校园快递时间先去找同校地点信息', () => {
    const result = analyzeCampusMatter('学校快递点到底几点关门？')
    expect(result).toMatchObject({ intent: 'information', category: 'campus_info', relatedType: 'place' })
    expect(result.searchTerms).toContain('快递')
  })

  it('老师问题优先搜索老师资料', () => {
    expect(analyzeCampusMatter('这个老师上课怎么样？')).toMatchObject({ intent: 'information', category: 'academic', relatedType: 'teacher' })
  })

  it('孤独和交友情况允许用户选择倾诉，不强制提供建议', () => {
    expect(analyzeCampusMatter('最近感觉没有什么真正的朋友。').intent).toBe('vent')
  })

  it('判断类问题必须能选角度，并识别安全提示关键词', () => {
    expect(analyzeCampusMatter('我是不是想多了？').intent).toBe('judgment')
    expect(analyzeCampusMatter('我最近不想活了。').highRisk).toBe(true)
    expect(matterSafetyText(true)).toContain('联系可信任的人')
    expect(matterSafetyText(false)).toBe('')
  })

  it('补充问题不是发布前置条件，关键信息足够时不继续追问', () => {
    const result = analyzeCampusMatter('我已经和室友沟通过两次，约好晚上戴耳机，最近一周声音小了很多。')
    expect(result.followUp).toBeNull()
  })
})
