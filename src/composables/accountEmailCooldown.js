import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const STORAGE_KEY = 'study-life-resend-cooldown'
let memoryDeadline = 0

function readDeadline() {
  try {
    const saved = Number(sessionStorage.getItem(STORAGE_KEY))
    return Math.max(memoryDeadline, Number.isFinite(saved) ? saved : 0)
  } catch { return memoryDeadline }
}

// Email requests share a cooldown that survives closing and reopening the panel.
export function useAccountEmailCooldown() {
  const deadline = ref(readDeadline())
  const now = ref(Date.now())
  const seconds = computed(() => Math.max(0, Math.ceil((deadline.value - now.value) / 1000)))
  let timer = 0

  function tick() {
    now.value = Date.now()
    if (!seconds.value) {
      window.clearInterval(timer)
      timer = 0
    }
  }

  function resume() {
    window.clearInterval(timer)
    tick()
    if (seconds.value) timer = window.setInterval(tick, 1000)
  }

  function start() {
    deadline.value = Date.now() + 60000
    memoryDeadline = deadline.value
    try { sessionStorage.setItem(STORAGE_KEY, String(deadline.value)) } catch { /* Memory fallback. */ }
    resume()
  }

  onMounted(resume)
  onBeforeUnmount(() => window.clearInterval(timer))
  return { seconds, start }
}
