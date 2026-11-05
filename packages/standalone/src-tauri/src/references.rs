use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub(crate) struct Baseline {
    pub source: String,
    pub label: String,
}

fn origin(id: Option<usize>, folders: &crate::Folders) -> Result<Option<PathBuf>, String> {
    let documents = folders.documents.lock().map_err(|e| e.to_string())?;
    id.map(|id| {
        documents
            .get(id)
            .ok_or("The originating document is closed")?
            .observed_path()
    })
    .transpose()
}

#[tauri::command]
pub(crate) fn reference_context(
    id: Option<usize>,
    folders: State<'_, crate::Folders>,
) -> Result<Option<String>, String> {
    Ok(origin(id, &folders)?.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub(crate) fn inspect_reference(
    id: Option<usize>,
    path: String,
    folders: State<'_, crate::Folders>,
) -> Result<String, String> {
    origin(id, &folders)?;
    let metadata =
        std::fs::metadata(&path).map_err(|e| format!("Could not inspect reference: {e}"))?;
    if metadata.is_dir() {
        Ok("directory".into())
    } else if metadata.is_file() {
        Ok("file".into())
    } else {
        Err("The reference is not a file or directory".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryEntry {
    name: String,
    is_directory: bool,
}

#[tauri::command]
pub(crate) fn reference_directory(
    id: Option<usize>,
    path: String,
    folders: State<'_, crate::Folders>,
) -> Result<Vec<DirectoryEntry>, String> {
    origin(id, &folders)?;
    directory_entries(Path::new(&path))
}

fn directory_entries(path: &Path) -> Result<Vec<DirectoryEntry>, String> {
    let mut entries = Vec::new();
    for entry in
        std::fs::read_dir(path).map_err(|e| format!("Could not read reference directory: {e}"))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        // Do not follow symlink directories into cycles or out of the candidate tree.
        if !kind.is_file() && !kind.is_dir() {
            continue;
        }
        entries.push(DirectoryEntry {
            name: entry
                .file_name()
                .into_string()
                .map_err(|_| "A reference file name is not valid UTF-8")?,
            is_directory: kind.is_dir(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

#[tauri::command]
pub(crate) async fn open_reference(
    id: Option<usize>,
    kind: String,
    value: String,
    folders: State<'_, crate::Folders>,
) -> Result<Option<crate::documents::Snapshot>, String> {
    origin(id, &folders)?;
    if kind == "url" {
        let url = tauri::Url::parse(&value).map_err(|e| e.to_string())?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err("Only HTTP and HTTPS references open in the browser".into());
        }
        open_external(url.as_str())?;
        return Ok(None);
    }
    if kind != "path" {
        return Err("Unknown reference kind".into());
    }
    let path = PathBuf::from(&value)
        .canonicalize()
        .map_err(|e| format!("Could not open reference: {e}"))?;
    if !path.is_file() {
        return Err("Choose a regular reference file".into());
    }
    if path
        .extension()
        .is_some_and(|extension| extension == "pfdsl")
    {
        return crate::add_document(crate::documents::Document::selected(&path)?, &folders)
            .map(Some);
    }
    open_external(
        path.to_str()
            .ok_or("The reference path is not valid UTF-8")?,
    )?;
    Ok(None)
}

#[cfg(target_os = "macos")]
fn open_external(value: &str) -> Result<(), String> {
    let result = Command::new("/usr/bin/open")
        .arg("--")
        .arg(value)
        .output()
        .map_err(|e| format!("Could not launch the default application: {e}"))?;
    if result.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not launch the default application: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ))
    }
}
#[cfg(not(target_os = "macos"))]
fn open_external(_value: &str) -> Result<(), String> {
    Err("External reference opening is available on macOS".into())
}

#[tauri::command]
pub(crate) async fn choose_comparison(app: tauri::AppHandle) -> Result<Option<Baseline>, String> {
    let Some(file) = app
        .dialog()
        .file()
        .add_filter("PFDSL", &["pfdsl"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    Ok(Some(Baseline {
        source: std::fs::read_to_string(&path)
            .map_err(|e| format!("Could not read comparison file: {e}"))?,
        label: path.to_string_lossy().into_owned(),
    }))
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git").current_dir(cwd).args(args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound { "Git is unavailable. Install Git from https://git-scm.com/download/mac, then restart PFDSL. File comparison and editing remain available.".into() }
        else { format!("Could not start Git: {e}. File comparison remains available.") }
    })?;
    if !output.status.success() {
        return Err(format!("Git comparison failed: {}. Check the repository, ref and tracked file; file comparison remains available.", String::from_utf8_lossy(&output.stderr).trim()));
    }
    String::from_utf8(output.stdout).map_err(|_| "Git comparison source is not valid UTF-8".into())
}

fn git_baseline_with(
    path: &Path,
    reference: &str,
    mut run: impl FnMut(&Path, &[&str]) -> Result<String, String>,
) -> Result<Baseline, String> {
    if reference.trim().is_empty() || reference.contains(['\0', '\n', '\r']) {
        return Err("Enter a single Git commit, branch or tag".into());
    }
    let cwd = path
        .parent()
        .ok_or("Save the document before using Git comparison")?;
    let root_text = run(cwd, &["rev-parse", "--show-toplevel"])?;
    let root = Path::new(root_text.trim_end_matches(['\n', '\r']));
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "The document is outside the detected Git repository")?;
    let resolved = run(
        root,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
    )?;
    let oid = resolved.trim();
    if !matches!(oid.len(), 40 | 64) || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Git returned an invalid commit identifier".into());
    }
    let object = format!(
        "{oid}:{}",
        relative.to_str().ok_or("The Git path is not valid UTF-8")?
    );
    let source = run(root, &["show", &object])?;
    Ok(Baseline {
        source,
        label: format!("Git {reference} ({})", &oid[..12]),
    })
}

#[tauri::command]
pub(crate) async fn compare_git(
    id: usize,
    reference: String,
    folders: State<'_, crate::Folders>,
) -> Result<Baseline, String> {
    let path =
        origin(Some(id), &folders)?.ok_or("Save the document before using Git comparison")?;
    git_baseline_with(&path, &reference, run_git)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn apple_quote(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "\\r")
    )
}

fn terminal_script(terminal: &str, command: &str, cwd: &str) -> Result<String, String> {
    if command.trim().is_empty() || command.contains('\0') || cwd.contains('\0') {
        return Err("The command and working directory must be valid text".into());
    }
    let body = format!("cd -- {} || exit\n{command}", shell_quote(cwd));
    let command = apple_quote(&format!("/bin/zsh -l -c {}", shell_quote(&body)));
    match terminal {
        "terminal" => Ok(format!("tell application \"Terminal\"\nactivate\ndo script {command}\nend tell")),
        "ghostty" => Ok(format!("tell application \"Ghostty\"\nset cfg to new surface configuration\nset initial working directory of cfg to {}\nset command of cfg to {command}\nset wait after command of cfg to true\nnew window with configuration cfg\nactivate\nend tell", apple_quote(cwd))),
        _ => Err("Choose Terminal.app or Ghostty".into()),
    }
}

#[tauri::command]
pub(crate) async fn run_process(
    id: Option<usize>,
    command: String,
    cwd: String,
    terminal: String,
    folders: State<'_, crate::Folders>,
) -> Result<(), String> {
    origin(id, &folders)?;
    let path = Path::new(&cwd)
        .canonicalize()
        .map_err(|e| format!("Could not use the command directory: {e}"))?;
    if !path.is_dir() {
        return Err("The command working directory is not a directory".into());
    }
    let script = terminal_script(
        &terminal,
        &command,
        path.to_str().ok_or("The command path is not valid UTF-8")?,
    )?;
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(script)
            .output()
            .map_err(|e| format!("Could not start {terminal}: {e}"))?;
        if !output.status.success() {
            return Err(format!("Could not start {terminal}. Check that the application is installed and Automation is allowed in System Settings: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = script;
        Err("External process commands are available on macOS".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn scripts_keep_shell_and_applescript_quoting_separate() {
        let command = "printf '%s\\n' \"日本語 'quoted'\"\nprintf done";
        let script = terminal_script("terminal", command, "/tmp/日本語 'a' \"b\"").unwrap();
        assert!(script.contains("tell application \"Terminal\""));
        assert!(script.contains("/bin/zsh -l -c"));
        assert!(script.contains("|| exit"));
        assert!(!script.contains("do script command"));
        let ghostty = terminal_script("ghostty", command, "/tmp/space dir").unwrap();
        assert!(ghostty.contains("new window with configuration"));
        assert!(ghostty.contains("initial working directory"));
        assert!(ghostty.contains("set wait after command of cfg to true"));
        assert!(terminal_script("unknown", command, "/tmp").is_err());
        assert!(terminal_script("terminal", "bad\0command", "/tmp").is_err());
        assert_eq!(shell_quote("a'b"), "'a'\\''b'");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_shell_and_applescript_literals_round_trip_without_executing_the_payload() {
        let payload = "echo \"日本語 'quote'\"\\path\nprintf done";
        let shell = Command::new("/bin/zsh")
            .args(["-c", &format!("printf '%s' {}", shell_quote(payload))])
            .output()
            .unwrap();
        assert!(shell.status.success());
        assert_eq!(String::from_utf8(shell.stdout).unwrap(), payload);
        let apple = Command::new("/usr/bin/osascript")
            .args(["-e", &format!("return {}", apple_quote(payload))])
            .output()
            .unwrap();
        assert!(
            apple.status.success(),
            "{}",
            String::from_utf8_lossy(&apple.stderr)
        );
        assert_eq!(
            String::from_utf8(apple.stdout)
                .unwrap()
                .trim_end_matches('\n'),
            payload
        );
    }

    #[test]
    fn candidate_listing_skips_symlinks_and_distinguishes_unreadable_paths() {
        let root =
            std::env::temp_dir().join(format!("pfdsl-reference-candidates-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::create_dir(root.join("nested")).unwrap();
        std::fs::write(root.join("日本語.pfdsl"), "a >> p").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&root, root.join("cycle")).unwrap();
        let entries = directory_entries(&root).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries
            .iter()
            .any(|entry| entry.name == "nested" && entry.is_directory));
        assert!(entries
            .iter()
            .any(|entry| entry.name == "日本語.pfdsl" && !entry.is_directory));
        assert!(directory_entries(&root.join("missing")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn git_uses_a_verified_commit_and_literal_path_without_a_shell() {
        let mut calls = Vec::new();
        let baseline = git_baseline_with(
            Path::new("/repo/sub dir/日本語.pfdsl"),
            "--bad ' ref",
            |cwd, args| {
                calls.push((
                    cwd.to_path_buf(),
                    args.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
                ));
                Ok(match calls.len() {
                    1 => "/repo\n",
                    2 => "0123456789012345678901234567890123456789\n",
                    _ => "a >> p -> b\n",
                }
                .to_string())
            },
        )
        .unwrap();
        assert_eq!(baseline.source, "a >> p -> b\n");
        assert_eq!(
            calls[1].1,
            [
                "rev-parse",
                "--verify",
                "--end-of-options",
                "--bad ' ref^{commit}"
            ]
        );
        assert_eq!(
            calls[2].1,
            [
                "show",
                "0123456789012345678901234567890123456789:sub dir/日本語.pfdsl"
            ]
        );
        assert!(git_baseline_with(Path::new("/repo/a.pfdsl"), "", |_, _| unreachable!()).is_err());
        let error = git_baseline_with(Path::new("/repo/a.pfdsl"), "HEAD", |_, _| {
            Err("Git is unavailable".to_string())
        })
        .err()
        .unwrap();
        assert!(error.contains("Git is unavailable"));
    }
}
