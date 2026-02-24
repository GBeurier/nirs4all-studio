; Custom NSIS installer script for nirs4all Studio
; Handles closing the running app before install/uninstall
; and optional cleanup of app data on uninstall

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

!macro customUnInstall
  ; Check if a custom/external Python env was configured (lives outside app data)
  StrCpy $0 ""
  IfFileExists "$APPDATA\nirs4all Studio\env-settings.json" 0 +2
    StrCpy $0 "$\n$\nNote: Your external Python environment will NOT be affected."

  ; Ask the user if they want to remove all app data
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove all nirs4all Studio configuration and data?$\n$\n\
This includes settings, logs, and the managed Python environment.$\n\
Your workspaces and datasets will NOT be affected.$0" \
    IDYES removeData IDNO skipRemove

  removeData:
    ; Remove Electron userData (logs, env-settings, managed Python venv)
    ; Path: %APPDATA%\nirs4all Studio
    RMDir /r "$APPDATA\nirs4all Studio"

    ; Remove Python backend app data (update cache/backup/staging, venv settings, config snapshots)
    ; Path: %LOCALAPPDATA%\nirs4all
    RMDir /r "$LOCALAPPDATA\nirs4all"

    ; Remove global app config (app_settings.json, dataset_links.json)
    ; Path: %APPDATA%\nirs4all
    RMDir /r "$APPDATA\nirs4all"

  skipRemove:
!macroend
