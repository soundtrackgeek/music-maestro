mod engine;
mod library;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};

pub struct AppState {
    root: PathBuf,
    resources: PathBuf,
    db: Mutex<rusqlite::Connection>,
    active: Mutex<Option<engine::Active>>,
    progress: Mutex<Option<engine::Progress>>,
    hardware: engine::Hardware,
}

#[tauri::command]
fn engine_status(state: State<Arc<AppState>>) -> Result<engine::EngineStatus, String> {
    engine::status(&state)
}
#[tauri::command]
fn list_songs(state: State<Arc<AppState>>) -> Result<Vec<library::Song>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    library::list(&db)
}
#[tauri::command]
fn setup_engine(app: tauri::AppHandle, state: State<Arc<AppState>>) -> Result<(), String> {
    engine::setup(app, state.inner().clone())
}
#[tauri::command]
fn create_song(
    app: tauri::AppHandle,
    state: State<Arc<AppState>>,
    request: library::Draft,
) -> Result<String, String> {
    engine::generate(app, state.inner().clone(), request)
}
#[tauri::command]
fn cancel_operation(state: State<Arc<AppState>>) -> Result<(), String> {
    engine::cancel(&state)
}
#[tauri::command]
fn export_song(
    state: State<Arc<AppState>>,
    id: String,
    format: String,
    destination: String,
) -> Result<(), String> {
    if !["wav", "flac"].contains(&format.as_str()) {
        return Err("Choose WAV or FLAC.".into());
    }
    let song = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        library::get(&db, &id)?
    };
    if song.status != "complete" || uuid::Uuid::parse_str(&id).is_err() {
        return Err("This song has no completed audio.".into());
    }
    let target = PathBuf::from(destination);
    if target
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case(&format))
    {
        return Err(format!("Choose a .{format} file."));
    }
    let source = state
        .root
        .join("outputs")
        .join(id)
        .join(format!("audio.{format}"));
    let canonical_source = source.canonicalize().map_err(|e| e.to_string())?;
    if target.exists() && target.canonicalize().ok().as_ref() == Some(&canonical_source) {
        return Err("Choose an export location outside the original song file.".into());
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().local_data_dir()?.join("MusicMaestro");
            fs::create_dir_all(&root)?;
            fs::create_dir_all(root.join("outputs"))?;
            app.asset_protocol_scope()
                .allow_directory(root.join("outputs"), true)?;
            let resources = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")
            } else {
                app.path().resource_dir()?.join("engine")
            };
            let db = library::open(&root).map_err(std::io::Error::other)?;
            app.manage(Arc::new(AppState {
                root,
                resources,
                db: Mutex::new(db),
                active: Mutex::new(None),
                progress: Mutex::new(None),
                hardware: engine::hardware(),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_status,
            list_songs,
            setup_engine,
            create_song,
            cancel_operation,
            export_song
        ])
        .build(tauri::generate_context!())
        .expect("Music Maestro could not start");
    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app.state::<Arc<AppState>>();
            let _ = engine::cancel(&state);
        }
    });
}
