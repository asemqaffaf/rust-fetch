//! Generate a key once, before the shared retry loop prepares its request.

use super::{invalid, Options};
use crate::{
    client::RequestBuilder,
    error::Result,
    idempotency::{validate_header, validate_key},
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(catch, js_namespace = crypto, js_name = randomUUID)]
    fn random_uuid() -> std::result::Result<String, JsValue>;
}

#[derive(Clone)]
enum Key {
    Generate,
    Value(String),
}

#[derive(Clone, Default)]
pub(crate) struct Defaults {
    key: Option<Key>,
    header: Option<String>,
}

impl Defaults {
    pub(crate) fn parse(options: &Options) -> Result<Self> {
        Self::default().resolve(options)
    }

    fn resolve(&self, options: &Options) -> Result<Self> {
        let key = match options.get("idempotencyKey") {
            Some(value) => parse_key(&value)?,
            None => self.key.clone(),
        };
        let header = match options.get("idempotencyHeader") {
            Some(value) => {
                let header = value
                    .as_string()
                    .ok_or_else(|| invalid("idempotencyHeader", "must be a header name"))?;
                validate_header(&header)?;
                Some(header)
            }
            None => self.header.clone(),
        };
        Ok(Self { key, header })
    }

    fn value(&self) -> Result<Option<String>> {
        match &self.key {
            None => Ok(None),
            Some(Key::Value(key)) => Ok(Some(key.clone())),
            Some(Key::Generate) => random_uuid().map(Some).map_err(|_| invalid(
                "idempotencyKey", "automatic keys require crypto.randomUUID(); supply an explicit key in this runtime",
            )),
        }
    }
}

fn parse_key(value: &JsValue) -> Result<Option<Key>> {
    if let Some(enabled) = value.as_bool() {
        return Ok(enabled.then_some(Key::Generate));
    }
    let key = value
        .as_string()
        .ok_or_else(|| invalid("idempotencyKey", "must be a boolean or a non-empty string"))?;
    validate_key(&key)?;
    Ok(Some(Key::Value(key)))
}

pub(crate) fn apply(
    builder: RequestBuilder,
    options: &Options,
    defaults: &Defaults,
) -> Result<RequestBuilder> {
    let resolved = defaults.resolve(options)?;
    match resolved.value()? {
        Some(key) => builder
            .idempotency_key_header(resolved.header.as_deref().unwrap_or("Idempotency-Key"), key),
        None => Ok(builder),
    }
}

/// Reconnecting an SSE stream must keep its key, rather than generating a new
/// one each time its POST request is prepared. Inherit other options without
/// changing the caller's object.
pub(crate) fn freeze(options: JsValue, defaults: &Defaults) -> Result<JsValue> {
    let resolved = defaults.resolve(&Options::new(&options))?;
    let Some(key) = resolved.value()? else {
        return Ok(options);
    };
    let frozen = if options.is_object() {
        js_sys::Object::create(options.unchecked_ref())
    } else {
        js_sys::Object::new()
    };
    let descriptor = js_sys::Object::new();
    super::set(&descriptor, "value", &key.into())?;
    // Defining an own property also works when the caller's inherited
    // property is read-only (for example Object.freeze(options)).
    js_sys::Object::define_property(&frozen, &"idempotencyKey".into(), &descriptor);
    Ok(frozen.into())
}
