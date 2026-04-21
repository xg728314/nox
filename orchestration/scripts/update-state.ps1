param(
    [string]$CurrentPhase,
    [string]$CurrentStep,
    [string]$Status,
    [string]$NextPriority
)

$ErrorActionPreference = "Stop"

$StatePath = "C:\work\nox\orchestration\config\state.json"

# --- guard: file must exist ---
if (-not (Test-Path $StatePath)) {
    Write-Error "[FAIL] state.json not found: $StatePath"
    exit 1
}

# --- read and parse ---
try {
    $Raw = Get-Content $StatePath -Raw -Encoding UTF8
    $State = $Raw | ConvertFrom-Json
}
catch {
    Write-Error "[FAIL] state.json is not valid JSON: $_"
    exit 1
}

# --- update only provided parameters ---
$Updated = @()

if ($PSBoundParameters.ContainsKey('CurrentPhase')) {
    $State.current_phase = $CurrentPhase
    $Updated += "current_phase=$CurrentPhase"
}

if ($PSBoundParameters.ContainsKey('CurrentStep')) {
    $State.current_step = $CurrentStep
    $Updated += "current_step=$CurrentStep"
}

if ($PSBoundParameters.ContainsKey('Status')) {
    $State.status = $Status
    $Updated += "status=$Status"
}

if ($PSBoundParameters.ContainsKey('NextPriority')) {
    $State.next_priority = $NextPriority
    $Updated += "next_priority=$NextPriority"
}

if ($Updated.Count -eq 0) {
    Write-Host "[SKIP] No parameters provided. state.json unchanged."
    exit 0
}

# --- add updated_at timestamp (ISO 8601) ---
$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$State | Add-Member -MemberType NoteProperty -Name "updated_at" -Value $Timestamp -Force

# --- write back ---
try {
    $Json = $State | ConvertTo-Json -Depth 10
    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($StatePath, $Json, $Utf8NoBom)
}
catch {
    Write-Error "[FAIL] Could not write state.json: $_"
    exit 1
}

Write-Host "[OK] state.json updated at $Timestamp"
foreach ($Entry in $Updated) {
    Write-Host "  -> $Entry"
}
