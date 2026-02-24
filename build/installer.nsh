; Custom NSIS installer script for nirs4all Studio
; Handles closing the running app before install/uninstall

!macro customInit
  ; Kill any running instances before install
  nsExec::ExecToLog 'taskkill /f /im "nirs4all Studio.exe" /t'
  Sleep 1000
!macroend

!macro customUnInit
  ; Kill any running instances before uninstall
  nsExec::ExecToLog 'taskkill /f /im "nirs4all Studio.exe" /t'
  Sleep 1000
!macroend
