const DEFAULT_MENU_HEIGHT = 214

export function menuPlacementFor(buttonRect, viewportHeight, menuHeight = DEFAULT_MENU_HEIGHT) {
  const top = Number(buttonRect?.top) || 0
  const bottom = Number(buttonRect?.bottom) || 0
  const height = Math.max(0, Number(viewportHeight) || 0)
  const spaceBelow = Math.max(0, height - bottom)
  const spaceAbove = Math.max(0, top)
  return spaceBelow < menuHeight && spaceAbove > spaceBelow ? 'up' : 'down'
}
