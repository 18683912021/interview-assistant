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
        // Hide individual items, not their parent menu: AppKit stops dispatching
        // standard text shortcuts when the entire top-level menu is hidden.
        { role: 'undo', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'redo', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'cut', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'copy', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'paste', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'selectAll', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'minimize', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'close', visible: false, acceleratorWorksWhenHidden: true },
        { role: 'togglefullscreen', visible: false, acceleratorWorksWhenHidden: true },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
