// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { useDomainCommands } from '../src/composables/domain/commands.js'
import { createPlaceWithVisit, importPlacePreset, placeOffers, placeVisits, places } from '../src/composables/placeBook.js'

const domain = useDomainCommands()

beforeEach(() => {
  domain.transactions.value = []
  places.value = []
  placeVisits.value = []
  placeOffers.value = []
})

describe('地点与账本的本机关联', () => {
  it('一笔支出只能关联一家地点和一条到访', () => {
    const transaction = domain.createTransaction({
      id: 'expense-place-link', name: '午饭', amount: 18, direction: 'expense', date: '2026-09-02',
    })
    createPlaceWithVisit({ id: 'place-a', name: '虚构面馆', category: 'food' }, {
      id: 'visit-a', visitedAt: '2026-09-02', price: 18, transactionId: transaction.id,
    })

    expect(transaction.placeId).toBe('place-a')
    expect(() => createPlaceWithVisit({ id: 'place-b', name: '虚构咖啡店', category: 'food' }, {
      id: 'visit-b', visitedAt: '2026-09-02', price: 18, transactionId: transaction.id,
    })).toThrow('已经关联到另一地点')
    expect(places.value.map((place) => place.id)).toEqual(['place-a'])
    expect(placeVisits.value.map((visit) => visit.id)).toEqual(['visit-a'])
  })

  it('接受好友预设只导入地点副本，不带备注和到访，并可安全重试', () => {
    const preset = {
      id: '8bc1046f-8ca1-46d2-9329-33f65a706194', name: '虚构食堂档口', category: 'food',
      campus: '虚构校区', area: '北苑', placeHint: '二楼靠窗', scores: { value: 'worth', portion: 'large' },
      note: '不应导入的私人备注', visits: [{ visitedAt: '2026-10-02', price: 18 }],
    }
    expect(importPlacePreset([preset])).toEqual({ imported: 1, skipped: 0 })
    expect(places.value[0]).toMatchObject({ id: preset.id, visibility: 'private', note: '', scores: preset.scores })
    expect(placeVisits.value).toEqual([])
    expect(importPlacePreset([preset])).toEqual({ imported: 0, skipped: 1 })
    expect(places.value).toHaveLength(1)
  })
})
