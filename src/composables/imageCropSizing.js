export const MAX_CROP_PIXELS = 8_500_000
export const MAX_CROP_SIDE = 4_096

export function cropCanvasDimensions(width, height, { maxPixels = MAX_CROP_PIXELS, maxSide = MAX_CROP_SIDE } = {}) {
  const sourceWidth = Math.max(1, Math.floor(Number(width) || 1))
  const sourceHeight = Math.max(1, Math.floor(Number(height) || 1))
  const pixelLimit = Math.max(1, Number(maxPixels) || MAX_CROP_PIXELS)
  const sideLimit = Math.max(1, Number(maxSide) || MAX_CROP_SIDE)
  const scale = Math.min(
    1,
    sideLimit / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(pixelLimit / (sourceWidth * sourceHeight)),
  )
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  }
}
