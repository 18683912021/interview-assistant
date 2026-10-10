import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export function createApplicationMenu(showMainWindow: () => void): void {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    {
      label: mac ? app.name : '应用',
      submenu: [
        { label: '打开主窗口', click: showMainWindow },
        { type: 'separator' },
        ...(mac ? [
          { role: 'hide' as const, label: '隐藏面试助手' },
          { role: 'hideOthers' as const, label: '隐藏其他应用' },
          { role: 'unhide' as const, label: '显示全部' },
          { type: 'separator' as const },
        ] : []),
        { role: 'quit', label: '退出面试助手' },
      ],
    },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '显示', submenu: [
      { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' }, { role: 'togglefullscreen', label: '切换全屏' },
      { type: 'separator' }, { role: 'toggleDevTools', label: '开发者工具' },
    ] },
    { label: '窗口', submenu: [
      { label: '打开主窗口', click: showMainWindow },
      { role: 'minimize', label: '最小化' }, { role: 'close', label: '关闭窗口' },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
