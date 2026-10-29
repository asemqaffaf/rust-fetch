//! Request IDs belong to one JavaScript module/environment, not the process.
use crate::pool::lock;
use futures_util::future::AbortHandle;
use std::{collections::HashMap, sync::Mutex};

#[derive(Default)]
pub(crate) struct Pending(Mutex<State>);
#[derive(Default)]
struct State {
    next: u64,
    closed: bool,
    entries: HashMap<u32, (u64, AbortHandle)>,
}
impl Pending {
    pub(crate) fn register(&self, id: u32, handle: AbortHandle) -> Result<u64, String> {
        let mut state = lock(&self.0);
        if state.closed {
            return Err("The native transport environment is closed".into());
        }
        if state.entries.contains_key(&id) {
            return Err("The native request ID is already in use".into());
        }
        let generation = state
            .next
            .checked_add(1)
            .ok_or("The native request generation is exhausted")?;
        state.next = generation;
        state.entries.insert(id, (generation, handle));
        Ok(generation)
    }
    pub(crate) fn finish(&self, id: u32, generation: u64) {
        let mut state = lock(&self.0);
        if state
            .entries
            .get(&id)
            .is_some_and(|(current, _)| *current == generation)
        {
            state.entries.remove(&id);
        }
    }
    pub(crate) fn cancel(&self, id: u32) {
        let pending = lock(&self.0).entries.remove(&id);
        if let Some((_, handle)) = pending {
            handle.abort();
        }
    }
    pub(crate) fn close(&self) {
        let entries = {
            let mut state = lock(&self.0);
            state.closed = true;
            std::mem::take(&mut state.entries)
        };
        for (_, (_, handle)) in entries {
            handle.abort();
        }
    }
}
