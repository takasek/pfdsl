mod workspace;
mod documents;
mod exit;
mod exit_gate;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

struct Folders {
    roots: Mutex<Vec<workspace::Folder>>,
    acceptance: Option<PathBuf>,
    documents: Mutex<Vec<documents::Document>>,
}

#[tauri::command]
async fn select_folder(
    app: tauri::AppHandle,
    folders: State<'_, Folders>,
) -> Result<Option<String>, String> {
    let Some(folder) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let root = workspace::Folder::open(&folder.into_path().map_err(|e| e.to_string())?)?;
    let path = root.path.to_string_lossy().into_owned();
    folders.roots.lock().map_err(|e| e.to_string())?.push(root);
    Ok(Some(path))
}

#[tauri::command]
fn list_documents(folders: State<'_, Folders>) -> Result<Vec<String>, String> {
    let roots = folders.roots.lock().map_err(|e| e.to_string())?;
    let root = roots.last().ok_or("Choose a folder first")?;
    workspace::documents(root)
}

#[tauri::command]
fn read_document(path: String, folders: State<'_, Folders>) -> Result<String, String> {
    let roots = folders.roots.lock().map_err(|e| e.to_string())?;
    workspace::read(&roots, &PathBuf::from(path))
}

pub fn run() {
    let acceptance = std::env::var("PFDSL_ACCEPTANCE_ROOT").ok().map(|path| {
        PathBuf::from(path)
            .canonicalize()
            .expect("Invalid acceptance corpus")
    });
    let roots = acceptance
        .iter()
        .map(|path| workspace::Folder::open(path).expect("Could not open acceptance corpus"))
        .collect();
    let verifying = acceptance.is_some();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(exit_gate::ExitGate::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                exit::request(window.app_handle());
            }
        })
        .manage(Folders {
            roots: Mutex::new(roots),
            acceptance,
            documents: Mutex::new(Vec::new()),
        })
        .setup(move |app| {
            exit::install(app.handle()).map_err(std::io::Error::other)?;
            if verifying {
                use tauri::Manager;
                app.get_webview_window("main")
                    .ok_or("Main window is unavailable")?
                    .set_title("PFDSL — Acceptance")?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            exit::finish_app_exit,
            exit::exit_listener_ready,
            select_folder,
            list_documents,
            read_document,
            select_document,
            open_document,
            inspect_document,
            save_document,
            choose_save_target,
            read_dependency,
            read_retained,
            confirm_close_document,
            list_recent,
            open_recent,
            remember_document,
            remember_folder,
            open_recent_folder,
            acceptance_baseline,
            acceptance_executable,
            write_acceptance_report
        ])
        .build(tauri::generate_context!())
        .expect("Could not start PFDSL")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<exit_gate::ExitGate>().take_approval() {
                    api.prevent_exit();
                    exit::request(app);
                }
            }
        });
}

#[tauri::command]
fn acceptance_executable(folders: State<'_, Folders>) -> Result<(String, String), String> {
    use sha2::{Digest, Sha256};
    folders
        .acceptance
        .as_ref()
        .ok_or("Acceptance mode is not enabled")?;
    let path = std::env::current_exe().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok((
        path.to_string_lossy().into_owned(),
        format!("{:x}", Sha256::digest(bytes)),
    ))
}

#[tauri::command]
fn acceptance_baseline(folders: State<'_, Folders>) -> Result<Option<String>, String> {
    let roots = folders.roots.lock().map_err(|e| e.to_string())?;
    folders
        .acceptance
        .as_ref()
        .map(|root| workspace::read(&roots, &root.join("baseline.json")))
        .transpose()
}

#[tauri::command]
fn write_acceptance_report(report: String, folders: State<'_, Folders>) -> Result<(), String> {
    let path = folders
        .acceptance
        .as_ref()
        .ok_or("Acceptance mode is not enabled")?;
    let roots = folders.roots.lock().map_err(|e| e.to_string())?;
    let root = roots
        .iter()
        .find(|root| &root.path == path)
        .ok_or("Acceptance folder is unavailable")?;
    root.write_acceptance_report(&report)
}

fn add_document(document: documents::Document, folders: &Folders) -> Result<documents::Snapshot, String> {
    let mut entries = folders.documents.lock().map_err(|e| e.to_string())?;
    let id = entries.len();
    let snapshot = document.inspect(id)?;
    entries.push(document);
    Ok(snapshot)
}

#[tauri::command]
async fn select_document(app: tauri::AppHandle, folders: State<'_, Folders>) -> Result<Option<documents::Snapshot>, String> {
    let Some(file) = app.dialog().file().add_filter("PFDSL", &["pfdsl"]).blocking_pick_file() else { return Ok(None); };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let document = documents::Document::selected(&path)?;
    Ok(Some(add_document(document, &folders)?))
}

#[tauri::command]
fn open_document(path: String, folders: State<'_, Folders>) -> Result<documents::Snapshot, String> {
    let roots = folders.roots.lock().map_err(|e| e.to_string())?;
    add_document(documents::Document::inside(&roots, &PathBuf::from(path))?, &folders)
}
#[tauri::command]
fn inspect_document(id: usize, folders: State<'_, Folders>) -> Result<documents::Snapshot, String> {
    let entries = folders.documents.lock().map_err(|e| e.to_string())?;
    entries.get(id).ok_or("Unknown document")?.inspect(id)
}
#[tauri::command]
fn save_document(id: usize, source: String, expected: Option<String>, folders: State<'_, Folders>) -> Result<documents::SaveResult, String> {
    let mut entries = folders.documents.lock().map_err(|e| e.to_string())?;
    Ok(entries.get_mut(id).ok_or("Unknown document")?.save(id, &source, expected.as_deref()))
}
#[tauri::command]
async fn choose_save_target(name: String, app: tauri::AppHandle, folders: State<'_, Folders>) -> Result<Option<documents::Snapshot>, String> {
    let Some(file) = app.dialog().file().add_filter("PFDSL", &["pfdsl"]).set_file_name(name).blocking_save_file() else { return Ok(None); };
    let path = file.into_path().map_err(|e| e.to_string())?;
    Ok(Some(add_document(documents::Document::selected(&path)?, &folders)?))
}
#[tauri::command]
fn read_dependency(id: usize, path: String, folders: State<'_, Folders>) -> Result<String, String> {
    let entries = folders.documents.lock().map_err(|e| e.to_string())?;
    entries.get(id).ok_or("Unknown document")?.read_dependency(&PathBuf::from(path))
}
#[tauri::command]
fn read_retained(id: usize, path: String, folders: State<'_, Folders>) -> Result<documents::Snapshot, String> {
    let entries = folders.documents.lock().map_err(|e| e.to_string())?;
    entries.get(id).ok_or("Unknown document")?.retained_snapshot(id, &path)
}
#[tauri::command]
async fn confirm_close_document(name: String, window: tauri::Window) -> Result<String, String> {
    let decision = window.dialog().message(format!("Save changes to {name}?"))
        .title("PFDSL").parent(&window)
        .buttons(MessageDialogButtons::YesNoCancelCustom("Save".into(), "Discard".into(), "Cancel".into()))
        .blocking_show_with_result();
    Ok(match decision {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(ref choice) if choice == "Save" => "save",
        MessageDialogResult::Custom(ref choice) if choice == "Discard" => "discard",
        _ => "cancel",
    }.into())
}
fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = std::env::var_os("PFDSL_DOCUMENTS_STATE_DIR").map(PathBuf::from)
        .map(Ok).unwrap_or_else(|| app.path().app_local_data_dir().map_err(|e| e.to_string()))?;
    Ok(directory.join("recent-documents.json"))
}
#[derive(serde::Serialize, serde::Deserialize)]
struct RecentTarget { kind: String, path: String }
fn read_recent(app: &tauri::AppHandle) -> Result<Vec<RecentTarget>, String> {
    match std::fs::read_to_string(recent_path(app)?) {
        Ok(source) => serde_json::from_str(&source).map_err(|e| format!("Could not read recent targets: {e}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(error) => Err(error.to_string()),
    }
}
#[tauri::command]
fn list_recent(app: tauri::AppHandle) -> Result<Vec<RecentTarget>, String> { read_recent(&app) }
#[tauri::command]
fn remember_document(path: String, app: tauri::AppHandle, folders: State<'_, Folders>) -> Result<(), String> {
    let entries = folders.documents.lock().map_err(|e| e.to_string())?;
    if !entries.iter().any(|d| d.observed_path().ok().is_some_and(|p| p.to_string_lossy() == path)) { return Err("The target has not been selected".into()); }
    remember_target(&app, "file", path)
}
fn remember_target(app: &tauri::AppHandle, kind: &str, path: String) -> Result<(), String> {
    let mut recent = read_recent(app)?;
    recent.retain(|p| p.path != path || p.kind != kind);
    recent.insert(0, RecentTarget { kind: kind.into(), path }); recent.truncate(20);
    let destination = recent_path(app)?;
    std::fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
    let staged = destination.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&staged, serde_json::to_vec(&recent).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&staged, destination).map_err(|e| e.to_string())
}
#[tauri::command]
fn remember_folder(path: String, app: tauri::AppHandle, folders: State<'_, Folders>) -> Result<(), String> {
    let roots = folders.roots.lock().map_err(|e| e.to_string())?;
    if !roots.iter().any(|root| root.path.to_string_lossy() == path) { return Err("The folder has not been selected".into()); }
    remember_target(&app, "folder", path)
}
#[tauri::command]
fn open_recent_folder(path: String, app: tauri::AppHandle, folders: State<'_, Folders>) -> Result<String, String> {
    if !read_recent(&app)?.iter().any(|p| p.kind == "folder" && p.path == path) { return Err("Unknown recent folder".into()); }
    let root = workspace::Folder::open(&PathBuf::from(&path))?;
    let result = root.path.to_string_lossy().into_owned();
    folders.roots.lock().map_err(|e| e.to_string())?.push(root);
    Ok(result)
}

#[tauri::command]
fn open_recent(path: String, app: tauri::AppHandle, folders: State<'_, Folders>) -> Result<documents::Snapshot, String> {
    if !read_recent(&app)?.iter().any(|p| p.kind == "file" && p.path == path) { return Err("Unknown recent target".into()); }
    add_document(documents::Document::selected(&PathBuf::from(path))?, &folders)
}
