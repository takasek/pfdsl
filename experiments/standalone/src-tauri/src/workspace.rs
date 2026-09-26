use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};

pub struct Workspace {
    root: PathBuf,
    writes: Mutex<()>,
}
static NEXT_WRITE: AtomicUsize = AtomicUsize::new(0);

impl Workspace {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root = root
            .canonicalize()
            .map_err(|e| format!("Cannot open workspace: {e}"))?;
        if !root.is_dir() {
            return Err("Workspace must be a directory".into());
        }
        Ok(Self {
            root,
            writes: Mutex::new(()),
        })
    }

    fn resolve(&self, relative: &str) -> Result<PathBuf, String> {
        let mut normalized = PathBuf::new();
        for component in Path::new(relative).components() {
            match component {
                Component::Normal(part) => normalized.push(part),
                Component::CurDir => {}
                Component::ParentDir if normalized.pop() => {}
                _ => return Err("Path must remain inside the workspace".into()),
            }
        }
        if normalized.as_os_str().is_empty() {
            return Err("A file path is required".into());
        }
        let candidate = self.root.join(normalized);
        let resolved = match fs::symlink_metadata(&candidate) {
            Ok(_) => candidate.canonicalize(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => candidate
                .parent()
                .unwrap()
                .canonicalize()
                .map(|parent| parent.join(candidate.file_name().unwrap())),
            Err(error) => Err(error),
        }
        .map_err(|e| format!("Cannot resolve workspace path: {e}"))?;
        if !resolved.starts_with(&self.root) {
            return Err("Path must remain inside the workspace".into());
        }
        Ok(resolved)
    }

    pub fn read(&self, path: &str) -> Result<String, String> {
        let path = self.resolve(path)?;
        require_extension(&path, &["pfdsl"])?;
        fs::read_to_string(path).map_err(|e| format!("Cannot read document: {e}"))
    }

    pub fn write_document(&self, path: &str, text: &str, expected: &str) -> Result<(), String> {
        let _guard = self
            .writes
            .lock()
            .map_err(|_| "Workspace write lock failed")?;
        let path = self.resolve(path)?;
        require_extension(&path, &["pfdsl"])?;
        let current = fs::read_to_string(&path)
            .map_err(|e| format!("Cannot read document before saving: {e}"))?;
        if current != expected {
            return Err("Document changed on disk. Reload before saving; your editor changes have not been written.".into());
        }
        atomic_write(&path, text.as_bytes())
    }

    pub fn validate_export(&self, path: &str) -> Result<(), String> {
        self.export_path(path).map(|_| ())
    }

    fn export_path(&self, path: &str) -> Result<PathBuf, String> {
        let path = self.resolve(path)?;
        if !path.starts_with(self.root.join("exports")) {
            return Err("Exports must be written beneath exports/".into());
        }
        require_extension(&path, &["svg", "png", "pdf", "json"])?;
        Ok(path)
    }

    pub fn write_export(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let _guard = self
            .writes
            .lock()
            .map_err(|_| "Workspace write lock failed")?;
        let path = self.export_path(path)?;
        atomic_write(&path, bytes)
    }

    pub fn documents(&self) -> Result<Vec<String>, String> {
        let mut paths = Vec::new();
        let samples = self.resolve("docs/samples")?;
        if samples.is_dir() {
            for entry in fs::read_dir(samples).map_err(|e| format!("Cannot list samples: {e}"))? {
                let entry = entry.map_err(|e| format!("Cannot list sample: {e}"))?;
                if entry.path().extension().and_then(|s| s.to_str()) == Some("pfdsl") {
                    let path = format!("docs/samples/{}", entry.file_name().to_string_lossy());
                    if self.resolve(&path)?.is_file() {
                        paths.push(path);
                    }
                }
            }
        }
        for name in ["roadmap", "pipeline", "workflow"] {
            let path = format!(".pfdsl/{name}.pfdsl");
            if self.resolve(&path)?.is_file() {
                paths.push(path);
            }
        }
        paths.sort();
        Ok(paths)
    }
}

fn require_extension(path: &Path, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&path.extension().and_then(|s| s.to_str()).unwrap_or("")) {
        Ok(())
    } else {
        Err(format!(
            "File extension must be one of: {}",
            allowed.join(", ")
        ))
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.parent().unwrap().join(format!(
        ".pfdsl-save-{}-{}",
        std::process::id(),
        NEXT_WRITE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| format!("Cannot create temporary workspace file: {e}"))?;
    let result = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| format!("Cannot write workspace file: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        sync::atomic::{AtomicUsize, Ordering},
    };
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "pfdsl-native-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("docs/samples")).unwrap();
            fs::create_dir_all(path.join(".pfdsl")).unwrap();
            fs::create_dir_all(path.join("exports")).unwrap();
            fs::write(path.join("docs/samples/a.pfdsl"), "original").unwrap();
            fs::write(path.join(".pfdsl/roadmap.pfdsl"), "roadmap").unwrap();
            Self(path)
        }
        fn workspace(&self) -> Workspace {
            Workspace::new(&self.0).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn reads_normalized_relative_paths_without_writing() {
        let fixture = Fixture::new();
        assert_eq!(
            fixture
                .workspace()
                .read("docs/samples/../samples/a.pfdsl")
                .unwrap(),
            "original"
        );
        assert_eq!(
            fs::read_to_string(fixture.0.join("docs/samples/a.pfdsl")).unwrap(),
            "original"
        );
    }

    #[test]
    fn rejects_absolute_and_escaping_paths() {
        let fixture = Fixture::new();
        for path in [
            "/etc/passwd",
            "../outside.pfdsl",
            "docs/../../outside.pfdsl",
            "",
        ] {
            assert!(fixture.workspace().read(path).is_err(), "{path}");
            assert!(
                fixture.workspace().write_export(path, b"data").is_err(),
                "{path}"
            );
        }
    }

    #[test]
    fn saves_only_when_disk_matches_expected_text() {
        let fixture = Fixture::new();
        let workspace = fixture.workspace();
        workspace
            .write_document("docs/samples/a.pfdsl", "edited", "original")
            .unwrap();
        assert_eq!(workspace.read("docs/samples/a.pfdsl").unwrap(), "edited");
        let error = workspace
            .write_document("docs/samples/a.pfdsl", "stale", "original")
            .unwrap_err();
        assert!(error.contains("changed on disk"), "{error}");
        assert_eq!(workspace.read("docs/samples/a.pfdsl").unwrap(), "edited");
    }

    #[test]
    fn exports_bytes_without_overwriting_documents() {
        let fixture = Fixture::new();
        let workspace = fixture.workspace();
        workspace
            .write_export("exports/chart.png", b"image bytes")
            .unwrap();
        assert_eq!(
            fs::read(fixture.0.join("exports/chart.png")).unwrap(),
            b"image bytes"
        );
        assert!(workspace
            .write_export("docs/samples/a.pfdsl", b"destroyed")
            .is_err());
        assert_eq!(workspace.read("docs/samples/a.pfdsl").unwrap(), "original");
    }

    #[test]
    fn exports_reports_only_beneath_exports_directory() {
        let fixture = Fixture::new();
        let workspace = fixture.workspace();
        workspace
            .write_export("exports/report.json", br#"{"ok":true}"#)
            .unwrap();
        assert!(workspace
            .write_export("docs/samples/report.json", b"{}")
            .is_err());
        assert!(workspace
            .write_export("exports/../outside.svg", b"svg")
            .is_err());
    }

    #[test]
    fn lists_only_the_requested_corpus() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join(".pfdsl/other.pfdsl"), "ignored").unwrap();
        fs::write(fixture.0.join("docs/samples/readme.md"), "ignored").unwrap();
        assert_eq!(
            fixture.workspace().documents().unwrap(),
            vec![".pfdsl/roadmap.pfdsl", "docs/samples/a.pfdsl"]
        );
    }

    #[test]
    fn rejects_symlink_escapes_for_reads_and_new_exports() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        symlink(
            outside.0.join("docs/samples/a.pfdsl"),
            fixture.0.join("docs/samples/link.pfdsl"),
        )
        .unwrap();
        symlink(&outside.0, fixture.0.join("escape")).unwrap();
        let workspace = fixture.workspace();
        assert!(workspace.read("docs/samples/link.pfdsl").is_err());
        assert!(workspace
            .write_document("docs/samples/link.pfdsl", "bad", "original")
            .is_err());
        assert!(workspace.write_export("escape/out.pdf", b"bad").is_err());
        assert_eq!(
            fs::read_to_string(outside.0.join("docs/samples/a.pfdsl")).unwrap(),
            "original"
        );
    }
}
