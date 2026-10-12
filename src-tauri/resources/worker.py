"""Music Maestro's isolated YuE2 adapter. stdout is a JSON-lines protocol."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import traceback
import urllib.request


def emit(kind, **values):
    # Native Windows GUI processes may inherit a legacy pipe encoding.
    # Keep the wire protocol ASCII; JSON decoding restores Unicode strings.
    print(json.dumps({"type": kind, **values}, ensure_ascii=True, allow_nan=False), flush=True)


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, allow_nan=False), encoding="utf-8")
    os.replace(temporary, path)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def download_file(url, destination, size, sha256, progress):
    """Resume a pinned HTTPS file; only atomically publish verified contents."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and destination.stat().st_size == size:
        if digest(destination) == sha256:
            progress(size)
            return
    partial = destination.with_suffix(destination.suffix + ".partial")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > size:
        partial.unlink()
        offset = 0
    request = urllib.request.Request(url, headers={"User-Agent": "MusicMaestro/0.1.0", **({"Range": f"bytes={offset}-"} if offset else {})})
    if offset < size:
        with urllib.request.urlopen(request, timeout=60) as response:
            resumed = offset > 0 and response.status == 206
            if resumed and not response.headers.get("Content-Range", "").startswith(f"bytes {offset}-"):
                raise ValueError("Download server returned an invalid resume range")
            if not resumed:
                offset = 0
            with partial.open("ab" if resumed else "wb") as target:
                progress(offset)
                while block := response.read(1024 * 1024):
                    target.write(block)
                    offset += len(block)
                    if offset > size:
                        raise ValueError("Downloaded file exceeds its pinned size")
                    progress(offset)
    if partial.stat().st_size != size:
        raise ValueError("Download ended before the complete file arrived; retry to resume")
    if digest(partial) != sha256:
        partial.unlink()
        raise ValueError("Download integrity check failed; retry will fetch a fresh copy")
    os.replace(partial, destination)


def probe(root):
    import torch
    import importlib.metadata
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Install the current NVIDIA driver and restart the app.")
    index = max(range(torch.cuda.device_count()), key=lambda i: torch.cuda.get_device_properties(i).total_memory)
    torch.cuda.set_device(index)
    if not torch.cuda.is_bf16_supported():
        raise RuntimeError("The GPU must support BF16 (RTX 30 series or newer).")
    properties = torch.cuda.get_device_properties(index)
    if properties.total_memory < 15 * 2**30:
        raise RuntimeError("This release requires an NVIDIA GPU with at least 16 GB VRAM.")
    data = {"version": "0.1.0", "torch": torch.__version__, "yue2": importlib.metadata.version("yue2-infer"), "gpu": properties.name, "vram": properties.total_memory, "bf16": True}
    atomic_json(root / "runtime-ready.json", data)
    return data


def setup(root):
    emit("progress", phase="Checking CUDA compatibility", detail="Checking your NVIDIA GPU before the model download", completed=None, total=None)
    runtime = probe(root)
    manifest = json.loads(Path(__file__).with_name("engine-manifest.json").read_text(encoding="utf-8"))
    total = sum(f["size"] for model in manifest["models"] for f in model["files"])
    completed = 0
    entries = []
    last_report = 0.0
    for model in manifest["models"]:
        for file in model["files"]:
            filename = file["name"]
            destination = root / "models" / model["folder"] / filename
            emit("progress", phase=f"Downloading {model['folder']}", detail=filename, completed=completed, total=total)

            def report(current):
                nonlocal last_report
                now = time.monotonic()
                if now - last_report > 0.2 or current == file["size"]:
                    emit("progress", phase=f"Downloading {model['folder']}", detail=filename, completed=completed + current, total=total)
                    last_report = now

            url = f"https://huggingface.co/{model['repo']}/resolve/{model['revision']}/{filename}"
            download_file(url, destination, file["size"], file["sha256"], report)
            completed += file["size"]
            entries.append({"path": f"models/{model['folder']}/{filename}", "size": file["size"], "sha256": file["sha256"], "mtime": int(destination.stat().st_mtime)})
    emit("progress", phase="Checking CUDA and model installation", detail="Checking the isolated runtime", completed=None, total=None)
    atomic_json(root / "engine-ready.json", {"version": "0.1.0", "files": entries, "runtime": runtime, "total": total})
    emit("complete", result={"installed": True, "total": total, "gpu": runtime["gpu"]})


def generate(root, request_path, output):
    import numpy as np
    import torch
    from yue2 import YuE2Pipeline
    from yue2.protocol import GenerationConfig
    from yue2.storage import verify_result
    from yue2.nar import synthesize

    data = json.loads(Path(request_path).read_text(encoding="utf-8"))
    probe(root)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    # Reject overwriting an earlier run; request.json is written by the host.
    if (output / "result.json").exists():
        raise ValueError("This output already contains a completed generation")
    if data["cot"] not in {"full", "melody", "off"} or not 0 <= data["seed"] <= 2**53 - 1:
        raise ValueError("Invalid planning mode or seed")
    max_tokens = {"sketch": 750, "standard": 3000, "extended": 6000}[data["length"]]
    config = GenerationConfig.from_dict({"semantic": {"max_tokens": max_tokens}})
    if data.get("smoke"):
        config = GenerationConfig.from_dict({"abc": {"max_tokens": 1024}, "semantic": {"max_tokens": 400}})
    last = 0.0
    counts = {"abc": 0, "semantic": 0}

    def on_token(phase, _token):
        nonlocal last
        counts[phase] += 1
        now = time.monotonic()
        if now - last > 0.5:
            emit("progress", phase="Composing melody and chords" if phase == "abc" else "Generating musical performance", detail=f"{counts[phase]:,} tokens", completed=None, total=None)
            last = now

    class WindowsPipeline(YuE2Pipeline):
        def synthesize(self, semantic, *, cancelled=None):
            emit("progress", phase="Synthesizing audio", detail="Rendering the performance", completed=0, total=config.ode_steps)
            model = self._load_model(for_nar=True)
            def on_progress(current, total):
                emit("progress", phase="Synthesizing audio", detail=f"Step {current} of {total}", completed=current, total=total)
            value = synthesize(model, semantic.plan.prefix, semantic.tokens, semantic.plan.request.seed,
                               steps=config.ode_steps, context=config.context, offload_ar=True,
                               attention="math", query_chunk_size=128, cancelled=cancelled, on_progress=on_progress)
            return value.numpy()

        def decode(self, latents, **kwargs):
            emit("progress", phase="Decoding stereo audio", detail="48 kHz · stereo", completed=None, total=None)
            return super().decode(latents, **kwargs)

    emit("progress", phase="Loading YuE2", detail="Checking model files and preparing the GPU", completed=None, total=None)
    started = time.monotonic()
    with WindowsPipeline.from_pretrained(str(root / "models" / "YuE2-3B"), vae=str(root / "models" / "YuE2-Vae"),
          device="cuda", local_files_only=True, memory_budget_gib=16, backend="torch-eager",
          offload_ar=True, vae_core_frames=512, generation_config=config, progress=False) as pipe:
        result = pipe(style=data["style"], lyrics=data["lyrics"], cot=data["cot"], seed=data["seed"], on_token=on_token)
        if not np.isfinite(result.audio).all() or result.audio.ndim != 2 or result.audio.shape[1] != 2 or len(result.audio) == 0:
            raise ValueError("The engine did not produce valid stereo audio")
        result.config["windows_attention"] = {"backend": "math", "query_chunk_size": 128}
        emit("progress", phase="Saving your song", detail="Verifying audio and generation artifacts", completed=None, total=None)
        result.save_artifacts(output)
        # WAV is the playback/export copy; retain the original lossless FLAC.
        result.save(output / "audio.wav")
        verified = verify_result(output)
        report = {"duration": verified["audio_seconds"], "truncated": any(verified["truncated"].values()),
                  "truncation": verified["truncated"], "elapsed": time.monotonic() - started,
                  "peakVramGiB": torch.cuda.max_memory_allocated() / 2**30,
                  "sampleRate": result.sample_rate}
        atomic_json(output / "verified.json", report)
        emit("complete", result=report)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["setup", "probe", "generate"])
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--request", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "setup":
            setup(args.root)
        elif args.mode == "probe":
            emit("complete", result=probe(args.root))
        else:
            if args.request is None or args.output is None:
                parser.error("generation requires --request and --output")
            generate(args.root, args.request, args.output)
    except Exception as error:
        emit("error", message=str(error))
        traceback.print_exc(file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
