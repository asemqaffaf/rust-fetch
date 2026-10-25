//! `Url` in WebAssembly: the runtime's WHATWG `URL` behind the few methods
//! of the `url` crate that the client uses, with the same signatures.

use std::borrow::Borrow;
use std::fmt;

/// A parsed absolute URL, held as its serialization (`href`)
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Url {
    href: String,
}

/// Why a URL didn't parse, as the runtime's `URL` reports it
#[derive(Debug)]
pub(crate) struct ParseError(String);

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

fn parsed(url: Result<web_sys::Url, wasm_bindgen::JsValue>) -> Result<Url, ParseError> {
    url.map(|url| Url { href: url.href() })
        .map_err(|error| ParseError(super::js_error_message(&error)))
}

impl Url {
    /// Parse an absolute URL
    pub(crate) fn parse(input: &str) -> Result<Self, ParseError> {
        parsed(web_sys::Url::new(input))
    }

    /// Resolve `input` against this URL
    pub(crate) fn join(&self, input: &str) -> Result<Self, ParseError> {
        parsed(web_sys::Url::new_with_base(input, &self.href))
    }

    fn js(&self) -> web_sys::Url {
        web_sys::Url::new(&self.href).expect("a parsed URL parses again")
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.href
    }

    /// The scheme, without the `:`
    pub(crate) fn scheme(&self) -> &str {
        self.href.split_once(':').map_or("", |(scheme, _)| scheme)
    }

    pub(crate) fn has_host(&self) -> bool {
        !self.js().host().is_empty()
    }

    /// Change the scheme; like the `url` crate, only between special schemes
    /// (http, https, ws, wss…), where the runtime's `URL` allows it
    pub(crate) fn set_scheme(&mut self, scheme: &str) -> Result<(), ()> {
        let url = self.js();
        url.set_protocol(&format!("{scheme}:"));
        if url.protocol() != format!("{scheme}:") {
            return Err(());
        }
        self.href = url.href();
        Ok(())
    }

    pub(crate) fn query_pairs_mut(&mut self) -> QueryPairs<'_> {
        QueryPairs { url: self }
    }
}

/// Appends query parameters, encoded as `application/x-www-form-urlencoded`
pub(crate) struct QueryPairs<'a> {
    url: &'a mut Url,
}

impl QueryPairs<'_> {
    pub(crate) fn extend_pairs<I, K, V>(&mut self, pairs: I) -> &mut Self
    where
        I: IntoIterator,
        I::Item: Borrow<(K, V)>,
        K: AsRef<str>,
        V: AsRef<str>,
    {
        let url = self.url.js();
        let params = url.search_params();
        for pair in pairs {
            let (name, value) = pair.borrow();
            params.append(name.as_ref(), value.as_ref());
        }
        self.url.href = url.href();
        self
    }
}

impl fmt::Display for Url {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.href)
    }
}

impl From<Url> for String {
    fn from(url: Url) -> String {
        url.href
    }
}
