use crate::exit_gate::ExitGate;
use tauri::{Emitter, Manager};

pub const EVENT: &str = "pfdsl-quit-requested";

pub fn request(app: &tauri::AppHandle) {
    if let Some(request) = app.state::<ExitGate>().request() {
        // Re-emit a pending request: a request before listener setup must remain retryable.
        let _ = app.emit(EVENT, request);
    }
}

#[tauri::command]
pub fn exit_listener_ready(app: tauri::AppHandle) {
    if let Some(request) = app.state::<ExitGate>().pending() {
        let _ = app.emit(EVENT, request);
    }
}

#[tauri::command]
pub fn finish_app_exit(request: String, approved: bool, app: tauri::AppHandle) -> Result<(), String> {
    app.state::<ExitGate>().finish(&request, approved)?;
    if approved { app.exit(0); }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CStr};
    use std::sync::OnceLock;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    type Object = *mut c_void;
    type Selector = *mut c_void;
    type Terminate = unsafe extern "C" fn(Object, Selector, Object) -> usize;

    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> Object;
        fn object_getClass(object: Object) -> Object;
        fn class_getName(class: Object) -> *const c_char;
        fn sel_registerName(name: *const c_char) -> Selector;
        fn class_getInstanceMethod(class: Object, selector: Selector) -> Object;
        fn class_addMethod(class: Object, selector: Selector, implementation: *const c_void, types: *const c_char) -> i8;
        fn class_getMethodImplementation(class: Object, selector: Selector) -> *const c_void;
        fn objc_msgSend();
    }

    // NSUInteger-returning AppKit delegate method (Q@:@ on both supported 64-bit Macs).
    unsafe extern "C" fn should_terminate(_: Object, _: Selector, _: Object) -> usize {
        let _ = std::panic::catch_unwind(|| {
            if let Some(app) = APP.get() { super::request(app); }
        });
        // Cancel synchronously; only the acknowledged frontend transaction calls AppHandle.exit.
        0
    }

    unsafe fn add_gate(class: Object) -> Result<(), String> {
        let selector = sel_registerName(c"applicationShouldTerminate:".as_ptr());
        if !class_getInstanceMethod(class, selector).is_null() {
            return Err("The native application already owns its termination method; refusing to replace it".into());
        }
        let implementation = should_terminate as Terminate as *const c_void;
        if class_addMethod(class, selector, implementation, c"Q@:@".as_ptr()) == 0
            || class_getMethodImplementation(class, selector) != implementation {
            return Err("Could not install the native document exit guard".into());
        }
        Ok(())
    }

    // Called by Tauri setup on the main AppKit thread, after Tao sets its delegate.
    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        unsafe {
            let send: unsafe extern "C" fn(Object, Selector) -> Object = std::mem::transmute(objc_msgSend as *const ());
            let application = send(objc_getClass(c"NSApplication".as_ptr()), sel_registerName(c"sharedApplication".as_ptr()));
            let delegate = send(application, sel_registerName(c"delegate".as_ptr()));
            if delegate.is_null() { return Err("The native application delegate is unavailable".into()); }
            let class = object_getClass(delegate);
            if CStr::from_ptr(class_getName(class)).to_bytes() != b"TaoAppDelegateParent" {
                return Err("The native application delegate is unsupported; document exit protection is required".into());
            }
            APP.set(app.clone()).map_err(|_| "The document exit guard was already initialized")?;
            add_gate(class)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[link(name = "objc")]
        extern "C" {
            fn objc_allocateClassPair(superclass: Object, name: *const c_char, extra: usize) -> Object;
            fn objc_disposeClassPair(class: Object);
        }
        #[test]
        fn bridge_installs_once_and_uses_appkit_cancel_abi() {
            unsafe {
                let class = objc_allocateClassPair(objc_getClass(c"NSObject".as_ptr()), c"PFDSLExitGateTest".as_ptr(), 0);
                assert!(!class.is_null());
                add_gate(class).unwrap();
                assert!(add_gate(class).is_err(), "do not replace an existing termination implementation");
                let selector = sel_registerName(c"applicationShouldTerminate:".as_ptr());
                let callback: Terminate = std::mem::transmute(class_getMethodImplementation(class, selector));
                assert_eq!(callback(std::ptr::null_mut(), selector, std::ptr::null_mut()), 0);
                objc_disposeClassPair(class);
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::install;
#[cfg(not(target_os = "macos"))]
pub fn install(_: &tauri::AppHandle) -> Result<(), String> { Ok(()) }
