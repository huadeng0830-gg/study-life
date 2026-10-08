import { describe, expect, it } from 'vitest'
import { cropCanvasDimensions, MAX_CROP_PIXELS, MAX_CROP_SIDE } from '../src/composables/imageCropSizing.js'

describe('课表裁切画布尺寸', () => {
  it('小图保持原尺寸', () => {
    expect(cropCanvasDimensions(1200, 800)).toEqual({ width: 1200, height: 800 })
  })

  it('大图按像素与单边上限等比缩小', () => {
    const size = cropCanvasDimensions(9000, 6000)
    expect(size.width).toBeLessThanOrEqual(MAX_CROP_SIDE)
    expect(size.height).toBeLessThanOrEqual(MAX_CROP_SIDE)
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CROP_PIXELS)
    expect(size.width / size.height).toBeCloseTo(1.5, 2)
  })
})
