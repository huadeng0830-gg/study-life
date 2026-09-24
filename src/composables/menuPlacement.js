const DEFAULT_MENU_HEIGHT = 214

export function menuPlacementFor(buttonRect, viewportHeight, menuHeight = DEFAULT_MENU_HEIGHT) {
  const top = Number(buttonRect?.top) || 0
  const bottom = Number(buttonRect?.bottom) || 0
  const height = Math.max(0, Number(viewportHeight) || 0)
  const spaceBelow = Math.max(0, height - bottom)
  const spaceAbove = Math.max(0, top)
  return spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'up' : 'down'
}

/**
 * 把菜单摆在触点附近，同时保证整块菜单留在视口内。
 *
 * 优先出现在触点右下方（手指不会挡住菜单），放不下就向左/向上翻，
 * 最后再夹一次边界，避免菜单被推出屏幕外。
 * 纯函数，可直接单测。
 *
 * @param {{x:number,y:number}} point 触点（视口坐标）
 * @param {{width:number,height:number}} menu 菜单实际尺寸
 * @param {{width:number,height:number}} viewport 视口尺寸
 * @param {number} margin 与视口边缘的最小间距
 * @returns {{left:number, top:number, flippedX:boolean, flippedY:boolean}}
 */
export function pointMenuPlacement(point, menu, viewport, margin = 8) {
  const x = Number(point?.x) || 0
  const y = Number(point?.y) || 0
  const width = Math.max(0, Number(menu?.width) || 0)
  const height = Math.max(0, Number(menu?.height) || 0)
  const viewportWidth = Math.max(0, Number(viewport?.width) || 0)
  const viewportHeight = Math.max(0, Number(viewport?.height) || 0)
  const gap = Math.max(0, Number(margin) || 0)

  const flippedX = x + width > viewportWidth - gap && x - width >= gap
  const flippedY = y + height > viewportHeight - gap && y - height >= gap

  const left = Math.min(
    Math.max(gap, flippedX ? x - width : x),
    Math.max(gap, viewportWidth - width - gap),
  )
  const top = Math.min(
    Math.max(gap, flippedY ? y - height : y),
    Math.max(gap, viewportHeight - height - gap),
  )

  return { left, top, flippedX, flippedY }
}
