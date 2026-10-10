//! Metadata observations and copying are FD-relative. API success alone is not preservation proof.
use std::os::fd::AsRawFd;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Stamp {
    uid: u32,
    gid: u32,
    mode: u16,
    flags: u32,
    birth: (i64, i64),
    acl: Vec<u8>,
    attrs: Vec<(Vec<u8>, Vec<u8>)>,
}

extern "C" {
    fn acl_get_fd_np(fd: libc::c_int, kind: libc::c_int) -> *mut libc::c_void;
    fn acl_to_text(acl: *mut libc::c_void, length: *mut libc::ssize_t) -> *mut libc::c_char;
    fn acl_free(value: *mut libc::c_void) -> libc::c_int;
    fn xattr_preserve_for_intent(name: *const libc::c_char, intent: libc::c_uint) -> libc::c_int;
}

fn error() -> String { std::io::Error::last_os_error().to_string() }
fn size(value: libc::ssize_t) -> Result<usize, String> {
    if value < 0 { return Err(error()); }
    // Refuse oversized metadata explicitly; never treat an unread attribute as absent.
    if value > 16 * 1024 * 1024 { return Err("Metadata is too large to verify safely".into()); }
    Ok(value as usize)
}

pub(super) fn capture(file: &impl AsRawFd) -> Result<Stamp, String> {
    let fd = file.as_raw_fd();
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    if unsafe { libc::fstat(fd, stat.as_mut_ptr()) } != 0 { return Err(error()); }
    let stat = unsafe { stat.assume_init() };
    let count = size(unsafe { libc::flistxattr(fd, std::ptr::null_mut(), 0, 0) })?;
    let mut names = vec![0u8; count];
    if size(unsafe { libc::flistxattr(fd, names.as_mut_ptr().cast(), count, 0) })? != count {
        return Err("Metadata changed while listing attributes".into());
    }
    let mut attrs = Vec::new();
    for name in names.split(|v| *v == 0).filter(|v| !v.is_empty()) {
        let c_name = std::ffi::CString::new(name).map_err(|e| e.to_string())?;
        let count = size(unsafe { libc::fgetxattr(fd, c_name.as_ptr(), std::ptr::null_mut(), 0, 0, 0) })?;
        let mut value = vec![0u8; count];
        if size(unsafe { libc::fgetxattr(fd, c_name.as_ptr(), value.as_mut_ptr().cast(), count, 0, 0) })? != count {
            return Err("Metadata changed while reading an attribute".into());
        }
        attrs.push((name.to_vec(), value));
    }
    attrs.sort();
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
        birth: (stat.st_birthtime, stat.st_birthtime_nsec), acl: acl_bytes, attrs })
}

impl Stamp {
    pub(super) fn copy_to(&self, original: &impl AsRawFd, stage: &impl AsRawFd) -> Result<(), String> {
        if unsafe { libc::fcopyfile(original.as_raw_fd(), stage.as_raw_fd(), std::ptr::null_mut(), libc::COPYFILE_METADATA) } != 0 {
            return Err(error());
        }
        // fcopyfile's metadata contract does not include creation time. Restore it on the owned FD.
        let mut attrs = libc::attrlist { bitmapcount: 5, reserved: 0, commonattr: libc::ATTR_CMN_CRTIME,
            volattr: 0, dirattr: 0, fileattr: 0, forkattr: 0 };
        let mut birth = libc::timespec { tv_sec: self.birth.0, tv_nsec: self.birth.1 };
        if unsafe { libc::fsetattrlist(stage.as_raw_fd(), (&mut attrs as *mut libc::attrlist).cast(),
            (&mut birth as *mut libc::timespec).cast(), std::mem::size_of::<libc::timespec>(), 0) } != 0 { return Err(error()); }
        self.update_encoding(stage)
    }
    pub(super) fn for_utf8_save(&self) -> Result<Self, String> {
        let mut prepared = self.clone();
        for (name, value) in &mut prepared.attrs {
            if name == b"com.apple.TextEncoding" {
                // NSString's documented IANA-name;CFStringEncoding format for UTF-8.
                *value = b"utf-8;134217984".to_vec();
            } else {
                let c_name = std::ffi::CString::new(name.clone()).map_err(|e| e.to_string())?;
                if unsafe { xattr_preserve_for_intent(c_name.as_ptr(), 2) } == 0 {
                    return Err(format!("The attribute '{}' needs an explicit save policy; no content was published.", String::from_utf8_lossy(name)));
                }
            }
        }
        Ok(prepared)
    }
    pub(super) fn update_encoding(&self, file: &impl AsRawFd) -> Result<(), String> {
        if let Some((name, value)) = self.attrs.iter().find(|(name, _)| name == b"com.apple.TextEncoding") {
            let c_name = std::ffi::CString::new(name.clone()).map_err(|e| e.to_string())?;
            if unsafe { libc::fsetxattr(file.as_raw_fd(), c_name.as_ptr(), value.as_ptr().cast(), value.len(), 0, 0) } != 0 {
                return Err(error());
            }
        }
        Ok(())
    }
}
