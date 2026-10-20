import { touchStoredRef, useStoredRef } from './store/core.js'
import { createId } from '../utils/ids.js'
import { deepClone } from '../utils/clone.js'

function cloneCourses(courses) {
  return deepClone(Array.isArray(courses) ? courses : [])
}

export function useCourseTemplateCommands() {
  const templates = useStoredRef('sl_course_templates', [])
  const commit = () => touchStoredRef('sl_course_templates')

  function saveTemplate(value = {}) {
    const name = String(value.name || '').trim()
    const courses = cloneCourses(value.courses)
    if (!name) throw new Error('请填写模板名称')
    if (!courses.length) throw new Error('当前没有课程可以保存')
    const template = {
      id: value.id || createId(),
      name,
      createdAt: value.createdAt || new Date().toISOString(),
      courses,
    }
    templates.value.unshift(template)
    commit()
    return template
  }

  function deleteTemplate(id) {
    const index = templates.value.findIndex((template) => template.id === id)
    if (index < 0) return null
    const template = templates.value.splice(index, 1)[0]
    commit()
    return template
  }

  return { templates, saveTemplate, deleteTemplate }
}
