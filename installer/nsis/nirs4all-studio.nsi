; NSIS Installer Script for nirs4all-studio
;
; This script creates a Windows installer with:
; - License agreement screen
; - Installation directory selection
; - Start Menu shortcuts
; - Desktop shortcut (optional)
; - Add/Remove Programs entry
; - Uninstaller
;
; Build with: makensis nirs4all-studio.nsi
; Requires: NSIS 3.x

;--------------------------------
; Includes

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

;--------------------------------
; General Configuration

; Name and output file
Name "nirs4all Studio"
OutFile "..\..\..\release\nirs4all-studio-${VERSION}-windows-x64-setup.exe"
Unicode True

; Default installation directory
InstallDir "$PROGRAMFILES64\nirs4all-studio"
InstallDirRegKey HKLM "Software\nirs4all-studio" "InstallDir"

; Request admin privileges
RequestExecutionLevel admin

Var DebugLogsCheckbox
Var DebugLogsConsent

; Version info
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "nirs4all Studio"
VIAddVersionKey "CompanyName" "nirs4all"
VIAddVersionKey "LegalCopyright" "CeCILL-2.1"
VIAddVersionKey "FileDescription" "nirs4all Desktop Application Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

;--------------------------------
; Interface Settings

!define MUI_ABORTWARNING
!define MUI_ICON "..\..\public\icon.ico"
!define MUI_UNICON "..\..\public\icon.ico"

; Header image
;!define MUI_HEADERIMAGE
;!define MUI_HEADERIMAGE_BITMAP "header.bmp"

; Welcome page
!define MUI_WELCOMEFINISHPAGE_BITMAP_NOSTRETCH
!define MUI_WELCOMEPAGE_TITLE "Welcome to nirs4all Studio Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of nirs4all Studio.$\r$\n$\r$\nnirs4all Studio is a desktop application for Near-Infrared Spectroscopy (NIRS) data analysis with machine learning pipelines.$\r$\n$\r$\nClick Next to continue."

; Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\nirs4all-studio.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch nirs4all Studio"
!define MUI_FINISHPAGE_LINK "Visit nirs4all on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/delete/nirs4all"

;--------------------------------
; Pages

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
Page custom DiagnosticsConsentPageCreate DiagnosticsConsentPageLeave
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

;--------------------------------
; Languages

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "Spanish"

;--------------------------------
; Installer Sections

Section "nirs4all Studio (required)" SecMain
    SectionIn RO  ; Read-only, always installed

    ; Set output path to the installation directory
    SetOutPath "$INSTDIR"

    ; Install main files (from PyInstaller dist)
    File /r "..\..\dist\nirs4all-studio\*.*"

    ; Store installation folder
    WriteRegStr HKLM "Software\nirs4all-studio" "InstallDir" "$INSTDIR"
    WriteRegStr HKLM "Software\nirs4all-studio" "Version" "${VERSION}"

    ; Persist install-time consent as a marker. The app promotes it to app_settings.json on first launch.
    ${If} $DebugLogsConsent == ${BST_CHECKED}
        SetShellVarContext current
        CreateDirectory "$APPDATA\nirs4all"
        FileOpen $0 "$APPDATA\nirs4all\installer_debug_data_sharing_consent" w
        FileWrite $0 "true"
        FileClose $0
    ${EndIf}

    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; Register with Add/Remove Programs
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "DisplayName" "nirs4all Studio"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "DisplayIcon" "$INSTDIR\nirs4all-studio.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "Publisher" "nirs4all"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "DisplayVersion" "${VERSION}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "URLInfoAbout" "https://github.com/delete/nirs4all"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "NoRepair" 1

    ; Calculate and store estimated size
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio" \
        "EstimatedSize" "$0"

SectionEnd

Section "Start Menu Shortcuts" SecStartMenu
    CreateDirectory "$SMPROGRAMS\nirs4all"
    CreateShortcut "$SMPROGRAMS\nirs4all\nirs4all Studio.lnk" "$INSTDIR\nirs4all-studio.exe"
    CreateShortcut "$SMPROGRAMS\nirs4all\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Desktop Shortcut" SecDesktop
    CreateShortcut "$DESKTOP\nirs4all Studio.lnk" "$INSTDIR\nirs4all-studio.exe"
SectionEnd

;--------------------------------
; Descriptions

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "Core application files (required)"
    !insertmacro MUI_DESCRIPTION_TEXT ${SecStartMenu} "Create shortcuts in the Start Menu"
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Create a shortcut on the Desktop"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

;--------------------------------
; Uninstaller Section

Section "Uninstall"

    ; Remove Start Menu shortcuts
    Delete "$SMPROGRAMS\nirs4all\nirs4all Studio.lnk"
    Delete "$SMPROGRAMS\nirs4all\Uninstall.lnk"
    RMDir "$SMPROGRAMS\nirs4all"

    ; Remove Desktop shortcut
    Delete "$DESKTOP\nirs4all Studio.lnk"

    ; Remove installed files
    RMDir /r "$INSTDIR"

    ; Remove registry keys
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-studio"
    DeleteRegKey HKLM "Software\nirs4all-studio"

SectionEnd

;--------------------------------
; Functions

Function .onInit
    ; Check if already installed
    ReadRegStr $0 HKLM "Software\nirs4all-studio" "InstallDir"
    StrCmp $0 "" done

    ; Ask user if they want to uninstall first
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "nirs4all Studio is already installed.$\r$\n$\r$\nWould you like to uninstall the existing version first?" \
        IDYES uninst
    Abort

    uninst:
        ; Run uninstaller silently
        ExecWait '"$0\Uninstall.exe" /S _?=$0'
        ; Delete uninstaller (the above can't delete itself)
        Delete "$0\Uninstall.exe"
        RMDir "$0"

    done:
FunctionEnd

Function DiagnosticsConsentPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
        Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 34u "Help improve nirs4all Studio by sharing aggregated diagnostic logs when the application encounters bugs.$\r$\n$\r$\nNo project data, spectra, file contents, or personal identifiers are intentionally sent. You can change this later in Settings."
    Pop $0
    ${NSD_CreateCheckbox} 0 48u 100% 16u "Share aggregated diagnostic logs to improve the software"
    Pop $DebugLogsCheckbox
    ${NSD_SetState} $DebugLogsCheckbox ${BST_UNCHECKED}

    nsDialogs::Show
FunctionEnd

Function DiagnosticsConsentPageLeave
    ${NSD_GetState} $DebugLogsCheckbox $DebugLogsConsent
FunctionEnd

Function un.onInit
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Are you sure you want to uninstall nirs4all Studio?" \
        IDYES +2
    Abort
FunctionEnd
