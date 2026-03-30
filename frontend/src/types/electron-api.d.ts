export interface ElectronUpdateStatusPayload {
  status: string;
  version?: string;
  percent?: number;
  message?: string;
}

export interface ElectronAPI {
  platform: string;
  isElectron: boolean;
  appVersion: string;
  onUpdateStatus: (callback: (data: ElectronUpdateStatusPayload) => void) => void;
  installUpdate: () => void;
  checkForUpdates: () => void;
  requestLastUpdateStatus: () => void;
  showAbout: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
