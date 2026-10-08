import { computed, watchEffect } from 'vue'
import { festiveFor, applyAtmosphere } from './festive.js'
import { festiveConfig } from './atmosphereStore.js'
import { appToday } from './timeContext.js'

const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']
const ANNIVERSARY_KEYS = ['anniversary', 'anniversary-start']
const ANNIVERSARY_COLORS = ['#fbbf24', '#fcd34d', '#fde68a', '#eab308', '#f59e0b', '#f97316']
const ANNIVERSARY_DURATION = 4.2

/** Keeps the calendar-derived atmosphere and its decorative particle projection together. */
export function useFestiveAtmosphere() {
  const festiveToday = computed(() => festiveFor(appToday.value, festiveConfig.value))
  const atmosphereKey = computed(() => festiveToday.value?.key ?? 'none')
  const isAnniversary = computed(() => ANNIVERSARY_KEYS.includes(festiveToday.value?.key ?? ''))

  // Reduce independently promoted animation layers on smaller devices.
  const decorCount = typeof window === 'undefined'
    ? 18
    : (window.innerWidth < 640 ? 8 : window.innerWidth < 1024 ? 12 : 18)
  const decorParticles = Array.from({ length: decorCount }, (_, id) => ({
    id,
    left: (id * 5.7 + 3) % 100,
    delay: (id % 9) * -1.1,
    dur: 6 + (id % 5),
    size: 6 + (id % 3) * 3,
  }))

  function decorStyle(particle) {
    const decor = festiveToday.value?.decor
    let background = festiveToday.value?.accentColor || 'var(--primary)'
    const lantern = decor === 'lantern'
    if (decor === 'snow') background = '#ffffff'
    else if (decor === 'confetti') background = CONFETTI_COLORS[particle.id % CONFETTI_COLORS.length]
    if (isAnniversary.value) background = ANNIVERSARY_COLORS[particle.id % ANNIVERSARY_COLORS.length]
    return {
      left: `${particle.left}%`,
      width: lantern ? `${14 + (particle.id % 3) * 3}px` : `${particle.size}px`,
      height: lantern ? `${18 + (particle.id % 3) * 3}px` : decor === 'snow' ? `${particle.size}px` : `${particle.size + 3}px`,
      background,
      animationDelay: `${particle.delay}s`,
      animationDuration: isAnniversary.value ? `${ANNIVERSARY_DURATION}s` : `${particle.dur}s`,
    }
  }

  watchEffect(() => {
    applyAtmosphere(festiveToday.value ? { accentColor: festiveToday.value.accentColor, decor: festiveToday.value.decor } : null)
  })

  return { festiveToday, atmosphereKey, isAnniversary, decorParticles, decorStyle }
}
