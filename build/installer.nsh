; 摸鱼小狐 · NSIS 自定义脚本（electron-builder 会自动引入 build/installer.nsh）
; 作用：安装前读取已安装版本，按版本号给出 升级 / 重新安装 / 降级 提示。
; 覆盖安装由 electron-builder 完成：同一 appId → 同一注册表键，自动关闭正在运行的程序、
; 卸载旧文件并安装到原目录，用户数据（%APPDATA%\摸鱼小狐）不受影响。

!include "WordFunc.nsh"

!macro moyuReadInstalledVersion _ROOT _OUT
  ReadRegStr ${_OUT} ${_ROOT} "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
!macroend

!macro customInit
  Var /GLOBAL moyuOldVer
  Var /GLOBAL moyuCmp

  !insertmacro moyuReadInstalledVersion HKCU $moyuOldVer
  ${if} $moyuOldVer == ""
    !insertmacro moyuReadInstalledVersion HKLM $moyuOldVer
  ${endif}

  ${if} $moyuOldVer != ""
  ${andIfNot} ${Silent}
    ${VersionCompare} "${VERSION}" "$moyuOldVer" $moyuCmp
    ${if} $moyuCmp == 1
      MessageBox MB_OKCANCEL|MB_ICONINFORMATION "检测到已安装 摸鱼小狐 v$moyuOldVer。$\r$\n$\r$\n将升级到 v${VERSION}，安装到原来的位置。$\r$\n你的工作设置和自定义背景都会保留。$\r$\n$\r$\n如果程序正在运行，安装时会自动关闭。" /SD IDOK IDOK moyuContinue
      Quit
    ${elseif} $moyuCmp == 0
      MessageBox MB_OKCANCEL|MB_ICONQUESTION "摸鱼小狐 v${VERSION} 已经安装过了。$\r$\n$\r$\n要重新安装（修复）吗？设置和背景都会保留。" /SD IDOK IDOK moyuContinue
      Quit
    ${else}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "当前已安装更新的版本 v$moyuOldVer，这个安装包是旧版本 v${VERSION}。$\r$\n$\r$\n确定要降级吗？设置会保留，但新版本的部分功能将不可用。" /SD IDOK IDOK moyuContinue
      Quit
    ${endif}
    moyuContinue:
  ${endif}
!macroend
