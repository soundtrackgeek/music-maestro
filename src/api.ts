import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { save } from '@tauri-apps/plugin-dialog';
import type { Draft, Engine, Operation, Song } from './types';

export const native = isTauri();
const desktopOnly = () =>
  Promise.reject(
    new Error('Open the Windows desktop app to set up the engine and generate music.'),
  );
export const api = {
  engine: (): Promise<Engine> =>
    native
      ? invoke('engine_status')
      : Promise.resolve({
          installed: false,
          runtimeReady: false,
          modelsReady: false,
          totalBytes: 7794629850,
          downloadedBytes: 0,
          dataPath: 'Local app data / MusicMaestro',
          hardware: {
            gpu: null,
            vramGib: 0,
            ramGib: 0,
            compatible: false,
            message: 'Use the Windows desktop app to detect your GPU and install the music engine.',
          },
          operation: null,
        }),
  songs: (): Promise<Song[]> => (native ? invoke('list_songs') : Promise.resolve([])),
  setup: (): Promise<void> => (native ? invoke('setup_engine') : desktopOnly()),
  generate: (request: Draft): Promise<string> =>
    native ? invoke('create_song', { request }) : desktopOnly(),
  cancel: (): Promise<void> => (native ? invoke('cancel_operation') : desktopOnly()),
  subscribe: async (progress: (value: Operation) => void, changed: () => void) => {
    if (!native) return () => {};
    const stopProgress = await listen<Operation>('studio-progress', (event) =>
      progress(event.payload),
    );
    const stopChanged = await listen('studio-changed', changed);
    return () => {
      stopProgress();
      stopChanged();
    };
  },
  audio: (song: Song) => (song.audio ? convertFileSrc(song.audio) : undefined),
  export: async (song: Song, format: 'wav' | 'flac') => {
    if (!native) return desktopOnly();
    const name =
      song.request.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'My song';
    const destination = await save({
      defaultPath: `${name}.${format}`,
      filters: [{ name: format === 'wav' ? 'Wave audio' : 'Lossless FLAC', extensions: [format] }],
    });
    if (destination) await invoke('export_song', { id: song.id, format, destination });
    return Boolean(destination);
  },
};
