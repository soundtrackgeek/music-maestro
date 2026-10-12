# Music Maestro 0.1.0

A Windows 11 desktop studio for turning a style description and original lyrics into music on an RTX 4060 Ti (16 GB VRAM) with 32 GB RAM. The selected design is After Hours: charcoal, warm amber, a generous lyric editor and persistent operation progress.

The primary flow is install the app, check hardware, set up the engine without a terminal, describe music, enter lyrics, generate, listen and export. A bundled uv helper provisions an isolated Python 3.12 environment; a pinned YuE2 inference wheel and CUDA PyTorch power the engine. Downloads are resumable, checked against published model hashes and kept outside the installation directory. Models are downloaded from the authors rather than redistributed in the installer.

Windows uses the eager PyTorch backend because the upstream CUDA graph path calls Flash Attention that is absent from the Windows wheel. The memory preset reserves GPU headroom, offloads unused autoregressive layers during synthesis and tiles attention/decoding. The upstream documented starting point remains Linux/24 GB; report real Windows evidence separately.

SQLite owns generation history. Every run has an immutable request and its own output directory. Restart marks interrupted work as interrupted. A song is complete only after its audio and result manifest have been saved and verified. Token-limited audio is labelled partial. Setup and generation are mutually exclusive, cancellation stops the child process, and partial model files survive retry. Progress uses real bytes during downloads and honest stage/token counters during generation.

Acceptance: real model integrity, CUDA/BF16 detection, end-to-end bounded generation on the target GPU, download resume/integrity checks, request validation, interrupted-job recovery, frontend build and interaction checks, Rust format/tests/Clippy, a Windows GUI release launch without Vite, and an NSIS installer artifact.
