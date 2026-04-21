$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$token = $args[0]
$sid = $args[1]

$headers = @{
    Authorization  = "Bearer $token"
    "Content-Type" = "application/json"
}

function ApiPost($url, $bodyObj) {
    $json = $bodyObj | ConvertTo-Json -Compress
    $utf8 = [System.Text.Encoding]::UTF8.GetBytes($json)
    try {
        $r = Invoke-WebRequest -Uri $url -Method POST -Headers $headers -Body $utf8 -UseBasicParsing
        return [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    } catch {
        $err = $_.Exception.Response
        if ($err) {
            $reader = New-Object System.IO.StreamReader($err.GetResponseStream(), [System.Text.Encoding]::UTF8)
            return $reader.ReadToEnd()
        }
        return $_.Exception.Message
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host "  [2/6] POST /api/sessions/participants"
Write-Host "========================================"
$body2 = @{
    session_id    = $sid
    membership_id = "2d139a29-2dfb-4e4c-a567-0448a17811e5"
    role          = "hostess"
    category      = "퍼블릭"
    time_minutes  = 90
}
$r2 = ApiPost "http://localhost:3001/api/sessions/participants" $body2
Write-Host $r2

Write-Host ""
Write-Host "========================================"
Write-Host "  [3/6] POST /api/sessions/orders"
Write-Host "========================================"
$body3 = @{
    session_id = $sid
    item_name  = "양주"
    order_type = "beverage"
    qty        = 1
    unit_price = 50000
}
$r3 = ApiPost "http://localhost:3001/api/sessions/orders" $body3
Write-Host $r3

Write-Host ""
Write-Host "========================================"
Write-Host "  [4/6] POST /api/sessions/checkout"
Write-Host "========================================"
$body4 = @{ session_id = $sid }
$r4 = ApiPost "http://localhost:3001/api/sessions/checkout" $body4
Write-Host $r4

Write-Host ""
Write-Host "========================================"
Write-Host "  [5/6] POST /api/sessions/settlement"
Write-Host "========================================"
$body5 = @{ session_id = $sid }
$r5 = ApiPost "http://localhost:3001/api/sessions/settlement" $body5
Write-Host $r5

Write-Host ""
Write-Host "========================================"
Write-Host "  [6/6] POST /api/sessions/receipt"
Write-Host "========================================"
$body6 = @{ session_id = $sid }
$r6 = ApiPost "http://localhost:3001/api/sessions/receipt" $body6
Write-Host $r6

Write-Host ""
Write-Host "========================================"
Write-Host "  E2E TEST COMPLETE"
Write-Host "========================================"
