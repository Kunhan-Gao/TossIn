; TossIn 的安装包脚本（NSIS）。不要直接编译它，用 npm run installer，那边会把版本号、文件清单等传进来。
; 默认装到当前用户自己的目录里，不需要管理员权限；安装位置可以自己选。

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APP "TossIn"
!define EXE "TossIn.exe"
!define UNINSTALLER "Uninstall TossIn.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\TossIn"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define RUN_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

Name "${APP}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "Software\${APP}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ManifestDPIAware true
BrandingText " "

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "CompanyName" "${AUTHOR}"
VIAddVersionKey "LegalCopyright" "© ${YEAR} ${AUTHOR}"
VIAddVersionKey "FileDescription" "${APP} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"

; 选安装位置。选了别的文件夹时会自动在后面加上 \TossIn（除非那个文件夹本身就叫 TossIn）
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckInstallDir
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; 界面语言跟随系统：中文系统用中文，其余用英文
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

LangString ShortcutName ${LANG_ENGLISH} "TossIn"
LangString ShortcutName ${LANG_SIMPCHINESE} "先放这儿"
LangString CannotWrite ${LANG_ENGLISH} "TossIn cannot be installed in this folder without administrator rights.$\n$\nPlease choose another location."
LangString CannotWrite ${LANG_SIMPCHINESE} "这个位置需要管理员权限才能写入，TossIn 装不进去。$\n$\n请换一个位置。"
LangString DeleteData ${LANG_ENGLISH} "Also delete everything on your board and your settings?$\n$\nChoose No to keep them for the next time you install TossIn."
LangString DeleteData ${LANG_SIMPCHINESE} "同时删除看板上的内容和设置吗？$\n$\n选“否”会把它们留着，下次安装还能接着用。"

; 请正在运行的那一份退出：先好好说（它会存好数据再走），不行再强行结束
!macro QuitRunningApp
  IfFileExists "$INSTDIR\${EXE}" 0 +4
    nsExec::Exec '"$INSTDIR\${EXE}" --quit'
    Pop $0
    Sleep 1500
  nsExec::Exec 'taskkill /IM "${EXE}" /F'
  Pop $0
  Sleep 400
!macroend

; 离开"选位置"那一页时试写一下：写不进去（比如 C:\Program Files）就留在这一页，请用户换地方
Function CheckInstallDir
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\tossin-write-test.tmp" w
  IfErrors 0 writable
    RMDir "$INSTDIR"
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(CannotWrite)"
    Abort
  writable:
  FileClose $0
  Delete "$INSTDIR\tossin-write-test.tmp"
  RMDir "$INSTDIR" ; 只在文件夹是空的时候才会删掉；真正安装时会再建
FunctionEnd

Section "Install"
  !insertmacro QuitRunningApp
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  CreateShortcut "$DESKTOP\$(ShortcutName).lnk" "$INSTDIR\${EXE}"
  CreateShortcut "$SMPROGRAMS\$(ShortcutName).lnk" "$INSTDIR\${EXE}"

  WriteRegStr HKCU "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${AUTHOR}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE}"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "${HOMEPAGE}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  !insertmacro QuitRunningApp

  ; 只删安装时放进去的文件（清单由打包脚本生成），不整个清空文件夹，免得误删别的东西
  !include "${FILES}"
  Delete "$INSTDIR\${UNINSTALLER}"
  RMDir "$INSTDIR"

  ; 两种语言下的快捷方式名字都清一遍
  Delete "$DESKTOP\TossIn.lnk"
  Delete "$DESKTOP\先放这儿.lnk"
  Delete "$SMPROGRAMS\TossIn.lnk"
  Delete "$SMPROGRAMS\先放这儿.lnk"

  ; 开机自启的登记
  DeleteRegValue HKCU "${RUN_KEY}" "${APP}"
  DeleteRegValue HKCU "${RUN_APPROVED_KEY}" "${APP}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP}"

  ; 看板上的内容和设置：默认留着（静默卸载时也留着）
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(DeleteData)" /SD IDNO IDNO keep
    RMDir /r "$APPDATA\${APP}"
  keep:
SectionEnd
