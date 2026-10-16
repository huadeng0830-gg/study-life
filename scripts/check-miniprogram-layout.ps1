param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$WechatIde = 'wechatide'
)

$ErrorActionPreference = 'Stop'

# 在已授权的真实模拟器上读取尺寸；VM 业务测试无法发现原生按钮的默认宽度。
function Invoke-LayoutTool {
  param([string]$Tool, [string[]]$ToolArguments)
  $raw = (& $WechatIde -c Codex $Tool --project $Project @ToolArguments | Out-String)
  if ($LASTEXITCODE -ne 0) { throw "WeChat tool failed: $Tool" }
  $jsonStart = $raw.IndexOf('{')
  if ($jsonStart -lt 0) { throw "Missing JSON result: $Tool" }
  $response = $raw.Substring($jsonStart) | ConvertFrom-Json
  if (!$response.ok -or $response.result.success -eq $false -or $response.result.status -eq 'pending') {
    throw "WeChat tool did not complete: $Tool"
  }
  return $response.result
}

function Get-ElementSize {
  param([string]$Selector)
  $size = Invoke-LayoutTool 'automation_element_action' @('--selector', $Selector, '--action', 'size', '--wait-for-selector', $Selector)
  if ($size.width -le 0 -or $size.height -le 0) { throw "Element has no layout: $Selector" }
  return $size
}

try {
  $null = Invoke-LayoutTool 'automation_navigate' @('--action', 'switchTab', '--url', '/pages/record/index')
  $grid = Get-ElementSize '.type-grid'
  $entry = Get-ElementSize '.type-button'
  if ($entry.width * 4 -gt $grid.width) { throw 'Record entry buttons overflow the four-column grid.' }
  Write-Output "PASS record grid: button $($entry.width)px / container $($grid.width)px"

  $null = Invoke-LayoutTool 'automation_navigate' @('--action', 'switchTab', '--url', '/pages/learning/index')
  $filters = Get-ElementSize '.chip-list'
  $chip = Get-ElementSize '.chip'
  if ($chip.width * 3 -gt $filters.width) { throw 'Learning filters wrap because buttons are too wide.' }
  Write-Output "PASS learning filters: button $($chip.width)px / container $($filters.width)px"

  $null = Invoke-LayoutTool 'automation_navigate' @('--action', 'switchTab', '--url', '/pages/home/index')
  $icon = Get-ElementSize '.icon'
  if ($icon.width -gt 32 -or $icon.height -gt 32) { throw 'Home focus icon is oversized.' }
  Write-Output "PASS home icon: $($icon.width)x$($icon.height)px"
} finally {
  # 检查结束后回到首页；不改变业务记录或本机存储。
  $null = Invoke-LayoutTool 'automation_navigate' @('--action', 'switchTab', '--url', '/pages/home/index')
}
