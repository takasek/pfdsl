use cap_std::fs::{Dir, File, OpenOptions};
use std::path::{Path, PathBuf};
#[path = "macos_metadata.rs"]
mod metadata;
use super::Capabilities;
pub(crate) use metadata::Stamp;
pub(crate) const CAPABILITIES: Capabilities = Capabilities {
    save: true,
    reason: None,
    directory_tracking: "descriptor",
    protection_metadata: true,
};
pub(crate) fn directory_path(directory: &Dir, _: &Path) -> Result<PathBuf, String> {
    use std::os::fd::AsRawFd;
    let mut buffer = [0u8; libc::PATH_MAX as usize];
    if unsafe { libc::fcntl(directory.as_raw_fd(), libc::F_GETPATH, buffer.as_mut_ptr()) } == -1 {
        return Err(format!(
            "Could not identify the selected directory: {}",
            std::io::Error::last_os_error()
        ));
    }
    let path = std::ffi::CStr::from_bytes_until_nul(&buffer)
        .map_err(|e| e.to_string())?
        .to_str()
        .map_err(|e| e.to_string())?;
    Ok(PathBuf::from(path))
}
pub(crate) fn publish(
    parent: &Dir,
    stage: &str,
    target: &str,
    replace: bool,
) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let stage = std::ffi::CString::new(stage).map_err(|e| e.to_string())?;
    let target = std::ffi::CString::new(target).map_err(|e| e.to_string())?;
    // Both arguments are single leaves in the same capability-bound directory.
    let result = unsafe {
        libc::renameatx_np(
            parent.as_raw_fd(),
            stage.as_ptr(),
            parent.as_raw_fd(),
            target.as_ptr(),
            if replace { 0 } else { libc::RENAME_EXCL },
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Safe publication failed: {}. Choose another file or filesystem.",
            std::io::Error::last_os_error()
        ))
    }
}

pub(crate) fn capture(file: &File) -> Result<Option<Stamp>, String> {
    metadata::capture(file).map(Some)
}
pub(crate) fn create_stage(parent: &Dir, stage: &str, existing: bool) -> Result<File, String> {
    use cap_std::fs::OpenOptionsExt;
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    // Existing protection is copied before writing; new files follow the process umask.
    options
        .custom_flags(libc::O_NOFOLLOW)
        .mode(if existing { 0o600 } else { 0o666 });
    parent.open_with(stage, &options).map_err(|e| e.to_string())
}
