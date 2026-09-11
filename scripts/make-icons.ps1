# アプリアイコン生成スクリプト
# 元画像の「ほぼ白」背景を純白へ平坦化し、any 用 (192/512) と maskable 用 (512, 80% 縮小＋白余白) を出力する
# 使い方（リポジトリ直下で）: .\scripts\make-icons.ps1 -Source design\icons\bus-icon.png -OutDir public\icons
# 詳細は docs/pwa-and-deployment.md の「アプリアイコン」を参照
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [int]$WhiteThreshold = 248,
  [double]$MaskableScale = 0.8
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$srcPath = (Resolve-Path $Source).Path

# --- 1. 背景の平坦化（R,G,B すべて閾値以上 → 純白） ---
$src = New-Object System.Drawing.Bitmap -ArgumentList $srcPath
$flat = New-Object System.Drawing.Bitmap -ArgumentList $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$rect = New-Object System.Drawing.Rectangle 0, 0, $src.Width, $src.Height
$sd = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($sd.Stride * $sd.Height)
[System.Runtime.InteropServices.Marshal]::Copy($sd.Scan0, $bytes, 0, $bytes.Length)
$src.UnlockBits($sd)
$changed = 0
for ($i = 0; $i -lt $bytes.Length; $i += 4) {
  # BGRA 並び
  if ($bytes[$i] -ge $WhiteThreshold -and $bytes[$i + 1] -ge $WhiteThreshold -and $bytes[$i + 2] -ge $WhiteThreshold) {
    if ($bytes[$i] -ne 255 -or $bytes[$i + 1] -ne 255 -or $bytes[$i + 2] -ne 255) { $changed++ }
    $bytes[$i] = 255; $bytes[$i + 1] = 255; $bytes[$i + 2] = 255
  }
  $bytes[$i + 3] = 255
}
$fd = $flat.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $fd.Scan0, $bytes.Length)
$flat.UnlockBits($fd)
$src.Dispose()
"平坦化: $changed 画素を純白へ置換（閾値 $WhiteThreshold）"

function New-Canvas([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  return @{ Bitmap = $bmp; Graphics = $g }
}

function Save-Icon([System.Drawing.Bitmap]$bmp, [string]$name) {
  $path = Join-Path $OutDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  "出力: $path ($($bmp.Width)x$($bmp.Height), $((Get-Item $path).Length) bytes)"
}

# --- 2. any 用: 全面縮小 ---
foreach ($size in 192, 512) {
  $c = New-Canvas $size
  # 縮小時の端のにじみを防ぐため WrapMode を TileFlipXY にする
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $dest = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $c.Graphics.DrawImage($flat, $dest, 0, 0, $flat.Width, $flat.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $c.Graphics.Dispose()
  Save-Icon $c.Bitmap "icon_${size}x${size}.png"
  $c.Bitmap.Dispose()
}

# --- 3. maskable 用: 80% に縮小して白キャンバス中央へ ---
$size = 512
$inner = [int][math]::Round($size * $MaskableScale)
$offset = [int](($size - $inner) / 2)
$c = New-Canvas $size
$attr = New-Object System.Drawing.Imaging.ImageAttributes
$attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
$dest = New-Object System.Drawing.Rectangle $offset, $offset, $inner, $inner
$c.Graphics.DrawImage($flat, $dest, 0, 0, $flat.Width, $flat.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
$c.Graphics.Dispose()
Save-Icon $c.Bitmap "maskable_${size}x${size}.png"
"maskable 内側領域: ($offset,$offset) から ${inner}x${inner}"
$c.Bitmap.Dispose()
$flat.Dispose()
