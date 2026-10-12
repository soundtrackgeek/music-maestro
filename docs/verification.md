# Windows verification — 2026-10-12

Tested on Windows 11 with an NVIDIA GeForce RTX 4060 Ti (16 GB VRAM), 31.2 GiB usable system RAM, CUDA PyTorch 2.10.0+cu128 and YuE2 inference 0.1.6.

## Installation and runtime

- Built a Windows GUI executable (PE subsystem 2) and a per-user NSIS installer.
- Installed the NSIS package successfully and launched the installed executable with Vite stopped.
- Confirmed that the package contains the worker, inference wheel, runtime lock, verified uv helper and license notices.
- Provisioned a fresh private Python 3.12.13 environment and installed every locked dependency through the same uv commands used by setup. CUDA and BF16 checks passed without a system Python dependency.
- Downloaded and verified 7,794,629,850 bytes of pinned model files. The installed app recognizes the models and target hardware.
- Ran **Verify & repair engine** through the installed UI; it completed and reused the verified model files.

## Generation and audio

- A deliberately bounded worker test produced 15.999 seconds of 48 kHz stereo audio in 115.8 seconds, with approximately 7.02 GiB peak PyTorch allocation.
- The installed app's **Sketch** flow produced 29.999 seconds of 48 kHz stereo audio in 102.8 seconds, with approximately 7.24 GiB peak PyTorch allocation. Its 750-token performance cap was reached, so the app correctly labels the output **Partial audio**. Score planning completed.
- The installed app's **Song** preset produced a complete 50.759-second composition in 153.6 seconds, with approximately 7.24 GiB peak PyTorch allocation. Both the score and performance reached their natural end without truncation. Its title included an em dash, exercising Unicode across the native request/history boundary.
- Generation saved and verified FLAC, WAV, score, semantic tokens, latents, request and result manifests before marking the song complete.
- Native playback advanced normally without a media error. Pause, seeking to 10 seconds and volume adjustment were exercised.
- WAV export passed through the actual Windows Save dialog. FLAC export passed through the native export command. Both exported files matched the originals by SHA-256.
- Cancellation retained the original request and marked its history entry cancelled. Setup was correctly rejected while generation was running.

The first installed-app run exposed a legacy Windows pipe-encoding failure at a Unicode decoding-stage message. The worker now emits ASCII-safe JSON and its host sets Python's pipe encoding to UTF-8. A regression test exercises multilingual progress under CP1252, and the installed Sketch run completed after this fix.

## Checks

- TypeScript and production frontend build passed.
- Two frontend validation/draft-recovery tests passed.
- Four Python tests passed: resumable downloads, offline verified-file reuse, rejection of corrupt downloads, repair of existing corrupt files, and Unicode protocol coverage.
- Rust formatting, Clippy with warnings denied, and two native request-validation/restart-recovery tests passed.
- Browser preview, empty library, saved draft, style presets and section insertion were exercised. Native setup/generation are unavailable in browser preview.
- Layout checks passed at 960×700 and at a narrow 390-pixel preview width. The creation action remains visible at the desktop minimum size.
- Studio-guide focus trapping and Escape dismissal were exercised. The final frontend restores focus to its guide trigger.
- The final installed build retains a dark play/pause icon against its lighter amber hover background.
- The installed frontend reported no console errors after the font CSP correction.

These are functional compatibility checks, not an evaluation of musical quality or a throughput guarantee. Longer generation depends on the generated score, budgets and other applications using GPU/RAM. The first release has no configured code signature or automatic updater.

Installer SHA-256: `410ef0d8a5f30c2bc193e73bf195a8b5f16daf729038c2ff1c5ac0734717f6ec`.
