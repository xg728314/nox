param(
    [string]$TaskFile = "C:\work\nox\orchestration\tasks\round-001-sample-task.md",
    [string]$BridgeMode = "manual",
    [int]$ConsecutiveFails = 0
)

$ErrorActionPreference = "Stop"

$WorkspaceRoot = "C:\work\nox"
$ConfigRoot = "C:\work\nox\orchestration\config"
$TasksRoot = "C:\work\nox\orchestration\tasks"
$ResultsRoot = "C:\work\nox\orchestration\results"
$LogsRoot = "C:\work\nox\orchestration\logs"

$StateFile = "C:\work\nox\orchestration\config\state.json"
$TaskTemplate = "C:\work\nox\orchestration\tasks\task-template.md"
$ResultTemplate = "C:\work\nox\orchestration\results\result-report-template.md"

# --- auto-loop consecutive fail guard (stop condition 9.1) ---
if ($ConsecutiveFails -ge 2) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[FAIL] Auto-loop stopped: $ConsecutiveFails consecutive validation failures detected."
    Write-Host "       Manual review is required before resuming."
    Write-Host "       Refer to NOX_AUTO_LOOP_SPEC.md Section 9, condition #1."

    $BaseName = [System.IO.Path]::GetFileNameWithoutExtension($TaskFile)
    $ResultName = ($BaseName -replace "-task$", "-result")
    $GuardLogFile = Join-Path $LogsRoot ($ResultName + ".log")
    $GuardLogLines = @(
        "[$Timestamp] NOX RUN ROUND BLOCKED",
        "Reason: Auto-loop consecutive fail limit reached ($ConsecutiveFails >= 2)",
        "TaskFile: $TaskFile",
        "Action: Manual review required. Auto-loop halted."
    )
    $Utf8NoBomGuard = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($GuardLogFile, $GuardLogLines, $Utf8NoBomGuard)

    exit 1
}

if (-not (Test-Path $StateFile)) {
    throw "state.json not found: $StateFile"
}

if (-not (Test-Path $TaskFile)) {
    throw "Task file not found: $TaskFile"
}

if (-not (Test-Path $TaskTemplate)) {
    throw "Task template not found: $TaskTemplate"
}

if (-not (Test-Path $ResultTemplate)) {
    throw "Result template not found: $ResultTemplate"
}

if (-not (Test-Path $LogsRoot)) {
    New-Item -ItemType Directory -Path $LogsRoot -Force | Out-Null
}

if (-not (Test-Path $ResultsRoot)) {
    New-Item -ItemType Directory -Path $ResultsRoot -Force | Out-Null
}

$BaseName = [System.IO.Path]::GetFileNameWithoutExtension($TaskFile)
$ResultName = ($BaseName -replace "-task$", "-result")
$ResultFile = Join-Path $ResultsRoot ($ResultName + ".md")

$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$LogFile = Join-Path $LogsRoot ($ResultName + ".log")

# Validate task file has required contract sections
$TaskContent = Get-Content $TaskFile -Raw -Encoding UTF8
$RequiredSections = @("[ROUND]", "[TASK TYPE]", "[OBJECTIVE]", "[CONSTRAINTS]", "[FAIL IF]", "[OUTPUT FORMAT]")
$MissingSections = @()
foreach ($Section in $RequiredSections) {
    if ($TaskContent -notmatch [regex]::Escape($Section)) {
        $MissingSections += $Section
    }
}
# Check TARGET FILE or TARGET FILES
if ($TaskContent -notmatch "\[TARGET FILE\]" -and $TaskContent -notmatch "\[TARGET FILES\]") {
    $MissingSections += "[TARGET FILE(S)]"
}
# Check ALLOWED_FILES
if ($TaskContent -notmatch "\[ALLOWED_FILES\]") {
    $MissingSections += "[ALLOWED_FILES]"
}
# Check FORBIDDEN_FILES
if ($TaskContent -notmatch "\[FORBIDDEN_FILES\]") {
    $MissingSections += "[FORBIDDEN_FILES]"
}

# --- task contract enforcement ---
if ($MissingSections.Count -gt 0) {
    Write-Host "[FAIL] Task contract incomplete. Missing required sections:"
    foreach ($Missing in $MissingSections) {
        Write-Host "  - $Missing"
    }

    # Log the failure before exit
    $State = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json

    $LogLines = @()
    $LogLines += "[$Timestamp] NOX RUN ROUND BLOCKED"
    $LogLines += "Reason: Task contract incomplete"
    $LogLines += "TaskFile: $TaskFile"
    $LogLines += "MissingSections: $($MissingSections -join ', ')"
    $LogLines += "StatePhase: $($State.current_phase)"
    $LogLines += "StateStep: $($State.current_step)"

    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)

    Write-Error "[FAIL] Task execution blocked. Fix task contract before retrying."
    exit 1
}

$State = Get-Content $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json

$LogLines = @()
$LogLines += "[$Timestamp] NOX RUN ROUND START"
$LogLines += "TaskContract: PASS"
$LogLines += "WorkspaceRoot: $WorkspaceRoot"
$LogLines += "TaskFile: $TaskFile"
$LogLines += "ResultFile: $ResultFile"
$LogLines += "StatePhase: $($State.current_phase)"
$LogLines += "StateStep: $($State.current_step)"
$LogLines += "PrimaryExecutor: $($State.primary_executor)"
$LogLines += "NextPriority: $($State.next_priority)"

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)

Write-Host ""
Write-Host "=== NOX ROUND CONTROLLER ==="
Write-Host "[PASS] Task contract validated."
Write-Host "Workspace : $WorkspaceRoot"
Write-Host "Task      : $TaskFile"
Write-Host "Result    : $ResultFile"
Write-Host "Log       : $LogFile"
Write-Host ""

if (Test-Path $ResultFile) {
    # --- result file validation ---
    $ResultContent = Get-Content $ResultFile -Raw -Encoding UTF8
    $ResultEmpty = [string]::IsNullOrWhiteSpace($ResultContent)

    if ($ResultEmpty) {
        Write-Host "[FAIL] Result file exists but is empty: $ResultFile"
        $LogLines += "[$Timestamp] ResultValidation: FAIL (empty file)"
        [System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)
        Write-Error "[FAIL] Empty result file. Remove or populate before re-running."
        exit 1
    }

    $ResultRequiredSections = @("FILES CHANGED", "ROOT CAUSE", "EXACT DIFF", "VALIDATION")
    $ResultMissing = @()
    foreach ($Section in $ResultRequiredSections) {
        if ($ResultContent -notmatch [regex]::Escape($Section)) {
            $ResultMissing += $Section
        }
    }

    if ($ResultMissing.Count -gt 0) {
        Write-Host "[FAIL] Result contract incomplete. Missing sections:"
        foreach ($Missing in $ResultMissing) {
            Write-Host "  - $Missing"
        }
        $LogLines += "[$Timestamp] ResultValidation: FAIL (missing $($ResultMissing -join ', '))"
        [System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)
        Write-Error "[FAIL] Result file does not meet contract. Fix before proceeding."
        exit 1
    }

    Write-Host "[PASS] Result file validated."
    Write-Host "[INFO] Review existing result before re-running."
}
else {
    # --- executor bridge dispatch ---
    $BridgeScript = Join-Path "C:\work\nox\orchestration\scripts" "executor-bridge.ps1"

    if (-not (Test-Path $BridgeScript)) {
        Write-Host "[WARN] executor-bridge.ps1 not found. Falling back to manual mode."
        Write-Host ""
        Write-Host "[NEXT ACTION]"
        Write-Host "1. Open the task file."
        Write-Host "2. Send it to the assigned executor."
        Write-Host "3. Save the result to:"
        Write-Host "   $ResultFile"
        Write-Host ""
        Write-Host "[TEMPLATES]"
        Write-Host "Task template  : $TaskTemplate"
        Write-Host "Result template: $ResultTemplate"
    }
    else {
        Write-Host "[BRIDGE] Dispatching to executor-bridge.ps1 (mode: $BridgeMode)"
        Write-Host ""

        try {
            & $BridgeScript -TaskFile $TaskFile -ResultFile $ResultFile -Mode $BridgeMode
        }
        catch {
            Write-Host "[FAIL] executor-bridge.ps1 failed: $_"
            $LogLines += "[$Timestamp] BridgeResult: FAIL ($_)"
            [System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)

            Write-Host ""
            Write-Host "[FALLBACK] Manual mode instructions:"
            Write-Host "1. Open the task file."
            Write-Host "2. Send it to the assigned executor."
            Write-Host "3. Save the result to:"
            Write-Host "   $ResultFile"
            Write-Host ""
            Write-Host "[TEMPLATES]"
            Write-Host "Task template  : $TaskTemplate"
            Write-Host "Result template: $ResultTemplate"

            Write-Error "[FAIL] Bridge dispatch failed. Manual intervention required."
            exit 1
        }

        # verify result was saved by bridge
        if (Test-Path $ResultFile) {
            $SavedContent = Get-Content $ResultFile -Raw -Encoding UTF8
            if ([string]::IsNullOrWhiteSpace($SavedContent)) {
                Write-Host "[FAIL] Bridge produced empty result file."
                $LogLines += "[$Timestamp] BridgeResult: FAIL (empty result)"
                [System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)
                Write-Error "[FAIL] Empty result after bridge execution."
                exit 1
            }
            Write-Host "[PASS] Result auto-saved by executor bridge."
            $LogLines += "[$Timestamp] BridgeResult: PASS (mode: $BridgeMode)"
            [System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)
        }
        else {
            # manual mode exits 0 without creating result — this is expected
            $LogLines += "[$Timestamp] BridgeResult: MANUAL (awaiting result)"
            [System.IO.File]::WriteAllLines($LogFile, $LogLines, $Utf8NoBom)
        }
    }
}

Write-Host ""
Write-Host "[DONE] run-round.ps1 completed."
exit 0
