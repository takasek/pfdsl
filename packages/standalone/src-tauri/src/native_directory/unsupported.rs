//! Read and edit only: no directory-move tracking or protection-metadata revision guarantee.
use super::Capabilities;
use cap_std::fs::{Dir, File};
use std::path::{Path, PathBuf};
pub(crate) const CAPABILITIES: Capabilities = Capabilities {
    save: false,
    reason: Some("Safe document saving is currently supported on macOS only."),
    directory_tracking: "selected-path",
    protection_metadata: false,
};
// No protection stamp exists on this backend; absence is explicit, never a dummy stamp.
#[derive(Debug, PartialEq)]
pub(crate) enum Stamp {}
impl Stamp {
    pub(crate) fn copy_to(&self, _: &File, _: &File) -> Result<(), String> {
        match *self {}
    }
}
pub(crate) fn capture(_: &File) -> Result<Option<Stamp>, String> {
    Ok(None)
}
pub(crate) fn directory_path(directory: &Dir, selected: &Path) -> Result<PathBuf, String> {
    // Never label a retained descriptor with a stale or replaced selected path.
    super::validate_named_directory(directory, selected)?;
    Ok(selected.to_path_buf())
}
pub(crate) fn create_stage(_: &Dir, _: &str, _: bool) -> Result<File, String> {
    Err(CAPABILITIES.reason.unwrap().into())
}
pub(crate) fn publish(_: &Dir, _: &str, _: &str, _: bool) -> Result<(), String> {
    Err(CAPABILITIES.reason.unwrap().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsupported_writes_do_not_touch_the_directory() {
        let root = std::env::temp_dir().join(format!("pfdsl-unsupported-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("a.pfdsl"), "original").unwrap();
        let dir = Dir::open_ambient_dir(&root, cap_std::ambient_authority()).unwrap();
        assert!(!CAPABILITIES.save);
        assert!(!CAPABILITIES.protection_metadata);
        assert_eq!(capture(&dir.open("a.pfdsl").unwrap()).unwrap(), None);
        assert!(create_stage(&dir, ".stage", true).is_err());
        assert!(publish(&dir, ".stage", "a.pfdsl", true).is_err());
        assert!(publish(&dir, ".stage", "new.pfdsl", false).is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        assert_eq!(
            std::fs::read_to_string(root.join("a.pfdsl")).unwrap(),
            "original"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn selected_path_is_not_reported_after_a_directory_move_or_replacement() {
        let root =
            std::env::temp_dir().join(format!("pfdsl-unsupported-move-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        let dir = Dir::open_ambient_dir(&root, cap_std::ambient_authority()).unwrap();
        assert_eq!(directory_path(&dir, &root).unwrap(), root);
        let moved = root.with_extension("moved");
        std::fs::rename(&root, &moved).unwrap();
        assert!(directory_path(&dir, &root).is_err());
        std::fs::create_dir(&root).unwrap();
        assert!(directory_path(&dir, &root).is_err());
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(moved).unwrap();
    }
}
