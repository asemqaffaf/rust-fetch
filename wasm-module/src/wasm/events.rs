//! `WasmClient.events()`: a Server-Sent Events client. Unlike `EventSource`
//! it works in Node.js, sends any method, headers and body (as streaming LLM
//! APIs need), and uses the client's base URL, interceptors, timeouts and
//! typed errors. Events are parsed in Rust (`crate::sse`).
//!
//! A connection runs as one task: connect, read and dispatch events, then
//! reconnect (honouring the server's `retry:` and sending `Last-Event-ID`)
//! or finish. Events go to `onEvent` when it's set, and are otherwise
//! buffered for async iteration (`for await … of stream`).

use super::futures::{abortable, AbortableStream};
use super::websocket::{call, parse_reconnect, report, IGNORE};
use super::{callback_option, invalid, parse_method, prop, set, BodyMode, JsRequest, WasmClient};
use crate::{
    client::{calculate_retry_delay, page_url, resolve_url, with_jitter},
    error::{Error, Result},
    sse,
    types::{Method, RetryConfig},
};
use futures_util::StreamExt;
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::time::Duration;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen(typescript_custom_section)]
const TYPESCRIPT_TYPES: &'static str = r#"
/** One Server-Sent Event */
export interface ServerSentEvent<T = any> {
  /** The `event:` field; `'message'` when the server didn't set one */
  event: string;
  /** The `data:` lines joined with `\n`, or parsed JSON with `messageType: 'json'` */
  data: T;
  /** The last event ID (`id:` field) in effect, or `''` */
  id: string;
}

export type EventStreamState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EventStreamOptions extends BrowserRequestOptions {
  /** HTTP method. Default: `GET` */
  method?: string;
  /** Request body, as for other requests; sent again on each reconnection */
  body?: RequestBody;
  headers?: HeadersLike;
  params?: QueryParams;
  /** Time allowed for each connection attempt until the response headers arrive, in ms. Default: the client's `timeoutMs` */
  timeoutMs?: number;
  /**
   * Reconnect after the stream ends or a connection fails, sending `Last-Event-ID` and honouring the
   * server's `retry:` field. Default: on for `GET`, off for other methods (which would resend the body).
   */
  reconnect?: boolean | number | ReconnectOptions;
  /** `auto` (default): `data` is a string. `json`: `data` is parsed JSON */
  messageType?: 'auto' | 'json';
  /** Close the stream normally when an event's raw `data` equals this. Default: `'[DONE]'` with `messageType: 'json'`, otherwise none */
  end?: string | null;
  /** Overrides the client's `allowAbsoluteUrls` */
  allowAbsoluteUrls?: boolean;
  /** Overrides the client's `maxLineBytes`; `null` removes the limit for this stream */
  maxLineBytes?: number | null;
  /** Overrides the client's `maxEventBytes`; `null` removes the limit for this stream */
  maxEventBytes?: number | null;
  /** Closes the stream and stops reconnecting when aborted */
  signal?: AbortSignal;
  /** Called each time a connection opens, including after reconnecting */
  onOpen?: () => void;
  /** Called for each event. Without it, events are buffered for `for await … of stream` */
  onEvent?: (event: ServerSentEvent) => void;
  /** Called on every failure: a failed attempt, a dropped stream, a `data` that isn't JSON */
  onError?: (error: RustFetchError) => void;
  /** Called before waiting to reconnect */
  onReconnect?: (info: WebSocketReconnectInfo) => void;
  /** Called once, when the stream is closed for good */
  onClose?: () => void;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// `EventStreamOptions` (see TypeScript definitions)
    #[wasm_bindgen(typescript_type = "EventStreamOptions")]
    pub type EventStreamOptions;

    /// `EventStreamState`
    #[wasm_bindgen(typescript_type = "EventStreamState")]
    pub type EventStreamStateName;

    /// `Promise<IteratorResult<ServerSentEvent>>`
    #[wasm_bindgen(typescript_type = "Promise<IteratorResult<ServerSentEvent>>")]
    pub type NextEventPromise;

    /// `Promise<void>`
    #[wasm_bindgen(typescript_type = "Promise<void>")]
    pub type VoidPromise;
}

/// Statuses worth reconnecting after; others fail the stream
const RECONNECT_ON: [u16; 6] = [408, 429, 500, 502, 503, 504];

#[derive(Clone, Copy, PartialEq)]
enum State {
    Connecting,
    Open,
    Reconnecting,
    Closed,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Open => "open",
            Self::Reconnecting => "reconnecting",
            Self::Closed => "closed",
        }
    }
}

struct Settings {
    method: Method,
    url: String,
    /// The `url` argument as given, resolved again by each attempt's request
    target: String,
    body: JsValue,
    options: JsValue,
    max_line_bytes: Option<usize>,
    max_event_bytes: Option<usize>,
    reconnect: Option<RetryConfig>,
    json: bool,
    end: Option<String>,
    on_open: Option<js_sys::Function>,
    on_event: Option<js_sys::Function>,
    on_error: Option<js_sys::Function>,
    on_reconnect: Option<js_sys::Function>,
    on_close: Option<js_sys::Function>,
}

struct Inner {
    state: State,
    /// Events waiting for `next()` (iteration mode only)
    queue: VecDeque<JsValue>,
    /// `next()` calls waiting for an event: (resolve, reject)
    waiters: VecDeque<(js_sys::Function, js_sys::Function)>,
    /// Resolves the reader paused on a full queue, once `next()` makes room
    room: Option<js_sys::Function>,
    /// Why the stream ended, delivered once to the iterator
    error: Option<JsValue>,
    last_event_id: String,
    opened_once: bool,
    resolve_opened: Option<js_sys::Function>,
    reject_opened: Option<js_sys::Function>,
    resolve_closed: Option<js_sys::Function>,
    signal_listener: Option<(web_sys::AbortSignal, Closure<dyn FnMut()>)>,
}

struct Shared {
    settings: Settings,
    inner: RefCell<Inner>,
    /// Aborted by `close()`: cancels the connection in flight and any reconnection delay
    closer: web_sys::AbortController,
    opened: js_sys::Promise,
    closed: js_sys::Promise,
}

/// A Server-Sent Events stream created by `WasmClient.events()`; also an async iterator of events
#[wasm_bindgen(js_name = EventStream)]
pub struct EventStream {
    shared: Rc<Shared>,
}

#[wasm_bindgen(js_class = EventStream)]
impl EventStream {
    /// The stream's URL, resolved against the client's base URL
    #[wasm_bindgen(getter)]
    pub fn url(&self) -> String {
        self.shared.settings.url.clone()
    }

    /// `connecting`, `open`, `reconnecting` or `closed`
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> EventStreamStateName {
        JsValue::from_str(self.shared.inner.borrow().state.name()).unchecked_into()
    }

    /// The last event ID received, sent as `Last-Event-ID` when reconnecting
    #[wasm_bindgen(getter = lastEventId)]
    pub fn last_event_id(&self) -> String {
        self.shared.inner.borrow().last_event_id.clone()
    }

    /// Resolves when the first connection opens; rejects if it never does
    #[wasm_bindgen(getter)]
    pub fn opened(&self) -> VoidPromise {
        self.shared.opened.clone().unchecked_into()
    }

    /// Resolves once the stream is closed for good
    #[wasm_bindgen(getter)]
    pub fn closed(&self) -> VoidPromise {
        self.shared.closed.clone().unchecked_into()
    }

    /// Close the stream and stop reconnecting
    pub fn close(&self) {
        finish(&self.shared, None);
    }

    /// The next buffered event (async iterator protocol)
    pub fn next(&self) -> NextEventPromise {
        let mut pending = None;
        let promise = js_sys::Promise::new(&mut |resolve, reject| {
            pending = Some((resolve, reject));
        });
        let (resolve, reject) = pending.expect("the Promise executor runs synchronously");
        let mut inner = self.shared.inner.borrow_mut();
        if let Some(event) = inner.queue.pop_front() {
            let room = (inner.queue.len() <= QUEUE_RESUME)
                .then(|| inner.room.take())
                .flatten();
            drop(inner);
            if let Some(room) = room {
                let _ = room.call0(&JsValue::UNDEFINED);
            }
            let _ = resolve.call1(&JsValue::UNDEFINED, &iteration(&event, false));
        } else if inner.state == State::Closed {
            match inner.error.take() {
                Some(error) => {
                    drop(inner);
                    let _ = reject.call1(&JsValue::UNDEFINED, &error);
                }
                None => {
                    drop(inner);
                    let _ =
                        resolve.call1(&JsValue::UNDEFINED, &iteration(&JsValue::UNDEFINED, true));
                }
            }
        } else {
            inner.waiters.push_back((resolve, reject));
        }
        promise.unchecked_into()
    }

    /// Stop iterating: closes the stream (async iterator protocol, e.g. `break`)
    #[wasm_bindgen(js_name = "return")]
    pub fn return_(&self) -> NextEventPromise {
        finish(&self.shared, None);
        js_sys::Promise::resolve(&iteration(&JsValue::UNDEFINED, true)).unchecked_into()
    }
}

#[wasm_bindgen]
impl WasmClient {
    /// Open a Server-Sent Events stream. Relative URLs are resolved against the base URL.
    pub fn events(&self, url: String, options: Option<EventStreamOptions>) -> Result<EventStream> {
        let options: JsValue = options.map_or(JsValue::UNDEFINED, Into::into);
        let settings = settings(&self.inner, url, options)?;
        // Snapshot, like requests: interceptors added later don't affect this stream
        let interceptors: Vec<js_sys::Function> = self
            .interceptors
            .borrow()
            .request
            .iter()
            .map(|(_, interceptor)| interceptor.clone())
            .collect();

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
                queue: VecDeque::new(),
                waiters: VecDeque::new(),
                room: None,
                error: None,
                last_event_id: String::new(),
                opened_once: false,
                resolve_opened,
                reject_opened,
                resolve_closed,
                signal_listener: None,
            }),
            closer: web_sys::AbortController::new()
                .map_err(|e| invalid("signal", &super::js_error_message(&e)))?,
            opened,
            closed,
        });

        if let Some(signal) = prop(&shared.settings.options, "signal") {
            let signal: web_sys::AbortSignal = signal.unchecked_into();
            if signal.aborted() {
                finish(&shared, Some(Error::Cancelled.into_js()));
                return Ok(EventStream { shared });
            }
            let weak = Rc::downgrade(&shared);
            let listener = Closure::<dyn FnMut()>::new(move || {
                if let Some(shared) = weak.upgrade() {
                    finish(&shared, None);
                }
            });
            let _ =
                signal.add_event_listener_with_callback("abort", listener.as_ref().unchecked_ref());
            shared.inner.borrow_mut().signal_listener = Some((signal, listener));
        }

        let client = self.inner.clone();
        let task = shared.clone();
        wasm_bindgen_futures::spawn_local(async move { run(&client, &task, &interceptors).await });
        Ok(EventStream { shared })
    }
}

/// Parse and validate the options up front, so mistakes throw from `events()`
fn settings(client: &crate::client::Client, target: String, options: JsValue) -> Result<Settings> {
    let method = match prop(&options, "method") {
        Some(method) => parse_method(
            &method
                .as_string()
                .ok_or_else(|| invalid("method", "must be a string"))?,
        )?,
        None => Method::Get,
    };
    let params = prop(&options, "params")
        .map(|params| super::parse_params(&params))
        .transpose()?
        .unwrap_or_default();
    let allow_absolute = match prop(&options, "allowAbsoluteUrls") {
        Some(value) => super::parse_bool(&value, "allowAbsoluteUrls")?,
        None => client.config.allow_absolute_urls,
    };
    crate::client::check_absolute_url(client.config.base_url.as_deref(), &target, allow_absolute)?;
    let url = resolve_url(
        client.config.base_url.as_deref(),
        page_url(),
        &target,
        &params,
    )?
    .to_string();
    if let Some(headers) = prop(&options, "headers") {
        for (name, values) in super::parse_headers(&headers)?.iter() {
            reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|e| invalid("headers", &e.to_string()))?;
            for value in values {
                reqwest::header::HeaderValue::from_str(value)
                    .map_err(|e| invalid("headers", &e.to_string()))?;
            }
        }
    }
    if let Some(timeout) = prop(&options, "timeoutMs") {
        super::parse_timeout(&timeout)?;
    }
    if let Some(signal) = prop(&options, "signal") {
        if !js_sys::Reflect::has(&signal, &"aborted".into()).unwrap_or(false) {
            return Err(invalid("signal", "must be an AbortSignal"));
        }
    }
    let reconnect = match prop(&options, "reconnect") {
        Some(value) => parse_reconnect(&value)?,
        // Like EventSource for GET; other methods would resend their body
        None if method == Method::Get => parse_reconnect(&JsValue::TRUE)?,
        None => None,
    };
    let json = match prop(&options, "messageType").map(|value| value.as_string()) {
        None => false,
        Some(Some(name)) if name == "auto" => false,
        Some(Some(name)) if name == "json" => true,
        Some(_) => return Err(invalid("messageType", "must be 'auto' or 'json'")),
    };
    let end = match js_sys::Reflect::get(&options, &"end".into()).unwrap_or(JsValue::UNDEFINED) {
        value if value.is_undefined() => json.then(|| "[DONE]".to_string()),
        value if value.is_null() => None,
        value => Some(
            value
                .as_string()
                .ok_or_else(|| invalid("end", "must be a string or null"))?,
        ),
    };
    let stream_limit = |name: &str, client| {
        let value = js_sys::Reflect::get(&options, &name.into()).unwrap_or(JsValue::UNDEFINED);
        super::parse_stream_limit(&value, client, name)
    };
    Ok(Settings {
        method,
        url,
        target,
        body: prop(&options, "body").unwrap_or(JsValue::UNDEFINED),
        max_line_bytes: stream_limit("maxLineBytes", client.config.max_line_bytes)?,
        max_event_bytes: stream_limit("maxEventBytes", client.config.max_event_bytes)?,
        reconnect,
        json,
        end,
        on_open: callback_option(&options, "onOpen")?,
        on_event: callback_option(&options, "onEvent")?,
        on_error: callback_option(&options, "onError")?,
        on_reconnect: callback_option(&options, "onReconnect")?,
        on_close: callback_option(&options, "onClose")?,
        options,
    })
}

/// How one connection ended
enum Ended {
    /// `close()`, the signal, a `204`, or the `end` sentinel
    Finished,
    /// The stream ended or failed in a way worth reconnecting after
    Dropped(Error),
    /// A failure that reconnecting won't fix
    Failed(Error),
}

/// Connect, read, and reconnect until the stream is finished
async fn run(
    client: &crate::client::Client,
    shared: &Rc<Shared>,
    interceptors: &[js_sys::Function],
) {
    let mut failures = 0u32;
    let mut server_retry: Option<Duration> = None;
    loop {
        if is_closed(shared) {
            return;
        }
        let ended = connect(client, shared, interceptors, &mut server_retry).await;
        if shared.inner.borrow().opened_once && shared.inner.borrow().state == State::Open {
            failures = 0;
        }
        let error = match ended {
            Ended::Finished => return finish(shared, None),
            Ended::Failed(error) => {
                let error = error.into_js();
                report(shared.settings.on_error.as_ref(), &error);
                return finish(shared, Some(error));
            }
            Ended::Dropped(error) => error.into_js(),
        };
        if is_closed(shared) {
            return;
        }
        report(shared.settings.on_error.as_ref(), &error);
        let Some(config) = shared
            .settings
            .reconnect
            .as_ref()
            .filter(|c| failures < c.max_retries)
        else {
            return finish(shared, Some(error));
        };
        failures += 1;
        let delay =
            server_retry.unwrap_or_else(|| with_jitter(calculate_retry_delay(failures, config)));
        shared.inner.borrow_mut().state = State::Reconnecting;
        if let Some(callback) = &shared.settings.on_reconnect {
            let info = js_sys::Object::new();
            let _ = set(&info, "attempt", &failures.into());
            #[allow(clippy::cast_precision_loss)]
            let _ = set(&info, "delayMs", &(delay.as_millis() as f64).into());
            let _ = set(&info, "error", &error);
            call(Some(callback), Some(&info));
        }
        let wait = abortable(Some(shared.closer.signal()), async {
            crate::runtime::sleep(delay).await;
            Ok(())
        });
        if wait.await.is_err() {
            return; // closed while waiting
        }
    }
}

/// One connection: request, then read and dispatch until it ends
async fn connect(
    client: &crate::client::Client,
    shared: &Rc<Shared>,
    interceptors: &[js_sys::Function],
    server_retry: &mut Option<Duration>,
) -> Ended {
    let settings = &shared.settings;
    let last_event_id = shared.inner.borrow().last_event_id.clone();
    let response = async {
        let mut request = JsRequest::new(
            settings.method,
            settings.target.clone(),
            &JsValue::UNDEFINED,
            BodyMode::Auto(settings.body.clone()),
            &settings.options,
        )?;
        for interceptor in interceptors {
            request = request.intercept(interceptor).await.map_err(Error::from)?;
        }
        // Only Accept, like EventSource: other headers (e.g. Cache-Control)
        // would make cross-origin requests preflighted in browsers
        let accept = !request.headers.contains("accept");
        let (mut builder, body) =
            super::request_builder(client, request, &super::Options::new(&settings.options))?;
        if accept {
            builder = builder.header("accept", "text/event-stream");
        }
        if !last_event_id.is_empty() {
            builder = builder.header("last-event-id", last_event_id);
        }
        let builder = super::apply_body(builder, body).await?;
        abortable(Some(shared.closer.signal()), builder.send_streaming()).await
    }
    .await;

    let response = match response {
        Ok(response) => response,
        Err(_) if is_closed(shared) => return Ended::Finished,
        Err(Error::Http {
            status,
            status_text,
            body,
        }) if RECONNECT_ON.contains(&status) => {
            return Ended::Dropped(Error::Http {
                status,
                status_text,
                body,
            })
        }
        Err(error @ (Error::Network { .. } | Error::Timeout { .. })) => {
            return Ended::Dropped(error)
        }
        Err(error) => return Ended::Failed(error),
    };
    if response.status == 204 {
        return Ended::Finished; // the server asks the client to stop
    }
    let content_type = response
        .headers
        .get_first("content-type")
        .unwrap_or("")
        .to_string();
    if !content_type
        .to_ascii_lowercase()
        .starts_with("text/event-stream")
    {
        return Ended::Failed(Error::Parse {
            message: format!(
                "Expected a text/event-stream response, got '{}'",
                if content_type.is_empty() {
                    "no Content-Type"
                } else {
                    &content_type
                }
            ),
            source: None,
        });
    }
    opened(shared);

    let mut parser = sse::Parser::with_limit(shared.settings.max_line_bytes)
        .event_limit(shared.settings.max_event_bytes);
    let mut body = AbortableStream::new(response.into_stream(), Some(shared.closer.signal()));
    while let Some(chunk) = body.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(_) if is_closed(shared) => return Ended::Finished,
            Err(error) => return Ended::Dropped(error),
        };
        // A line over maxLineBytes, or an event over maxEventBytes, ends the
        // stream after the events before it: reconnecting would get it again
        let (events, too_long) = parser.feed(&chunk);
        if let Some(retry) = parser.take_retry() {
            *server_retry = Some(Duration::from_millis(retry));
        }
        for event in events {
            shared
                .inner
                .borrow_mut()
                .last_event_id
                .clone_from(&event.id);
            if !dispatch(shared, event) || is_closed(shared) {
                return Ended::Finished;
            }
        }
        if let Some(error) = too_long {
            return Ended::Failed(error);
        }
        if let Some(room) = full_queue(shared) {
            let _ = wasm_bindgen_futures::JsFuture::from(room).await;
            if is_closed(shared) {
                return Ended::Finished;
            }
        }
    }
    if is_closed(shared) {
        return Ended::Finished;
    }
    Ended::Dropped(Error::Network {
        message: "The event stream ended".to_string(),
        source: None,
    })
}

fn opened(shared: &Rc<Shared>) {
    let resolve = {
        let mut inner = shared.inner.borrow_mut();
        inner.state = State::Open;
        inner.opened_once = true;
        inner.reject_opened = None;
        inner.resolve_opened.take()
    };
    if let Some(resolve) = resolve {
        let _ = resolve.call0(&JsValue::UNDEFINED);
    }
    call(shared.settings.on_open.as_ref(), None);
}

/// Backpressure for iterators: with this many events not yet taken by
/// `next()`, the body isn't read until the queue is down to `QUEUE_RESUME`,
/// so the connection, and the server, slow down instead of the queue growing
const QUEUE_LIMIT: usize = 64;
const QUEUE_RESUME: usize = QUEUE_LIMIT / 2;

/// A promise that resolves once `next()` makes room, when the queue is full
fn full_queue(shared: &Rc<Shared>) -> Option<js_sys::Promise> {
    let mut inner = shared.inner.borrow_mut();
    if inner.queue.len() < QUEUE_LIMIT {
        return None;
    }
    let mut room = None;
    let promise = js_sys::Promise::new(&mut |resolve, _| room = Some(resolve));
    inner.room = room;
    Some(promise)
}

/// Deliver one event; returns false when the stream should finish
fn dispatch(shared: &Rc<Shared>, event: sse::Event) -> bool {
    let settings = &shared.settings;
    if settings.end.as_deref() == Some(event.data.as_str()) {
        return false;
    }
    let data = if settings.json {
        match super::transport::parse_native_json(&JsValue::from_str(&event.data)) {
            Ok(value) => value,
            Err(error) => {
                let error = Error::Parse {
                    message: format!(
                        "Failed to parse event data as JSON: {}",
                        super::js_error_message(&error)
                    ),
                    source: None,
                }
                .into_js();
                report(settings.on_error.as_ref(), &error);
                if settings.on_event.is_none() {
                    // An iterator can't skip it silently: end the stream with the error
                    finish(shared, Some(error));
                    return false;
                }
                return true;
            }
        }
    } else {
        JsValue::from_str(&event.data)
    };
    let value = js_sys::Object::new();
    let _ = set(&value, "event", &event.event.into());
    let _ = set(&value, "data", &data);
    let _ = set(&value, "id", &event.id.into());
    let value: JsValue = value.into();

    if settings.on_event.is_some() {
        call(settings.on_event.as_ref(), Some(&value));
        return true;
    }
    let waiter = {
        let mut inner = shared.inner.borrow_mut();
        match inner.waiters.pop_front() {
            Some(waiter) => Some(waiter),
            None => {
                inner.queue.push_back(value.clone());
                None
            }
        }
    };
    if let Some((resolve, _)) = waiter {
        let _ = resolve.call1(&JsValue::UNDEFINED, &iteration(&value, false));
    }
    true
}

/// Closed for good: settle promises and waiting iterators, release the signal, call onClose
fn finish(shared: &Rc<Shared>, error: Option<JsValue>) {
    let (waiters, reject_opened, resolve_closed, listener, room) = {
        let mut inner = shared.inner.borrow_mut();
        if inner.state == State::Closed {
            return;
        }
        inner.state = State::Closed;
        inner.resolve_opened = None;
        (
            std::mem::take(&mut inner.waiters),
            inner.reject_opened.take(),
            inner.resolve_closed.take(),
            inner.signal_listener.take(),
            inner.room.take(),
        )
    };
    // A reader paused on a full queue wakes up to see the stream closed
    if let Some(room) = room {
        let _ = room.call0(&JsValue::UNDEFINED);
    }
    shared.closer.abort();
    if let Some((signal, listener)) = listener {
        let _ =
            signal.remove_event_listener_with_callback("abort", listener.as_ref().unchecked_ref());
    }
    if let Some(reject) = reject_opened {
        let reason = error.clone().unwrap_or_else(|| Error::Cancelled.into_js());
        let _ = reject.call1(&JsValue::UNDEFINED, &reason);
    }
    // The first waiting `next()` gets the error; an iterator started later gets it from `next()`
    let mut error = error;
    for (resolve, reject) in waiters {
        match error.take() {
            Some(error) => {
                let _ = reject.call1(&JsValue::UNDEFINED, &error);
            }
            None => {
                let _ = resolve.call1(&JsValue::UNDEFINED, &iteration(&JsValue::UNDEFINED, true));
            }
        }
    }
    if shared.settings.on_event.is_none() {
        shared.inner.borrow_mut().error = error;
    }
    if let Some(resolve) = resolve_closed {
        let _ = resolve.call0(&JsValue::UNDEFINED);
    }
    call(shared.settings.on_close.as_ref(), None);
}

fn is_closed(shared: &Rc<Shared>) -> bool {
    shared.inner.borrow().state == State::Closed
}

/// `{ value, done }`
fn iteration(value: &JsValue, done: bool) -> JsValue {
    let result = js_sys::Object::new();
    let _ = set(&result, "value", value);
    let _ = set(&result, "done", &done.into());
    result.into()
}
