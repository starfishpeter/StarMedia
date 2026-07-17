param(
  [Parameter(Mandatory = $true)]
  [string]$PlanPath
)

$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$script:ReplacementStarted = $false

function Write-UpdateLog([string]$Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $plan.logPath -Value $line -Encoding UTF8
}

function Get-ProgramEntries([string]$InstallDirectory, [string]$RollbackDirectory) {
  return Get-ChildItem -LiteralPath $InstallDirectory -Force | Where-Object {
    $_.Name -ne 'StarMediaData' -and $_.FullName -ne $RollbackDirectory
  }
}

function Restore-PreviousProgram {
  Write-UpdateLog '开始恢复旧版程序。'
  if ($script:ReplacementStarted) {
    foreach ($entry in @(Get-ProgramEntries $plan.installDirectory $plan.rollbackDirectory)) {
      Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  if (Test-Path -LiteralPath $plan.rollbackDirectory) {
    foreach ($entry in @(Get-ChildItem -LiteralPath $plan.rollbackDirectory -Force)) {
      $destination = Join-Path $plan.installDirectory $entry.Name
      if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Recurse -Force
      }
      Move-Item -LiteralPath $entry.FullName -Destination $plan.installDirectory -Force
    }
    Remove-Item -LiteralPath $plan.rollbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
  $oldExecutable = Join-Path $plan.installDirectory $plan.executableName
  if (Test-Path -LiteralPath $oldExecutable) {
    Start-Process -FilePath $oldExecutable -WorkingDirectory $plan.installDirectory | Out-Null
  }
  Write-UpdateLog '旧版程序已恢复。'
}

try {
  if ($plan.format -ne 'starmedia-local-update-plan') { throw '升级计划格式无效。' }
  $installDirectory = (Resolve-Path -LiteralPath $plan.installDirectory).Path
  $applicationRoot = (Resolve-Path -LiteralPath $plan.applicationRoot).Path
  $dataRoot = (Resolve-Path -LiteralPath $plan.dataRoot).Path
  $planDirectory = (Resolve-Path -LiteralPath (Split-Path -Parent $PlanPath)).Path
  if (-not $applicationRoot.StartsWith("$planDirectory\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw '升级暂存目录位置无效。'
  }
  $expectedDataRoot = Join-Path $installDirectory 'StarMediaData'
  if ($dataRoot -ne $expectedDataRoot) { throw '数据目录位置无效。' }
  if ((Split-Path -Parent $plan.rollbackDirectory) -ne $installDirectory) { throw '回滚目录位置无效。' }
  if ((Split-Path -Leaf $plan.rollbackDirectory) -notlike '.starmedia-update-rollback-*') { throw '回滚目录名称无效。' }
  $newExecutable = Join-Path $applicationRoot $plan.executableName
  if (-not (Test-Path -LiteralPath $newExecutable -PathType Leaf)) { throw '升级包缺少应用程序。' }

  New-Item -ItemType Directory -Path (Split-Path -Parent $plan.logPath) -Force | Out-Null
  Write-UpdateLog "等待 StarMedia $($plan.fromVersion) 退出。"
  Wait-Process -Id ([int]$plan.processId) -Timeout 120 -ErrorAction SilentlyContinue
  if (Get-Process -Id ([int]$plan.processId) -ErrorAction SilentlyContinue) { throw 'StarMedia 未能在 120 秒内退出。' }
  Start-Sleep -Milliseconds 800

  if (Test-Path -LiteralPath $plan.rollbackDirectory) { throw '回滚目录已存在。' }
  New-Item -ItemType Directory -Path $plan.rollbackDirectory | Out-Null
  Write-UpdateLog '备份现有程序文件。'
  foreach ($entry in @(Get-ProgramEntries $installDirectory $plan.rollbackDirectory)) {
    Move-Item -LiteralPath $entry.FullName -Destination $plan.rollbackDirectory -Force
  }

  $script:ReplacementStarted = $true
  Write-UpdateLog "安装 StarMedia $($plan.toVersion)。"
  foreach ($entry in @(Get-ChildItem -LiteralPath $applicationRoot -Force)) {
    if ($entry.Name -eq 'StarMediaData') { throw '升级包意外包含数据目录。' }
    Copy-Item -LiteralPath $entry.FullName -Destination $installDirectory -Recurse -Force
  }

  $installedExecutable = Join-Path $installDirectory $plan.executableName
  if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) { throw '新版应用程序安装失败。' }
  $process = Start-Process -FilePath $installedExecutable -WorkingDirectory $installDirectory -PassThru
  Start-Sleep -Seconds 5
  if ($process.HasExited) { throw "新版应用程序启动后提前退出，退出码 $($process.ExitCode)。" }

  Remove-Item -LiteralPath $plan.rollbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Split-Path -Parent $applicationRoot) -Recurse -Force -ErrorAction SilentlyContinue
  Write-UpdateLog "升级完成：$($plan.fromVersion) -> $($plan.toVersion)。"
  exit 0
} catch {
  try { Write-UpdateLog "升级失败：$($_.Exception.Message)" } catch {}
  try { Restore-PreviousProgram } catch {
    try { Write-UpdateLog "自动恢复失败：$($_.Exception.Message)" } catch {}
  }
  try { Remove-Item -LiteralPath (Split-Path -Parent $plan.applicationRoot) -Recurse -Force -ErrorAction SilentlyContinue } catch {}
  exit 1
}
