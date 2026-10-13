//! Native document I/O boundary. macOS supports saving; other OSes explicitly support reading only.
use cap_std::fs::{Dir, File, Metadata, MetadataExt, OpenOptions};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(test, not(target_os = "macos")))]
mod unsupported;
#[cfg(target_os = "macos")]
use macos as backend;
#[cfg(not(target_os = "macos"))]
use unsupported as backend;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Capabilities {
    pub save: bool,
    pub reason: Option<&'static str>,
    pub directory_tracking: &'static str,
    pub protection_metadata: bool,
}
pub(crate) fn capabilities() -> Capabilities {
    backend::CAPABILITIES
}
pub(crate) fn require_save() -> Result<(), String> {
    let capability = capabilities();
    if capability.save {
        Ok(())
    } else {
        Err(capability.reason.unwrap().into())
    }
}
pub(crate) use backend::{capture, create_stage, directory_path, publish};
pub(crate) fn protection_revision(stamp: &Option<backend::Stamp>) -> String {
    match stamp {
        Some(value) => format!("{:x}", Sha256::digest(format!("{value:?}").as_bytes())),
        None => "unsupported".into(),
    }
}
pub(crate) fn leaf_metadata(parent: &Dir, leaf: &str) -> Result<Metadata, std::io::Error> {
    parent.symlink_metadata(leaf)
}
pub(crate) fn open(parent: &Dir, leaf: &str) -> Result<File, std::io::Error> {
    parent.open(leaf)
}
pub(crate) fn open_writable(parent: &Dir, leaf: &str) -> Result<File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    parent.open_with(leaf, &options)
}
pub(crate) fn remove_stage(parent: &Dir, stage: &str) -> Result<(), std::io::Error> {
    parent.remove_file(stage)
}
fn validate_named_directory(directory: &Dir, path: &Path) -> Result<(), String> {
    let named = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    let retained = directory.dir_metadata().map_err(|e| e.to_string())?;
    use std::os::unix::fs::MetadataExt as _;
    if !named.is_dir()
        || named.file_type().is_symlink()
        || named.dev() != retained.dev()
        || named.ino() != retained.ino()
    {
        return Err("The selected directory was moved, deleted, or replaced. Select its current location explicitly; no content was published.".into());
    }
    Ok(())
}
pub(crate) fn validate_binding(directory: &Dir, path: &Path) -> Result<(), String> {
    if directory_path(directory, path)? != path {
        return Err("The selected directory was moved, deleted, or replaced. Select its current location explicitly; no content was published.".into());
    }
    validate_named_directory(directory, path)
}
