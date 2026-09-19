!include "LogicLib.nsh"

; Custom NSIS lifecycle for nirs4all Studio.
; An upgrade/reinstall must never ask about or remove user configuration.

; Older uninstallers ignore --updated and /KEEP_APP_DATA. Protect the whole
; user-data roots by same-volume rename before invoking them. This is constant
; time even with a large Python environment or workspaces under app data.
; Restore on success, failure and cancellation; interrupted installs retain
; named sibling backups that the next installer can restore.
!ifndef BUILD_UNINSTALLER

; 0.11.7's uninstaller displays a blocking MessageBox even with /S and
; --updated. Replace only that registered version with this build's corrected
; uninstaller before electron-builder calls it. Keep registry and normal
; uninstall sequencing intact; preserve the original executable on failure.
!ifdef UNINSTALLER_OUT_FILE
Var studioPatchedMachineUninstaller
Var studioPatchedUserUninstaller

!macro studioRepairKnownUninstaller ROOT TRACK LABEL
  ReadRegStr $R8 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  StrCmp $R8 "0.11.7" 0 ${LABEL}_done
  ReadRegStr $R9 ${ROOT} "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $R9 "" ${LABEL}_invalid
  GetFullPathName $R9 "$R9"
  StrCpy $R7 "$R9\${UNINSTALL_FILENAME}"
  ReadRegStr $R6 ${ROOT} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  StrCmp $R6 '$\"$R7$\" /allusers' ${LABEL}_identified
  StrCmp $R6 '$\"$R7$\" /currentuser' ${LABEL}_identified
  StrCmp $R6 '$\"$R7$\"' ${LABEL}_identified ${LABEL}_invalid
  ${LABEL}_identified:
  IfFileExists "$R9\${APP_EXECUTABLE_FILENAME}" 0 ${LABEL}_invalid
  IfFileExists "$R7" 0 ${LABEL}_invalid
  ; Never overwrite an earlier recovery backup.
  IfFileExists "$R7.recovery-0.11.7" ${LABEL}_invalid
  ClearErrors
  Rename "$R7" "$R7.recovery-0.11.7"
  IfErrors ${LABEL}_invalid
  StrCpy ${TRACK} "$R7"
  ClearErrors
  CopyFiles /SILENT "$PLUGINSDIR\studio-upgrade-uninstaller.exe" "$R7"
  IfErrors ${LABEL}_invalid
  DetailPrint "Repaired the known 0.11.7 uninstaller for a silent, data-preserving upgrade."
  Goto ${LABEL}_done
  ${LABEL}_invalid:
    Call studioRestoreKnownUninstallers
    MessageBox MB_OK|MB_ICONSTOP "Could not safely prepare the existing Studio 0.11.7 uninstaller. Installation stopped; the previous application and its data have been kept." /SD IDOK
    Abort
  ${LABEL}_done:
!macroend

!macro studioRestoreKnownUninstaller TRACK
  StrCmp ${TRACK} "" +5
  IfFileExists "${TRACK}.recovery-0.11.7" 0 +4
  Delete "${TRACK}"
  Rename "${TRACK}.recovery-0.11.7" "${TRACK}"
  StrCpy ${TRACK} ""
!macroend

Function studioRestoreKnownUninstallers
  !insertmacro studioRestoreKnownUninstaller $studioPatchedMachineUninstaller
  !insertmacro studioRestoreKnownUninstaller $studioPatchedUserUninstaller
FunctionEnd

Function studioPrepareKnownUninstallers
  InitPluginsDir
  File /oname=$PLUGINSDIR\studio-upgrade-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
  !insertmacro studioRepairKnownUninstaller HKLM $studioPatchedMachineUninstaller repair_machine
  !insertmacro studioRepairKnownUninstaller HKCU $studioPatchedUserUninstaller repair_user
FunctionEnd
!endif
!macro studioPreserveRoot ROOT BACKUP LABEL
  IfFileExists "${BACKUP}\." 0 ${LABEL}_preserve
  IfFileExists "${ROOT}\." 0 ${LABEL}_done
    MessageBox MB_OK|MB_ICONSTOP "An earlier installation left preserved data at ${BACKUP}. Both folders have been kept. Restore that folder before retrying." /SD IDOK
    Abort
  ${LABEL}_preserve:
  IfFileExists "${ROOT}\." 0 ${LABEL}_done
  ClearErrors
  Rename "${ROOT}" "${BACKUP}"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Could not preserve ${ROOT}. Close applications using this folder and retry. Installation has stopped without deleting your data." /SD IDOK
    Abort
  ${EndIf}
  ${LABEL}_done:
!macroend

!macro studioRestoreRoot ROOT BACKUP LABEL
  IfFileExists "${BACKUP}\." 0 ${LABEL}_done
  IfFileExists "${ROOT}\." 0 ${LABEL}_restore
    MessageBox MB_OK|MB_ICONSTOP "Your preserved data is safe at ${BACKUP}. The destination ${ROOT} was recreated during installation; restore your data before opening Studio." /SD IDOK
    Abort
  ${LABEL}_restore:
  ClearErrors
  Rename "${BACKUP}" "${ROOT}"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Could not restore ${ROOT}. Your data is preserved at ${BACKUP}. Restore it before opening Studio." /SD IDOK
    Abort
  ${EndIf}
  ${LABEL}_done:
!macroend

Function studioRestorePreservedData
  SetShellVarContext current
  !insertmacro studioRestoreRoot "$APPDATA\nirs4all" "$APPDATA\nirs4all-upgrade-preserved-config" restore_config
  !insertmacro studioRestoreRoot "$LOCALAPPDATA\nirs4all" "$LOCALAPPDATA\nirs4all-upgrade-preserved-data" restore_data
  !insertmacro studioRestoreRoot "$APPDATA\nirs4all Studio" "$APPDATA\nirs4all-upgrade-preserved-electron" restore_electron
  ; Both installer configurations are per-machine. This include precedes
  ; electron-builder's declaration of $installMode.
  SetShellVarContext all
FunctionEnd

Section "-Preserve Studio user data"
  !ifdef UNINSTALLER_OUT_FILE
    Call studioPrepareKnownUninstallers
  !endif
  SetShellVarContext current
  !insertmacro studioPreserveRoot "$APPDATA\nirs4all" "$APPDATA\nirs4all-upgrade-preserved-config" preserve_config
  !insertmacro studioPreserveRoot "$LOCALAPPDATA\nirs4all" "$LOCALAPPDATA\nirs4all-upgrade-preserved-data" preserve_data
  !insertmacro studioPreserveRoot "$APPDATA\nirs4all Studio" "$APPDATA\nirs4all-upgrade-preserved-electron" preserve_electron
  ; Both installer configurations are per-machine. This include precedes
  ; electron-builder's declaration of $installMode.
  SetShellVarContext all
SectionEnd

!macro customInstall
  !ifdef UNINSTALLER_OUT_FILE
    StrCpy $studioPatchedMachineUninstaller ""
    StrCpy $studioPatchedUserUninstaller ""
  !endif
  Call studioRestorePreservedData
!macroend

Function .onInstFailed
  !ifdef UNINSTALLER_OUT_FILE
    Call studioRestoreKnownUninstallers
  !endif
  Call studioRestorePreservedData
FunctionEnd

Function .onGUIEnd
  !ifdef UNINSTALLER_OUT_FILE
    Call studioRestoreKnownUninstallers
  !endif
  Call studioRestorePreservedData
FunctionEnd
!endif

!macro customInit
  nsExec::ExecToLog 'taskkill /f /im "nirs4all Studio.exe" /t'
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /f /im "nirs4all Studio.exe" /t'
!macroend

!macro customUnInstall
  ; electron-builder invokes the old uninstaller with --updated /KEEP_APP_DATA.
  ; Silent removal also preserves data: no unattended affirmative defaults.
  ${If} ${isUpdated}
    Goto studioCleanupDone
  ${EndIf}
  ${If} ${Silent}
    Goto studioCleanupDone
  ${EndIf}

  SetShellVarContext current
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Remove application preferences and cache?$\n$\nWorkspaces, datasets and the Python environment will be kept." \
    /SD IDNO IDNO studioKeepPreferences

  ; Delete only known preferences/cache. User workspaces may be inside any of
  ; these roots, so never remove an entire application-data directory.
  Delete "$APPDATA\nirs4all\app_settings.json"
  Delete "$APPDATA\nirs4all\dataset_links.json"
  Delete "$APPDATA\nirs4all\setup_status.json"
  Delete "$LOCALAPPDATA\nirs4all\nirs4all-webapp\setup_status.json"
  Delete "$APPDATA\nirs4all Studio\env-settings.json"
  Delete "$APPDATA\nirs4all Studio\telemetry-consent.json"
  RMDir /r "$APPDATA\nirs4all Studio\Cache"
  RMDir /r "$APPDATA\nirs4all Studio\Code Cache"
  RMDir /r "$APPDATA\nirs4all Studio\GPUCache"
  RMDir /r "$APPDATA\nirs4all Studio\logs"
  RMDir /r "$LOCALAPPDATA\nirs4all\updates"

  studioKeepPreferences:
  IfFileExists "$APPDATA\nirs4all Studio\python-env\*.*" 0 studioKeepEnvironment
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Remove the managed Python environment?$\n$\nIt will need to be installed again. External Python environments will be kept." \
    /SD IDNO IDNO studioKeepEnvironment
  RMDir /r "$APPDATA\nirs4all Studio\python-env"

  studioKeepEnvironment:
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  studioCleanupDone:
!macroend
