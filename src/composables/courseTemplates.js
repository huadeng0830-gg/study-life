import { touchStoredRef, useStoredRef } from './store/core.js'

function cloneCourses(courses) {
  return JSON.parse(JSON.stringify(Array.isArray(courses) ? courses : []))
}

function createId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ? `tpl-${uuid}` : `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
