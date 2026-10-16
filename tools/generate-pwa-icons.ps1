Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $PSScriptRoot '..\apps\web\public\icons'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

foreach ($size in @(180, 192, 512)) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::FromArgb(247, 248, 252))

  $margin = [int]($size * 0.14)
  $side = $size - 2 * $margin
  $radius = [int]($side * 0.22)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($margin, $margin, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($margin + $side - $radius * 2, $margin, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($margin + $side - $radius * 2, $margin + $side - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc($margin, $margin + $side - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()
  $purple = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(100, 73, 207))
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $graphics.FillPath($purple, $path)

  $font = [System.Drawing.Font]::new('Arial', [single]($size * 0.40), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = [System.Drawing.RectangleF]::new(0, [single](-$size * 0.015), [single]$size, [single]$size)
  $graphics.DrawString('K', $font, $white, $rect, $format)

  $file = if ($size -eq 180) { 'apple-touch-icon.png' } else { "icon-$size.png" }
  $bitmap.Save((Join-Path $outputDir $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $format.Dispose(); $font.Dispose(); $white.Dispose(); $purple.Dispose(); $path.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
