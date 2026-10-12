# Third-party components

- YuE2 inference 0.1.6, built without modification from Multimodal Art Projection's YuE repository at commit `1647252d68b70cbead046ffd3f7caf036dde47ee`. Inference code is Apache-2.0. The wheel includes its upstream license and component notices. Source: https://github.com/multimodal-art-projection/YuE.
- YuE2-3B checkpoint revision `8f24312f187763b9854adeec87e437e2b03bbff1` and YuE2-Vae revision `152733a19ad43aa67e367f9b5503ef8075bb5126`. Model weights are CC BY-NC 4.0 and downloaded directly from the authors on setup. The model license and notices are retained with the models. Source: https://huggingface.co/m-a-p/YuE2-3B and https://huggingface.co/m-a-p/YuE2-Vae.
- uv 0.11.32 by Astral, distributed under MIT or Apache-2.0. The build provisioner downloads the Windows x64 release and verifies its published archive SHA-256. Source: https://github.com/astral-sh/uv.
- The runtime also installs PyTorch, Transformers, NumPy and the packages pinned in `src-tauri/resources/runtime-lock.txt`; their own licenses apply.
- Manrope and IBM Plex Mono fonts are distributed with their Open Font License notices in their npm packages.
- The selected concept and studio photograph were generated with the built-in imagegen tool. The final photograph prompt is recorded in `docs/design/direction.md`.
