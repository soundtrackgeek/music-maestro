# Changelog

## [0.1.0] - 2026-10-12

### Added
- Windows desktop music creation with YuE2-3B and the YuE2-Vae listening decoder.
- After Hours interface with style presets, section-aware lyrics, score planning, seeds and generation budgets.
- One-click private Python/CUDA setup, pinned model downloads, real byte progress, pause/resume, checksum validation and repair.
- A Windows 16 GB inference preset with eager PyTorch, offloading and bounded attention/audio decoding.
- Local SQLite song history, persistent drafts, unique generation artifacts and interrupted-run recovery.
- Stereo playback, seeking, volume, lossless FLAC/WAV export and reuse of earlier song settings.
- Clear partial-audio states, hardware requirements, offline generation after setup, and model-license attribution.
- Windows x64 per-user installer packaging, frontend/native checks, download recovery tests and real GPU smoke verification.

### Fixed
- Unicode progress messages survive legacy Windows pipe encodings when the installed GUI launches its worker.
- The play/pause icon keeps its contrast when hovered, and closing the studio guide restores keyboard focus.
- Published installer instructions and checksums use GitHub's asset filename.
