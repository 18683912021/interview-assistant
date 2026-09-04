; NSIS 自定义卸载脚本
; electron-builder nsis.include

!macro customUnInstall
  ; ── LibreOffice 系统安装 ──
  ; LOCALAPPDATA（App 自动下载安装的）
  RMDir /r "$LOCALAPPDATA\LibreOffice"
  ; D 盘（如果用户改过路径）
  RMDir /r "D:\LibreOffice"

  ; ── 下载缓存（lo-installer-*.tmp + 状态文件） ──
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\libreoffice-download-state.json"
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\lo-installer-*.tmp"
  ; 旧版残留
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\libreoffice-installer-tmp"
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\libreoffice-installer.exe"
  RMDir /r "$PROFILE\AppData\Roaming\${APP_FILENAME}\libreoffice-portable"

  ; ── 偏好数据 ──
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\preferences.json"
!macroend

!macro customInstall
  ; 安装时清理残留
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\libreoffice-download-state.json"
  Delete "$PROFILE\AppData\Roaming\${APP_FILENAME}\lo-installer-*.tmp"
!macroend
