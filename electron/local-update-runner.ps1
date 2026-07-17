param(
  [Parameter(Mandatory = $true)]
  [string]$PlanPath,
  [Parameter(Mandatory = $true)]
  [string]$StatusPath
)

$ErrorActionPreference = 'Stop'
$plan = $null
$script:ReplacementStarted = $false
$script:OriginalProcessExited = $false

function Set-UpdateStatus([string]$Status) {
  Set-Content -LiteralPath $StatusPath -Value $Status -Encoding UTF8
}

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
  Write-UpdateLog 'Restoring the previous application.'
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
  Write-UpdateLog 'The previous application was restored.'
}

try {
  $plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
  if ($plan.format -ne 'starmedia-local-update-plan') { throw 'Invalid update plan format.' }
  $installDirectory = (Resolve-Path -LiteralPath $plan.installDirectory).Path
  $applicationRoot = (Resolve-Path -LiteralPath $plan.applicationRoot).Path
  $dataRoot = (Resolve-Path -LiteralPath $plan.dataRoot).Path
  $planDirectory = (Resolve-Path -LiteralPath (Split-Path -Parent $PlanPath)).Path
  $statusDirectory = (Resolve-Path -LiteralPath (Split-Path -Parent $StatusPath)).Path
  if ($statusDirectory -ne $planDirectory) { throw 'Invalid update status path.' }
  if (-not $applicationRoot.StartsWith("$planDirectory\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Invalid staged application path.'
  }
  $expectedDataRoot = Join-Path $installDirectory 'StarMediaData'
  if ($dataRoot -ne $expectedDataRoot) { throw 'Invalid application data path.' }
  if ((Split-Path -Parent $plan.rollbackDirectory) -ne $installDirectory) { throw 'Invalid rollback path.' }
  if ((Split-Path -Leaf $plan.rollbackDirectory) -notlike '.starmedia-update-rollback-*') { throw 'Invalid rollback directory name.' }
  $newExecutable = Join-Path $applicationRoot $plan.executableName
  if (-not (Test-Path -LiteralPath $newExecutable -PathType Leaf)) { throw 'The staged update does not contain the application executable.' }

  New-Item -ItemType Directory -Path (Split-Path -Parent $plan.logPath) -Force | Out-Null
  Write-UpdateLog "Updater ready; waiting for StarMedia $($plan.fromVersion) to exit."
  Set-UpdateStatus 'ready'
  Wait-Process -Id ([int]$plan.processId) -Timeout 120 -ErrorAction SilentlyContinue
  if (Get-Process -Id ([int]$plan.processId) -ErrorAction SilentlyContinue) { throw 'StarMedia did not exit within 120 seconds.' }
  $script:OriginalProcessExited = $true
  Start-Sleep -Milliseconds 800

  if (Test-Path -LiteralPath $plan.rollbackDirectory) { throw 'The rollback directory already exists.' }
  New-Item -ItemType Directory -Path $plan.rollbackDirectory | Out-Null
  Write-UpdateLog 'Backing up the current application files.'
  foreach ($entry in @(Get-ProgramEntries $installDirectory $plan.rollbackDirectory)) {
    Move-Item -LiteralPath $entry.FullName -Destination $plan.rollbackDirectory -Force
  }

  $script:ReplacementStarted = $true
  Write-UpdateLog "Installing StarMedia $($plan.toVersion)."
  foreach ($entry in @(Get-ChildItem -LiteralPath $applicationRoot -Force)) {
    if ($entry.Name -eq 'StarMediaData') { throw 'The update unexpectedly contains StarMediaData.' }
    Copy-Item -LiteralPath $entry.FullName -Destination $installDirectory -Recurse -Force
  }

  $installedExecutable = Join-Path $installDirectory $plan.executableName
  if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) { throw 'The updated application executable is missing.' }
  $process = Start-Process -FilePath $installedExecutable -WorkingDirectory $installDirectory -PassThru
  Start-Sleep -Seconds 5
  if ($process.HasExited) { throw "The updated application exited early with code $($process.ExitCode)." }

  Remove-Item -LiteralPath $plan.rollbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Split-Path -Parent $applicationRoot) -Recurse -Force -ErrorAction SilentlyContinue
  Write-UpdateLog "Update completed: $($plan.fromVersion) -> $($plan.toVersion)."
  exit 0
} catch {
  try { Set-UpdateStatus "failed:$($_.Exception.Message)" } catch {}
  try { Write-UpdateLog "Update failed: $($_.Exception.Message)" } catch {}
  if ($script:OriginalProcessExited) {
    try { Restore-PreviousProgram } catch {
      try { Write-UpdateLog "Automatic restore failed: $($_.Exception.Message)" } catch {}
    }
  }
  try { Remove-Item -LiteralPath (Split-Path -Parent $plan.applicationRoot) -Recurse -Force -ErrorAction SilentlyContinue } catch {}
  exit 1
}
