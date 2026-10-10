import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { createCollaborationContext } from '../src/composables/collaborationContext.js'
import { createProjectEditorScope } from '../src/composables/projects/projectEditorScope.js'

describe('project editor visit scope', () => {
  it('releases a closed form and ignores its response after reopening', () => {
    const context = createCollaborationContext(() => ['fictional-project'])
    const visible = ref(true), busy = ref(true)
    const editor = createProjectEditorScope(context, visible, busy)
    const oldRequest = editor.capture()
    visible.value = false
    expect(busy.value).toBe(false)
    visible.value = true
    const newRequest = editor.capture()
    busy.value = true
    expect(oldRequest()).toBe(false)
    expect(newRequest()).toBe(true)
    context.invalidate()
    expect(newRequest()).toBe(false)
  })

  it('treats changing a review target as a new visit without requiring closure', () => {
    const context = createCollaborationContext(() => ['fictional-project'])
    const target = ref({ id: 'fictional-first' })
    const editor = createProjectEditorScope(context, target, ref(true))
    const first = editor.capture()
    target.value = { id: 'fictional-second' }
    expect(first()).toBe(false)
  })
})
