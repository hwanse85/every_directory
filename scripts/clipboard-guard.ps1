# E2E 동안 원래 클립보드를 메모리에만 보관한다. 백업 불가능한 형식이면 테스트 전에 중단한다.
$ErrorActionPreference = 'Stop'
$count = 0
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $saved = New-Object System.Windows.Forms.DataObject
  $original = $null
  for ($attempt = 0; $attempt -lt 8; $attempt++) {
    try { $original = [System.Windows.Forms.Clipboard]::GetDataObject(); break }
    catch { if ($attempt -eq 7) { throw }; Start-Sleep -Milliseconds 100 }
  }
  if ($null -ne $original) {
    foreach ($format in $original.GetFormats($false)) {
      $data = $original.GetData($format, $false)
      if ($null -eq $data -or [Runtime.InteropServices.Marshal]::IsComObject($data)) { throw 'Cannot preserve clipboard format' }
      if ($data -is [IO.MemoryStream]) { $data = New-Object IO.MemoryStream(,$data.ToArray()) }
      elseif ($data -is [Drawing.Image]) { $data = $data.Clone() }
      elseif ($data -is [ICloneable]) { $data = $data.Clone() }
      $saved.SetData($format, $false, $data)
      $count++
    }
  }
} catch { [Console]::WriteLine('ED_CLIPBOARD_SKIP'); exit 2 }
[Console]::WriteLine('ED_CLIPBOARD_READY')
[Console]::In.ReadLine() | Out-Null
if ($count -eq 0) { [System.Windows.Forms.Clipboard]::Clear() }
else { [System.Windows.Forms.Clipboard]::SetDataObject($saved, $true) }
[Console]::WriteLine('ED_CLIPBOARD_RESTORED')
