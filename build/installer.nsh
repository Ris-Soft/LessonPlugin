!include "LogicLib.nsh"
!define DIR_NAME "OrbiBoard"
; !define MUI_PAGE_CUSTOMFUNCTION_PRE DirPagePre ; Commented out to fix build error

Function .onVerifyInstDir
  StrLen $0 "\${DIR_NAME}"
  StrCpy $1 "$INSTDIR" "" -$0
  StrCmp $1 "\${DIR_NAME}" +2 0
  StrCpy $INSTDIR "$INSTDIR\${DIR_NAME}"
FunctionEnd

; Function DirPagePre
;   IfFileExists "$INSTDIR\Uninstall.exe" 0 +2
;   Abort
; FunctionEnd

; Function un.DirPagePre
; FunctionEnd

Function .onInstSuccess
  IfSilent 0 skip_silent_start
  ExecShell "" "$INSTDIR\${APP_FILENAME}.exe"
  skip_silent_start:
FunctionEnd
