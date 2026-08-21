# E2E helper: kill every process whose command line references devstate-e2e
# (my wrangler dev on 8801) WITHOUT touching the 8797 dev worker.
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*devstate-e2e*' } | ForEach-Object {
  Write-Output ("killing " + $_.ProcessId + " " + $_.Name)
  & taskkill /F /T /PID $_.ProcessId | Out-Null
}
