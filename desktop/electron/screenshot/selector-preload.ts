import {contextBridge, ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('screenshotSelector', {
  select: (region: {x: number; y: number; width: number; height: number}) => ipcRenderer.send('screenshot:select', region),
  cancel: () => ipcRenderer.send('screenshot:cancel-selection'),
});
