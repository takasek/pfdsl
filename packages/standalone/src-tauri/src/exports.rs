use cap_std::fs::{Dir, MetadataExt};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::State;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogResult};

const FORMATS: [&str; 5] = ["dot", "svg", "pdf", "png", "tsv"];
fn validate_formats(formats: &[String]) -> Result<(), String> {
    if formats.is_empty()
        || formats.len() > 5
        || formats.iter().any(|f| !FORMATS.contains(&f.as_str()))
        || formats.iter().collect::<HashSet<_>>().len() != formats.len()
    {
        return Err("Choose one export format or All".into());
    }
    Ok(())
}

fn revision(dir: &Dir, leaf: &str) -> Result<Option<Vec<u8>>, String> {
    match dir.symlink_metadata(leaf) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
            Err(format!("Export target is not a regular file: {leaf}"))
        }
        Ok(meta) => {
            let file = dir.open(leaf).map_err(|e| e.to_string())?;
            let protection = crate::native_directory::protection_revision(
                &crate::native_directory::capture(&file)?,
            );
            let mut hash = Sha256::new();
            hash.update(format!(
                "{}:{}:{:?}:{protection}",
                meta.dev(),
                meta.ino(),
                meta.modified().ok()
            ));
            hash.update(dir.read(leaf).map_err(|e| e.to_string())?);
            Ok(Some(hash.finalize().to_vec()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
struct Target {
    leaf: String,
    observed: Option<Vec<u8>>,
}
struct ExportSession {
    dir: Dir,
    path: PathBuf,
    targets: HashMap<String, Target>,
}
impl ExportSession {
    fn new(path: &Path, stem: &str, formats: &[String]) -> Result<Self, String> {
        validate_formats(formats)?;
        if stem.is_empty() || stem == "." || stem == ".." || stem.contains(['/', '\\', '\0']) {
            return Err("Choose a single export file name".into());
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let dir = Dir::open_ambient_dir(&path, cap_std::ambient_authority())
            .map_err(|e| e.to_string())?;
        let mut targets = HashMap::new();
        for format in formats {
            let leaf = format!("{stem}.{format}");
            let observed = revision(&dir, &leaf)?;
            targets.insert(format.clone(), Target { leaf, observed });
        }
        Ok(Self { dir, path, targets })
    }
    fn write(&mut self, format: &str, bytes: &[u8]) -> Result<String, String> {
        self.write_with_hooks(format, bytes, || {}, || {})
    }
    fn write_with_hooks(
        &mut self,
        format: &str,
        bytes: &[u8],
        before_publish: impl FnOnce(),
        after_publish: impl FnOnce(),
    ) -> Result<String, String> {
        crate::native_directory::require_save()?;
        if bytes.len() > 256 * 1024 * 1024 {
            return Err("Export exceeds the 256 MiB file limit".into());
        }
        let target = self
            .targets
            .remove(format)
            .ok_or("This format was not selected or has already been attempted")?;
        crate::native_directory::validate_binding(&self.dir, &self.path)?;
        if revision(&self.dir, &target.leaf)? != target.observed {
            return Err(format!(
                "Export target changed after selection: {}. Select it again.",
                target.leaf
            ));
        }
        static SERIAL: AtomicU64 = AtomicU64::new(0);
        let stage = format!(
            ".pfdsl-export-{}-{}.tmp",
            std::process::id(),
            SERIAL.fetch_add(1, Ordering::Relaxed)
        );
        let original = if target.observed.is_some() {
            Some(
                crate::native_directory::open_writable(&self.dir, &target.leaf)
                    .map_err(|e| format!("The export target is not writable: {e}"))?,
            )
        } else {
            None
        };
        let protection = original
            .as_ref()
            .map(crate::native_directory::capture)
            .transpose()?
            .flatten();
        let mut file =
            crate::native_directory::create_stage(&self.dir, &stage, original.is_some())?;
        let result = (|| {
            if let (Some(stamp), Some(original)) = (&protection, &original) {
                stamp.copy_to(original, &file)?;
            }
            file.write_all(bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())?;
            crate::native_directory::validate_binding(&self.dir, &self.path)?;
            if revision(&self.dir, &target.leaf)? != target.observed {
                return Err("Export target changed during conversion; select it again".into());
            }
            before_publish();
            crate::native_directory::publish(
                &self.dir,
                &stage,
                &target.leaf,
                target.observed.is_some(),
            )?;
            after_publish();
            crate::native_directory::validate_binding(&self.dir, &self.path).map_err(|e| {
                format!("The export was published, but its saved path could not be confirmed: {e}")
            })?;
            let confirmed = self.dir.read(&target.leaf).map_err(|e| {
                format!("The export was published, but could not be read back: {e}")
            })?;
            if confirmed != bytes {
                return Err("The export was published, but the target changed before confirmation. Inspect the destination before retrying.".into());
            }
            Ok(self.path.join(&target.leaf).to_string_lossy().into_owned())
        })();
        if result.is_err() {
            let _ = self.dir.remove_file(&stage);
        }
        result
    }
}

#[derive(Default)]
pub(crate) struct Exports {
    next: AtomicU64,
    sessions: Mutex<HashMap<u64, ExportSession>>,
}
#[derive(Serialize)]
pub(crate) struct Selection {
    id: u64,
    paths: HashMap<String, String>,
}

#[tauri::command]
pub(crate) async fn choose_export(
    app: tauri::AppHandle,
    exports: State<'_, Exports>,
    name: String,
    formats: Vec<String>,
) -> Result<Option<Selection>, String> {
    crate::native_directory::require_save()?;
    validate_formats(&formats)?;
    let first = &formats[0];
    let Some(file) = app
        .dialog()
        .file()
        .set_title("Export — choose file name and destination")
        .set_file_name(format!("{name}.{first}"))
        .add_filter("Export", &[first.as_str()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("The export name is not valid UTF-8")?;
    let session = ExportSession::new(
        path.parent().ok_or("Choose an export directory")?,
        stem,
        &formats,
    )?;
    let mut existing: Vec<_> = session
        .targets
        .values()
        .filter(|target| target.observed.is_some())
        .map(|t| t.leaf.as_str())
        .collect();
    existing.sort();
    if !existing.is_empty() {
        let answer = app
            .dialog()
            .message(format!(
                "Replace these export files?\n{}\nCancel keeps all files unchanged.",
                existing.join("\n")
            ))
            .title("Replace export files")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Replace files".into(),
                "Cancel".into(),
            ))
            .blocking_show_with_result();
        if !matches!(
            answer,
            MessageDialogResult::Ok | MessageDialogResult::Custom(_)
        ) {
            return Ok(None);
        }
        // Custom results must match the affirmative label, not merely be present.
        if let MessageDialogResult::Custom(ref value) = answer {
            if value != "Replace files" {
                return Ok(None);
            }
        }
    }
    let paths = session
        .targets
        .iter()
        .map(|(format, t)| {
            (
                format.clone(),
                session.path.join(&t.leaf).to_string_lossy().into_owned(),
            )
        })
        .collect();
    let id = exports.next.fetch_add(1, Ordering::Relaxed);
    exports
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, session);
    Ok(Some(Selection { id, paths }))
}

#[tauri::command]
pub(crate) async fn write_export(
    exports: State<'_, Exports>,
    id: u64,
    format: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    exports
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get_mut(&id)
        .ok_or("The export selection has expired")?
        .write(&format, &bytes)
}
#[tauri::command]
pub(crate) fn release_export(exports: State<'_, Exports>, id: u64) -> Result<(), String> {
    exports
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn export_pdf(svg: String, width: f64, height: f64) -> Result<Vec<u8>, String> {
    let html = crate::pdf::envelope(&svg, width, height)?;
    crate::pdf::render(html, (width * 0.75).ceil(), (height * 0.75).ceil()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn format_and_leaf_scope_are_fixed_before_writing() {
        assert!(validate_formats(&["svg".into(), "pdf".into()]).is_ok());
        for formats in [
            vec!["../escape".into()],
            vec![],
            vec!["svg".into(), "svg".into()],
        ] {
            assert!(validate_formats(&formats).is_err());
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn staged_outputs_preserve_success_and_refuse_changed_targets() {
        let root = std::env::temp_dir().join(format!("pfdsl-export-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("日本語.svg"), "old").unwrap();
        let mut session =
            ExportSession::new(&root, "日本語", &["dot".into(), "svg".into(), "tsv".into()])
                .unwrap();
        assert!(session.write("../escape", b"bad").is_err());
        let path = session.write("dot", b"digraph {}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "digraph {}");
        std::fs::write(root.join("日本語.svg"), "changed after chooser").unwrap();
        assert!(session.write("svg", b"replacement").is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("日本語.svg")).unwrap(),
            "changed after chooser"
        );
        assert!(session.write("tsv", b"kind\tid\n").is_ok());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 3);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn replacing_exports_keeps_private_permissions_and_refuses_read_only_targets() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("pfdsl-export-mode-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("private.svg");
        std::fs::write(&path, "old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let mut session = ExportSession::new(&root, "private", &["svg".into()]).unwrap();
        session.write("svg", b"replacement").unwrap();
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o400)).unwrap();
        let mut session = ExportSession::new(&root, "private", &["svg".into()]).unwrap();
        assert!(session.write("svg", b"must not replace").is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "replacement");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn a_move_during_publication_never_reports_a_stale_success_path() {
        let root =
            std::env::temp_dir().join(format!("pfdsl-export-publish-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let selected = root.join("selected");
        let moved = root.join("moved");
        std::fs::create_dir(&selected).unwrap();
        let mut session = ExportSession::new(&selected, "a", &["dot".into()]).unwrap();
        let error = session
            .write_with_hooks(
                "dot",
                b"digraph {}",
                || std::fs::rename(&selected, &moved).unwrap(),
                || {},
            )
            .unwrap_err();
        assert!(error.contains("published"));
        assert_eq!(
            std::fs::read_to_string(moved.join("a.dot")).unwrap(),
            "digraph {}"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
