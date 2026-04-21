param(
    [string]$Message,
    [string]$Token,
    [string]$ChatId
)

$ErrorActionPreference = "Stop"

# --- fallback: load from local.secrets.json if Token or ChatId missing ---
$SecretsPath = "C:\work\nox\orchestration\config\local.secrets.json"

if ([string]::IsNullOrWhiteSpace($Token) -or [string]::IsNullOrWhiteSpace($ChatId)) {
    if (Test-Path $SecretsPath) {
        try {
            $Secrets = Get-Content $SecretsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        }
        catch {
            Write-Error "[FAIL] local.secrets.json is not valid JSON: $_"
            exit 1
        }

        if ([string]::IsNullOrWhiteSpace($Token) -and $Secrets.telegram.token) {
            $Token = $Secrets.telegram.token
        }
        if ([string]::IsNullOrWhiteSpace($ChatId) -and $Secrets.telegram.chat_id) {
            $ChatId = [string]$Secrets.telegram.chat_id
        }
    }
}

# --- guard: required values ---
if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Error "[FAIL] -Token is required and not found in local.secrets.json."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($ChatId)) {
    Write-Error "[FAIL] -ChatId is required and not found in local.secrets.json."
    exit 1
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    Write-Error "[FAIL] -Message is required."
    exit 1
}

# --- HTML escape (& must be first) ---
$Message = $Message.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;')

# --- truncate to Telegram limit ---
if ($Message.Length -gt 4000) {
    $Message = $Message.Substring(0, 3997) + "..."
}

# --- send via Telegram Bot API ---
$Uri = "https://api.telegram.org/bot$Token/sendMessage"

$Body = @{
    chat_id    = $ChatId
    text       = $Message
    parse_mode = "HTML"
}

try {
    $Response = Invoke-RestMethod -Uri $Uri -Method Post -Body $Body -ContentType "application/x-www-form-urlencoded; charset=utf-8" -TimeoutSec 10
}
catch {
    Write-Error "[FAIL] Telegram API call failed: $_"
    exit 1
}

if ($Response.ok -eq $true) {
    Write-Host "[OK] Message sent to chat $ChatId."
}
else {
    Write-Error "[FAIL] Telegram returned ok=false: $($Response | ConvertTo-Json -Depth 5)"
    exit 1
}
