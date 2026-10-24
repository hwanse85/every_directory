!include "LogicLib.nsh"

; 경량 설치본은 WebView2가 없는 PC에 앱을 설치하기 전에 필요한 준비를 안내한다.
!macro NSIS_HOOK_PREINSTALL
  Push $R7
  SetRegView 64
  ReadRegStr $R7 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $R7 == ""
  ${OrIf} $R7 == "0.0.0.0"
    ReadRegStr $R7 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  SetRegView 32
  ${If} $R7 == ""
  ${OrIf} $R7 == "0.0.0.0"
    Pop $R7
    DetailPrint "Microsoft Edge WebView2 Runtime is required. Install the offline runtime first."
    IfSilent +2
      MessageBox MB_OK|MB_ICONEXCLAMATION "Microsoft Edge WebView2 Runtime이 필요합니다.$\r$\n전산 담당자에게 오프라인 런타임 설치를 요청하세요.$\r$\n$\r$\nAsk your IT administrator to install Microsoft Edge WebView2 Runtime first."
    SetErrorLevel 2
    Quit
  ${EndIf}
  Pop $R7
!macroend

; 앱 제거 시 로그인 자동 실행 항목도 함께 정리한다.
!macro NSIS_HOOK_PREUNINSTALL
  SetRegView 64
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "every-directory"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Every Directory"
  SetRegView 32
!macroend
