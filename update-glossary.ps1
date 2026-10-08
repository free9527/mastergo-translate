# v12.45 术语库后台重新生成脚本（审核后一键更新）
# 前提：你已完成「导出」→ 粘贴到 术语素材/Lexar术语库_专属.csv
# 用法：双击本文件，或 PowerShell 执行：.\update-glossary.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "═══ v12.45 术语库后台重新生成 ═══" -ForegroundColor Cyan
Write-Host "工作目录: $root`n"

# 1. 重新生成默认术语库（merge-glossary.py）
Write-Host "[1/4] 重新生成 lib/default-glossary.ts ..." -ForegroundColor Yellow
if (Test-Path "scripts/merge-glossary.py") {
  python scripts/merge-glossary.py
  if ($LASTEXITCODE -ne 0) { Write-Host "❌ merge-glossary.py 失败" -ForegroundColor Red; exit 1 }
  Write-Host "✅ default-glossary.ts 已更新`n" -ForegroundColor Green
} else {
  Write-Host "⚠️  scripts/merge-glossary.py 不存在，跳过（手动合并术语库 CSV）`n" -ForegroundColor DarkYellow
}

# 2. 重新生成人工语料库（gen-corpus-inline.ts）
Write-Host "[2/4] 重新生成 lib/human-corpus-data.ts ..." -ForegroundColor Yellow
if (Test-Path "claude-tmp/gen-corpus-inline.ts") {
  npx tsx claude-tmp/gen-corpus-inline.ts
  if ($LASTEXITCODE -ne 0) { Write-Host "❌ gen-corpus-inline.ts 失败" -ForegroundColor Red; exit 1 }
  Write-Host "✅ human-corpus-data.ts 已更新`n" -ForegroundColor Green
} else {
  Write-Host "⚠️  claude-tmp/gen-corpus-inline.ts 不存在，跳过`n" -ForegroundColor DarkYellow
}

# 3. TypeScript 检查
Write-Host "[3/4] 运行 npm run typecheck ..." -ForegroundColor Yellow
npm run typecheck
if ($LASTEXITCODE -ne 0) { Write-Host "❌ typecheck 失败" -ForegroundColor Red; exit 1 }
Write-Host "✅ typecheck 通过`n" -ForegroundColor Green

# 4. 生产构建
Write-Host "[4/4] 运行 npm run build ..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "❌ build 失败" -ForegroundColor Red; exit 1 }
Write-Host "✅ build 完成`n" -ForegroundColor Green

Write-Host "═══ 全部完成 ═══" -ForegroundColor Cyan
Write-Host "dist/ 已更新，可以发版（MasterGo 插件市场 / 内部渠道）" -ForegroundColor Green
Write-Host "`n按任意键退出..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
