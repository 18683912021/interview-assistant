import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export function createApplicationMenu(showMainWindow: () => void): void {
  // Remove the window menu completely on Windows/Linux, including Alt reveal.
  // Tray actions remain available independently of the application menu.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { label: '打开主窗口', click: showMainWindow },
        { type: 'separator' },
        { role: 'hide', label: '隐藏面试助手' },
        { role: 'hideOthers', label: '隐藏其他应用' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: '退出面试助手' },
      ],
    },
    // macOS needs native editing roles for standard text shortcuts. Hide the
    // menu while retaining those shortcuts (acceleratorWorksWhenHidden=true).
    { label: '编辑', visible: false, submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' },
    ] },
    { label: '窗口', visible: false, submenu: [
      { role: 'minimize' }, { role: 'close' }, { role: 'togglefullscreen' },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
