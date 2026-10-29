//! Opaque streaming bodies: byte plumbing stays in the portable JS adapter.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
use super::{invalid, js_error_message};
use crate::error::Result;
use std::{cell::Cell, rc::Rc};
use wasm_bindgen::{JsCast, JsValue};

#[derive(Clone)]
pub(crate) struct Upload(Rc<Owner>);
struct Owner {
    value: JsValue,
    replayable: bool,
    active: Cell<bool>,
}
impl Drop for Owner {
    fn drop(&mut self) {
        if self.active.get() {
            if let Ok(cancel) = js_sys::Reflect::get(&self.value, &"cancel".into()) {
                if let Some(cancel) = cancel.dyn_ref::<js_sys::Function>() {
                    let _ = cancel.call0(&self.value);
                }
            }
        }
    }
}

fn creator() -> Option<js_sys::Function> {
    js_sys::Reflect::get(
        &js_sys::global(),
        &js_sys::Symbol::for_("rust-fetch.upload"),
    )
    .ok()?
    .dyn_into()
    .ok()
}
impl Upload {
    pub(crate) fn from_value(value: &JsValue) -> Result<Option<Self>> {
        let Some(create) = creator() else {
            return Ok(None);
        };
        let owner = create
            .call1(&JsValue::UNDEFINED, value)
            .map_err(|error| invalid("body", &js_error_message(&error)))?;
        if owner.is_undefined() {
            return Ok(None);
        }
        let replayable = js_sys::Reflect::get(&owner, &"replayable".into())
            .ok()
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        Ok(Some(Self(Rc::new(Owner {
            value: owner,
            replayable,
            active: Cell::new(false),
        }))))
    }
    pub(crate) fn replayable(&self) -> bool {
        self.0.replayable
    }
    pub(crate) fn activate(&self) {
        self.0.active.set(true);
    }
    pub(crate) fn value(&self) -> &JsValue {
        &self.0.value
    }
    pub(crate) fn open(&self, progress: Option<&js_sys::Function>) -> Result<JsValue> {
        let open: js_sys::Function = js_sys::Reflect::get(&self.0.value, &"open".into())
            .map_err(crate::Error::from)?
            .unchecked_into();
        open.call1(
            &self.0.value,
            progress.map_or(&JsValue::UNDEFINED, |p| p.as_ref()),
        )
        .map_err(|error| invalid("body", &js_error_message(&error)))
    }
    pub(crate) fn progress(&self, callback: &js_sys::Function) -> Result<()> {
        js_sys::Reflect::set(&self.0.value, &"progress".into(), callback)
            .map_err(crate::Error::from)?;
        Ok(())
    }
    pub(crate) fn supported() -> bool {
        creator()
            .and_then(|create| {
                let check: js_sys::Function = js_sys::Reflect::get(&create, &"supported".into())
                    .ok()?
                    .dyn_into()
                    .ok()?;
                check.call0(&create).ok()?.as_bool()
            })
            .unwrap_or(false)
    }
}
