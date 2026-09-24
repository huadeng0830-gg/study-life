<script setup>
defineProps({
  icon: { type: String, default: '✦' },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  hint: { type: String, default: '' },
  primaryLabel: { type: String, default: '' },
  secondaryLabel: { type: String, default: '' },
  // 标题层级。空态通常挂在页面 h1 之下，用 h2 才不跳级；
  // 但在弹窗或卡片里作为次级块时 h3 更合适，所以做成可配置。
  level: { type: Number, default: 3 },
})

const emit = defineEmits(['primary', 'secondary'])
</script>

<template>
  <div class="empty-state">
    <span class="es-icon" aria-hidden="true">{{ icon }}</span>
    <div class="es-copy">
      <h3 v-if="level === 3">{{ title }}</h3>
      <h2 v-else-if="level === 2">{{ title }}</h2>
      <h4 v-else>{{ title }}</h4>
      <p v-if="description">{{ description }}</p>
      <small v-if="hint">{{ hint }}</small>
    </div>
    <div v-if="primaryLabel || secondaryLabel || $slots.default" class="es-actions">
      <button v-if="secondaryLabel" class="btn btn-ghost" @click="emit('secondary')">{{ secondaryLabel }}</button>
      <button v-if="primaryLabel" class="btn btn-primary" @click="emit('primary')">{{ primaryLabel }}</button>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 26px 20px;
  text-align: center;
}
.es-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  color: var(--primary);
  font-size: 21px;
  border: 1px solid var(--border);
  border-radius: 13px;
  background: var(--bg-tint);
}

/* 呼吸感：非常轻的缩放 + 亮度起伏，用来在空页面上给一个"这里还活着"的信号。
   刻意放进 no-preference 里——开了「减少动效」的用户连这个都不该看到，
   不依赖全局那条 !important 降级规则。 */
@media (prefers-reduced-motion: no-preference) {
  .es-icon {
    animation: es-breathe 4.2s var(--ease-standard, cubic-bezier(0.2, 0.8, 0.2, 1)) infinite;
  }
}

@keyframes es-breathe {
  0%,
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 var(--focus-ring, rgba(69, 111, 232, 0.16));
  }
  50% {
    transform: scale(1.055);
    box-shadow: 0 0 0 7px transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .es-icon {
    animation: none;
  }
}

/* 应用内的「流畅优先」开关同样要能停掉它。 */
:global(:root[data-performance='reduced']) .es-icon {
  animation: none;
}
.es-copy {
  max-width: 420px;
}
.es-copy h3 {
  font-size: 14.5px;
  font-weight: 700;
}
.es-copy p {
  margin-top: 3px;
  color: var(--ink-soft);
  font-size: 12.5px;
  line-height: 1.55;
}
.es-copy small {
  margin-top: 3px;
  color: var(--ink-faint);
  font-size: 11px;
}
.es-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
