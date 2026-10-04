mod workspace;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

struct Folders {
    roots: Mutex<Vec<workspace::Folder>>,
    acceptance: Option<PathBuf>,
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
        .manage(Folders {
            roots: Mutex::new(roots),
            acceptance,
        })
        .setup(move |app| {
            if verifying {
                use tauri::Manager;
                app.get_webview_window("main")
                    .ok_or("Main window is unavailable")?
                    .set_title("PFDSL — Acceptance")?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            select_folder,
            list_documents,
            read_document,
            confirm_discard,
            acceptance_baseline,
            acceptance_executable,
            write_acceptance_report
        ])
        .run(tauri::generate_context!())
        .expect("Could not start PFDSL");
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
async fn confirm_discard(window: tauri::Window) -> Result<(), String> {
    if window
        .dialog()
        .message("Discard the changes in this window? They have not been saved.")
        .title("PFDSL")
        .parent(&window)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Discard".into(),
            "Keep Editing".into(),
        ))
        .blocking_show()
    {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
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
