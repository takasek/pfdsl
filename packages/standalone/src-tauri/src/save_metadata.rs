//! Verify protection fields; delegate other metadata copying to the operating system.
use std::os::fd::AsRawFd;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Stamp {
    uid: u32,
    gid: u32,
    mode: u16,
    flags: u32,
    acl: Vec<u8>,
}

extern "C" {
    fn acl_get_fd_np(fd: libc::c_int, kind: libc::c_int) -> *mut libc::c_void;
    fn acl_to_text(acl: *mut libc::c_void, length: *mut libc::ssize_t) -> *mut libc::c_char;
    fn acl_free(value: *mut libc::c_void) -> libc::c_int;
}

fn error() -> String { std::io::Error::last_os_error().to_string() }
pub(super) fn capture(file: &impl AsRawFd) -> Result<Stamp, String> {
    let fd = file.as_raw_fd();
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 { return Err(error()); }
    let stat = unsafe { stat.assume_init() };
    // Installed sys/acl.h: ACL_TYPE_EXTENDED = 0x100; acl_free owns both returned allocations.
    let acl = unsafe { acl_get_fd_np(fd, 0x100) };
    if acl.is_null() && std::io::Error::last_os_error().raw_os_error() != Some(libc::ENOENT) { return Err(error()); }
    let mut length = 0;
    // Observed on this SDK/runtime: valid ordinary-file FDs without an extended ACL return ENOENT.
    // Nontrivial/inherited ACL acceptance is still required; other failures are refused.
    let text = if acl.is_null() { std::ptr::null_mut() } else { unsafe { acl_to_text(acl, &mut length) } };
    if !acl.is_null() && text.is_null() {
        let failure = error(); unsafe { acl_free(acl); } return Err(failure);
    }
    let acl_bytes = if !text.is_null() && length >= 0 { unsafe { std::slice::from_raw_parts(text.cast::<u8>(), length as usize) }.to_vec() } else { vec![] };
    if !text.is_null() { unsafe { acl_free(text.cast()); } }
    if !acl.is_null() { unsafe { acl_free(acl); } }
    if length < 0 { return Err("Could not verify document ACL".into()); }
    Ok(Stamp { uid: stat.st_uid, gid: stat.st_gid, mode: stat.st_mode & 0o7777, flags: stat.st_flags,
        acl: acl_bytes })
}

impl Stamp {
    pub(super) fn copy_to(&self, original: &impl AsRawFd, stage: &impl AsRawFd) -> Result<(), String> {
        if unsafe { libc::fcopyfile(original.as_raw_fd(), stage.as_raw_fd(), std::ptr::null_mut(), libc::COPYFILE_METADATA) } != 0 {
            return Err(error());
        }
        // The editor writes UTF-8. Correct a pre-existing encoding hint without
        // inventing a policy for every unrelated extended attribute.
        let name = b"com.apple.TextEncoding\0";
        let size = unsafe { libc::fgetxattr(stage.as_raw_fd(), name.as_ptr().cast(), std::ptr::null_mut(), 0, 0, 0) };
        if size >= 0 {
            let value = b"utf-8;134217984";
            if unsafe { libc::fsetxattr(stage.as_raw_fd(), name.as_ptr().cast(), value.as_ptr().cast(), value.len(), 0, 0) } != 0 { return Err(error()); }
        } else if std::io::Error::last_os_error().raw_os_error() != Some(libc::ENOATTR) { return Err(error()); }
        Ok(())
    }
}
