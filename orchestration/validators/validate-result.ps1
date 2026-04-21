param(
    [Parameter(Mandatory=$true)]
    [string]$TaskFile,

    [Parameter(Mandatory=$true)]
    [string]$ResultFile
)

$ErrorActionPreference = "Stop"

# --- REJECT guards ---
if (-not (Test-Path $TaskFile)) {
    Write-Host "REJECT: TaskFile not found: $TaskFile"
    exit 2
}

if (-not (Test-Path $ResultFile)) {
    Write-Host "REJECT: ResultFile not found: $ResultFile"
    exit 2
}

$GitRoot = "C:\work\nox"

try {
    $GitCheck = git -C $GitRoot rev-parse --is-inside-work-tree 2>&1
    if ($GitCheck -ne "true") {
        Write-Host "REJECT: $GitRoot is not a git repository"
        exit 2
    }
}
catch {
    Write-Host "REJECT: git command failed: $_"
    exit 2
}

# --- parse task file sections ---
$TaskContent = Get-Content $TaskFile -Raw -Encoding UTF8

function Parse-Section {
    param([string]$Content, [string]$SectionName)

    $Pattern = "(?mi)^\[" + [regex]::Escape($SectionName) + "\]\s*\r?\n([\s\S]*?)(?=\r?\n\[|\z)"
    $Match = [regex]::Match($Content, $Pattern)

    if (-not $Match.Success) { return @() }

    $Lines = $Match.Groups[1].Value -split "\r?\n" |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -ne "" -and $_ -ne "-" }

    $Paths = @()
    foreach ($Line in $Lines) {
        $Cleaned = $Line -replace "^[-\*]\s*", ""
        $Cleaned = $Cleaned.Trim()
        if ($Cleaned -ne "") {
            $Paths += $Cleaned
        }
    }
    return $Paths
}

$AllowedFiles = Parse-Section -Content $TaskContent -SectionName "ALLOWED_FILES"
$ForbiddenFiles = Parse-Section -Content $TaskContent -SectionName "FORBIDDEN_FILES"

if ($AllowedFiles.Count -eq 0) {
    Write-Host "REJECT: ALLOWED_FILES section is empty or not found in task"
    exit 2
}

if ($ForbiddenFiles.Count -eq 0) {
    Write-Host "REJECT: FORBIDDEN_FILES section is empty or not found in task"
    exit 2
}

# --- detect single-file task ---
$TargetFiles = Parse-Section -Content $TaskContent -SectionName "TARGET FILE"
if ($TargetFiles.Count -eq 0) {
    $TargetFiles = Parse-Section -Content $TaskContent -SectionName "TARGET FILES"
}
$IsSingleFileTask = ($TargetFiles.Count -eq 1)

# --- git diff: collect changed files ---
$OldErrorPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    $DiffRaw = git -C $GitRoot diff HEAD --name-only 2>&1 | Where-Object { $_ -notmatch "^warning:" }
    $StagedRaw = git -C $GitRoot diff --cached --name-only 2>&1 | Where-Object { $_ -notmatch "^warning:" }
    $UntrackedRaw = git -C $GitRoot ls-files --others --exclude-standard 2>&1 | Where-Object { $_ -notmatch "^warning:" }

    if ($LASTEXITCODE -ne 0) {
        Write-Host "REJECT: git command returned exit code $LASTEXITCODE"
        exit 2
    }
}
catch {
    Write-Host "REJECT: git diff failed: $_"
    exit 2
}
finally {
    $ErrorActionPreference = $OldErrorPref
}

function Normalize-GitPaths {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { return @() }
    $Lines = $Raw -split "\r?\n" | Where-Object { $_.Trim() -ne "" }
    $Normalized = @()
    foreach ($Line in $Lines) {
        $Full = Join-Path $GitRoot ($Line.Trim() -replace "/", "\")
        $Normalized += $Full
    }
    return $Normalized
}

# Orchestration output paths — always excluded from validation
$ExcludedPrefixes = @(
    "C:\work\nox\orchestration\results\",
    "C:\work\nox\orchestration\logs\",
    "C:\work\nox\orchestration\staging\"
)

$AllChangedFiles = @()
$AllChangedFiles += Normalize-GitPaths $DiffRaw
$AllChangedFiles += Normalize-GitPaths $StagedRaw
$AllChangedFiles += Normalize-GitPaths $UntrackedRaw
$AllChangedFiles = $AllChangedFiles | Select-Object -Unique

# Filter out orchestration output files
$ChangedFiles = @()
foreach ($File in $AllChangedFiles) {
    $Excluded = $false
    foreach ($Prefix in $ExcludedPrefixes) {
        if ($File.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $Excluded = $true
            break
        }
    }
    if (-not $Excluded) {
        $ChangedFiles += $File
    }
}

if ($AllChangedFiles.Count -ne $ChangedFiles.Count) {
    $ExcludedCount = $AllChangedFiles.Count - $ChangedFiles.Count
    Write-Host "[INFO] Excluded $ExcludedCount orchestration output file(s) from validation."
}

if ($ChangedFiles.Count -eq 0) {
    Write-Host "[INFO] No changed files detected by git diff."
    Write-Host "PASS"
    exit 0
}

Write-Host ""
Write-Host "=== NOX RESULT VALIDATOR ==="
Write-Host "TaskFile   : $TaskFile"
Write-Host "ResultFile : $ResultFile"
Write-Host "ChangedFiles: $($ChangedFiles.Count)"
Write-Host ""

# --- wildcard match helper ---
function Test-PathMatchesPattern {
    param([string]$FilePath, [string]$Pattern)

    $NormFile = $FilePath.Replace("/", "\").TrimEnd("\")
    $NormPattern = $Pattern.Replace("/", "\").TrimEnd("\")

    # exact match
    if ($NormFile -eq $NormPattern) { return $true }

    # wildcard: pattern ends with \* (e.g. C:\work\nox\app\*)
    if ($NormPattern.EndsWith("\*")) {
        $Prefix = $NormPattern.Substring(0, $NormPattern.Length - 1)
        if ($NormFile.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    # wildcard: pattern ends with * without backslash
    if ($NormPattern.EndsWith("*") -and -not $NormPattern.EndsWith("\*")) {
        $Prefix = $NormPattern.Substring(0, $NormPattern.Length - 1)
        if ($NormFile.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    return $false
}

$Failures = @()

# --- CHECK 1: FORBIDDEN_FILES ---
Write-Host "[CHECK 1] FORBIDDEN_FILES violation"
$ForbiddenViolations = @()
foreach ($File in $ChangedFiles) {
    foreach ($Pattern in $ForbiddenFiles) {
        if (Test-PathMatchesPattern -FilePath $File -Pattern $Pattern) {
            $ForbiddenViolations += "$File (matched: $Pattern)"
        }
    }
}

if ($ForbiddenViolations.Count -gt 0) {
    Write-Host "  FAIL: Forbidden file(s) modified:"
    foreach ($V in $ForbiddenViolations) {
        Write-Host "    - $V"
    }
    $Failures += "FORBIDDEN_FILES violation"
}
else {
    Write-Host "  PASS"
}

# --- CHECK 2: ALLOWED_FILES scope ---
Write-Host "[CHECK 2] ALLOWED_FILES scope"
$ScopeViolations = @()
foreach ($File in $ChangedFiles) {
    $Matched = $false
    foreach ($Pattern in $AllowedFiles) {
        if (Test-PathMatchesPattern -FilePath $File -Pattern $Pattern) {
            $Matched = $true
            break
        }
    }
    if (-not $Matched) {
        $ScopeViolations += $File
    }
}

if ($ScopeViolations.Count -gt 0) {
    Write-Host "  FAIL: File(s) outside ALLOWED_FILES:"
    foreach ($V in $ScopeViolations) {
        Write-Host "    - $V"
    }
    $Failures += "ALLOWED_FILES scope violation"
}
else {
    Write-Host "  PASS"
}

# --- CHECK 3: single-file task multi-file change ---
Write-Host "[CHECK 3] Single-file task multi-file check"
if ($IsSingleFileTask -and $ChangedFiles.Count -gt 1) {
    Write-Host "  FAIL: Single-file task but $($ChangedFiles.Count) files changed:"
    foreach ($F in $ChangedFiles) {
        Write-Host "    - $F"
    }
    $Failures += "Single-file task multi-file violation"
}
else {
    if ($IsSingleFileTask) {
        Write-Host "  PASS (single-file task, $($ChangedFiles.Count) file changed)"
    }
    else {
        Write-Host "  PASS (multi-file task, $($ChangedFiles.Count) files changed)"
    }
}

# --- CHECK 4: config/ path modification ---
Write-Host "[CHECK 4] Config path modification"
$ConfigPattern = "C:\work\nox\orchestration\config\*"
$ConfigViolations = @()
foreach ($File in $ChangedFiles) {
    if (Test-PathMatchesPattern -FilePath $File -Pattern $ConfigPattern) {
        # check if config modification is explicitly allowed
        $ConfigAllowed = $false
        foreach ($Pattern in $AllowedFiles) {
            if (Test-PathMatchesPattern -FilePath $File -Pattern $Pattern) {
                $ConfigAllowed = $true
                break
            }
        }
        if (-not $ConfigAllowed) {
            $ConfigViolations += $File
        }
    }
}

if ($ConfigViolations.Count -gt 0) {
    Write-Host "  FAIL: Config file(s) modified without explicit allowance:"
    foreach ($V in $ConfigViolations) {
        Write-Host "    - $V"
    }
    $Failures += "Config modification violation"
}
else {
    Write-Host "  PASS"
}

# --- FINAL VERDICT ---
Write-Host ""
if ($Failures.Count -gt 0) {
    Write-Host "FAIL: $($Failures.Count) violation(s) detected:"
    foreach ($F in $Failures) {
        Write-Host "  - $F"
    }
    exit 1
}
else {
    Write-Host "PASS"
    exit 0
}
