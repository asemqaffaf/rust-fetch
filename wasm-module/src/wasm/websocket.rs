//! `WasmClient.websocket()`: the runtime's `WebSocket` (browsers, Node.js 22+,
//! Deno, Bun) with the client's base URL, typed errors, a connect timeout and
//! reconnection with the same jittered backoff as request retries.
//!
//! Everything here is event-driven. While a connection is active, the
//! socket's handlers and timers hold it alive (so a caller doesn't have to
//! keep a reference); once it's closed for good they are all dropped.
//! User callbacks are never called while the state is borrowed, since they
//! may call back into the connection.

use super::{
    callback_option, invalid, js_error_message, non_negative_u32, parse_delay, parse_headers,
    parse_params, parse_timeout, prop, set, WasmClient,
};
use crate::{
    client::{calculate_retry_delay, page_url, resolve_url, with_jitter},
    error::{Error, Result},
    types::RetryConfig,
};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen(typescript_custom_section)]
const TYPESCRIPT_TYPES: &'static str = r#"
/** Reconnection after a connection fails or drops, with jittered exponential backoff. */
export interface ReconnectOptions {
  /** Reconnection attempts in a row before giving up; reset once a connection opens. Default: unlimited */
  maxRetries?: number;
  /** Delay before the first attempt, in ms. Default: 1000 */
  initialDelayMs?: number;
  /** Upper bound for any delay, in ms. Default: 30000 */
  maxDelayMs?: number;
  /** Exponential backoff multiplier. Default: 2 */
  multiplier?: number;
}

/** What `send()` accepts; use `sendJson()` for other values. */
export type WebSocketData = string | ArrayBuffer | ArrayBufferView | Blob;

export type WebSocketState = 'connecting' | 'open' | 'reconnecting' | 'closing' | 'closed';

export interface WebSocketCloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface WebSocketReconnectInfo {
  /** 1 for the first attempt after a failure */
  attempt: number;
  delayMs: number;
  /** Why the previous connection failed or dropped */
  error: RustFetchError;
}

export interface WebSocketOptions {
  /** Subprotocols to offer */
  protocols?: string | string[];
  params?: QueryParams;
  /**
   * Handshake headers, merged over the client's headers. Node.js only: browsers don't allow
   * WebSocket headers, so there this rejects with an `InvalidInputError` (client headers are skipped).
   */
  headers?: HeadersLike;
  /**
   * Node.js only: an undici dispatcher for the connection, e.g. `new ProxyAgent('http://proxy:3128')` from
   * the `undici` package to connect through a proxy. Node's WebSocket doesn't use the client's `proxy` option.
   */
  dispatcher?: object;
  /** Time allowed for each connection attempt, in ms. `0` disables it. Default: the client's `timeoutMs` */
  timeoutMs?: number;
  /**
   * Reconnect when a connection fails or drops unexpectedly (close codes 1001, 1006, 1011-1014):
   * `true` for the defaults, a maximum number of attempts in a row, or options. Default: off
   */
  reconnect?: boolean | number | ReconnectOptions;
  /** Overrides the client's `allowAbsoluteUrls` */
  allowAbsoluteUrls?: boolean;
  /**
   * Node.js: overrides the client's `allowPrivateNetwork`. With `false`, an IP address that is private or reserved
   * throws a `NetworkError` from `websocket()`, and a host name is checked on every connection, reconnections
   * included (a blocked one fails the attempt with "Blocked: …"). Can't be combined with `dispatcher`, and fails
   * while another undici global dispatcher is installed. Browsers have their own rules.
   */
  allowPrivateNetwork?: boolean;
  /**
   * The most messages `send()` queues while the connection isn't open yet (connecting or reconnecting). One more
   * throws a `NetworkError` whose `maxQueuedMessages` is the limit, and isn't queued. Default: no limit
   */
  maxQueuedMessages?: number;
  /**
   * The most bytes (UTF-8 for text, `byteLength` or `size` otherwise) `send()` queues while the connection isn't
   * open yet. A message that would go over throws a `NetworkError` whose `maxQueuedBytes` is the limit, and isn't
   * queued. Once open, messages go to the runtime's socket: watch `bufferedAmount` there. Default: no limit
   */
  maxQueuedBytes?: number;
  /** Closes the connection and stops reconnecting when aborted */
  signal?: AbortSignal;
  /** `auto` (default): text messages as strings, binary ones as `Uint8Array`. `json`: text messages parsed as JSON */
  messageType?: 'auto' | 'json';
  /** Called each time a connection opens, including after reconnecting */
  onOpen?: () => void;
  onMessage?: (data: any) => void;
  /** Called on every failure: a failed or timed-out attempt, an unexpected drop, a message that isn't JSON */
  onError?: (error: RustFetchError) => void;
  /** Called before waiting to reconnect */
  onReconnect?: (info: WebSocketReconnectInfo) => void;
  /** Called once, when the connection is closed for good */
  onClose?: (info: WebSocketCloseInfo) => void;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// `WebSocketOptions` (see TypeScript definitions)
    #[wasm_bindgen(typescript_type = "WebSocketOptions")]
    pub type WebSocketOptions;

    /// `WebSocketData`
    #[wasm_bindgen(typescript_type = "WebSocketData")]
    pub type WebSocketData;

    /// `WebSocketState`
    #[wasm_bindgen(typescript_type = "WebSocketState")]
    pub type WebSocketStateName;

    /// `Promise<void>`
    #[wasm_bindgen(typescript_type = "Promise<void>")]
    pub type OpenedPromise;

    /// `Promise<WebSocketCloseInfo>`
    #[wasm_bindgen(typescript_type = "Promise<WebSocketCloseInfo>")]
    pub type ClosedPromise;

    #[wasm_bindgen(js_name = WebSocket)]
    type Socket;

    #[wasm_bindgen(constructor, catch, js_class = WebSocket)]
    fn new(url: &str, protocols: &JsValue) -> std::result::Result<Socket, JsValue>;

    #[wasm_bindgen(method, setter = binaryType)]
    fn set_binary_type(this: &Socket, value: &str);

    #[wasm_bindgen(method, setter = onopen)]
    fn set_onopen(this: &Socket, handler: Option<&js_sys::Function>);

    #[wasm_bindgen(method, setter = onmessage)]
    fn set_onmessage(this: &Socket, handler: Option<&js_sys::Function>);

    #[wasm_bindgen(method, setter = onclose)]
    fn set_onclose(this: &Socket, handler: Option<&js_sys::Function>);

    #[wasm_bindgen(method, setter = onerror)]
    fn set_onerror(this: &Socket, handler: Option<&js_sys::Function>);

    #[wasm_bindgen(method, catch)]
    fn send(this: &Socket, data: &JsValue) -> std::result::Result<(), JsValue>;

    #[wasm_bindgen(method, catch)]
    fn close(this: &Socket, code: u16, reason: &str) -> std::result::Result<(), JsValue>;

    #[wasm_bindgen(method, js_name = close)]
    fn abandon(this: &Socket);

    #[wasm_bindgen(method, getter)]
    fn protocol(this: &Socket) -> String;

    #[wasm_bindgen(method, getter = bufferedAmount)]
    fn buffered_amount(this: &Socket) -> f64;
}

thread_local! {
    /// A shared no-op rejection handler, so an `opened` promise nobody
    /// awaits doesn't become an unhandled rejection
    pub(crate) static IGNORE: Closure<dyn FnMut(JsValue)> = Closure::new(|_| {});
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Connecting,
    Open,
    Reconnecting,
    Closing,
    Closed,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Open => "open",
            Self::Reconnecting => "reconnecting",
            Self::Closing => "closing",
            Self::Closed => "closed",
        }
    }
}

/// What a connection was created with
struct Settings {
    url: String,
    /// The constructor's second argument: subprotocols, or (in Node.js, with
    /// headers) `{ protocols, headers }`
    protocols: JsValue,
    timeout: Option<Duration>,
    reconnect: Option<RetryConfig>,
    json: bool,
    /// Node.js: `allowPrivateNetwork: false`
    block_private_network: bool,
    max_queued_messages: Option<usize>,
    max_queued_bytes: Option<usize>,
    on_open: Option<js_sys::Function>,
    on_message: Option<js_sys::Function>,
    on_error: Option<js_sys::Function>,
    on_reconnect: Option<js_sys::Function>,
    on_close: Option<js_sys::Function>,
}

/// The socket of the current attempt and its handlers
struct Attempt {
    socket: Socket,
    _handlers: [Closure<dyn FnMut(JsValue)>; 4],
}

impl Attempt {
    /// Close the socket, without its events: closing can dispatch them
    /// synchronously, so the handlers are detached first
    fn discard(self) {
        self.detach();
        self.socket.abandon();
    }

    fn detach(&self) {
        self.socket.set_onopen(None);
        self.socket.set_onmessage(None);
        self.socket.set_onclose(None);
        self.socket.set_onerror(None);
    }
}

impl Drop for Attempt {
    fn drop(&mut self) {
        self.detach();
    }
}

/// A `setTimeout` timer, cleared when dropped
struct Timer {
    handle: JsValue,
    _callback: Closure<dyn FnMut()>,
}

impl Timer {
    fn new(delay: Duration, callback: impl FnMut() + 'static) -> Self {
        let callback = Closure::<dyn FnMut()>::new(callback);
        let ms = i32::try_from(delay.as_millis()).unwrap_or(i32::MAX);
        let handle = super::futures::set_timeout(callback.as_ref().unchecked_ref(), ms);
        Self {
            handle,
            _callback: callback,
        }
    }
}

impl Drop for Timer {
    fn drop(&mut self) {
        super::futures::clear_timeout(&self.handle);
    }
}

struct Inner {
    state: State,
    attempt: Option<Attempt>,
    /// The connect timeout, or the delay before reconnecting
    timer: Option<Timer>,
    /// Messages sent before the connection opened
    queue: Vec<JsValue>,
    /// Their total size, as `data_length` counts it
    queued_bytes: f64,
    /// Failed attempts in a row
    failures: u32,
    opened_once: bool,
    resolve_opened: Option<js_sys::Function>,
    reject_opened: Option<js_sys::Function>,
    resolve_closed: Option<js_sys::Function>,
    /// Close code and reason given to `close()`, used if no socket is open
    closing: Option<(u16, String)>,
    abort: Option<(web_sys::AbortSignal, Closure<dyn FnMut()>)>,
}

struct Shared {
    settings: Settings,
    inner: RefCell<Inner>,
    opened: js_sys::Promise,
    closed: js_sys::Promise,
}

/// A WebSocket connection created by `WasmClient.websocket()`
#[wasm_bindgen(js_name = WebSocketConnection)]
pub struct WebSocketConnection {
    shared: Rc<Shared>,
}

#[wasm_bindgen(js_class = WebSocketConnection)]
impl WebSocketConnection {
    /// The connection URL (`ws:` or `wss:`)
    #[wasm_bindgen(getter)]
    pub fn url(&self) -> String {
        self.shared.settings.url.clone()
    }

    /// `connecting`, `open`, `reconnecting`, `closing` or `closed`
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> WebSocketStateName {
        JsValue::from_str(self.shared.inner.borrow().state.name()).unchecked_into()
    }

    /// The subprotocol the server selected, or `""`
    #[wasm_bindgen(getter)]
    pub fn protocol(&self) -> String {
        let inner = self.shared.inner.borrow();
        inner
            .attempt
            .as_ref()
            .map(|attempt| attempt.socket.protocol())
            .unwrap_or_default()
    }

    /// Bytes queued by the socket but not yet sent
    #[wasm_bindgen(getter = bufferedAmount)]
    pub fn buffered_amount(&self) -> f64 {
        let inner = self.shared.inner.borrow();
        let queued = inner.queued_bytes;
        inner
            .attempt
            .as_ref()
            .map_or(0.0, |attempt| attempt.socket.buffered_amount())
            + queued
    }

    /// Resolves when the first connection opens; rejects if it never does
    #[wasm_bindgen(getter)]
    pub fn opened(&self) -> OpenedPromise {
        self.shared.opened.clone().unchecked_into()
    }

    /// Resolves with the close code and reason once the connection is closed for good
    #[wasm_bindgen(getter)]
    pub fn closed(&self) -> ClosedPromise {
        self.shared.closed.clone().unchecked_into()
    }

    /// Send a message. Before the connection opens (or while reconnecting),
    /// messages are queued and sent once it does.
    pub fn send(&self, data: WebSocketData) -> Result<()> {
        let data: JsValue = data.into();
        let valid = data.is_string()
            || data.is_instance_of::<js_sys::ArrayBuffer>()
            || js_sys::ArrayBuffer::is_view(&data)
            || super::is_instance_of_global(&data, "Blob");
        if !valid {
            return Err(invalid(
                "data",
                "must be a string, ArrayBuffer, typed array, DataView or Blob; use sendJson() for other values",
            ));
        }
        send(&self.shared, data)
    }

    /// Send a value as JSON text
    #[wasm_bindgen(js_name = sendJson)]
    pub fn send_json(&self, value: JsValue) -> Result<()> {
        let text = js_sys::JSON::stringify(&value)
            .ok()
            .filter(|text| JsValue::is_string(text))
            .ok_or_else(|| invalid("value", "can't be serialized as JSON"))?;
        send(&self.shared, text.into())
    }

    /// Close the connection and stop reconnecting. `code` is 1000 (the
    /// default) or 3000-4999; `reason` is at most 123 bytes of UTF-8.
    pub fn close(&self, code: Option<u16>, reason: Option<String>) -> Result<()> {
        let code = code.unwrap_or(1000);
        if code != 1000 && !(3000..=4999).contains(&code) {
            return Err(invalid("code", "must be 1000 or between 3000 and 4999"));
        }
        let reason = reason.unwrap_or_default();
        if reason.len() > 123 {
            return Err(invalid("reason", "must be at most 123 bytes of UTF-8"));
        }
        close(&self.shared, code, reason);
        Ok(())
    }
}

#[wasm_bindgen]
impl WasmClient {
    /// Open a WebSocket connection. Relative URLs are resolved against the
    /// base URL, with `http:` and `https:` becoming `ws:` and `wss:`.
    pub fn websocket(
        &self,
        url: String,
        options: Option<WebSocketOptions>,
    ) -> Result<WebSocketConnection> {
        let options: JsValue = options.map_or(JsValue::UNDEFINED, Into::into);
        if !super::transport::has_global("WebSocket") {
            return Err(Error::Network {
                message:
                    "WebSocket isn't available in this runtime (Node.js has it from version 22, and on version 20 with --experimental-websocket)"
                        .to_string(),
                source: None,
            });
        }
        let settings = settings(&self.inner, &url, &options)?;
        let signal = match prop(&options, "signal") {
            Some(signal) if js_sys::Reflect::has(&signal, &"aborted".into()).unwrap_or(false) => {
                Some(signal.unchecked_into::<web_sys::AbortSignal>())
            }
            Some(_) => return Err(invalid("signal", "must be an AbortSignal")),
            None => None,
        };

        let mut opened_callbacks = None;
        let opened = js_sys::Promise::new(&mut |resolve, reject| {
            opened_callbacks = Some((resolve, reject));
        });
        IGNORE.with(|ignore| {
            let _ = opened.catch(ignore);
        });
        let mut resolve_closed = None;
        let closed = js_sys::Promise::new(&mut |resolve, _| resolve_closed = Some(resolve));
        let (resolve_opened, reject_opened) = opened_callbacks.unzip();

        let shared = Rc::new(Shared {
            settings,
            inner: RefCell::new(Inner {
                state: State::Connecting,
                attempt: None,
                timer: None,
                queue: Vec::new(),
                queued_bytes: 0.0,
                failures: 0,
                opened_once: false,
                resolve_opened,
                reject_opened,
                resolve_closed,
                closing: None,
                abort: None,
            }),
            opened,
            closed,
        });
        // The first attempt's constructor errors (e.g. an invalid URL) are thrown here
        let attempt = Socket::new(&shared.settings.url, &shared.settings.protocols)
            .map_err(|error| invalid("url", &js_error_message(&error)))?;
        if let Some(signal) = signal {
            if signal.aborted() {
                attempt.abandon();
                finish(&shared, 1000, String::new(), false, Some(Error::Cancelled));
                return Ok(WebSocketConnection { shared });
            }
            let weak = Rc::downgrade(&shared);
            let listener = Closure::<dyn FnMut()>::new(move || {
                if let Some(shared) = weak.upgrade() {
                    close(&shared, 1000, String::new());
                }
            });
            let _ =
                signal.add_event_listener_with_callback("abort", listener.as_ref().unchecked_ref());
            shared.inner.borrow_mut().abort = Some((signal, listener));
        }
        start(&shared, attempt);
        Ok(WebSocketConnection { shared })
    }
}

/// Parse the options and resolve the URL
fn settings(client: &crate::client::Client, url: &str, options: &JsValue) -> Result<Settings> {
    let config = &client.config;
    let params = prop(options, "params")
        .map(|params| parse_params(&params))
        .transpose()?
        .unwrap_or_default();
    let allow_absolute = match prop(options, "allowAbsoluteUrls") {
        Some(value) => super::parse_bool(&value, "allowAbsoluteUrls")?,
        None => config.allow_absolute_urls,
    };
    crate::client::check_absolute_url(config.base_url.as_deref(), url, allow_absolute)?;
    let url = websocket_url(config.base_url.as_deref(), url, &params)?;

    let protocols = js_sys::Array::new();
    match prop(options, "protocols") {
        Some(value) if value.is_string() => {
            protocols.push(&value);
        }
        Some(value) if js_sys::Array::is_array(&value) => {
            for protocol in js_sys::Array::from(&value).iter() {
                if !protocol.is_string() {
                    return Err(invalid(
                        "protocols",
                        "must be a string or an array of strings",
                    ));
                }
                protocols.push(&protocol);
            }
        }
        Some(_) => {
            return Err(invalid(
                "protocols",
                "must be a string or an array of strings",
            ))
        }
        None => {}
    }

    let headers = prop(options, "headers")
        .map(|headers| parse_headers(&headers))
        .transpose()?;
    let dispatcher = prop(options, "dispatcher");
    if dispatcher.as_ref().is_some_and(|value| !value.is_object()) {
        return Err(invalid(
            "dispatcher",
            "must be an undici dispatcher, e.g. a ProxyAgent",
        ));
    }
    let block_private_network = match prop(options, "allowPrivateNetwork") {
        Some(value) => !super::parse_bool(&value, "allowPrivateNetwork")?,
        None => !config.allow_private_network,
    };
    let protocols: JsValue = if super::transport::is_node() {
        // allowPrivateNetwork: false connects through a dispatcher that checks
        // where it connects; another dispatcher couldn't be checked
        let dispatcher = if block_private_network {
            if dispatcher.is_some() {
                return Err(invalid(
                    "dispatcher",
                    "can't be combined with allowPrivateNetwork: false, which needs its own dispatcher to check where connections go",
                ));
            }
            Some(super::transport::websocket_guard(&url)?)
        } else {
            dispatcher
        };
        // Node's WebSocket (undici) takes `{ protocols, headers }`
        let mut merged = config.default_headers.clone();
        for (name, values) in headers.iter().flat_map(crate::types::Headers::iter) {
            merged.remove(name);
            for value in values {
                merged.insert(name.clone(), value.clone());
            }
        }
        if merged.iter().next().is_none() && dispatcher.is_none() {
            protocols.into()
        } else {
            let init = js_sys::Object::new();
            set(&init, "protocols", &protocols)?;
            if merged.iter().next().is_some() {
                let js_headers = js_sys::Object::new();
                for (name, values) in merged.iter() {
                    set(&js_headers, name, &values.join(", ").into())?;
                }
                set(&init, "headers", &js_headers)?;
            }
            if let Some(dispatcher) = &dispatcher {
                set(&init, "dispatcher", dispatcher)?;
            }
            init.into()
        }
    } else {
        if headers.is_some() {
            return Err(invalid(
                "headers",
                "browsers don't allow WebSocket handshake headers; send credentials in the URL, a cookie or the first message",
            ));
        }
        if dispatcher.is_some() {
            return Err(invalid(
                "dispatcher",
                "only Node.js's WebSocket takes a dispatcher; browsers use the system's proxy settings",
            ));
        }
        protocols.into()
    };

    let timeout = match prop(options, "timeoutMs") {
        Some(value) => parse_timeout(&value)?,
        None => config.timeout,
    };
    let reconnect = prop(options, "reconnect")
        .map(|value| parse_reconnect(&value))
        .transpose()?
        .flatten();
    let json = match prop(options, "messageType").map(|value| value.as_string()) {
        None => false,
        Some(Some(name)) if name == "auto" => false,
        Some(Some(name)) if name == "json" => true,
        Some(_) => return Err(invalid("messageType", "must be 'auto' or 'json'")),
    };
    let limit = |name| {
        prop(options, name)
            .map(|value| super::positive_u32(&value, name))
            .transpose()
    };

    Ok(Settings {
        url,
        protocols,
        timeout,
        reconnect,
        json,
        block_private_network: block_private_network && super::transport::is_node(),
        max_queued_messages: limit("maxQueuedMessages")?,
        max_queued_bytes: limit("maxQueuedBytes")?,
        on_open: callback_option(options, "onOpen")?,
        on_message: callback_option(options, "onMessage")?,
        on_error: callback_option(options, "onError")?,
        on_reconnect: callback_option(options, "onReconnect")?,
        on_close: callback_option(options, "onClose")?,
    })
}

/// Resolve like an HTTP request URL, then switch `http(s):` to `ws(s):`
fn websocket_url(base: Option<&str>, url: &str, params: &[(String, String)]) -> Result<String> {
    if let Ok(mut absolute) = reqwest::Url::parse(url) {
        if matches!(absolute.scheme(), "ws" | "wss") {
            if !params.is_empty() {
                absolute.query_pairs_mut().extend_pairs(params);
            }
            return Ok(absolute.into());
        }
    }
    let mut resolved = resolve_url(base, page_url(), url, params)?;
    let scheme = if resolved.scheme() == "https" {
        "wss"
    } else {
        "ws"
    };
    // Switching between special schemes always succeeds
    let _ = resolved.set_scheme(scheme);
    Ok(resolved.into())
}

/// `true`, a maximum number of attempts, or `ReconnectOptions`; `None` for off
pub(crate) fn parse_reconnect(value: &JsValue) -> Result<Option<RetryConfig>> {
    let mut config = RetryConfig {
        max_retries: u32::MAX,
        initial_delay: Duration::from_secs(1),
        max_delay: Duration::from_secs(30),
        multiplier: 2.0,
        ..RetryConfig::default()
    };
    if let Some(enabled) = value.as_bool() {
        return Ok(enabled.then_some(config));
    }
    if let Some(count) = value.as_f64() {
        config.max_retries = if count == f64::INFINITY {
            u32::MAX
        } else {
            non_negative_u32(count, "reconnect")?
        };
        return Ok((config.max_retries > 0).then_some(config));
    }
    if !value.is_object() {
        return Err(invalid(
            "reconnect",
            "must be a boolean, a number or a ReconnectOptions object",
        ));
    }
    if let Some(v) = prop(value, "maxRetries") {
        let count = v.as_f64().unwrap_or(f64::NAN);
        config.max_retries = if count == f64::INFINITY {
            u32::MAX
        } else {
            non_negative_u32(count, "reconnect.maxRetries")?
        };
    }
    if let Some(v) = prop(value, "initialDelayMs") {
        config.initial_delay = parse_delay(&v, "reconnect.initialDelayMs")?;
    }
    if let Some(v) = prop(value, "maxDelayMs") {
        config.max_delay = parse_delay(&v, "reconnect.maxDelayMs")?;
    }
    if let Some(v) = prop(value, "multiplier") {
        config.multiplier = v
            .as_f64()
            .filter(|m| m.is_finite() && *m >= 1.0)
            .ok_or_else(|| invalid("reconnect.multiplier", "must be a number >= 1"))?;
    }
    Ok(Some(config))
}

/// Open a new socket for the next attempt
fn connect(shared: &Rc<Shared>) {
    match Socket::new(&shared.settings.url, &shared.settings.protocols) {
        Ok(socket) => start(shared, socket),
        Err(error) => {
            let error = invalid("url", &js_error_message(&error)).into_js();
            report(shared.settings.on_error.as_ref(), &error);
            finish_with(shared, 1006, String::new(), false, Some(error));
        }
    }
}

/// Attach the handlers and the connect timeout to a new socket
fn start(shared: &Rc<Shared>, socket: Socket) {
    socket.set_binary_type("arraybuffer");
    let on_open = {
        let shared = shared.clone();
        Closure::<dyn FnMut(JsValue)>::new(move |_| opened(&shared))
    };
    let on_message = {
        let shared = shared.clone();
        Closure::<dyn FnMut(JsValue)>::new(move |event: JsValue| {
            message(&shared, &js_get(&event, "data"));
        })
    };
    let on_close = {
        let shared = shared.clone();
        Closure::<dyn FnMut(JsValue)>::new(move |event: JsValue| {
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let code = js_get(&event, "code").as_f64().unwrap_or(1006.0) as u16;
            let reason = js_get(&event, "reason").as_string().unwrap_or_default();
            let was_clean = js_get(&event, "wasClean").as_bool().unwrap_or(false);
            dropped(&shared, code, reason, was_clean);
        })
    };
    // An error event is normally followed by a close event, but Node.js's
    // WebSocket fires only the error when it can't connect. Either ends the
    // attempt, and its handlers are detached before the other can arrive.
    let on_error = {
        let shared = shared.clone();
        Closure::<dyn FnMut(JsValue)>::new(move |_| {
            dropped(&shared, 1006, String::new(), false);
        })
    };
    socket.set_onerror(Some(on_error.as_ref().unchecked_ref()));
    socket.set_onopen(Some(on_open.as_ref().unchecked_ref()));
    socket.set_onmessage(Some(on_message.as_ref().unchecked_ref()));
    socket.set_onclose(Some(on_close.as_ref().unchecked_ref()));

    let timer = shared.settings.timeout.map(|timeout| {
        let shared = shared.clone();
        Timer::new(timeout, move || {
            let duration_ms = u64::try_from(timeout.as_millis()).unwrap_or(u64::MAX);
            failed(&shared, Error::Timeout { duration_ms }, 1006, String::new());
        })
    });
    let mut inner = shared.inner.borrow_mut();
    inner.attempt = Some(Attempt {
        socket,
        _handlers: [on_open, on_message, on_close, on_error],
    });
    inner.timer = timer;
}

fn opened(shared: &Rc<Shared>) {
    let (socket, queue, resolve) = {
        let mut inner = shared.inner.borrow_mut();
        if inner.state == State::Closing {
            return;
        }
        inner.state = State::Open;
        inner.timer = None;
        inner.failures = 0;
        inner.opened_once = true;
        inner.reject_opened = None;
        let Some(attempt) = &inner.attempt else {
            return;
        };
        (
            attempt.socket.clone().unchecked_into::<Socket>(),
            {
                inner.queued_bytes = 0.0;
                std::mem::take(&mut inner.queue)
            },
            inner.resolve_opened.take(),
        )
    };
    for data in queue {
        if let Err(error) = socket.send(&data) {
            report(
                shared.settings.on_error.as_ref(),
                &network_error(&error).into_js(),
            );
        }
    }
    if let Some(resolve) = resolve {
        let _ = resolve.call0(&JsValue::UNDEFINED);
    }
    call(shared.settings.on_open.as_ref(), None);
}

fn message(shared: &Rc<Shared>, data: &JsValue) {
    let data = if let Some(buffer) = data.dyn_ref::<js_sys::ArrayBuffer>() {
        js_sys::Uint8Array::new(buffer).into()
    } else if shared.settings.json && data.is_string() {
        match super::transport::parse_native_json(data) {
            Ok(value) => value,
            Err(error) => {
                let error = Error::Parse {
                    message: format!("Failed to parse JSON message: {}", js_error_message(&error)),
                    source: None,
                };
                report(shared.settings.on_error.as_ref(), &error.into_js());
                return;
            }
        }
    } else {
        data.clone()
    };
    call(shared.settings.on_message.as_ref(), Some(&data));
}

/// The socket closed
fn dropped(shared: &Rc<Shared>, code: u16, reason: String, was_clean: bool) {
    let state = shared.inner.borrow().state;
    match state {
        State::Closing => finish(shared, code, reason, was_clean, Some(Error::Cancelled)),
        State::Connecting => {
            let url = &shared.settings.url;
            let blocked = shared
                .settings
                .block_private_network
                .then(|| super::transport::websocket_blocked(url))
                .flatten();
            let message =
                blocked.unwrap_or_else(|| format!("WebSocket connection to {url} failed"));
            let error = Error::Network {
                message,
                source: None,
            };
            failed(shared, error, code, reason);
        }
        // 1001 going away, 1006 abnormal, 1011 server error, 1012 restart,
        // 1013 try again later, 1014 bad gateway: worth another attempt
        State::Open if matches!(code, 1001 | 1006 | 1011..=1014) => failed(
            shared,
            Error::Network {
                message: format!("WebSocket connection closed unexpectedly (code {code})"),
                source: None,
            },
            code,
            reason,
        ),
        State::Open => finish(shared, code, reason, was_clean, None),
        State::Reconnecting | State::Closed => {}
    }
}

/// An attempt failed or a connection dropped: reconnect if allowed, or give up
fn failed(shared: &Rc<Shared>, error: Error, code: u16, reason: String) {
    let (attempt, delay) = {
        let mut inner = shared.inner.borrow_mut();
        let attempt = inner.attempt.take();
        inner.timer = None;
        match &shared.settings.reconnect {
            Some(config) if inner.failures < config.max_retries => {
                inner.failures += 1;
                inner.state = State::Reconnecting;
                let delay = with_jitter(calculate_retry_delay(inner.failures, config));
                (attempt, Some((inner.failures, delay)))
            }
            _ => (attempt, None),
        }
    };
    if let Some(attempt) = attempt {
        attempt.discard();
    }
    let error = error.into_js();
    report(shared.settings.on_error.as_ref(), &error);
    let Some((attempt, delay)) = delay else {
        return finish_with(shared, code, reason, false, Some(error));
    };
    if let Some(callback) = &shared.settings.on_reconnect {
        let info = js_sys::Object::new();
        let _ = set(&info, "attempt", &attempt.into());
        #[allow(clippy::cast_precision_loss)]
        let _ = set(&info, "delayMs", &(delay.as_millis() as f64).into());
        let _ = set(&info, "error", &error);
        call(Some(callback), Some(&info));
    }
    // A callback may have closed the connection
    if shared.inner.borrow().state != State::Reconnecting {
        return;
    }
    let timer = {
        let shared = shared.clone();
        Timer::new(delay, move || {
            shared.inner.borrow_mut().state = State::Connecting;
            connect(&shared);
        })
    };
    shared.inner.borrow_mut().timer = Some(timer);
}

/// `close()`: close the open socket, or give up on connecting
fn close(shared: &Rc<Shared>, code: u16, reason: String) {
    let mut connecting = None;
    let open_socket = {
        let mut inner = shared.inner.borrow_mut();
        match inner.state {
            State::Closing | State::Closed => return,
            State::Open => {
                inner.state = State::Closing;
                inner.closing = Some((code, reason.clone()));
                inner
                    .attempt
                    .as_ref()
                    .map(|attempt| attempt.socket.clone().unchecked_into::<Socket>())
            }
            State::Connecting | State::Reconnecting => {
                connecting = inner.attempt.take();
                None
            }
        }
    };
    if let Some(attempt) = connecting {
        attempt.discard();
    }
    match open_socket {
        // The close event finishes it
        Some(socket) => {
            if socket.close(code, &reason).is_err() {
                finish(shared, code, reason, false, None);
            }
        }
        None => finish(shared, code, reason, false, Some(Error::Cancelled)),
    }
}

fn finish(shared: &Rc<Shared>, code: u16, reason: String, was_clean: bool, error: Option<Error>) {
    finish_with(shared, code, reason, was_clean, error.map(Error::into_js));
}

/// Closed for good: settle the promises, drop handlers and timers, call onClose
fn finish_with(
    shared: &Rc<Shared>,
    code: u16,
    reason: String,
    was_clean: bool,
    error: Option<JsValue>,
) {
    let (reject_opened, resolve_closed, attempt, timer, abort, closing) = {
        let mut inner = shared.inner.borrow_mut();
        if inner.state == State::Closed {
            return;
        }
        inner.state = State::Closed;
        inner.queue.clear();
        inner.queued_bytes = 0.0;
        inner.resolve_opened = None;
        (
            inner.reject_opened.take(),
            inner.resolve_closed.take(),
            inner.attempt.take(),
            inner.timer.take(),
            inner.abort.take(),
            inner.closing.take(),
        )
    };
    drop((attempt, timer));
    if let Some((signal, listener)) = abort {
        let _ =
            signal.remove_event_listener_with_callback("abort", listener.as_ref().unchecked_ref());
    }
    // Close events report 1005 when the server sent no code
    let (code, reason) = match closing {
        Some((requested, requested_reason)) if code == 1005 || code == 1006 => {
            (requested, requested_reason)
        }
        _ => (code, reason),
    };
    if let Some(reject) = reject_opened {
        let error = error.unwrap_or_else(|| Error::Cancelled.into_js());
        let _ = reject.call1(&JsValue::UNDEFINED, &error);
    }
    let info = js_sys::Object::new();
    let _ = set(&info, "code", &code.into());
    let _ = set(&info, "reason", &reason.into());
    let _ = set(&info, "wasClean", &was_clean.into());
    if let Some(resolve) = resolve_closed {
        let _ = resolve.call1(&JsValue::UNDEFINED, &info);
    }
    call(shared.settings.on_close.as_ref(), Some(&info));
}

/// Queue or send a message
fn send(shared: &Rc<Shared>, data: JsValue) -> Result<()> {
    let mut inner = shared.inner.borrow_mut();
    match inner.state {
        State::Open => match &inner.attempt {
            Some(attempt) => attempt.socket.send(&data).map_err(|e| network_error(&e)),
            None => Err(closed_error()),
        },
        State::Connecting | State::Reconnecting => {
            let settings = &shared.settings;
            if let Some(limit) = settings.max_queued_messages {
                if inner.queue.len() >= limit {
                    return Err(Error::queue_full("maxQueuedMessages", limit));
                }
            }
            let size = data_length(&data);
            if let Some(limit) = settings.max_queued_bytes {
                #[allow(clippy::cast_precision_loss)]
                if inner.queued_bytes + size > limit as f64 {
                    return Err(Error::queue_full("maxQueuedBytes", limit));
                }
            }
            inner.queue.push(data);
            inner.queued_bytes += size;
            Ok(())
        }
        State::Closing | State::Closed => Err(closed_error()),
    }
}

fn closed_error() -> Error {
    Error::Network {
        message: "The WebSocket connection is closed".to_string(),
        source: None,
    }
}

fn network_error(error: &JsValue) -> Error {
    Error::Network {
        message: js_error_message(error),
        source: None,
    }
}

/// Byte length of a queued message, for `bufferedAmount`
fn data_length(data: &JsValue) -> f64 {
    if let Some(text) = data.as_string() {
        #[allow(clippy::cast_precision_loss)]
        return text.len() as f64;
    }
    js_get(data, "byteLength")
        .as_f64()
        .or_else(|| js_get(data, "size").as_f64())
        .unwrap_or(0.0)
}

fn js_get(target: &JsValue, name: &str) -> JsValue {
    js_sys::Reflect::get(target, &name.into()).unwrap_or(JsValue::UNDEFINED)
}

/// Call a user callback. Its exceptions are reported as unhandled
/// rejections, as they would be from an async function, so they're visible
/// without breaking the connection.
pub(crate) fn call(callback: Option<&js_sys::Function>, argument: Option<&JsValue>) {
    let Some(callback) = callback else {
        return;
    };
    let result = match argument {
        Some(argument) => callback.call1(&JsValue::UNDEFINED, argument),
        None => callback.call0(&JsValue::UNDEFINED),
    };
    if let Err(error) = result {
        let _ = js_sys::Promise::reject(&error);
    }
}

pub(crate) fn report(on_error: Option<&js_sys::Function>, error: &JsValue) {
    call(on_error, Some(error));
}

impl Error {
    pub(crate) fn into_js(self) -> JsValue {
        self.into()
    }
}
