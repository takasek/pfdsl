use cap_std::fs::{Dir, MetadataExt, OpenOptions};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "macos")]
#[path = "save_metadata.rs"]
mod save_metadata;

static NEXT_STAGE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
pub struct Snapshot {
    pub id: usize,
    pub path: String,
    pub source: Option<String>,
    pub revision: Option<String>,
    pub identity: Option<String>,
    pub binding: String,
}
#[derive(Serialize)]
pub struct SaveResult {
    pub outcome: String,
    pub current: Option<Snapshot>,
    pub message: String,
    pub publication: String,
    #[serde(rename = "targetState")]
    pub target_state: String,
}

/// IDs are never reused, so a late IPC request cannot address a newer document.
#[derive(Default)]
pub struct Registry {
    next_id: usize,
    entries: std::collections::HashMap<usize, Document>,
}
impl Registry {
    pub fn insert(&mut self, document: Document) -> Result<Snapshot, String> {
        let id = self.next_id;
        let snapshot = document.inspect(id)?;
        self.next_id = id.checked_add(1).ok_or("Document identifiers exhausted")?;
        self.entries.insert(id, document);
        Ok(snapshot)
    }
    pub fn get(&self, id: usize) -> Option<&Document> { self.entries.get(&id) }
    pub fn get_mut(&mut self, id: usize) -> Option<&mut Document> { self.entries.get_mut(&id) }
    pub fn remove(&mut self, id: usize) { self.entries.remove(&id); }
    pub fn values(&self) -> impl Iterator<Item = &Document> { self.entries.values() }
}

pub struct Document {
    pub path: PathBuf,
    parent: Dir,
    leaf: String,
    source_root: Dir,
    source_root_path: PathBuf,
}
impl Document {
    pub fn selected(path: &Path) -> Result<Self, String> {
        let parent = path.parent().ok_or("The file needs a parent folder")?;
        let parent_path = parent.canonicalize().map_err(|e| e.to_string())?;
        let directory = Dir::open_ambient_dir(&parent_path, cap_std::ambient_authority())
            .map_err(|e| e.to_string())?;
        Self::bound(directory.try_clone().map_err(|e| e.to_string())?, parent_path.clone(), path.file_name().ok_or("Missing file name")?, directory, parent_path)
    }
    pub fn inside(roots: &[crate::workspace::Folder], path: &Path) -> Result<Self, String> {
        let root = roots.iter().rev().find(|root| path.starts_with(&root.path))
            .ok_or("The file is outside the selected folders")?;
        let relative = path.strip_prefix(&root.path).map_err(|e| e.to_string())?;
        if relative.components().any(|part| !matches!(part, Component::Normal(_))) {
            return Err("Invalid relative document path".into());
        }
        let relative_parent = relative.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
        let directory = root.directory.open_dir(relative_parent).map_err(|e| e.to_string())?;
        Self::bound(directory, root.path.join(relative_parent), relative.file_name().ok_or("Missing file name")?, root.directory.try_clone().map_err(|e| e.to_string())?, root.path.clone())
    }
    fn bound(parent: Dir, parent_path: PathBuf, leaf: &std::ffi::OsStr, source_root: Dir, source_root_path: PathBuf) -> Result<Self, String> {
        let leaf = leaf.to_str().ok_or("The file name is not valid UTF-8")?.to_string();
        if Path::new(&leaf).components().count() != 1 || !matches!(Path::new(&leaf).components().next(), Some(Component::Normal(_))) {
            return Err("Invalid document file name".into());
        }
        if Path::new(&leaf).extension().is_none_or(|e| e != "pfdsl") {
            return Err("Choose a .pfdsl document".into());
        }
        Ok(Self { path: parent_path.join(&leaf), parent, leaf, source_root, source_root_path })
    }
    pub fn observed_path(&self) -> Result<PathBuf, String> {
        Ok(directory_path(&self.parent, self.path.parent().unwrap())?.join(&self.leaf))
    }
    pub fn read_dependency(&self, path: &Path) -> Result<String, String> {
        let current_root = directory_path(&self.source_root, &self.source_root_path)?;
        let relative = path.strip_prefix(&current_root).or_else(|_| path.strip_prefix(&self.source_root_path)).map_err(|_| "Dependency is outside the selected folder")?;
        self.source_root.read_to_string(relative).map_err(|e| e.to_string())
    }
    pub fn inspect(&self, id: usize) -> Result<Snapshot, String> {
        self.inspect_leaf(id, &self.leaf)
    }
    fn inspect_leaf(&self, id: usize, leaf: &str) -> Result<Snapshot, String> {
        let path = directory_path(&self.parent, self.path.parent().unwrap())?.join(leaf).to_string_lossy().into_owned();
        let parent = self.parent.dir_metadata().map_err(|e| e.to_string())?;
        let binding = format!("{}:{}:{}", parent.dev(), parent.ino(), leaf);
        let absent = Snapshot { id, path: path.clone(), source: None, revision: None, identity: None, binding: binding.clone() };
        let metadata = match self.parent.symlink_metadata(leaf) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(absent),
            Err(error) => return Err(error.to_string()),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("The document target is not a regular file; it was not discarded".into());
        }
        let mut file = self.parent.open(leaf).map_err(|e| e.to_string())?;
        let before = file.metadata().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        let metadata_before = save_metadata::capture(&file)?;
        let mut source = String::new();
        file.read_to_string(&mut source).map_err(|e| e.to_string())?;
        let after = file.metadata().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        let metadata_after = save_metadata::capture(&file)?;
        #[cfg(target_os = "macos")]
        if metadata_before != metadata_after { return Err("Metadata changed while reading; editor content is retained.".into()); }
        let identity = format!("{}:{}", after.dev(), after.ino());
        if before.dev() != metadata.dev() || before.ino() != metadata.ino()
            || before.len() != after.len() || before.modified().ok() != after.modified().ok()
            || before.len() != source.len() as u64 {
            return Err("The disk changed while reading. Try again; editor content is retained.".into());
        }
        let revision = format!("{}:{:?}:{:x}", identity, after.modified().ok(), Sha256::digest(source.as_bytes()));
        #[cfg(target_os = "macos")]
        let revision = format!("{revision}:{:x}", Sha256::digest(format!("{metadata_after:?}").as_bytes()));
        Ok(Snapshot { id, path, source: Some(source), revision: Some(revision), identity: Some(identity), binding })
    }
    fn validate_binding(&self) -> Result<(), String> {
        for (directory, path) in [(&self.source_root, self.source_root_path.as_path()), (&self.parent, self.path.parent().unwrap())] {
            let actual = directory_path(directory, path)?;
            let named = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            let retained = directory.dir_metadata().map_err(|e| e.to_string())?;
            use std::os::unix::fs::MetadataExt as _;
            if actual != path || !named.is_dir() || named.file_type().is_symlink() || named.dev() != retained.dev() || named.ino() != retained.ino() {
                return Err("The selected directory was moved, deleted, or replaced. Select its current location explicitly; no content was published.".into());
            }
        }
        Ok(())
    }
    pub fn save(&mut self, id: usize, source: &str, expected: Option<&str>) -> SaveResult {
        self.save_with(id, source, expected, || {})
    }
    fn save_with(&mut self, id: usize, source: &str, expected: Option<&str>, before_publish: impl FnOnce()) -> SaveResult {
        self.save_with_hooks(id, source, expected, before_publish, || {})
    }
    fn save_with_hooks(&mut self, id: usize, source: &str, expected: Option<&str>, before_publish: impl FnOnce(), after_publish: impl FnOnce()) -> SaveResult {
        self.save_with_metadata_hook(id, source, expected, |_| {}, before_publish, after_publish)
    }
    fn save_with_metadata_hook(&mut self, id: usize, source: &str, expected: Option<&str>, metadata_copied: impl FnOnce(&cap_std::fs::File), before_publish: impl FnOnce(), after_publish: impl FnOnce()) -> SaveResult {
        let result = |outcome: &str, current: Option<Snapshot>, message: String| {
            let target_state = match &current { Some(s) if s.source.is_some() => "readable", Some(_) => "missing", None => "unreadable" };
            SaveResult { outcome: outcome.into(), current, message, publication: "not-published".into(), target_state: target_state.into() }
        };
        if let Err(error) = self.validate_binding() { return result("conflict", self.inspect(id).ok(), error); }
        let current = match self.inspect(id) {
            Ok(value) => value,
            Err(error) => return result("failed-before-publication", None, error),
        };
        if current.revision.as_deref() != expected {
            return result("conflict", Some(current), "The disk changed. Review it before replacing this version.".into());
        }
        // A no-op still validates the selected directory and expected revision.
        if current.source.as_deref() == Some(source) {
            return result("saved", Some(current), "Already saved.".into());
        }
        let original = if current.source.is_some() {
            // Directory write permission must not bypass the file's write protection.
            let mut options = OpenOptions::new();
            options.read(true).write(true);
            match self.parent.open_with(&self.leaf, &options) {
                Ok(file) if file.metadata().is_ok_and(|m| current.identity.as_deref() == Some(&format!("{}:{}", m.dev(), m.ino()))) => Some(file),
                Ok(_) => return result("conflict", self.inspect(id).ok(), "The target changed before saving. Editor content is retained.".into()),
                Err(error) => return result("failed-before-publication", Some(current), format!("The document cannot be opened for writing. Editor content is retained. {error}")),
            }
        } else { None };
        #[cfg(target_os = "macos")]
        let protection = match original.as_ref().map(save_metadata::capture).transpose() {
            Ok(stamp) => stamp,
            Err(error) => return result("failed-before-publication", Some(current), error),
        };
        let stage = format!(".pfdsl-save-{}-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(), NEXT_STAGE.fetch_add(1, Ordering::Relaxed));
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        { use cap_std::fs::OpenOptionsExt; options.custom_flags(libc::O_NOFOLLOW).mode(0o600); }
        let mut file = match self.parent.open_with(&stage, &options) {
            Ok(file) => file,
            Err(error) => return result("failed-before-publication", Some(current), error.to_string()),
        };
        // The app owns this exclusive temporary name. Deliberate manipulation of
        // app-private temporary names is outside the document-conflict guarantee.
        let cleanup = |mut receipt: SaveResult| {
            if let Err(error) = self.parent.remove_file(&stage) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    receipt.message.push_str(&format!(" Could not remove temporary file '{stage}': {error}"));
                }
            }
            receipt
        };
        let prepared = (|| -> Result<(), String> {
            #[cfg(target_os = "macos")]
            if let (Some(required), Some(original)) = (&protection, &original) {
                required.copy_to(original, &file)?;
            }
            metadata_copied(&file);
            #[cfg(target_os = "macos")]
            if let Some(required) = &protection {
                if save_metadata::capture(&file)? != *required { return Err("The temporary file did not preserve document protection; no content was written.".into()); }
            }
            file.write_all(source.as_bytes()).map_err(|e| e.to_string())?;
            #[cfg(target_os = "macos")]
            if let Some(required) = &protection {
                if save_metadata::capture(&file)? != *required { return Err("Document protection changed while preparing the save; no content was published.".into()); }
            }
            file.sync_all().map_err(|e| e.to_string())
        })();
        if let Err(error) = prepared { return cleanup(result("failed-before-publication", Some(current), error)); }
        before_publish();
        let validation = self.validate_binding().and_then(|_| {
            if self.inspect(id)?.revision != current.revision {
                Err("The target changed before publication; editor content is retained.".into())
            } else { Ok(()) }
        });
        if let Err(error) = validation { return cleanup(result("conflict", self.inspect(id).ok(), error)); }
        // This is a pre-save check, not compare-and-swap: an external write after
        // the final observation can be overwritten. Old file descriptors are not retained.
        if let Err(error) = publish(&self.parent, &stage, &self.leaf, current.source.is_some()) {
            let observed = self.inspect(id).ok();
            let outcome = if observed.as_ref().map(|s| &s.revision) != Some(&current.revision) { "conflict" } else { "failed-before-publication" };
            return cleanup(result(outcome, observed, error));
        }
        after_publish();
        let mut receipt = match self.inspect(id) {
            Ok(published) if self.validate_binding().is_ok() && published.source.as_deref() == Some(source) => result("saved", Some(published), "Saved.".into()),
            Ok(published) => result("conflict", Some(published), "The target changed after publication. Editor content is retained; review the current disk version.".into()),
            Err(error) => result("published-but-unconfirmed", None, format!("The save was published, but its result could not be read. Editor content is retained. {error}")),
        };
        receipt.publication = "published".into();
        receipt
    }

}

#[cfg(target_os = "macos")]
fn directory_path(directory: &Dir, _: &Path) -> Result<PathBuf, String> {
    use std::os::fd::AsRawFd;
    let mut buffer = [0u8; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) } == -1 {
        return Err(format!("Could not identify the selected directory: {}", std::io::Error::last_os_error()));
    }
    let path = std::ffi::CStr::from_bytes_until_nul(&buffer).map_err(|e| e.to_string())?.to_str().map_err(|e| e.to_string())?;
    Ok(PathBuf::from(path))
}
#[cfg(not(target_os = "macos"))]
fn directory_path(_: &Dir, fallback: &Path) -> Result<PathBuf, String> { Ok(fallback.to_path_buf()) }

#[cfg(target_os = "macos")]
fn publish(parent: &Dir, stage: &str, target: &str, replace: bool) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let stage = std::ffi::CString::new(stage).map_err(|e| e.to_string())?;
    let target = std::ffi::CString::new(target).map_err(|e| e.to_string())?;
    // Both arguments are single leaves in the same capability-bound directory.
    let result = unsafe { libc::renameatx_np(parent.as_raw_fd(), stage.as_ptr(), parent.as_raw_fd(), target.as_ptr(), if replace { 0 } else { libc::RENAME_EXCL }) };
    if result == 0 { Ok(()) } else { Err(format!("Safe publication failed: {}. Choose another file or filesystem.", std::io::Error::last_os_error())) }
}
#[cfg(not(target_os = "macos"))]
fn publish(_: &Dir, _: &str, _: &str, _: bool) -> Result<(), String> {
    Err("Safe document publication is currently supported on macOS only.".into())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::fs;
    fn fixture(name: &str) -> (PathBuf, Document) {
        let root = std::env::temp_dir().join(format!("pfdsl-documents-{}-{}-{}", std::process::id(), name, NEXT_STAGE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let path = root.join("a.pfdsl");
        fs::write(&path, "original").unwrap();
        (root, Document::selected(&path).unwrap())
    }
    fn attribute(path: &Path, name: &str, value: Option<&[u8]>) -> Vec<u8> {
        use std::os::unix::ffi::OsStrExt;
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        let name = std::ffi::CString::new(name).unwrap();
        if let Some(value) = value {
            assert_eq!(unsafe { libc::setxattr(path.as_ptr(), name.as_ptr(), value.as_ptr().cast(), value.len(), 0, 0) }, 0);
        }
        let size = unsafe { libc::getxattr(path.as_ptr(), name.as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
        if size < 0 { return vec![]; }
        let mut bytes = vec![0u8; size as usize];
        assert_eq!(unsafe { libc::getxattr(path.as_ptr(), name.as_ptr(), bytes.as_mut_ptr().cast(), bytes.len(), 0, 0) }, size);
        bytes
    }
    #[test] fn unchanged_save_keeps_identity_and_leaves_no_temporary_files() {
        let (root, mut doc) = fixture("unchanged");
        let before = doc.inspect(0).unwrap();
        let result = doc.save(0, "original", before.revision.as_deref());
        assert_eq!(result.outcome, "saved");
        assert_eq!(doc.inspect(0).unwrap().revision, before.revision);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn repeated_saves_leave_only_the_document() {
        let (root, mut doc) = fixture("cleanup");
        for source in ["first", "second", "third"] {
            let before = doc.inspect(0).unwrap();
            assert_eq!(doc.save(0, source, before.revision.as_deref()).outcome, "saved");
            assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), source);
            assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn registry_releases_documents_without_reusing_stale_ids() {
        let (root, doc) = fixture("registry");
        let mut registry = Registry::default();
        let first = registry.insert(doc).unwrap().id;
        let mut retired = std::collections::HashSet::new();
        for _ in 0..100 {
            let id = registry.insert(Document::selected(&root.join("a.pfdsl")).unwrap()).unwrap().id;
            assert_ne!(id, first);
            assert!(!retired.contains(&id), "A released document ID must never be reused");
            for stale in &retired { assert!(registry.get(*stale).is_none()); }
            registry.remove(id);
            retired.insert(id);
            assert!(registry.get(id).is_none());
            assert_eq!(registry.values().count(), 1);
        }
        registry.remove(first);
        registry.remove(first);
        assert_eq!(registry.values().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn unchanged_content_does_not_bypass_revision_conflicts() {
        let (root, mut doc) = fixture("unchanged-conflict");
        let before = doc.inspect(0).unwrap();
        fs::write(root.join("a.pfdsl"), "external").unwrap();
        assert_eq!(doc.save(0, "external", before.revision.as_deref()).outcome, "conflict");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn save_preserves_application_metadata_and_updates_existing_encoding_to_utf8() {
        let (root, mut doc) = fixture("utf8-metadata"); let path = root.join("a.pfdsl");
        attribute(&path, "com.pfdsl.fixture-note", Some(b"retain this note"));
        attribute(&path, "com.apple.TextEncoding", Some(b"macintosh;0"));
        let provenance = attribute(&path, "com.apple.provenance", None);
        let before = doc.inspect(0).unwrap();
        let result = doc.save(0, "成果 >> process -> done", before.revision.as_deref());
        assert_eq!(result.outcome, "saved");
        assert_eq!(attribute(&path, "com.pfdsl.fixture-note", None), b"retain this note");
        assert_eq!(attribute(&path, "com.apple.TextEncoding", None), b"utf-8;134217984");
        assert_eq!(attribute(&path, "com.apple.provenance", None), provenance);
        assert_eq!(fs::read_to_string(&path).unwrap(), "成果 >> process -> done");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn incomplete_metadata_copy_is_refused_before_writing_buffer_into_stage() {
        use std::os::fd::AsRawFd;
        use std::os::unix::fs::PermissionsExt;
        let (root, mut doc) = fixture("metadata-before-buffer"); let path = root.join("a.pfdsl");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let before = doc.inspect(0).unwrap();
        let mut observed_stage = None;
        let result = doc.save_with_metadata_hook(0, "public fixture buffer", before.revision.as_deref(), |stage| {
            // Model a copier returning success without establishing the source's protection.
            // This changes only the disposable stage; no ACL or protected xattr is synthesized.
            assert_eq!(unsafe { libc::fchmod(stage.as_raw_fd(), 0o644) }, 0);
            observed_stage = Some(stage.try_clone().unwrap());
        }, || {}, || {});
        // Keep the stage FD across cleanup so an early write cannot hide behind unlink.
        use std::io::{Seek, SeekFrom};
        let mut stage = observed_stage.unwrap();
        stage.seek(SeekFrom::Start(0)).unwrap();
        let mut staged_content = String::new();
        stage.read_to_string(&mut staged_content).unwrap();
        assert!(staged_content.is_empty(), "Buffer was written before protection was established");
        assert_eq!(result.outcome, "failed-before-publication");
        assert_eq!(result.publication, "not-published");
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test] fn replaced_selected_directory_is_refused_without_writing_either_directory() {
        let (root, mut doc) = fixture("refuse-parent-replacement"); let before = doc.inspect(0).unwrap();
        let moved = root.with_extension("moved"); fs::rename(&root, &moved).unwrap();
        fs::create_dir(&root).unwrap(); fs::write(root.join("a.pfdsl"), "foreign").unwrap();
        let result = doc.save(0, "local", before.revision.as_deref());
        assert_eq!(result.outcome, "conflict");
        assert_eq!(fs::read_to_string(moved.join("a.pfdsl")).unwrap(), "original");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "foreign");
        fs::remove_dir_all(root).unwrap(); fs::remove_dir_all(moved).unwrap();
    }
    #[test] fn same_content_target_replacement_before_publication_is_refused() {
        let (root, mut doc) = fixture("late-replacement"); let before = doc.inspect(0).unwrap();
        let result = doc.save_with(0, "local", before.revision.as_deref(), || {
            fs::rename(root.join("a.pfdsl"), root.join("original-moved")).unwrap();
            fs::write(root.join("a.pfdsl"), "original").unwrap();
        });
        assert_eq!(result.outcome, "conflict");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "original");
         fs::remove_dir_all(root).unwrap();
    }






    #[test] fn published_failure_reports_actual_unreadable_target() {
        let (root, mut doc) = fixture("published-unreadable"); let before = doc.inspect(0).unwrap();
        let result = doc.save_with_hooks(0, "local", before.revision.as_deref(), || {}, || {
            fs::rename(root.join("a.pfdsl"), root.join("published-local")).unwrap();
            fs::create_dir(root.join("a.pfdsl")).unwrap();
            fs::write(root.join("a.pfdsl/foreign.txt"), "foreign after publication").unwrap();
        });
        let receipt = serde_json::to_value(&result).unwrap();
        assert_eq!(result.outcome, "published-but-unconfirmed");
        assert_eq!(receipt["publication"], "published");
        assert_eq!(receipt["targetState"], "unreadable");
        assert!(result.current.is_none());
        assert_eq!(fs::read_to_string(root.join("published-local")).unwrap(), "local");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl/foreign.txt")).unwrap(), "foreign after publication");
        if let Some(path) = std::env::var_os("PFDSL_SAVE_RECEIPT_PATH") {
            let packet = serde_json::json!({"result": receipt, "baseline": before, "buffer": "local", "observedPublishedContent": fs::read_to_string(root.join("published-local")).unwrap(), "targetWasDirectory": root.join("a.pfdsl").is_dir()});
            fs::write(path, serde_json::to_vec_pretty(&packet).unwrap()).unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn protection_change_before_publication_is_refused() {
        let (root, mut doc) = fixture("metadata-conflict"); let before = doc.inspect(0).unwrap();
        let result = doc.save_with(0, "local", before.revision.as_deref(), || { use std::os::unix::fs::PermissionsExt; fs::set_permissions(root.join("a.pfdsl"), fs::Permissions::from_mode(0o600)).unwrap(); });
        assert_eq!(result.outcome, "conflict"); assert_eq!(result.publication, "not-published");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "original"); fs::remove_dir_all(root).unwrap();
    }
    #[test] fn moved_directory_after_publication_is_not_accepted_as_a_successful_save() {
        let (root, mut doc) = fixture("published-parent-move"); let before = doc.inspect(0).unwrap();
        let moved = root.with_extension("moved");
        let result = doc.save_with_hooks(0, "local", before.revision.as_deref(), || {}, || { fs::rename(&root, &moved).unwrap(); });
        assert_eq!(result.outcome, "conflict"); assert_eq!(result.publication, "published");
        assert_eq!(result.current.unwrap().path, moved.join("a.pfdsl").to_string_lossy());
        assert_eq!(fs::read_to_string(moved.join("a.pfdsl")).unwrap(), "local");
        fs::remove_dir_all(moved).unwrap();
    }
    #[test] fn ordinary_metadata_does_not_require_a_custom_attribute_policy() {
        let (root, mut doc) = fixture("unknown-metadata"); let path = root.join("a.pfdsl");
        attribute(&path, "com.pfdsl.fixture-digest#C", Some(b"old content digest"));
        let before = doc.inspect(0).unwrap(); let result = doc.save(0, "local", before.revision.as_deref());
        assert_eq!(result.outcome, "saved");
        assert_eq!(fs::read_to_string(path).unwrap(), "local");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn detects_a_write_before_publication_without_overwriting_it() {
        let (root, mut doc) = fixture("race"); let before = doc.inspect(0).unwrap();
        let result = doc.save_with(0, "local", before.revision.as_deref(), || fs::write(root.join("a.pfdsl"), "external").unwrap());
        assert_eq!(result.outcome, "conflict");

        assert_eq!(result.publication, "not-published");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "external");
        fs::remove_dir_all(root).unwrap();
    }

    #[test] fn save_as_publication_never_overwrites_a_racing_creation() {
        let (root, mut doc) = fixture("exclusive");fs::remove_file(root.join("a.pfdsl")).unwrap();
        let result = doc.save_with(0, "local", None, || fs::write(root.join("a.pfdsl"), "external").unwrap());
        assert_eq!(result.outcome, "conflict");assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "external");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn external_deletion_requires_an_explicit_new_target() {
        let (root, mut doc) = fixture("deletion");let before = doc.inspect(0).unwrap();fs::remove_file(root.join("a.pfdsl")).unwrap();
        assert_eq!(doc.save(0, "local", before.revision.as_deref()).outcome, "conflict");
        assert!(!root.join("a.pfdsl").exists());assert_eq!(doc.save(0, "local", None).outcome, "saved");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn permission_failure_retains_target_and_never_publishes() {
        use std::os::unix::fs::PermissionsExt;
        let (root, mut doc) = fixture("permission"); let before = doc.inspect(0).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o555)).unwrap();
        let result = doc.save(0, "local", before.revision.as_deref());
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(result.outcome, "failed-before-publication");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "original");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn unexpected_directory_before_publication_is_refused_and_preserved() {
        let (root, mut doc) = fixture("directory"); let before = doc.inspect(0).unwrap();
        let result = doc.save_with(0, "local", before.revision.as_deref(), || {
            fs::remove_file(root.join("a.pfdsl")).unwrap();
            fs::create_dir(root.join("a.pfdsl")).unwrap();
            fs::write(root.join("a.pfdsl/external.txt"), "external data").unwrap();
        });
        assert_eq!(result.outcome, "conflict");
        assert_eq!(result.publication, "not-published");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl/external.txt")).unwrap(), "external data");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn partial_staging_write_never_changes_the_target() {
        if std::env::var_os("PFDSL_PARTIAL_WRITE_CHILD").is_none() {
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "documents::tests::partial_staging_write_never_changes_the_target", "--nocapture"])
                .env("PFDSL_PARTIAL_WRITE_CHILD", "1").output().unwrap();
            assert!(child.status.success(), "child status {:?}: {} {}", child.status, String::from_utf8_lossy(&child.stdout), String::from_utf8_lossy(&child.stderr)); return;
        }
        // A child-only write limit produces a partial write without changing global test limits.
        // This is not an ENOSPC / full-volume test.
        let (root, mut doc) = fixture("partial-write"); let before = doc.inspect(0).unwrap();
        let limit = libc::rlimit { rlim_cur: 5, rlim_max: 5 };
        unsafe { libc::signal(libc::SIGXFSZ, libc::SIG_IGN); assert_eq!(libc::setrlimit(libc::RLIMIT_FSIZE, &limit), 0); }
        let result = doc.save(0, "a longer local document", before.revision.as_deref());
        assert_eq!(result.outcome, "failed-before-publication");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "original");
        let temporary = fs::read_dir(&root).unwrap().map(|entry| entry.unwrap().path())
            .filter(|path| path.file_name().unwrap().to_string_lossy().starts_with(".pfdsl-save-")).collect::<Vec<_>>();
        assert!(temporary.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn reselected_folder_uses_the_latest_selected_capability() {
        let (root, _) = fixture("reselected");
        let first = crate::workspace::Folder::open(&root).unwrap();
        let old = root.with_extension("original"); fs::rename(&root, &old).unwrap();
        fs::create_dir(&root).unwrap(); fs::write(root.join("a.pfdsl"), "new selection").unwrap();
        let roots = vec![first, crate::workspace::Folder::open(&root).unwrap()];
        let mut doc = Document::inside(&roots, &root.join("a.pfdsl")).unwrap();
        let before = doc.inspect(0).unwrap(); assert_eq!(before.source.as_deref(), Some("new selection"));
        assert_eq!(doc.save(0, "new saved", before.revision.as_deref()).outcome, "saved");
        assert_eq!(fs::read_to_string(old.join("a.pfdsl")).unwrap(), "original");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "new saved");
        fs::remove_dir_all(root).unwrap(); fs::remove_dir_all(old).unwrap();
    }
    #[test] fn long_document_name_can_be_saved_without_a_longer_stage_name() {
        let (root, _) = fixture("long-name");
        let leaf = format!("{}.pfdsl", "a".repeat(240)); let path = root.join(leaf);
        fs::write(&path, "original").unwrap(); let mut doc = Document::selected(&path).unwrap();
        let before = doc.inspect(0).unwrap();
        assert_eq!(doc.save(0, "local", before.revision.as_deref()).outcome, "saved");
        assert_eq!(fs::read_to_string(path).unwrap(), "local"); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn read_only_document_cannot_be_saved_through_a_writable_parent_directory() {
        use std::os::unix::fs::PermissionsExt;
        let (root, mut doc) = fixture("read-only-file");
        let path = root.join("a.pfdsl");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        let before = doc.inspect(0).unwrap();
        let result = doc.save(0, "local", before.revision.as_deref());
        assert_eq!(result.outcome, "failed-before-publication");
        assert_eq!(fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o7777, 0o400);

        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn capability_binding_survives_parent_move_and_distinguishes_hard_link_leaves() {
        let (root, doc) = fixture("binding");
        let initial = doc.inspect(0).unwrap();
        let reselected = Document::selected(&root.join("a.pfdsl")).unwrap().inspect(1).unwrap();
        assert_eq!(initial.binding, reselected.binding);
        let moved = root.with_extension("moved");
        fs::rename(&root, &moved).unwrap();
        let moved_snapshot = doc.inspect(0).unwrap();
        assert_eq!(initial.binding, moved_snapshot.binding);
        assert_ne!(initial.path, moved_snapshot.path);
        fs::hard_link(moved.join("a.pfdsl"), moved.join("alias.pfdsl")).unwrap();
        let alias = Document::selected(&moved.join("alias.pfdsl")).unwrap().inspect(2).unwrap();
        assert_eq!(initial.identity, alias.identity);
        assert_ne!(initial.binding, alias.binding);
        fs::rename(moved.join("a.pfdsl"), moved.join("renamed.pfdsl")).unwrap();
        let renamed = Document::selected(&moved.join("renamed.pfdsl")).unwrap().inspect(3).unwrap();
        assert_eq!(initial.identity, renamed.identity);
        assert_ne!(initial.binding, renamed.binding);
        fs::remove_dir_all(moved).unwrap();
    }
    #[test] fn selected_parent_remains_bound_after_path_replacement() {
        let (root, mut doc) = fixture("capability");let before = doc.inspect(0).unwrap();
        let original = root.with_extension("original");fs::rename(&root, &original).unwrap();fs::create_dir(&root).unwrap();fs::write(root.join("a.pfdsl"), "unselected").unwrap();
        assert_eq!(doc.save(0, "local", before.revision.as_deref()).outcome, "conflict");
        assert_eq!(fs::read_to_string(root.join("a.pfdsl")).unwrap(), "unselected");assert_eq!(fs::read_to_string(original.join("a.pfdsl")).unwrap(), "original");

        fs::remove_dir_all(root).unwrap();fs::remove_dir_all(original).unwrap();
    }


}
