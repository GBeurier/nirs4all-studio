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
  ; electron-builder sets SetShellVarContext=all for per-machine installs, which
  ; makes $APPDATA resolve to C:\ProgramData instead of the user's AppData.
  ; Switch to current-user context so we target the correct directories.
  SetShellVarContext current

  ; Pre-check: note about external Python environment (before any deletion)
  StrCpy $0 ""
  IfFileExists "$APPDATA\nirs4all Studio\env-settings.json" 0 +2
    StrCpy $0 "$\n$\nNote: Your external Python environment (if configured) will NOT be affected."

  ; ---- Question 1: Application settings & cache ----
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove application settings and cache?$\n$\n\
This includes preferences, logs, dataset links, and backend cache.$\n\
Your workspaces (models, predictions, databases) and dataset files are NOT affected." \
    IDYES removeData IDNO skipData

  removeData:
    ; Remove global app config (app_settings.json, dataset_links.json)
    RMDir /r "$APPDATA\nirs4all"

    ; Remove Python backend app data (update cache/backup/staging, venv settings, config snapshots)
    RMDir /r "$LOCALAPPDATA\nirs4all"

    ; Remove Electron userData but preserve python-env if it exists
    RMDir /r "$TEMP\nirs4all-python-env-tmp"
    IfFileExists "$APPDATA\nirs4all Studio\python-env\*.*" 0 removeAllUserData
      ; python-env exists — move it aside, nuke the rest, move it back
      Rename "$APPDATA\nirs4all Studio\python-env" "$TEMP\nirs4all-python-env-tmp"
      RMDir /r "$APPDATA\nirs4all Studio"
      CreateDirectory "$APPDATA\nirs4all Studio"
      Rename "$TEMP\nirs4all-python-env-tmp" "$APPDATA\nirs4all Studio\python-env"
      Goto skipData
    removeAllUserData:
      ; No python-env to preserve — remove the whole directory
      RMDir /r "$APPDATA\nirs4all Studio"

  skipData:

  ; ---- Question 2: Python environment ----
  ; Only ask if a managed python-env actually exists
  IfFileExists "$APPDATA\nirs4all Studio\python-env\*.*" 0 skipEnv

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Do you want to remove the managed Python environment?$\n$\n\
This frees approximately 1-2 GB of disk space.$\n\
It will be re-downloaded automatically if you reinstall.$0" \
    IDYES removeEnv IDNO skipEnv

  removeEnv:
    RMDir /r "$APPDATA\nirs4all Studio\python-env"

  skipEnv:
  ; Clean up parent directory if it's now empty
  RMDir "$APPDATA\nirs4all Studio"

  ; Restore all-users context for any remaining electron-builder uninstall steps
  SetShellVarContext all
!macroend
