!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎使用三两事桌面版"
  !define MUI_WELCOMEPAGE_TEXT "安装向导可选择应用目录。应用资料、登录会话、缓存、日志和默认备份均保存在所选目录中。卸载程序时会保留本机资料。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInit
  ; New installs prefer D:\StudyLife. Existing installs keep the registry path.
  StrCmp $hasPerUserInstallation "1" existingInstall
  StrCmp $hasPerMachineInstallation "1" existingInstall
  IfFileExists "D:\." 0 existingInstall
  StrCpy $INSTDIR "D:\StudyLife"
existingInstall:
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  ; The directory page appends the product folder to the selected base.
  ; Keep the selected base beside that folder so uninstalling the app preserves data.
  CreateDirectory "$INSTDIR\resources"
  FileOpen $0 "$INSTDIR\resources\study-life.install-root" w
  FileWrite $0 "$INSTDIR\..$\r$\n"
  FileClose $0
!macroend
