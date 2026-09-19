/** Compile the actual custom lifecycle macros, without packaging Electron. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-nsis-compile-'));
try {
  const source = path.resolve(process.argv[2] || path.join(__dirname, '../build/installer.nsh')).replaceAll('\\', '/');
  fs.writeFileSync(path.join(root, 'check.nsi'), `Unicode true
Name "Studio lifecycle compile check"
OutFile "check.exe"
InstallDir "$TEMP\\studio-installer-compile-check"
RequestExecutionLevel user
!define isUpdated '\${Silent}'
!include "${source}"
Var installMode
Function .onInit
  StrCpy $installMode "all"
  !insertmacro customInit
FunctionEnd
Function un.onInit
  StrCpy $installMode "all"
  !insertmacro customUnInit
FunctionEnd
Section "Install"
!ifmacrodef customInstall
  !insertmacro customInstall
!endif
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
SectionEnd
Section "Uninstall"
  !insertmacro customUnInstall
SectionEnd
`);
  for (const defines of [[], ['-DBUILD_UNINSTALLER']]) {
    execFileSync(process.env.MAKENSIS || 'makensis', ['-WX', '-V3', ...defines, 'check.nsi'], {
      cwd: root, timeout: 30000, stdio: 'inherit',
    });
    if (fs.statSync(path.join(root, 'check.exe')).size === 0) throw new Error('NSIS emitted an empty installer');
  }
  console.log('NSIS lifecycle compilation passed (installer and uninstaller macros).');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
