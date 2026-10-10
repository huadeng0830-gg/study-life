import { watch } from 'vue'

/** A closed or replaced form cannot finish work on a newer editor visit. */
export function createProjectEditorScope(context, target, busy) {
  let visit = 0
  watch(target, () => { visit++; if (busy) busy.value = false }, { flush: 'sync' })
  return {
    capture() {
      const token = visit
      const isCurrentProject = context.capture()
      return () => token === visit && isCurrentProject()
    },
  }
}
