# 从手机拉取采集的音频文件到项目 captures/ 目录
# 使用方式：powershell -File scripts/pull-captures.ps1

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$capturesDir = Join-Path $scriptDir "..\captures"
New-Item -ItemType Directory -Force -Path $capturesDir | Out-Null

Write-Host "正在从设备拉取音频文件..." -ForegroundColor Cyan
adb pull /data/data/com.poc.audiocapture/files/captures/ "$capturesDir\"

Write-Host ""
Write-Host "完成。文件位置: $((Resolve-Path $capturesDir).Path)" -ForegroundColor Green
Get-ChildItem -Recurse $capturesDir | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
    $size = "{0,10:N0} B" -f $_.Length
    Write-Host "  $size  $($_.Name)"
}
