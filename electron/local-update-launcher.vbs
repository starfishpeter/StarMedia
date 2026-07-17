If WScript.Arguments.Count <> 3 Then WScript.Quit 1

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Dim command
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(WScript.Arguments(0)) & " -PlanPath " & Quote(WScript.Arguments(1)) & " -StatusPath " & Quote(WScript.Arguments(2))
CreateObject("WScript.Shell").Run command, 0, False
