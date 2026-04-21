param(
    [string]$TaskFile = "C:\work\nox\orchestration\tasks\round-001-sample-task.md"
)

$ErrorActionPreference = "Stop"

$ScriptRoot = "C:\work\nox\orchestration\scripts"
$StatePath  = "C:\work\nox\orchestration\config\state.json"

$RunRound     = Join-Path $ScriptRoot "run-round.ps1"
$UpdateState  = Join-Path $ScriptRoot "update-state.ps1"
$SendTelegram = Join-Path $ScriptRoot "send-telegram.ps1"

# --- guard: required files ---
foreach ($File in @($RunRound, $UpdateState, $SendTelegram, $StatePath, $TaskFile)) {
    if (-not (Test-Path $File)) {
        Write-Error "[FAIL] Required file not found: $File"
        exit 1
    }
}

$TaskName = [System.IO.Path]::GetFileNameWithoutExtension($TaskFile)

Write-Host ""
Write-Host "=== NOX ORCHESTRATOR (ONE-SHOT) ==="
Write-Host "Task : $TaskFile"
Write-Host ""

# --- telegram START ---
try {
    & $SendTelegram -Message "[NOX] ORCHESTRATOR START: $TaskName"
}
catch {
    Write-Error "[FAIL] Telegram START failed: $_"
    exit 1
}

# --- run round ---
try {
    & $RunRound -TaskFile $TaskFile
}
catch {
    Write-Host "[FAIL] run-round.ps1 failed: $_"

    try { & $SendTelegram -Message "[NOX] ORCHESTRATOR FAIL: $TaskName" } catch {}

    exit 1
}

# --- success: update state ---
try {
    & $UpdateState -CurrentStep "orchestrator one-shot executed" -NextPriority "create round-002 actual task"
}
catch {
    Write-Host "[FAIL] update-state.ps1 failed: $_"

    try { & $SendTelegram -Message "[NOX] ORCHESTRATOR FAIL (state update): $TaskName" } catch {}

    exit 1
}

# --- telegram PASS ---
try {
    & $SendTelegram -Message "[NOX] ORCHESTRATOR PASS: $TaskName"
}
catch {
    Write-Error "[FAIL] Telegram PASS failed: $_"
    exit 1
}

Write-Host ""
Write-Host "[DONE] orchestrator.ps1 completed successfully."
