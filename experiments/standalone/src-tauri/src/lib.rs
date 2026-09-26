mod pdf;
mod workspace;

use serde::Serialize;
use std::path::Path;
use tauri::State;
use workspace::Workspace;

#[derive(Serialize)]
struct DocumentEntry {
    path: String,
    name: String,
}

#[derive(Serialize)]
struct Document {
    path: String,
    text: String,
}

#[tauri::command]
fn list_documents(workspace: State<'_, Workspace>) -> Result<Vec<DocumentEntry>, String> {
    Ok(workspace
        .documents()?
        .into_iter()
        .map(|path| {
            let name = Path::new(&path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            DocumentEntry { path, name }
        })
        .collect())
}

#[tauri::command]
fn read_document(path: String, workspace: State<'_, Workspace>) -> Result<Document, String> {
    let text = workspace.read(&path)?;
    Ok(Document { path, text })
}

#[tauri::command]
fn write_document(
    path: String,
    text: String,
    expected_text: String,
    workspace: State<'_, Workspace>,
) -> Result<(), String> {
    workspace.write_document(&path, &text, &expected_text)
}

#[tauri::command]
fn write_export(
    path: String,
    bytes: Vec<u8>,
    workspace: State<'_, Workspace>,
) -> Result<(), String> {
    workspace.write_export(&path, &bytes)
}

#[tauri::command]
async fn export_pdf(
    path: String,
    svg: String,
    width: f64,
    height: f64,
    workspace: State<'_, Workspace>,
) -> Result<(), String> {
    workspace.validate_export(&path)?;
    if Path::new(&path).extension().and_then(|s| s.to_str()) != Some("pdf") {
        return Err("PDF export requires a .pdf path".into());
    }
    let html = pdf::envelope(&svg, width, height)?;
    let bytes = pdf::render(html, width, height).await?;
    workspace.write_export(&path, &bytes)
}

pub fn run() {
    let root = std::env::var("PFDSL_SPIKE_WORKSPACE")
        .expect("PFDSL_SPIKE_WORKSPACE must point to the copied prototype corpus");
    let workspace = Workspace::new(Path::new(&root)).expect("Cannot open prototype workspace");
    tauri::Builder::default()
        .manage(workspace)
        .invoke_handler(tauri::generate_handler![
            list_documents,
            read_document,
            write_document,
            write_export,
            export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("Failed to run PFDSL Prototype");
}
