export type Draft = {
  title: string;
  style: string;
  lyrics: string;
  cot: 'full' | 'melody' | 'off';
  seed: number;
  length: 'sketch' | 'standard' | 'extended';
};
export type Song = {
  id: string;
  request: Draft;
  status: string;
  created: number;
  duration: number | null;
  truncated: boolean;
  error: string | null;
  audio: string | null;
};
export type Operation = {
  id: string;
  kind: string;
  phase: string;
  detail: string;
  completed: number | null;
  total: number | null;
  started: number;
  status: string;
  error: string | null;
};
export type Engine = {
  installed: boolean;
  runtimeReady: boolean;
  modelsReady: boolean;
  totalBytes: number;
  downloadedBytes: number;
  dataPath: string;
  hardware: {
    gpu: string | null;
    vramGib: number;
    ramGib: number;
    compatible: boolean;
    message: string;
  };
  operation: Operation | null;
};
