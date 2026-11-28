$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$picker = New-Object System.Windows.Forms.OpenFileDialog
$owner = New-Object System.Windows.Forms.Form
try {
    $picker.Title = $env:ROPPO_PICKER_TITLE
    $picker.InitialDirectory = $env:ROPPO_PICKER_DIRECTORY
    $picker.Multiselect = $true
    $picker.CheckFileExists = $true
    $picker.RestoreDirectory = $true
    $owner.TopMost = $true
    if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        ConvertTo-Json -InputObject @($picker.FileNames) -Compress
    } else {
        '[]'
    }
} finally {
    $picker.Dispose()
    $owner.Dispose()
}
