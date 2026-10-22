# 生成安卓启动图标（桌面图标 + 自适应图标前景）。
#
# 【为什么要脚本生成，而不是直接复制 public/pwa-v2-512x512.png】
# 原来的 res/mipmap-* 里塞的是同一张 512x512 的图，每个密度目录都一样：
#   - mdpi 设备上这张图是 512dp（比屏幕还宽），被系统缩到 48dp，边缘发虚；
#   - 自适应图标的前景层是 108dp 画布，系统只显示中间 72dp。
#     原图被当成 108dp 满铺 → 启动器只截到中间 2/3，
#     于是桌面上的图标是"被放大裁掉一圈的便签"，跟网页/PWA 的图标完全不是一回事。
#
# 【现在生成什么】
#   - 传统图标 ic_launcher.png / ic_launcher_round.png：按各密度标准尺寸出图；
#   - 自适应前景 ic_launcher_foreground.png：108dp 画布里居中放 72dp 的图案，
#     正好落在系统显示的安全区里，桌面图标与网页图标一致；
#   - 圆形图标用圆形遮罩，适配圆形图标槽位。
#
# 图案来源：public/pwa-v2-512x512.png（与 PWA、网页首屏同一张）。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android-icons.ps1
param(
  [string]$Source = 'public/pwa-v2-512x512.png',
  [string]$ResDir = 'android/app/src/main/res'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$sourcePath = Join-Path $root $Source
if (-not (Test-Path $sourcePath)) { throw "找不到图标源文件：$sourcePath" }

# 密度 -> (传统图标边长 px, 自适应前景画布 px)
$densities = [ordered]@{
  'mdpi'    = @(48, 108)
  'hdpi'    = @(72, 162)
  'xhdpi'   = @(96, 216)
  'xxhdpi'  = @(144, 324)
  'xxxhdpi' = @(192, 432)
}

function New-ResizedBitmap {
  param(
    [System.Drawing.Image]$Source,
    [int]$Size,
    [switch]$Circular
  )
  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($Source, 0, 0, $Size, $Size)
  if ($Circular) {
    # 圆形遮罩：只有圆内保留，其余像素透明。
    $mask = New-Object System.Drawing.Bitmap $Size, $Size
    $mg = [System.Drawing.Graphics]::FromImage($mask)
    $mg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $mg.Clear([System.Drawing.Color]::Transparent)
    $mg.FillEllipse([System.Drawing.Brushes]::White, 0, 0, $Size, $Size)
    $mg.Dispose()
    $out = New-Object System.Drawing.Bitmap $Size, $Size
    $og = [System.Drawing.Graphics]::FromImage($out)
    $og.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, $Size, $Size))
    $og.Dispose()
    $bmp.SetResolution(96, 96)
    $bmp.Dispose()
    $bmp = $out
    $mask.Dispose()
  }
  $g.Dispose()
  return $bmp
}

$art = [System.Drawing.Image]::FromFile($sourcePath)
try {
  foreach ($density in $densities.Keys) {
    $legacy = $densities[$density][0]
    $canvas = $densities[$density][1]
    $safe = [int][Math]::Round($canvas * 72 / 108)
    $dir = Join-Path $root (Join-Path $ResDir "mipmap-$density")
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    # 传统方形图标：图案铺满。
    $square = New-ResizedBitmap -Source $art -Size $legacy
    $square.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $square.Dispose()

    # 传统圆形图标：圆形遮罩。
    $round = New-ResizedBitmap -Source $art -Size $legacy -Circular
    $round.Save((Join-Path $dir 'ic_launcher_round.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $round.Dispose()

    # 自适应前景：108dp 画布 + 居中 72dp 图案（= 系统显示的安全区）。
    $fg = New-Object System.Drawing.Bitmap $canvas, $canvas
    $fg.SetResolution(96, 96)
    $fgGraphics = [System.Drawing.Graphics]::FromImage($fg)
    $fgGraphics.Clear([System.Drawing.Color]::Transparent)
    $fgGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $fgGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $offset = [int](($canvas - $safe) / 2)
    $artRect = New-Object System.Drawing.Rectangle $offset, $offset, $safe, $safe
    $fgGraphics.DrawImage($art, $artRect)
    $fgGraphics.Dispose()
    $fg.Save((Join-Path $dir 'ic_launcher_foreground.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()

    Write-Output ("{0,-8} 传统 {1}px / 自适应前景 {2}px（图案 {3}px）" -f $density, $legacy, $canvas, $safe)
  }
}
finally {
  $art.Dispose()
}

Write-Output '安卓图标已生成。'
