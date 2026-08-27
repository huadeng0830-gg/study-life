<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { activeWallpaperSpec, wallpaperConfig } from '../composables/appearance.js'
import { getWallpaper, wallpaperRevision } from '../composables/wallpaperStorage.js'

const route = useRoute()
const imageUrl = ref('')
const imageRatio = ref(0)
const viewportRatio = ref(window.innerWidth / Math.max(1, window.innerHeight))
const mobileViewport = window.matchMedia('(max-width: 900px)').matches
const maxCachedImages = mobileViewport ? 2 : 5

// 按 target 缓存 objectURL 与宽高比：路由切换不再重复读库，
// 仅当壁纸被修改（revision 变化）时才重新加载。
const imageCache = new Map()

function rememberImage(target, entry) {
  imageCache.delete(target)
  imageCache.set(target, entry)
  while (imageCache.size > maxCachedImages) {
    const oldestTarget = imageCache.keys().next().value
    const oldest = imageCache.get(oldestTarget)
    if (oldest?.url) URL.revokeObjectURL(oldest.url)
    imageCache.delete(oldestTarget)
  }
}

const spec = computed(() => activeWallpaperSpec(route.path))
const sourceTarget = computed(() => spec.value?.target ?? '')

async function loadImage() {
  const target = sourceTarget.value
  if (!target) {
    imageUrl.value = ''
    imageRatio.value = 0
    return
  }
  const cached = imageCache.get(target)
  if (cached && cached.revision === wallpaperRevision.value) {
    // 命中后移到末尾，形成简单 LRU，避免手机一直保留所有页面的大图。
    rememberImage(target, cached)
    imageUrl.value = cached.url
    imageRatio.value = cached.ratio
    return
  }
  try {
    const blob = await getWallpaper(target)
    const url = blob ? URL.createObjectURL(blob) : ''
    const ratio = blob ? await readImageRatio(blob) : 0
    if (cached) URL.revokeObjectURL(cached.url)
    rememberImage(target, { url, ratio, revision: wallpaperRevision.value })
    // 快速连续切页时，较早发起的图片读取可能较晚结束；不要让它覆盖当前页面。
    if (target !== sourceTarget.value) return
    imageUrl.value = url
    imageRatio.value = ratio
  } catch {
    if (target !== sourceTarget.value) return
    imageUrl.value = ''
    imageRatio.value = 0
  }
}

async function readImageRatio(blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    const ratio = bitmap.width / Math.max(1, bitmap.height)
    bitmap.close()
    return ratio
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      const ratio = image.naturalWidth / Math.max(1, image.naturalHeight)
      URL.revokeObjectURL(url)
      resolve(ratio)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    image.src = url
  })
}

function updateViewportRatio() {
  viewportRatio.value = window.innerWidth / Math.max(1, window.innerHeight)
}

watch([sourceTarget, wallpaperRevision], loadImage, { immediate: true })
onMounted(() => window.addEventListener('resize', updateViewportRatio))
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewportRatio)
  for (const entry of imageCache.values()) URL.revokeObjectURL(entry.url)
  imageCache.clear()
})

const effectiveFit = computed(() => {
  const fit = spec.value?.settings?.fit
  if (fit && fit !== 'auto') return fit
  if (!imageRatio.value || !viewportRatio.value) return 'cover'
  const difference = Math.max(imageRatio.value / viewportRatio.value, viewportRatio.value / imageRatio.value)
  return difference > 1.42 ? 'contain' : 'cover'
})

const layerStyle = computed(() => {
  const settings = spec.value?.settings
  if (!settings || !imageUrl.value) return { display: 'none' }
  const requestedBlur = Math.max(0, Number(settings.blur) || 0)
  return {
    '--wallpaper-image': `url("${imageUrl.value}")`,
    '--wallpaper-blur': `${mobileViewport ? Math.min(requestedBlur, 4) : requestedBlur}px`,
    '--wallpaper-brightness': `${Number(settings.brightness) || 100}%`,
    '--wallpaper-opacity': `${(Number(settings.opacity) || 0) / 100}`,
    '--wallpaper-overlay': `${(Number(settings.overlay) || 0) / 100}`,
    '--wallpaper-position': settings.position || 'center center',
    '--wallpaper-fit': effectiveFit.value,
    '--wallpaper-inset': effectiveFit.value === 'contain' ? '0px' : '-28px',
    '--wallpaper-scale': effectiveFit.value === 'contain' ? '1' : '1.025',
  }
})
</script>

<template>
  <div class="wallpaper-layer" :style="layerStyle" aria-hidden="true">
    <div class="wallpaper-image"></div>
    <div class="wallpaper-shade"></div>
  </div>
</template>

<style scoped>
.wallpaper-layer{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--bg);contain:strict}.wallpaper-image{position:absolute;inset:var(--wallpaper-inset);background-image:var(--wallpaper-image);background-repeat:no-repeat;background-position:var(--wallpaper-position);background-size:var(--wallpaper-fit);filter:blur(var(--wallpaper-blur)) brightness(var(--wallpaper-brightness));opacity:var(--wallpaper-opacity);transform:translateZ(0) scale(var(--wallpaper-scale));backface-visibility:hidden}.wallpaper-shade{position:absolute;inset:0;background:rgba(10,16,32,var(--wallpaper-overlay))}
</style>
