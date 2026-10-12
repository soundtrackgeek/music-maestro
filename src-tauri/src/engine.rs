use crate::{
    library::{self, Draft, Song},
    AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub gpu: Option<String>,
    pub vram_gib: f64,
    pub ram_gib: f64,
    pub compatible: bool,
    pub message: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub kind: String,
    pub phase: String,
    pub detail: String,
    pub completed: Option<u64>,
    pub total: Option<u64>,
    pub started: u64,
    pub status: String,
    pub error: Option<String>,
}

pub struct Active {
    pub id: String,
    pub cancelled: Arc<AtomicBool>,
    pub pid: Arc<AtomicU32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    pub runtime_ready: bool,
    pub models_ready: bool,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub data_path: String,
    pub hardware: Hardware,
    pub operation: Option<Progress>,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}

pub fn hardware() -> Hardware {
    let mut system = sysinfo::System::new();
    system.refresh_memory();
    let ram_gib = system.total_memory() as f64 / 2_f64.powi(30);
    let result = command("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output();
    let (gpu, vram) = match result {
        Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let (name, memory) = line.split_once(',')?;
                Some((
                    name.trim().to_string(),
                    memory.trim().parse::<f64>().ok()? / 1024.0,
                ))
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(name, memory)| (Some(name), memory))
            .unwrap_or((None, 0.)),
        _ => (None, 0.),
    };
    let compatible = gpu.is_some() && vram >= 15.0 && ram_gib >= 30.0;
    let message=if compatible { "16 GB Windows preset available. CUDA and BF16 are checked during setup." } else { "Requires Windows 11, an NVIDIA BF16-capable GPU with 16 GB VRAM, and 32 GB RAM. Install the NVIDIA driver if the GPU is missing." }.into();
    Hardware {
        gpu,
        vram_gib: vram,
        ram_gib,
        compatible,
        message,
    }
}

pub fn python(root: &Path) -> PathBuf {
    root.join("runtime/.venv/Scripts/python.exe")
}

pub fn status(state: &AppState) -> Result<EngineStatus, String> {
    let manifest: Value =
        serde_json::from_slice(include_bytes!("../resources/engine-manifest.json"))
            .map_err(|e| e.to_string())?;
    let mut total = 0;
    let mut downloaded = 0;
    for model in manifest["models"]
        .as_array()
        .ok_or("Invalid engine manifest")?
    {
        for file in model["files"].as_array().ok_or("Invalid file manifest")? {
            let size = file["size"].as_u64().unwrap_or(0);
            total += size;
            let path = state
                .root
                .join("models")
                .join(model["folder"].as_str().unwrap_or(""))
                .join(file["name"].as_str().unwrap_or(""));
            let partial = path.with_extension(format!(
                "{}.partial",
                path.extension().unwrap_or_default().to_string_lossy()
            ));
            downloaded += fs::metadata(path)
                .or_else(|_| fs::metadata(partial))
                .map(|m| m.len().min(size))
                .unwrap_or(0);
        }
    }
    let ready: Value = fs::read(state.root.join("engine-ready.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let models_ready = ready["version"] == "0.1.0"
        && ready["files"].as_array().is_some_and(|files| {
            !files.is_empty()
                && files.iter().all(|file| {
                    let Some(name) = file["path"].as_str() else {
                        return false;
                    };
                    if name.contains("..") || Path::new(name).is_absolute() {
                        return false;
                    }
                    fs::metadata(state.root.join(name)).is_ok_and(|m| {
                        m.len() == file["size"].as_u64().unwrap_or(0)
                            && m.modified()
                                .ok()
                                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                                .map(|d| d.as_secs())
                                == file["mtime"].as_u64()
                    })
                })
        });
    let runtime_ready =
        python(&state.root).is_file() && state.root.join("runtime-ready.json").is_file();
    Ok(EngineStatus {
        installed: runtime_ready && models_ready,
        runtime_ready,
        models_ready,
        total_bytes: total,
        downloaded_bytes: downloaded,
        data_path: state.root.to_string_lossy().into(),
        hardware: state.hardware.clone(),
        operation: state.progress.lock().map_err(|e| e.to_string())?.clone(),
    })
}

fn publish(app: &AppHandle, state: &AppState, progress: &Progress) {
    if let Ok(mut current) = state.progress.lock() {
        *current = Some(progress.clone());
    }
    let _ = app.emit("studio-progress", progress);
}

fn reserve(state: &AppState, id: &str) -> Result<(Arc<AtomicBool>, Arc<AtomicU32>), String> {
    let mut active = state.active.lock().map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("Another studio operation is running.".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    let pid = Arc::new(AtomicU32::new(0));
    *active = Some(Active {
        id: id.into(),
        cancelled: cancelled.clone(),
        pid: pid.clone(),
    });
    Ok((cancelled, pid))
}

pub fn cancel(state: &AppState) -> Result<(), String> {
    if let Some(active) = state.active.lock().map_err(|e| e.to_string())?.as_ref() {
        active.cancelled.store(true, Ordering::SeqCst);
        let pid = active.pid.load(Ordering::SeqCst);
        if pid != 0 {
            kill(pid);
        }
    }
    Ok(())
}

fn kill(pid: u32) {
    #[cfg(windows)]
    {
        let _ = command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = command("kill").arg(pid.to_string()).status();
    }
}

struct Reporter<'a> {
    app: &'a AppHandle,
    state: &'a AppState,
    progress: &'a mut Progress,
    cancelled: &'a AtomicBool,
    pid: &'a AtomicU32,
}

impl Reporter<'_> {
    fn run(&mut self, mut cmd: Command, protocol: bool) -> Result<Option<Value>, String> {
        if self.cancelled.load(Ordering::SeqCst) {
            return Err("Operation paused.".into());
        }
        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start engine: {e}"))?;
        self.pid.store(child.id(), Ordering::SeqCst);
        if self.cancelled.load(Ordering::SeqCst) {
            kill(child.id());
        }
        let stderr = child.stderr.take().ok_or("Missing engine diagnostics")?;
        let diagnostics = Arc::new(Mutex::new(String::new()));
        let errors = diagnostics.clone();
        let diagnostic_thread = std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut value) = errors.lock() {
                    value.push_str(&line);
                    value.push('\n');
                    if value.len() > 6000 {
                        let cut = value
                            .char_indices()
                            .map(|(i, _)| i)
                            .find(|i| *i >= value.len() - 4000)
                            .unwrap_or(0);
                        value.drain(..cut);
                    }
                }
            }
        });
        let stdout = child.stdout.take().ok_or("Missing engine output")?;
        let mut result = None;
        let mut error = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !protocol {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                match value["type"].as_str() {
                    Some("progress") => {
                        self.progress.phase = value["phase"].as_str().unwrap_or("Working").into();
                        self.progress.detail = value["detail"].as_str().unwrap_or("").into();
                        self.progress.completed = value["completed"].as_u64();
                        self.progress.total = value["total"].as_u64();
                        publish(self.app, self.state, self.progress);
                    }
                    Some("complete") => {
                        result = Some(value["result"].clone());
                    }
                    Some("error") => {
                        error = Some(
                            value["message"]
                                .as_str()
                                .unwrap_or("Engine failed")
                                .to_string(),
                        );
                    }
                    _ => {}
                }
            }
        }
        let exit = child.wait().map_err(|e| e.to_string())?;
        self.pid.store(0, Ordering::SeqCst);
        let _ = diagnostic_thread.join();
        if self.cancelled.load(Ordering::SeqCst) {
            return Err("Operation paused.".into());
        }
        if !exit.success() {
            return Err(error.unwrap_or_else(|| {
                diagnostics
                    .lock()
                    .map(|v| v.trim().to_string())
                    .unwrap_or_else(|_| "Engine failed".into())
            }));
        }
        if protocol && result.is_none() {
            return Err("The engine ended without a verified result.".into());
        }
        Ok(result)
    }
}

pub fn setup(app: AppHandle, state: Arc<AppState>) -> Result<(), String> {
    if !state.hardware.compatible {
        return Err(state.hardware.message.clone());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (cancelled, pid) = reserve(&state, &id)?;
    let mut progress = Progress {
        id,
        kind: "setup".into(),
        phase: "Preparing Python 3.12".into(),
        detail: "Installing a private runtime; no terminal or administrator account needed".into(),
        completed: None,
        total: None,
        started: now(),
        status: "running".into(),
        error: None,
    };
    publish(&app, &state, &progress);
    std::thread::spawn(move || {
        let outcome = (|| -> Result<(), String> {
            let venv = state.root.join("runtime/.venv");
            fs::create_dir_all(state.root.join("runtime")).map_err(|e| e.to_string())?;
            let uv = state.resources.join("uv.exe");
            if !uv.is_file() {
                return Err(
                    "The bundled runtime helper is missing. Reinstall Music Maestro.".into(),
                );
            }
            if !python(&state.root).is_file() {
                let mut cmd = command(&uv);
                cmd.args(["venv", "--python", "3.12", "--managed-python"])
                    .arg(&venv);
                cmd.env("UV_PYTHON_INSTALL_DIR", state.root.join("runtime/python"));
                Reporter {
                    app: &app,
                    state: &state,
                    progress: &mut progress,
                    cancelled: &cancelled,
                    pid: &pid,
                }
                .run(cmd, false)?;
            }
            progress.phase = "Installing the CUDA music engine".into();
            progress.detail = "The initial runtime download is approximately 3 GB".into();
            publish(&app, &state, &progress);
            let mut cmd = command(&uv);
            cmd.args(["pip", "install", "--python"])
                .arg(python(&state.root))
                .arg("--requirements")
                .arg(state.resources.join("runtime-lock.txt"));
            cmd.arg(state.resources.join("yue2_infer-0.1.6-py3-none-any.whl"))
                .args([
                    "--extra-index-url",
                    "https://download.pytorch.org/whl/cu128",
                    "--index-strategy",
                    "unsafe-best-match",
                ]);
            cmd.env("UV_CACHE_DIR", state.root.join("runtime/cache"));
            Reporter {
                app: &app,
                state: &state,
                progress: &mut progress,
                cancelled: &cancelled,
                pid: &pid,
            }
            .run(cmd, false)?;
            progress.phase = "Downloading and verifying models".into();
            publish(&app, &state, &progress);
            let mut cmd = command(python(&state.root));
            cmd.arg("-u")
                .arg(state.resources.join("worker.py"))
                .arg("setup")
                .arg("--root")
                .arg(&state.root);
            Reporter {
                app: &app,
                state: &state,
                progress: &mut progress,
                cancelled: &cancelled,
                pid: &pid,
            }
            .run(cmd, true)?;
            Ok(())
        })();
        finish(&app, &state, &mut progress, &cancelled, outcome);
    });
    Ok(())
}

fn finish(
    app: &AppHandle,
    state: &AppState,
    progress: &mut Progress,
    cancelled: &AtomicBool,
    outcome: Result<(), String>,
) {
    progress.status = if cancelled.load(Ordering::SeqCst) {
        "paused"
    } else if outcome.is_ok() {
        "complete"
    } else {
        "failed"
    }
    .into();
    progress.error = if progress.status == "failed" {
        outcome.err()
    } else {
        None
    };
    if progress.status == "complete" {
        progress.phase = if progress.kind == "setup" {
            "Engine ready"
        } else {
            "Your song is ready"
        }
        .into();
        progress.detail.clear();
    }
    if let Ok(mut active) = state.active.lock() {
        if active.as_ref().is_some_and(|a| a.id == progress.id) {
            *active = None;
        }
    }
    publish(app, state, progress);
    let _ = app.emit("studio-changed", json!({"id":progress.id}));
}

pub fn generate(app: AppHandle, state: Arc<AppState>, request: Draft) -> Result<String, String> {
    request.validate()?;
    if !status(&state)?.installed {
        return Err("Set up the music engine first.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (cancelled, pid) = reserve(&state, &id)?;
    let song = Song {
        id: id.clone(),
        request,
        status: "running".into(),
        created: now(),
        duration: None,
        truncated: false,
        error: None,
        audio: None,
    };
    let db_result = state
        .db
        .lock()
        .map_err(|e| e.to_string())
        .and_then(|db| library::put(&db, &song));
    if let Err(error) = db_result {
        if let Ok(mut active) = state.active.lock() {
            *active = None;
        }
        return Err(error);
    }
    let mut progress = Progress {
        id: id.clone(),
        kind: "generation".into(),
        phase: "Preparing your song".into(),
        detail: song.request.title.clone(),
        completed: None,
        total: None,
        started: now(),
        status: "running".into(),
        error: None,
    };
    publish(&app, &state, &progress);
    let _ = app.emit("studio-changed", json!({"id":id}));
    std::thread::spawn(move || {
        let mut song = song;
        let outcome = (|| -> Result<(), String> {
            let output = state.root.join("outputs").join(&song.id);
            fs::create_dir_all(&output).map_err(|e| e.to_string())?;
            let request_file = output.join("maestro-request.json");
            fs::write(
                &request_file,
                serde_json::to_vec_pretty(&song.request).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let mut cmd = command(python(&state.root));
            cmd.arg("-u")
                .arg(state.resources.join("worker.py"))
                .arg("generate")
                .arg("--root")
                .arg(&state.root)
                .arg("--request")
                .arg(request_file)
                .arg("--output")
                .arg(&output);
            let report = Reporter {
                app: &app,
                state: &state,
                progress: &mut progress,
                cancelled: &cancelled,
                pid: &pid,
            }
            .run(cmd, true)?
            .ok_or("Missing verified song")?;
            song.duration = report["duration"].as_f64();
            song.truncated = report["truncated"].as_bool().unwrap_or(true);
            song.audio = Some(output.join("audio.wav").to_string_lossy().into());
            Ok(())
        })();
        song.status = if cancelled.load(Ordering::SeqCst) {
            "cancelled"
        } else if outcome.is_ok() {
            "complete"
        } else {
            "failed"
        }
        .into();
        song.error = outcome.as_ref().err().cloned();
        let saved = state
            .db
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|db| library::put(&db, &song));
        finish(&app, &state, &mut progress, &cancelled, outcome.and(saved));
    });
    Ok(id)
}
