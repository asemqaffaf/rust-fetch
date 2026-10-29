//! Unit tests for the JavaScript bindings. They need a JS engine:
//! `wasm-pack test --node`. Network behaviour is covered end-to-end by the
//! JS test suite in `js/test`.

use super::futures::{abortable, AbortableStream, Delay};
use super::*;
use crate::runtime;
use crate::types::Body;
use futures_util::StreamExt;
use wasm_bindgen_test::*;

/// Evaluate a JS expression
fn js(expression: &str) -> JsValue {
    js_sys::Function::new_no_args(&format!("return ({expression});"))
        .call0(&JsValue::UNDEFINED)
        .unwrap()
}

fn error_parameter<T>(result: Result<T>) -> String {
    match result.err() {
        Some(Error::InvalidInput { parameter, .. }) => parameter,
        other => panic!("expected InvalidInput, got {other:?}"),
    }
}

fn get(value: &JsValue, name: &str) -> JsValue {
    js_sys::Reflect::get(value, &name.into()).unwrap()
}

fn request() -> RequestBuilder {
    Client::new()
        .unwrap()
        .request(Method::Post, "https://example.com")
}

fn body_of(request: &RequestBuilder) -> Option<Vec<u8>> {
    request.config.body.as_ref().map(|b| b.to_bytes().unwrap())
}

fn content_type(request: &RequestBuilder) -> Option<String> {
    request
        .config
        .headers
        .get_first("content-type")
        .map(String::from)
}

// --- Headers ----------------------------------------------------------------

#[wasm_bindgen_test]
fn headers_from_every_headers_like_shape() {
    let shapes = [
        r#"{ "X-A": "1", "X-B": 2, "X-C": true, "X-Skip": null, "X-Undef": undefined }"#,
        r#"new Headers({ "X-A": "1", "X-B": "2", "X-C": "true" })"#,
        r#"new Map([["X-A", "1"], ["X-B", 2], ["X-C", true]])"#,
        r#"[["X-A", "1"], ["X-B", "2"], ["X-C", "true"]]"#,
    ];
    for shape in shapes {
        let headers = parse_headers(&js(shape)).unwrap();
        assert_eq!(headers.get_first("x-a"), Some("1"), "{shape}");
        assert_eq!(headers.get_first("x-b"), Some("2"), "{shape}");
        assert_eq!(headers.get_first("x-c"), Some("true"), "{shape}");
        assert!(!headers.contains("x-skip"), "{shape}");
    }

    assert!(parse_headers(&JsValue::NULL)
        .unwrap()
        .iter()
        .next()
        .is_none());
    assert!(parse_headers(&JsValue::UNDEFINED)
        .unwrap()
        .iter()
        .next()
        .is_none());
    let legacy = Headers::from_js_object(&js(r#"{ "a": "b" }"#).unchecked_into()).unwrap();
    assert_eq!(legacy.get_first("a"), Some("b"));
}

#[wasm_bindgen_test]
fn invalid_headers_are_rejected_not_dropped() {
    for shape in [
        r#""x-a: 1""#,
        r#"{ "x-a": { nested: 1 } }"#,
        r#"[[1, "x"]]"#,
        "42",
    ] {
        assert_eq!(
            error_parameter(parse_headers(&js(shape))),
            "headers",
            "{shape}"
        );
    }
}

// --- Query parameters ---------------------------------------------------------

#[wasm_bindgen_test]
fn params_from_objects_and_url_search_params() {
    let params = parse_params(&js(r#"{ q: "a b", n: 1.5, big: 1e21, ok: false, tags: ["x", 2], skip: null, undef: undefined }"#)).unwrap();
    let expected: Vec<(String, String)> = [
        ("q", "a b"),
        ("n", "1.5"),
        ("big", "1e+21"),
        ("ok", "false"),
        ("tags", "x"),
        ("tags", "2"),
    ]
    .iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect();
    assert_eq!(params, expected);

    let params = parse_params(&js(r#"new URLSearchParams("a=1&a=2&b=")"#)).unwrap();
    assert_eq!(
        params,
        vec![
            ("a".into(), "1".into()),
            ("a".into(), "2".into()),
            ("b".into(), String::new())
        ]
    );
}

#[wasm_bindgen_test]
fn invalid_params_are_rejected() {
    for shape in [r#""a=1""#, r#"{ a: { b: 1 } }"#, r#"{ a: [[1]] }"#] {
        assert_eq!(
            error_parameter(parse_params(&js(shape))),
            "params",
            "{shape}"
        );
    }
}

// --- Options ------------------------------------------------------------------

#[wasm_bindgen_test]
fn timeouts() {
    assert_eq!(parse_timeout(&js("0")).unwrap(), None);
    assert_eq!(
        parse_timeout(&js("1500")).unwrap(),
        Some(Duration::from_millis(1500))
    );
    assert_eq!(
        parse_timeout(&js("0.5")).unwrap(),
        Some(Duration::from_micros(500))
    );
    for invalid in ["-1", "NaN", "Infinity", r#""100""#] {
        assert_eq!(
            error_parameter(parse_timeout(&js(invalid))),
            "timeoutMs",
            "{invalid}"
        );
    }
}

#[wasm_bindgen_test]
fn retries_from_a_count() {
    let config = parse_retries(&js("5")).unwrap();
    assert_eq!(config.max_retries, 5);
    assert_eq!(
        config.retry_on_status,
        RetryConfig::default().retry_on_status
    );
}

#[wasm_bindgen_test]
fn retries_from_options() {
    let config = parse_retries(&js(
        r#"{ maxRetries: 2, initialDelayMs: 50, maxDelayMs: 2000, multiplier: 1.5, retryOn: [409, 503],
             retryOnNetworkError: false, retryOnTimeout: false, retryNonIdempotent: true }"#,
    ))
    .unwrap();
    assert_eq!(config.max_retries, 2);
    assert_eq!(config.initial_delay, Duration::from_millis(50));
    assert_eq!(config.max_delay, Duration::from_secs(2));
    assert_eq!(config.multiplier, 1.5);
    assert_eq!(config.retry_on_status, vec![409, 503]);
    assert!(!config.retry_on_network_error);
    assert!(!config.retry_on_timeout);
    assert!(config.retry_non_idempotent);

    let defaults = parse_retries(&js("{}")).unwrap();
    assert_eq!(defaults.max_retries, RetryConfig::default().max_retries);
}

#[wasm_bindgen_test]
fn invalid_retries_are_rejected() {
    let cases = [
        (r#""3""#, "retries"),
        ("-1", "retries"),
        ("1.5", "retries"),
        ("{ maxRetries: -1 }", "retries.maxRetries"),
        (r#"{ maxRetries: "2" }"#, "retries.maxRetries"),
        ("{ initialDelayMs: -5 }", "retries.initialDelayMs"),
        ("{ maxDelayMs: NaN }", "retries.maxDelayMs"),
        ("{ multiplier: 0.5 }", "retries.multiplier"),
        ("{ retryOn: 503 }", "retries.retryOn"),
        ("{ retryOn: [99] }", "retries.retryOn"),
        ("{ retryOn: [503.5] }", "retries.retryOn"),
        (
            r#"{ retryOnNetworkError: "yes" }"#,
            "retries.retryOnNetworkError",
        ),
        ("{ retryOnTimeout: 1 }", "retries.retryOnTimeout"),
        (
            "{ retryNonIdempotent: null, retryOnTimeout: 0 }",
            "retries.retryOnTimeout",
        ),
    ];
    for (shape, parameter) in cases {
        assert_eq!(
            error_parameter(parse_retries(&js(shape))),
            parameter,
            "{shape}"
        );
    }
}

#[wasm_bindgen_test]
fn body_types_and_methods() {
    for (name, expected) in [
        ("auto", BodyType::Auto),
        ("json", BodyType::Json),
        ("text", BodyType::Text),
        ("binary", BodyType::Binary),
        ("stream", BodyType::Stream),
    ] {
        assert!(
            std::mem::discriminant(&parse_body_type(&name.into()).unwrap())
                == std::mem::discriminant(&expected)
        );
    }
    assert_eq!(
        error_parameter(parse_body_type(&"xml".into())),
        "responseType"
    );
    assert_eq!(parse_method("patch").unwrap(), Method::Patch);
    assert_eq!(error_parameter(parse_method("FETCH")), "method");
    assert_eq!(error_parameter(parse_method("trace")), "method");
    assert_eq!(error_parameter(parse_method("CONNECT")), "method");
}

// --- Request bodies -----------------------------------------------------------

#[wasm_bindgen_test]
async fn bodies_are_encoded_by_type() {
    let cases: [(&str, &[u8], Option<&str>); 7] = [
        (r#""plain text""#, b"plain text", None),
        ("new Uint8Array([1, 2, 3])", &[1, 2, 3], None),
        ("new Uint8Array([1, 2, 3]).buffer", &[1, 2, 3], None),
        (
            "new DataView(new Uint8Array([9, 1, 2, 9]).buffer, 1, 2)",
            &[1, 2],
            None,
        ),
        (
            r#"new URLSearchParams({ q: "a b", n: "1" })"#,
            b"q=a+b&n=1",
            Some("application/x-www-form-urlencoded;charset=UTF-8"),
        ),
        (
            r#"{ name: "Zoë", when: new Date(0), skip: undefined }"#,
            r#"{"name":"Zoë","when":"1970-01-01T00:00:00.000Z"}"#.as_bytes(),
            Some("application/json"),
        ),
        (
            "[1, true, null]",
            b"[1,true,null]",
            Some("application/json"),
        ),
    ];
    for (value, bytes, header) in cases {
        let request = apply_body(request(), BodyMode::Auto(js(value)))
            .await
            .unwrap();
        assert_eq!(body_of(&request).as_deref(), Some(bytes), "{value}");
        assert_eq!(content_type(&request).as_deref(), header, "{value}");
    }
    // Raw strings and bytes get their Content-Type from the body type at send time
    assert!(matches!(
        apply_body(request(), BodyMode::Auto("x".into()))
            .await
            .unwrap()
            .config
            .body,
        Some(Body::Text(_))
    ));
    assert!(matches!(
        apply_body(request(), BodyMode::Auto(js("new Uint8Array(1)")))
            .await
            .unwrap()
            .config
            .body,
        Some(Body::Binary(_))
    ));
}

#[wasm_bindgen_test]
async fn missing_and_forced_json_bodies() {
    assert!(apply_body(request(), BodyMode::Auto(JsValue::UNDEFINED))
        .await
        .unwrap()
        .config
        .body
        .is_none());
    assert!(apply_body(request(), BodyMode::Auto(JsValue::NULL))
        .await
        .unwrap()
        .config
        .body
        .is_none());

    let forced = apply_body(request(), BodyMode::Json("text".into()))
        .await
        .unwrap();
    assert_eq!(body_of(&forced).unwrap(), br#""text""#);
    let forced = apply_body(request(), BodyMode::Json(JsValue::NULL))
        .await
        .unwrap();
    assert_eq!(body_of(&forced).unwrap(), b"null");
    assert_eq!(content_type(&forced).as_deref(), Some("application/json"));
}

#[wasm_bindgen_test]
async fn explicit_content_type_is_kept() {
    let request = request().header("Content-Type", "application/vnd.api+json");
    let request = apply_body(request, BodyMode::Auto(js("{ a: 1 }")))
        .await
        .unwrap();
    assert_eq!(
        content_type(&request).as_deref(),
        Some("application/vnd.api+json")
    );
}

#[wasm_bindgen_test]
async fn unsupported_bodies_are_rejected() {
    for value in [
        "undefined",
        "10n",
        "(() => { const a = {}; a.self = a; return a; })()",
    ] {
        let mode = if value == "undefined" {
            BodyMode::Json(js(value))
        } else {
            BodyMode::Auto(js(value))
        };
        assert_eq!(
            error_parameter(apply_body(request(), mode).await),
            "body",
            "{value}"
        );
    }
}

#[wasm_bindgen_test]
async fn form_data_and_blobs_become_multipart_and_bytes() {
    let form = js(r#"(() => {
        const f = new FormData();
        f.append("title", "Report");
        f.append("upload", new File(["%PDF"], "report.pdf", { type: "application/pdf" }));
        f.append("raw", new Blob([new Uint8Array([0, 255])]));
        return f;
    })()"#);
    let encoded = apply_body(request(), BodyMode::Auto(form)).await.unwrap();
    let header = content_type_of(&encoded);
    let boundary = header
        .strip_prefix("multipart/form-data; boundary=")
        .unwrap()
        .to_string();
    let body = body_of(&encoded).unwrap();
    let mut expected = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"title\"\r\n\r\nReport\r\n\
         --{boundary}\r\nContent-Disposition: form-data; name=\"upload\"; filename=\"report.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF\r\n\
         --{boundary}\r\nContent-Disposition: form-data; name=\"raw\"; filename=\"blob\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    expected.extend_from_slice(&[0, 255]);
    expected.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    assert_eq!(body, expected);

    // A user Content-Type can't be kept: the boundary must match
    let replaced = apply_body(
        request_with_type("multipart/form-data"),
        BodyMode::Auto(js("new FormData()")),
    )
    .await
    .unwrap();
    assert!(content_type_of(&replaced).contains("boundary=----rust-fetch-"));

    let blob = apply_body(
        request(),
        BodyMode::Auto(js(r#"new Blob(["{}"], { type: "application/json" })"#)),
    )
    .await
    .unwrap();
    assert_eq!(body_of(&blob).unwrap(), b"{}");
    assert_eq!(content_type(&blob).as_deref(), Some("application/json"));
    let untyped = apply_body(request(), BodyMode::Auto(js(r#"new Blob(["x"])"#)))
        .await
        .unwrap();
    assert_eq!(
        content_type(&untyped).as_deref(),
        Some("application/octet-stream")
    );
}

fn request_with_type(content_type: &str) -> RequestBuilder {
    request().header("content-type", content_type)
}

fn content_type_of(request: &RequestBuilder) -> String {
    content_type(request).unwrap_or_default()
}

// --- Responses ----------------------------------------------------------------

#[wasm_bindgen_test]
fn decoding_follows_body_type_and_content_type() {
    let decode_bytes = |bytes: &[u8], content_type: &str, body_type| {
        let buffer: JsValue = js_sys::Uint8Array::from(bytes).buffer().into();
        let length = u32::try_from(bytes.len()).unwrap();
        transport::decode_body(&buffer, length, content_type, body_type)
    };
    let decode = |bytes: &[u8], content_type: &str, body_type| {
        decode_bytes(bytes, content_type, body_type).unwrap()
    };
    let stringify = |value: JsValue| {
        js_sys::JSON::stringify(&value)
            .unwrap()
            .as_string()
            .unwrap()
    };

    // Big integers lose precision like Response.json() instead of failing
    let json = decode(
        br#"{"id":12345678901234567890,"a":[1]}"#,
        "application/json",
        BodyType::Auto,
    );
    assert_eq!(stringify(json), r#"{"id":12345678901234567000,"a":[1]}"#);
    assert!(decode(b"{}", "application/problem+json", BodyType::Auto).is_object());
    assert_eq!(
        decode(b"not json", "application/json", BodyType::Auto)
            .as_string()
            .unwrap(),
        "not json"
    );
    assert_eq!(
        decode(b"<p>", "text/html", BodyType::Auto)
            .as_string()
            .unwrap(),
        "<p>"
    );
    assert!(decode(b"\x89PNG", "image/png", BodyType::Auto).is_instance_of::<js_sys::Uint8Array>());
    assert!(decode(b"[1]", "text/plain", BodyType::Json).is_array());
    assert_eq!(
        decode(b"[1]", "application/json", BodyType::Text)
            .as_string()
            .unwrap(),
        "[1]"
    );
    assert_eq!(
        js_sys::Uint8Array::from(decode(b"[1]", "application/json", BodyType::Binary)).to_vec(),
        b"[1]"
    );

    assert!(decode(b"", "application/json", BodyType::Auto).is_null());
    assert!(decode(b"", "", BodyType::Json).is_null());
    assert_eq!(decode(b"", "", BodyType::Text).as_string().unwrap(), "");
    assert_eq!(
        js_sys::Uint8Array::from(decode(b"", "", BodyType::Binary)).length(),
        0
    );

    let error = decode_bytes(b"{", "", BodyType::Json).unwrap_err();
    assert!(matches!(error, Error::Parse { .. }));
    assert!(error.to_string().contains("Failed to parse JSON response"));
}

#[wasm_bindgen_test]
fn response_heads_become_plain_objects() {
    let mut headers = Headers::new();
    headers.insert("content-type", "application/json");
    headers.insert("set-thing", "a");
    headers.insert("set-thing", "b");

    let value: JsValue = response_head_to_js(201, "Created", "https://example.com/x", &headers)
        .unwrap()
        .into();
    assert_eq!(get(&value, "status").as_f64(), Some(201.0));
    assert_eq!(get(&value, "statusText").as_string().unwrap(), "Created");
    assert_eq!(get(&value, "ok").as_bool(), Some(true));
    assert_eq!(
        get(&value, "url").as_string().unwrap(),
        "https://example.com/x"
    );
    assert_eq!(
        get(&get(&value, "headers"), "set-thing")
            .as_string()
            .unwrap(),
        "a, b"
    );
    let redirect: JsValue = response_head_to_js(302, "Found", "", &Headers::new())
        .unwrap()
        .into();
    assert_eq!(get(&redirect, "ok").as_bool(), Some(false));
}

// --- Errors -------------------------------------------------------------------

#[wasm_bindgen_test]
fn errors_become_real_js_errors() {
    let http = JsValue::from(Error::Http {
        status: 503,
        status_text: "Service Unavailable".into(),
        body: Some("down".into()),
    });
    assert!(http.is_instance_of::<js_sys::Error>());
    assert_eq!(get(&http, "name").as_string().unwrap(), "HttpError");
    assert_eq!(get(&http, "kind").as_string().unwrap(), "HttpError");
    assert_eq!(
        get(&http, "message").as_string().unwrap(),
        "HTTP error 503: Service Unavailable - down"
    );
    assert_eq!(get(&http, "status").as_f64(), Some(503.0));
    assert_eq!(
        get(&http, "statusText").as_string().unwrap(),
        "Service Unavailable"
    );
    assert_eq!(get(&http, "body").as_string().unwrap(), "down");
    assert!(get(&http, "stack").as_string().is_some());

    let no_body = JsValue::from(Error::Http {
        status: 500,
        status_text: String::new(),
        body: None,
    });
    assert!(get(&no_body, "body").is_undefined());

    let timeout = JsValue::from(Error::Timeout { duration_ms: 250 });
    assert_eq!(get(&timeout, "timeoutMs").as_f64(), Some(250.0));

    let input = JsValue::from(invalid("headers", "bad"));
    assert_eq!(get(&input, "parameter").as_string().unwrap(), "headers");

    let cancelled = JsValue::from(Error::Cancelled);
    assert_eq!(
        get(&cancelled, "name").as_string().unwrap(),
        "CancelledError"
    );
}

#[wasm_bindgen_test]
fn js_values_become_errors() {
    let error = Error::from(js("new TypeError('nope')"));
    assert!(matches!(error, Error::JsInterop { .. }));

    let serde_error = serde_wasm_bindgen::from_value::<u8>(js(r#""x""#)).unwrap_err();
    assert!(Error::from(serde_error)
        .to_string()
        .starts_with("JavaScript interop error: JavaScript serialization error"));

    assert_eq!(js_error_message(&js("new Error('boom')")), "boom");
    assert_eq!(js_error_message(&"plain".into()), "plain");
    assert_eq!(js_error_message(&js("42")), "JsValue(42)");
}

// --- Helpers ------------------------------------------------------------------

#[wasm_bindgen_test]
fn helpers() {
    assert!(prop(&js("{ a: null }"), "a").is_none());
    assert!(prop(&js("{ a: undefined }"), "a").is_none());
    assert_eq!(prop(&js("{ a: 0 }"), "a").unwrap().as_f64(), Some(0.0));
    assert!(prop(&"string".into(), "length").is_none());

    assert!(is_instance_of_global(
        &js("new URLSearchParams()"),
        "URLSearchParams"
    ));
    assert!(!is_instance_of_global(&js("{}"), "URLSearchParams"));
    assert!(!is_instance_of_global(&"x".into(), "URLSearchParams"));
    assert!(!is_instance_of_global(&js("{}"), "NoSuchGlobal"));
    assert!(!is_instance_of_global(&js("{}"), "Math"));

    assert!(js_bytes(&js("{}")).is_none());
    assert!(into_js::<JsValue>(None).is_undefined());
    assert_eq!(non_negative_u32(4_294_967_296.0, "n").is_err(), true);
}

// --- Client construction --------------------------------------------------------

#[wasm_bindgen_test]
fn client_options() {
    let options = |o: &str| Some(js(o).unchecked_into::<ClientOptions>());
    assert!(WasmClient::new(None).is_ok());
    assert!(WasmClient::new(options(
        r#"{ baseUrl: "https://api.example.com/v1", headers: { "X-Key": "k" }, timeoutMs: 0, retries: { maxRetries: 1 } }"#,
    ))
    .is_ok());
    assert!(WasmClient::new(options("{ timeoutMs: 100, retries: 2 }")).is_ok());

    for (shape, parameter) in [
        ("{ baseUrl: 1 }", "baseUrl"),
        (r#"{ baseUrl: "api.example.com" }"#, "baseUrl"),
        (r#"{ headers: "x" }"#, "headers"),
        ("{ timeoutMs: -1 }", "timeoutMs"),
        (r#"{ retries: "3" }"#, "retries"),
    ] {
        let result = WasmClient::new(options(shape)).map(|_| ());
        assert_eq!(error_parameter(result), parameter, "{shape}");
    }
}

async fn rejection(promise: ResponsePromise) -> JsValue {
    wasm_bindgen_futures::JsFuture::from(promise.unchecked_into::<js_sys::Promise>())
        .await
        .unwrap_err()
}

#[wasm_bindgen_test]
async fn invalid_requests_reject_before_any_network_io() {
    let client = WasmClient::new(None).unwrap();

    let error = rejection(client.request(
        "BREW".into(),
        "https://example.com".into(),
        None,
        None,
        None,
    ))
    .await;
    assert_eq!(get(&error, "parameter").as_string().unwrap(), "method");

    let error = rejection(client.fetch(
        "https://example.com".into(),
        Some(js("{ method: 1 }").unchecked_into()),
    ))
    .await;
    assert_eq!(get(&error, "parameter").as_string().unwrap(), "method");

    let error = rejection(client.fetch(
        "https://example.com".into(),
        Some(js(r#"{ method: "NOPE" }"#).unchecked_into()),
    ))
    .await;
    assert_eq!(get(&error, "parameter").as_string().unwrap(), "method");

    let error = rejection(client.get("/relative".into(), None)).await;
    assert_eq!(get(&error, "parameter").as_string().unwrap(), "url");

    for (options, parameter) in [
        (r#"{ responseType: "xml" }"#, "responseType"),
        (r#"{ signal: {} }"#, "signal"),
        (r#"{ params: "a=1" }"#, "params"),
        (r#"{ headers: 1 }"#, "headers"),
        (r#"{ timeoutMs: "1" }"#, "timeoutMs"),
    ] {
        let error = rejection(client.get(
            "https://example.com".into(),
            Some(js(options).unchecked_into()),
        ))
        .await;
        assert_eq!(
            get(&error, "parameter").as_string().unwrap(),
            parameter,
            "{options}"
        );
    }

    let error = rejection(client.post(
        "https://example.com".into(),
        Some(js("{ body: Symbol('invalid') }").unchecked_into()),
    ))
    .await;
    assert_eq!(get(&error, "parameter").as_string().unwrap(), "body");

    let error = rejection(client.request(
        "GET".into(),
        "https://example.com".into(),
        Some(js("1").unchecked_into()),
        None,
        None,
    ))
    .await;
    assert_eq!(get(&error, "parameter").as_string().unwrap(), "headers");
}

// --- Interceptors ---------------------------------------------------------------

#[wasm_bindgen_test]
fn interceptors_can_be_added_and_ejected() {
    let client = WasmClient::new(None).unwrap();
    let noop = || js("(x) => x");
    let first = client.add_request_interceptor(noop().unchecked_into());
    let second = client.add_response_interceptor(Some(noop().unchecked_into()), None);
    let third = client.add_response_interceptor(None, Some(noop().unchecked_into()));
    assert_eq!((first, second, third), (1, 2, 3));
    assert_eq!(client.interceptors.borrow().request.len(), 1);
    assert_eq!(client.interceptors.borrow().response.len(), 2);

    assert!(client.eject_interceptor(second));
    assert!(!client.eject_interceptor(second));
    assert!(client.eject_interceptor(first));
    assert_eq!(client.interceptors.borrow().response.len(), 1);
    client.clear_interceptors();
    assert!(client.interceptors.borrow().response.is_empty());
    assert_eq!(client.add_request_interceptor(noop().unchecked_into()), 4);
}

#[wasm_bindgen_test]
async fn request_interceptors_rewrite_requests() {
    let request = || {
        JsRequest::new(
            Method::Post,
            "https://a.dev/x".into(),
            &js(r#"{ "X-A": "1" }"#),
            BodyMode::Json(js("{ a: 1 }")),
            &js(r#"{ headers: { "x-a": "2", "X-B": "3" } }"#),
        )
        .unwrap()
    };

    // Options headers override the headers argument
    let merged = request();
    assert_eq!(merged.headers.get("x-a").unwrap(), &vec!["2".to_string()]);
    assert_eq!(merged.headers.get_first("x-b"), Some("3"));

    // Mutating in place (returning nothing)
    let mutate: js_sys::Function = js(
        r#"(r) => { r.method = "put"; r.url += "?y=1"; r.headers["x-c"] = "4"; r.body = [1]; }"#,
    )
    .unchecked_into();
    let changed = request().intercept(&mutate).await.unwrap();
    assert_eq!(changed.method, Method::Put);
    assert_eq!(changed.url, "https://a.dev/x?y=1");
    assert_eq!(changed.headers.get_first("x-c"), Some("4"));
    assert!(matches!(changed.body, BodyMode::Json(ref b) if js_sys::Array::is_array(b)));

    // Returning a new object (asynchronously)
    let replace: js_sys::Function = js(
        r#"async (r) => ({ method: "GET", url: "https://b.dev/", headers: {}, body: "plain" })"#,
    )
    .unchecked_into();
    let replaced = request().intercept(&replace).await.unwrap();
    assert_eq!(
        (replaced.method, replaced.url.as_str()),
        (Method::Get, "https://b.dev/")
    );
    assert!(replaced.headers.iter().next().is_none());

    let auto = JsRequest::new(
        Method::Get,
        "https://a.dev".into(),
        &JsValue::UNDEFINED,
        BodyMode::Auto(JsValue::UNDEFINED),
        &JsValue::UNDEFINED,
    )
    .unwrap();
    let kept = auto
        .intercept(&js("() => 42").unchecked_into())
        .await
        .unwrap();
    assert!(matches!(kept.body, BodyMode::Auto(ref b) if b.is_undefined()));

    // Broken results and exceptions are rejected
    for (code, expected) in [
        (r#"(r) => { r.method = 1; }"#, "method"),
        (r#"(r) => { delete r.url; }"#, "url"),
        (r#"(r) => { r.method = "BREW"; }"#, "method"),
        (r#"(r) => { r.headers = 5; }"#, "headers"),
    ] {
        let error = request()
            .intercept(&js(code).unchecked_into())
            .await
            .err()
            .unwrap();
        assert_eq!(
            get(&error, "parameter").as_string().unwrap(),
            expected,
            "{code}"
        );
    }
    let thrown = request()
        .intercept(&js(r#"() => { throw new RangeError("stop"); }"#).unchecked_into())
        .await
        .err()
        .unwrap();
    assert!(thrown.is_instance_of::<js_sys::RangeError>());
}

#[wasm_bindgen_test]
async fn call_async_awaits_promises() {
    let sync = call_async(&js("(x) => x + 1").unchecked_into(), &JsValue::from(1))
        .await
        .unwrap();
    assert_eq!(sync.as_f64(), Some(2.0));
    let resolved = call_async(
        &js("async (x) => x * 3").unchecked_into(),
        &JsValue::from(2),
    )
    .await
    .unwrap();
    assert_eq!(resolved.as_f64(), Some(6.0));
    let rejected = call_async(
        &js("async () => { throw 'no'; }").unchecked_into(),
        &JsValue::NULL,
    )
    .await
    .unwrap_err();
    assert_eq!(rejected.as_string().unwrap(), "no");
}

// --- Timers and cancellation ------------------------------------------------------

#[wasm_bindgen_test]
async fn delay_waits_and_timeout_fires() {
    let started = js_sys::Date::now();
    Delay::new(Duration::from_millis(30)).await;
    assert!(js_sys::Date::now() - started >= 25.0);

    runtime::sleep(Duration::from_millis(1)).await;

    let slow = async {
        Delay::new(Duration::from_secs(5)).await;
        Ok(())
    };
    let result = runtime::timeout(Duration::from_millis(20), slow).await;
    assert!(matches!(result, Err(Error::Timeout { duration_ms: 20 })));

    let fast = async { Ok(7) };
    assert_eq!(
        runtime::timeout(Duration::from_secs(5), fast)
            .await
            .unwrap(),
        7
    );

    let random = runtime::random();
    assert!((0.0..1.0).contains(&random));
}

#[wasm_bindgen_test]
async fn abort_signal_cancels() {
    let pending = || async {
        Delay::new(Duration::from_secs(5)).await;
        Ok(())
    };

    // Already aborted
    let signal: web_sys::AbortSignal = js("AbortSignal.abort()").unchecked_into();
    assert!(matches!(
        abortable(Some(signal), pending()).await,
        Err(Error::Cancelled)
    ));

    // Aborted while waiting
    let signal: web_sys::AbortSignal = js("AbortSignal.timeout(20)").unchecked_into();
    assert!(matches!(
        abortable(Some(signal), pending()).await,
        Err(Error::Cancelled)
    ));

    // Finishes before the signal fires, and without a signal at all
    let signal: web_sys::AbortSignal = js("new AbortController().signal").unchecked_into();
    assert_eq!(abortable(Some(signal), async { Ok(1) }).await.unwrap(), 1);
    assert_eq!(abortable(None, async { Ok(2) }).await.unwrap(), 2);
}

#[wasm_bindgen_test]
async fn abortable_stream_errors_once_aborted() {
    let items = || futures_util::stream::iter(vec![Ok::<_, Error>(1), Ok(2)]);

    let all: Vec<_> = AbortableStream::new(items(), None).collect().await;
    assert_eq!(all.len(), 2);

    let signal: web_sys::AbortSignal = js("AbortSignal.abort()").unchecked_into();
    let mut aborted = AbortableStream::new(items(), Some(signal));
    assert!(matches!(aborted.next().await, Some(Err(Error::Cancelled))));
    assert!(aborted.next().await.is_none());

    let signal: web_sys::AbortSignal = js("new AbortController().signal").unchecked_into();
    let live: Vec<_> = AbortableStream::new(items(), Some(signal)).collect().await;
    assert_eq!(live.len(), 2);
}

#[wasm_bindgen_test]
async fn invalid_progress_callbacks_are_rejected() {
    let client = WasmClient::new(None).unwrap();
    let error = rejection(client.get(
        "https://example.com".into(),
        Some(js("{ onDownloadProgress: 1 }").unchecked_into()),
    ))
    .await;
    assert_eq!(
        get(&error, "parameter").as_string().unwrap(),
        "onDownloadProgress"
    );
}

/// The same URL resolution as the native `test_resolve_url`, through the
/// runtime's `URL` (crate::url in WebAssembly), plus what only it does here
#[wasm_bindgen_test]
fn urls_resolve_with_the_runtime_url_as_with_the_url_crate() {
    use crate::client::resolve_url;
    use crate::url::Url;
    let page = Url::parse("https://app.example.com/dashboard/index.html").ok();
    let none: &[(String, String)] = &[];
    let resolve = |base, page, url| resolve_url(base, page, url, none).map(|u| u.to_string());
    let cases = [
        (None, None, "https://a.com/x", "https://a.com/x"),
        (
            Some("https://api.com/v1"),
            page.clone(),
            "https://a.com/x",
            "https://a.com/x",
        ),
        (
            Some("https://api.com/v1"),
            page.clone(),
            "users",
            "https://api.com/v1/users",
        ),
        (
            None,
            page.clone(),
            "api/items",
            "https://app.example.com/dashboard/api/items",
        ),
        (
            None,
            page.clone(),
            "/api/items",
            "https://app.example.com/api/items",
        ),
        // International domain names become punycode, as with the url crate
        (
            None,
            None,
            "https://bücher.example/ä?q=ü",
            "https://xn--bcher-kva.example/%C3%A4?q=%C3%BC",
        ),
        // Paths can't climb out of the base URL's host
        (
            Some("https://api.com/v1"),
            None,
            "//evil.example/x",
            "https://api.com/v1/evil.example/x",
        ),
    ];
    for (base, page, url, expected) in cases {
        assert_eq!(resolve(base, page, url).unwrap(), expected, "{url}");
    }

    let query = [
        ("q".to_string(), "a&b c".to_string()),
        ("n".to_string(), "1".to_string()),
    ];
    let url = resolve_url(None, None, "https://a.com/s?x=0", &query).unwrap();
    assert_eq!(url.as_str(), "https://a.com/s?x=0&q=a%26b+c&n=1");

    for (base, page, url) in [
        (None, None, "/no/base"),
        (Some("https://api.com"), None, "ftp://a.com/x"),
        (Some("not a base"), None, "users"),
        (None, Some(Url::parse("data:text/plain,hi").unwrap()), "x"),
    ] {
        let error = resolve_url(base, page, url, none).expect_err(url);
        assert!(
            matches!(error, Error::InvalidInput { ref parameter, .. } if parameter == "url"),
            "{url}: {error}"
        );
    }

    // The rest of the Url API the bindings use
    let mut ws = Url::parse("https://example.com/live?a=1").unwrap();
    assert_eq!(ws.scheme(), "https");
    assert!(ws.has_host());
    ws.set_scheme("wss").unwrap();
    assert_eq!(ws.as_str(), "wss://example.com/live?a=1");
    assert!(
        ws.set_scheme("mailto").is_err(),
        "only between special schemes"
    );
    assert_eq!(
        ws.as_str(),
        "wss://example.com/live?a=1",
        "unchanged on error"
    );
    assert!(!Url::parse("file:///etc/passwd").unwrap().has_host());
    assert!(Url::parse("not a url").unwrap_err().to_string().len() > 0);
    assert_eq!(
        Url::parse("https://a.com/x")
            .unwrap()
            .join("../y")
            .unwrap()
            .as_str(),
        "https://a.com/y"
    );
    assert_eq!(
        String::from(Url::parse("https://a.com").unwrap()),
        "https://a.com/"
    );
}

#[wasm_bindgen_test]
async fn delays_chain_long_timers_and_round_up_fractional_milliseconds() {
    js("(() => { globalThis.__timers = []; globalThis.__setTimeout = globalThis.setTimeout; globalThis.__clearTimeout = globalThis.clearTimeout; globalThis.setTimeout = (callback, ms) => { __timers.push(ms); callback(); return __timers.length; }; globalThis.clearTimeout = () => {}; return null; })()");
    Delay::new(Duration::from_millis(i32::MAX as u64 + 10)).await;
    Delay::new(Duration::from_micros(1)).await;
    let timers = js("JSON.stringify(__timers)").as_string().unwrap();
    js("(() => { globalThis.setTimeout = __setTimeout; globalThis.clearTimeout = __clearTimeout; delete globalThis.__setTimeout; delete globalThis.__clearTimeout; delete globalThis.__timers; return null; })()");
    assert_eq!(timers, "[2147483647,10,1]");
}

#[wasm_bindgen_test]
async fn promise_adapter_schedules_once_and_preserves_fulfillment_and_rejection() {
    let polled = std::rc::Rc::new(std::cell::Cell::new(false));
    let flag = std::rc::Rc::clone(&polled);
    let success = super::futures::promise(async move {
        flag.set(true);
        Delay::new(Duration::from_millis(1)).await;
        Ok(JsValue::from_str("ok"))
    });
    assert!(!polled.get(), "the request starts on the next microtask");
    assert_eq!(
        wasm_bindgen_futures::JsFuture::from(success)
            .await
            .unwrap()
            .as_string()
            .unwrap(),
        "ok"
    );
    assert!(polled.get());
    let failed = super::futures::promise(async { Err(JsValue::from_str("failure")) });
    assert_eq!(
        wasm_bindgen_futures::JsFuture::from(failed)
            .await
            .unwrap_err()
            .as_string()
            .unwrap(),
        "failure"
    );
}

#[wasm_bindgen_test]
async fn streaming_bodies_stay_lazy_and_expose_replay_policy() {
    js_sys::eval(include_str!("../../js/upload.js")).unwrap();
    for (expression, replayable) in [
        ("new ReadableStream()", false),
        (
            "(async function* () { yield new Uint8Array([1]); })()",
            false,
        ),
        ("() => new ReadableStream()", true),
    ] {
        let request = apply_body(request(), BodyMode::Auto(js(expression)))
            .await
            .unwrap();
        let upload = request.upload.as_ref().unwrap();
        assert_eq!(upload.replayable(), replayable);
        assert!(request.config.body.is_none());
        assert_eq!(
            content_type(&request).as_deref(),
            Some("application/octet-stream")
        );
    }
    let get = Client::new()
        .unwrap()
        .request(Method::Get, "https://example.com");
    assert_eq!(
        error_parameter(apply_body(get, BodyMode::Auto(js("new ReadableStream()"))).await),
        "body"
    );
}
