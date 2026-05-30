Write-Host "`n=== SCHEDULER STATUS ===" -ForegroundColor Cyan
$status = Invoke-RestMethod -Uri "http://localhost:3000/api/scheduler/status"
Write-Host "Running: $($status.isRunning)"
Write-Host "Phase:   $($status.currentPhase)"
Write-Host "Last run: $($status.lastRun)"

Write-Host "`n=== RECENT LOGS (last 40) ===" -ForegroundColor Cyan
$logs = Invoke-RestMethod -Uri "http://localhost:3000/api/logs?limit=40"
foreach ($log in $logs.logs) {
    $color = if ($log.level -eq "error") { "Red" } elseif ($log.level -eq "warn") { "Yellow" } else { "White" }
    Write-Host "[$($log.timestamp.Substring(11,8))] ($($log.platform)) $($log.message)" -ForegroundColor $color
}

Write-Host "`n=== APPLICATION SUMMARY ===" -ForegroundColor Cyan
$stats = Invoke-RestMethod -Uri "http://localhost:3000/api/stats/summary"
Write-Host "Total applied:   $($stats.totalApplied)"
Write-Host "Total failed:    $($stats.totalFailed)"
Write-Host "Total queued:    $($stats.totalQueued)"
Write-Host "Total skipped:   $($stats.totalSkipped)"

Write-Host "`n=== RECENT APPLICATIONS (today) ===" -ForegroundColor Cyan
$apps = Invoke-RestMethod -Uri "http://localhost:3000/api/applications?status=applied&limit=100"
$today = (Get-Date).ToString("yyyy-MM-dd")
$todayApps = $apps.applications | Where-Object { $_.appliedAt -like "$today*" }
Write-Host "Applied today: $($todayApps.Count)"
foreach ($app in $todayApps | Select-Object -Last 20) {
    Write-Host "  [$($app.appliedAt.Substring(11,8))] $($app.job.platform.PadRight(10)) $($app.job.company) — $($app.job.jobTitle)"
}

Write-Host "`n=== TRIGGERING EMAIL IMPORT (checking confirmations) ===" -ForegroundColor Cyan
$emailResult = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/email/import"
Write-Host "Imported new:    $($emailResult.imported)"
Write-Host "Status updates:  $($emailResult.updated)"
if ($emailResult.details.Count -gt 0) {
    Write-Host "Details:"
    foreach ($d in $emailResult.details) {
        Write-Host "  $($d.company): $($d.oldStatus) -> $($d.newStatus)"
    }
}

Write-Host "`nDone." -ForegroundColor Green
Read-Host "Press Enter to close"
