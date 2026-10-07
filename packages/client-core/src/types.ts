export interface TailorKitApp {
  scope?: { name: string };
  views?: { slot: string; path: string; instances?: true; disabled?: true }[];
  clientPath?: string;
  description?: string;
  id: string;
  logoPaths?: {
    dark?: string;
    light?: string;
  };
  projectId?: string;
  currentDeployment?: {
    id: string;
  } | null;
  name?: string;
  preview?: { sessionId: string; expiresAt: string; websocketUrl: string; token: string };
}

export interface TailorKitView {
  instances?: true;
  id: string;
  app: TailorKitApp;
  slot: string;
  path: string;
}
