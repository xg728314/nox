param(
    [Parameter(Mandatory=$true)]
    [string]$TaskFile,

    [Parameter(Mandatory=$true)]
    [string]$ResultFile,

    [string]$Mode = "manual"
)

$ErrorActionPreference = "Stop"

# --- validate inputs ---
if (-not (Test-Path $TaskFile)) {
    Write-Error "[FAIL] Task file not found: $TaskFile"
    exit 1
}

if (Test-Path $ResultFile) {
    Write-Error "[FAIL] Result file already exists: $ResultFile. Remove or rename before re-running."
    exit 1
}

$ResultDir = [System.IO.Path]::GetDirectoryName($ResultFile)
if (-not (Test-Path $ResultDir)) {
    New-Item -ItemType Directory -Path $ResultDir -Force | Out-Null
}

$TaskContent = Get-Content $TaskFile -Raw -Encoding UTF8

if ([string]::IsNullOrWhiteSpace($TaskContent)) {
    Write-Error "[FAIL] Task file is empty: $TaskFile"
    exit 1
}

$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Write-Host ""
Write-Host "=== NOX EXECUTOR BRIDGE ==="
Write-Host "[$Timestamp] Mode     : $Mode"
Write-Host "[$Timestamp] TaskFile : $TaskFile"
Write-Host "[$Timestamp] ResultFile: $ResultFile"
Write-Host ""

# --- mode dispatch ---
switch ($Mode) {
    "manual" {
        Write-Host "[MODE: MANUAL]"
        Write-Host "Executor bridge is in manual mode."
        Write-Host "1. Open the task file and send to executor."
        Write-Host "2. Copy the executor result."
        Write-Host "3. Save it to: $ResultFile"
        Write-Host ""
        Write-Host "[WAITING] Manual result required. Bridge will not auto-generate."
        exit 0
    }

    "clipboard" {
        Write-Host "[MODE: CLIPBOARD]"
        Write-Host "Reading result from clipboard..."

        try {
            Add-Type -AssemblyName System.Windows.Forms
            $ClipText = [System.Windows.Forms.Clipboard]::GetText()
        }
        catch {
            Write-Error "[FAIL] Clipboard read failed: $_"
            exit 1
        }

        if ([string]::IsNullOrWhiteSpace($ClipText)) {
            Write-Error "[FAIL] Clipboard is empty. Copy executor result to clipboard before running."
            exit 1
        }

        # validate result contract
        $ResultRequiredSections = @("FILES CHANGED", "ROOT CAUSE", "EXACT DIFF", "VALIDATION")
        $Missing = @()
        foreach ($Section in $ResultRequiredSections) {
            if ($ClipText -notmatch [regex]::Escape($Section)) {
                $Missing += $Section
            }
        }

        if ($Missing.Count -gt 0) {
            Write-Host "[FAIL] Clipboard result missing required sections:"
            foreach ($M in $Missing) {
                Write-Host "  - $M"
            }
            Write-Error "[FAIL] Result contract not met. Fix executor output and retry."
            exit 1
        }

        # save result
        $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($ResultFile, $ClipText, $Utf8NoBom)

        Write-Host "[PASS] Result saved from clipboard."
        Write-Host "ResultFile: $ResultFile"
        exit 0
    }

    "file" {
        Write-Host "[MODE: FILE]"
        Write-Host "Looking for pre-written result file..."

        # In file mode, check if a temp result exists at a known staging path
        $StagingDir = "C:\work\nox\orchestration\staging"
        $BaseName = [System.IO.Path]::GetFileNameWithoutExtension($ResultFile)
        $StagingFile = Join-Path $StagingDir ($BaseName + ".md")

        if (-not (Test-Path $StagingFile)) {
            Write-Host "[FAIL] No staged result found at: $StagingFile"
            Write-Host "Place executor result at the staging path, then re-run."
            Write-Error "[FAIL] Staged result file not found."
            exit 1
        }

        $StagedContent = Get-Content $StagingFile -Raw -Encoding UTF8

        if ([string]::IsNullOrWhiteSpace($StagedContent)) {
            Write-Error "[FAIL] Staged result file is empty: $StagingFile"
            exit 1
        }

        # validate result contract
        $ResultRequiredSections = @("FILES CHANGED", "ROOT CAUSE", "EXACT DIFF", "VALIDATION")
        $Missing = @()
        foreach ($Section in $ResultRequiredSections) {
            if ($StagedContent -notmatch [regex]::Escape($Section)) {
                $Missing += $Section
            }
        }

        if ($Missing.Count -gt 0) {
            Write-Host "[FAIL] Staged result missing required sections:"
            foreach ($M in $Missing) {
                Write-Host "  - $M"
            }
            Write-Error "[FAIL] Result contract not met. Fix staged file and retry."
            exit 1
        }

        # save result
        $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($ResultFile, $StagedContent, $Utf8NoBom)

        Write-Host "[PASS] Result saved from staging file."
        Write-Host "Source : $StagingFile"
        Write-Host "Target : $ResultFile"
        exit 0
    }

    default {
        Write-Error "[FAIL] Unknown mode: $Mode. Valid modes: manual, clipboard, file"
        exit 1
    }
}
