use std::sync::Mutex;

#[derive(Default)]
pub struct ExitGate {
    state: Mutex<ExitState>,
}
#[derive(Default)]
struct ExitState {
    next: u64,
    pending: Option<String>,
    approved: bool,
}
impl ExitGate {
    pub fn request(&self) -> Option<String> {
        let mut state = self.state.lock().ok()?;
        if state.approved { return None; }
        if let Some(request) = &state.pending { return Some(request.clone()); }
        state.next = state.next.checked_add(1)?;
        let request = state.next.to_string();
        state.pending = Some(request.clone());
        Some(request)
    }
    pub fn finish(&self, request: &str, approved: bool) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Exit state is unavailable")?;
        if state.pending.as_deref() != Some(request) { return Err("The exit request is no longer current".into()); }
        state.pending = None;
        state.approved = approved;
        Ok(())
    }
    pub fn take_approval(&self) -> bool {
        let Ok(mut state) = self.state.lock() else { return false; };
        std::mem::take(&mut state.approved)
    }
    pub fn pending(&self) -> Option<String> {
        self.state.lock().ok()?.pending.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_requests_are_coalesced_and_cancel_keeps_exit_blocked() {
        let gate = ExitGate::default();
        assert!(!gate.take_approval());
        let first = gate.request().unwrap();
        assert_eq!(gate.request().unwrap(), first);
        gate.finish(&first, false).unwrap();
        assert!(!gate.take_approval());
        assert_eq!(gate.pending(), None);
        assert_ne!(gate.request().unwrap(), first);
    }
    #[test]
    fn only_current_request_can_authorize_one_exit() {
        let gate = ExitGate::default();
        assert!(gate.finish("unsolicited", true).is_err());
        let first = gate.request().unwrap();
        gate.finish(&first, false).unwrap();
        let second = gate.request().unwrap();
        assert!(gate.finish(&first, true).is_err());
        assert!(!gate.take_approval());
        gate.finish(&second, true).unwrap();
        assert!(gate.finish(&second, true).is_err());
        assert_eq!(gate.request(), None);
        assert!(gate.take_approval());
        assert!(!gate.take_approval());
    }
}
