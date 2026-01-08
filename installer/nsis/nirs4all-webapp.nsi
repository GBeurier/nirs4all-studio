; NSIS Installer Script for nirs4all-webapp
;
; This script creates a Windows installer with:
; - License agreement screen
; - Installation directory selection
; - Start Menu shortcuts
; - Desktop shortcut (optional)
; - Add/Remove Programs entry
; - Uninstaller
;
; Build with: makensis nirs4all-webapp.nsi
; Requires: NSIS 3.x

;--------------------------------
; Includes

!include "MUI2.nsh"
!include "FileFunc.nsh"

;--------------------------------
; General Configuration

; Name and output file
Name "nirs4all Webapp"
OutFile "..\..\..\release\nirs4all-webapp-${VERSION}-windows-x64-setup.exe"
Unicode True

; Default installation directory
InstallDir "$PROGRAMFILES64\nirs4all-webapp"
InstallDirRegKey HKLM "Software\nirs4all-webapp" "InstallDir"

; Request admin privileges
RequestExecutionLevel admin

; Version info
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "nirs4all Webapp"
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
!define MUI_WELCOMEPAGE_TITLE "Welcome to nirs4all Webapp Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of nirs4all Webapp.$\r$\n$\r$\nnirs4all Webapp is a desktop application for Near-Infrared Spectroscopy (NIRS) data analysis with machine learning pipelines.$\r$\n$\r$\nClick Next to continue."

; Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\nirs4all-webapp.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch nirs4all Webapp"
!define MUI_FINISHPAGE_LINK "Visit nirs4all on GitHub"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/delete/nirs4all"

;--------------------------------
; Pages

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\..\LICENSE"
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

Section "nirs4all Webapp (required)" SecMain
    SectionIn RO  ; Read-only, always installed

    ; Set output path to the installation directory
    SetOutPath "$INSTDIR"

    ; Install main files (from PyInstaller dist)
    File /r "..\..\dist\nirs4all-webapp\*.*"

    ; Store installation folder
    WriteRegStr HKLM "Software\nirs4all-webapp" "InstallDir" "$INSTDIR"
    WriteRegStr HKLM "Software\nirs4all-webapp" "Version" "${VERSION}"

    ; Create uninstaller
    WriteUninstaller "$INSTDIR\Uninstall.exe"

    ; Register with Add/Remove Programs
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "DisplayName" "nirs4all Webapp"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "UninstallString" '"$INSTDIR\Uninstall.exe"'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "InstallLocation" "$INSTDIR"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "DisplayIcon" "$INSTDIR\nirs4all-webapp.exe"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "Publisher" "nirs4all"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "DisplayVersion" "${VERSION}"
    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "URLInfoAbout" "https://github.com/delete/nirs4all"
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "NoModify" 1
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "NoRepair" 1

    ; Calculate and store estimated size
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp" \
        "EstimatedSize" "$0"

SectionEnd

Section "Start Menu Shortcuts" SecStartMenu
    CreateDirectory "$SMPROGRAMS\nirs4all"
    CreateShortcut "$SMPROGRAMS\nirs4all\nirs4all Webapp.lnk" "$INSTDIR\nirs4all-webapp.exe"
    CreateShortcut "$SMPROGRAMS\nirs4all\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Desktop Shortcut" SecDesktop
    CreateShortcut "$DESKTOP\nirs4all Webapp.lnk" "$INSTDIR\nirs4all-webapp.exe"
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
    Delete "$SMPROGRAMS\nirs4all\nirs4all Webapp.lnk"
    Delete "$SMPROGRAMS\nirs4all\Uninstall.lnk"
    RMDir "$SMPROGRAMS\nirs4all"

    ; Remove Desktop shortcut
    Delete "$DESKTOP\nirs4all Webapp.lnk"

    ; Remove installed files
    RMDir /r "$INSTDIR"

    ; Remove registry keys
    DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\nirs4all-webapp"
    DeleteRegKey HKLM "Software\nirs4all-webapp"

SectionEnd

;--------------------------------
; Functions

Function .onInit
    ; Check if already installed
    ReadRegStr $0 HKLM "Software\nirs4all-webapp" "InstallDir"
    StrCmp $0 "" done

    ; Ask user if they want to uninstall first
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "nirs4all Webapp is already installed.$\r$\n$\r$\nWould you like to uninstall the existing version first?" \
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

Function un.onInit
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Are you sure you want to uninstall nirs4all Webapp?" \
        IDYES +2
    Abort
FunctionEnd
