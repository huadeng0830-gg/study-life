import { computed, watchEffect } from 'vue'
import { festiveFor, applyAtmosphere } from './festive.js'
import { festiveConfig } from './atmosphereStore.js'
import { appToday } from './timeContext.js'

const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']
const ANNIVERSARY_KEYS = ['anniversary', 'anniversary-start']
const ANNIVERSARY_COLORS = ['#fbbf24', '#fcd34d', '#fde68a', '#eab308', '#f59e0b', '#f97316']
const ANNIVERSARY_DURATION = 4.2

/**
 * 当天的氛围（key / name / 主题色 / 祝福语 / 装饰类型）。
 *
 * 【为什么放在模块级而不是 composable 里】外壳（装饰层）与首页（节日叙事）读的是**同一天
 * 的同一个值**，此前两边各有一条 computed，于是 `festiveFor()` 每天算两遍 —— 每遍都要
 * 重新归一化配置、并读一次农历纪念日的存储镜像。共享一个 computed 之后，
 * `appToday` 或 `festiveConfig` 变化时也只会求值一次。
 *
 * 纯只读派生，没有任何副作用；写 `--atmosphere-accent` 的副作用仍留在下面的
 * `useFestiveAtmosphere()` 里，由外壳决定何时挂载。
 */
export const festiveToday = computed(() => festiveFor(appToday.value, festiveConfig.value))

/** Keeps the calendar-derived atmosphere and its decorative particle projection together. */
export function useFestiveAtmosphere() {
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

  // `atmosphereKey` 原先也在这里对外返回，供外壳打 data-atmosphere —— 那个属性全仓无人读，
// 已连同它的 computed 一起删掉（留着就是"看起来接线了"的死钩子）。
  return { festiveToday, isAnniversary, decorParticles, decorStyle }
}
