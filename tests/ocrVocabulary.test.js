// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { applyOcrVocabulary, closestOcrTerm, ocrVocabulary, rememberOcrCourses } from '../src/composables/ocrVocabulary.js'

describe('local OCR vocabulary', () => {
  beforeEach(() => {
    ocrVocabulary.value = { courses: [], teachers: [], rooms: [], campuses: [] }
  })

  it('remembers only accepted timetable fields locally', () => {
    rememberOcrCourses([{ name: '高等数学', teacher: '张老师', room: 'A201' }])
    expect(ocrVocabulary.value).toMatchObject({
      courses: ['高等数学'], teachers: ['张老师'], rooms: ['A201'],
    })
  })

  it('uses an unambiguous close match but avoids ambiguous corrections', () => {
    expect(closestOcrTerm('高等数芋', ['高等数学'])).toBe('高等数学')
    expect(closestOcrTerm('大学英语', ['大学英语A', '大学英语B'])).toBeNull()
    const result = applyOcrVocabulary({ name: '高等数芋', teacher: '张老师', room: 'A201' }, [{ name: '高等数学' }])
    expect(result.course.name).toBe('高等数学')
  })
})
