//! End-to-end tests against a local HTTP server (no external network needed)
#![cfg(not(target_arch = "wasm32"))]

use futures_util::StreamExt;
use rust_fetch::error::Error;
use rust_fetch::types::{ResponseBody, RetryConfig};
use rust_fetch::{Client, Method, Multipart, Progress, Redirect};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// A request as seen by the test server
#[derive(Debug, Clone)]
struct Recorded {
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Recorded {
    fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    fn header_values(&self, name: &str) -> Vec<&str> {
        self.headers
            .iter()
            .filter(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
            .collect()
    }
}

/// Canned response: status, extra headers, body, delay before responding
struct Reply {
    status: u16,
    headers: Vec<(&'static str, String)>,
    body: Vec<u8>,
    delay: Duration,
    /// When set, these bytes are written verbatim (each after its delay)
    /// instead of a well-formed response, then the connection is closed
    raw: Option<Vec<(Duration, Vec<u8>)>>,
}

impl Reply {
    fn new(status: u16, body: &str) -> Self {
        Self::bytes(status, body.as_bytes().to_vec())
    }

    fn bytes(status: u16, body: Vec<u8>) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body,
            delay: Duration::ZERO,
            raw: None,
        }
    }

    fn raw(parts: Vec<(Duration, &str)>) -> Self {
        let mut reply = Self::new(0, "");
        reply.raw = Some(
            parts
                .into_iter()
                .map(|(d, p)| (d, p.as_bytes().to_vec()))
                .collect(),
        );
        reply
    }

    fn header(mut self, name: &'static str, value: &str) -> Self {
        self.headers.push((name, value.to_string()));
        self
    }

    fn delay(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

struct TestServer {
    base: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl TestServer {
    /// Start a server; `handler` gets each request and its 0-based index
    fn start(handler: impl Fn(&Recorded, usize) -> Reply + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let handler = Arc::new(handler);
        let counter = Arc::new(AtomicUsize::new(0));

        let recorded = Arc::clone(&requests);
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (handler, recorded, counter) = (
                    Arc::clone(&handler),
                    Arc::clone(&recorded),
                    Arc::clone(&counter),
                );
                thread::spawn(move || serve(stream, &*handler, &recorded, &counter));
            }
        });

        Self { base, requests }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }
}

fn serve(
    stream: TcpStream,
    handler: &(dyn Fn(&Recorded, usize) -> Reply + Send + Sync),
    recorded: &Mutex<Vec<Recorded>>,
    counter: &AtomicUsize,
) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut line = String::new();
    if reader.read_line(&mut line).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();

    let mut headers = Vec::new();
    loop {
        line.clear();
        reader.read_line(&mut line).unwrap();
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            headers.push((name.trim().to_lowercase(), value.trim().to_string()));
        }
    }
    let length = headers
        .iter()
        .find(|(n, _)| n == "content-length")
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    reader.read_exact(&mut body).unwrap();

    let request = Recorded {
        method,
        target,
        headers,
        body,
    };
    recorded.lock().unwrap().push(request.clone());
    let reply = handler(&request, counter.fetch_add(1, Ordering::SeqCst));

    let mut stream = stream;
    if let Some(parts) = reply.raw {
        for (delay, bytes) in parts {
            thread::sleep(delay);
            if stream
                .write_all(&bytes)
                .and_then(|()| stream.flush())
                .is_err()
            {
                return;
            }
        }
        return;
    }

    thread::sleep(reply.delay);
    let mut response = format!(
        "HTTP/1.1 {} X\r\nconnection: close\r\ncontent-length: {}\r\n",
        reply.status,
        reply.body.len()
    );
    for (name, value) in &reply.headers {
        response.push_str(&format!("{name}: {value}\r\n"));
    }
    response.push_str("\r\n");
    let mut response = response.into_bytes();
    response.extend_from_slice(&reply.body);
    let _ = stream.write_all(&response);
}

fn fast_retries(max_retries: u32) -> RetryConfig {
    RetryConfig {
        max_retries,
        initial_delay: Duration::from_millis(5),
        max_delay: Duration::from_millis(50),
        ..RetryConfig::default()
    }
}

#[tokio::test]
async fn get_parses_json_including_problem_json() {
    let server = TestServer::start(|req, _| match req.target.as_str() {
        "/json" => Reply::new(200, r#"{"a":{"b":1}}"#)
            .header("content-type", "application/json; charset=utf-8"),
        _ => Reply::new(200, r#"{"x":1}"#).header("content-type", "application/problem+json"),
    });
    let client = Client::new().unwrap();

    let response = client.get(server.url("/json")).await.unwrap();
    assert_eq!(response.json().unwrap()["a"]["b"], 1);

    let response = client.get(server.url("/problem")).await.unwrap();
    assert_eq!(response.json().unwrap()["x"], 1);
}

#[tokio::test]
async fn empty_response_is_empty_body() {
    let server =
        TestServer::start(|_, _| Reply::new(204, "").header("content-type", "application/json"));
    let response = Client::new().unwrap().get(server.url("/")).await.unwrap();
    assert_eq!(response.status, 204);
    assert!(matches!(response.body, ResponseBody::Empty));
}

#[tokio::test]
async fn explicit_content_type_is_not_duplicated() {
    let server = TestServer::start(|_, _| Reply::new(200, ""));
    let client = Client::new().unwrap();

    client
        .post(server.url("/"))
        .header("Content-Type", "application/json")
        .text(r#"{"q":1}"#)
        .send()
        .await
        .unwrap();
    client
        .post(server.url("/"))
        .text("plain")
        .send()
        .await
        .unwrap();

    let requests = server.requests();
    assert_eq!(
        requests[0].header_values("content-type"),
        vec!["application/json"]
    );
    assert_eq!(requests[0].body_text(), r#"{"q":1}"#);
    assert_eq!(
        requests[1].header_values("content-type"),
        vec!["text/plain"]
    );
}

#[tokio::test]
async fn request_headers_replace_default_headers() {
    let server = TestServer::start(|_, _| Reply::new(200, ""));
    let client = Client::builder()
        .default_header("Authorization", "Bearer default")
        .default_header("X-Client", "rust-fetch")
        .build()
        .unwrap();

    client
        .request(rust_fetch::Method::Get, server.url("/"))
        .header("authorization", "Bearer override")
        .send()
        .await
        .unwrap();

    let request = &server.requests()[0];
    assert_eq!(
        request.header_values("authorization"),
        vec!["Bearer override"]
    );
    assert_eq!(request.header_values("x-client"), vec!["rust-fetch"]);
}

#[tokio::test]
async fn base_url_joining_and_query_params() {
    let server = TestServer::start(|_, _| Reply::new(200, ""));
    let client = Client::builder()
        .base_url(format!("{}/v1/", server.base))
        .build()
        .unwrap();

    client
        .request(rust_fetch::Method::Get, "/users")
        .query([("q", "a b"), ("page", "2")])
        .send()
        .await
        .unwrap();
    client.get("items").await.unwrap();
    client.get(server.url("/absolute")).await.unwrap();

    let targets: Vec<_> = server.requests().into_iter().map(|r| r.target).collect();
    assert_eq!(
        targets,
        vec!["/v1/users?q=a+b&page=2", "/v1/items", "/absolute"]
    );
}

#[tokio::test]
async fn invalid_urls_fail_fast_without_retrying() {
    let client = Client::builder().with_retries().build().unwrap();

    for url in [
        "not a url",
        "/relative/without/base",
        "ftp://example.com/file",
    ] {
        let error = client.get(url).await.unwrap_err();
        assert!(
            matches!(error, Error::InvalidInput { ref parameter, .. } if parameter == "url"),
            "{url}: {error}"
        );
    }

    assert!(Client::builder().base_url("example.com").build().is_err());
}

#[tokio::test]
async fn http_errors_carry_status_and_body() {
    let server = TestServer::start(|_, _| Reply::new(404, "no such user"));
    let error = Client::new()
        .unwrap()
        .get(server.url("/users/9"))
        .await
        .unwrap_err();

    match error {
        Error::Http { status, body, .. } => {
            assert_eq!(status, 404);
            assert_eq!(body.as_deref(), Some("no such user"));
        }
        other => panic!("expected HttpError, got {other}"),
    }
}

#[tokio::test]
async fn retries_retryable_status_then_succeeds() {
    let server = TestServer::start(|_, i| {
        if i < 2 {
            Reply::new(503, "busy")
        } else {
            Reply::new(200, "ok")
        }
    });
    let client = Client::builder()
        .retry_config(fast_retries(3))
        .build()
        .unwrap();

    let response = client.get(server.url("/")).await.unwrap();
    assert_eq!(response.status, 200);
    assert_eq!(server.requests().len(), 3);
}

#[tokio::test]
async fn gives_up_after_max_retries() {
    let server = TestServer::start(|_, _| Reply::new(502, "bad gateway"));
    let client = Client::builder()
        .retry_config(fast_retries(2))
        .build()
        .unwrap();

    let error = client.get(server.url("/")).await.unwrap_err();
    assert!(matches!(error, Error::Http { status: 502, .. }));
    assert_eq!(server.requests().len(), 3);
}

#[tokio::test]
async fn does_not_retry_non_retryable_status() {
    let server = TestServer::start(|_, _| Reply::new(400, "bad request"));
    let client = Client::builder()
        .retry_config(fast_retries(3))
        .build()
        .unwrap();

    assert!(client.get(server.url("/")).await.is_err());
    assert_eq!(server.requests().len(), 1);
}

#[tokio::test]
async fn does_not_retry_post_unless_enabled() {
    let server = TestServer::start(|_, _| Reply::new(503, "busy"));
    let client = Client::builder()
        .retry_config(fast_retries(3))
        .build()
        .unwrap();
    assert!(client.post(server.url("/")).text("x").send().await.is_err());
    assert_eq!(server.requests().len(), 1);

    let client = Client::builder()
        .retry_config(RetryConfig {
            retry_non_idempotent: true,
            ..fast_retries(3)
        })
        .build()
        .unwrap();
    assert!(client.post(server.url("/")).text("x").send().await.is_err());
    assert_eq!(server.requests().len(), 5);
}

#[tokio::test]
async fn retry_after_is_honored_but_capped() {
    let server = TestServer::start(|_, i| {
        if i == 0 {
            Reply::new(429, "slow down").header("retry-after", "30")
        } else {
            Reply::new(200, "ok")
        }
    });
    let client = Client::builder()
        .retry_config(RetryConfig {
            max_delay: Duration::from_millis(200),
            ..fast_retries(1)
        })
        .build()
        .unwrap();

    let started = Instant::now();
    client.get(server.url("/")).await.unwrap();
    let elapsed = started.elapsed();
    assert!(elapsed >= Duration::from_millis(200), "{elapsed:?}");
    assert!(elapsed < Duration::from_secs(5), "{elapsed:?}");
}

#[tokio::test]
async fn timeout_fails_with_configured_duration() {
    let server = TestServer::start(|_, _| Reply::new(200, "late").delay(Duration::from_secs(3)));
    let client = Client::builder()
        .timeout(Duration::from_millis(200))
        .build()
        .unwrap();

    let started = Instant::now();
    let error = client.get(server.url("/")).await.unwrap_err();
    assert!(
        matches!(error, Error::Timeout { duration_ms: 200 }),
        "{error}"
    );
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn per_request_timeout_overrides_client_timeout() {
    let server =
        TestServer::start(|_, _| Reply::new(200, "late").delay(Duration::from_millis(300)));
    let client = Client::builder()
        .timeout(Duration::from_millis(100))
        .build()
        .unwrap();

    let response = client
        .request(rust_fetch::Method::Get, server.url("/"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status, 200);
}

#[tokio::test]
async fn timeouts_are_retried() {
    let server = TestServer::start(|_, i| {
        let reply = Reply::new(200, "ok");
        if i == 0 {
            reply.delay(Duration::from_secs(3))
        } else {
            reply
        }
    });
    let client = Client::builder()
        .timeout(Duration::from_millis(200))
        .retry_config(fast_retries(1))
        .build()
        .unwrap();

    assert_eq!(client.get(server.url("/")).await.unwrap().status, 200);
}

#[tokio::test]
async fn network_errors_are_retried_then_reported() {
    // Reserve a port, then close it so connections are refused
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let client = Client::builder()
        .retry_config(fast_retries(2))
        .build()
        .unwrap();

    let error = client
        .get(format!("http://127.0.0.1:{port}/"))
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Network { .. }), "{error}");
}

// --- Request encoding -------------------------------------------------------

#[tokio::test]
async fn every_method_and_body_type_is_sent_correctly() {
    let server = TestServer::start(|_, _| Reply::new(200, ""));
    let client = Client::new().unwrap();

    client
        .post(server.url("/json"))
        .json(&serde_json::json!({"name": "Zoë", "n": 1}))
        .unwrap()
        .send()
        .await
        .unwrap();
    let form = std::collections::HashMap::from([("q".to_string(), "a b&c".to_string())]);
    client
        .put(server.url("/form"))
        .form(form)
        .send()
        .await
        .unwrap();
    client
        .patch(server.url("/bytes"))
        .bytes(vec![0, 159, 146, 150])
        .send()
        .await
        .unwrap();
    client.delete(server.url("/delete")).send().await.unwrap();
    for method in [Method::Head, Method::Options, Method::Trace] {
        client
            .request(method, server.url("/other"))
            .send()
            .await
            .unwrap();
    }

    let requests = server.requests();
    let summary: Vec<_> = requests
        .iter()
        .map(|r| (r.method.as_str(), r.header_values("content-type").join(",")))
        .collect();
    assert_eq!(
        summary,
        vec![
            ("POST", "application/json".to_string()),
            ("PUT", "application/x-www-form-urlencoded".to_string()),
            ("PATCH", "application/octet-stream".to_string()),
            ("DELETE", String::new()),
            ("HEAD", String::new()),
            ("OPTIONS", String::new()),
            ("TRACE", String::new()),
        ]
    );
    assert_eq!(requests[0].body_text(), r#"{"n":1,"name":"Zoë"}"#);
    assert_eq!(requests[1].body_text(), "q=a+b%26c");
    assert_eq!(requests[2].body, vec![0, 159, 146, 150]);
}

#[tokio::test]
async fn invalid_header_is_input_error_and_not_retried() {
    let server = TestServer::start(|_, _| Reply::new(200, ""));
    let client = Client::builder()
        .retry_config(fast_retries(3))
        .build()
        .unwrap();

    let error = client
        .request(Method::Get, server.url("/"))
        .header("bad header", "x")
        .send()
        .await
        .unwrap_err();
    assert!(matches!(error, Error::InvalidInput { .. }), "{error}");
    let error = client
        .request(Method::Get, server.url("/"))
        .header("x-ok", "line\nbreak")
        .send()
        .await
        .unwrap_err();
    assert!(matches!(error, Error::InvalidInput { .. }), "{error}");
    assert!(server.requests().is_empty());
}

// --- Response decoding ------------------------------------------------------

#[tokio::test]
async fn redirects_are_followed_and_final_url_reported() {
    let server = TestServer::start(|req, _| match req.target.as_str() {
        "/old" => Reply::new(301, "").header("location", "/middle"),
        "/middle" => Reply::new(302, "").header("location", "/new?x=1"),
        _ => Reply::new(200, "arrived").header("content-type", "text/plain"),
    });

    let response = Client::new()
        .unwrap()
        .get(server.url("/old"))
        .await
        .unwrap();
    assert_eq!(response.text(), Some("arrived"));
    assert_eq!(response.url, server.url("/new?x=1"));
    assert_eq!(server.requests().len(), 3);
}

fn redirecting_server() -> TestServer {
    TestServer::start(|req, _| match req.target.as_str() {
        "/old" => Reply::new(301, "moved").header("location", "/middle"),
        "/middle" => Reply::new(302, "").header("location", "/new"),
        "/loop" => Reply::new(302, "").header("location", "/loop"),
        "/cached" => Reply::new(304, ""),
        _ => Reply::new(200, "arrived").header("content-type", "text/plain"),
    })
}

#[tokio::test]
async fn manual_redirects_return_the_redirect_response() {
    let server = redirecting_server();
    let client = Client::builder()
        .redirect(Redirect::Manual)
        .build()
        .unwrap();

    let response = client.get(server.url("/old")).await.unwrap();
    assert_eq!(response.status, 301);
    assert_eq!(response.headers.get_first("location"), Some("/middle"));
    assert_eq!(response.bytes(), Some(&b"moved"[..]));
    assert!(response.is_redirect());

    // Streaming returns it too, with the body unread
    let streamed = client
        .request(Method::Get, server.url("/old"))
        .send_streaming()
        .await
        .unwrap();
    assert_eq!(streamed.status, 301);
    assert_eq!(streamed.bytes().await.unwrap(), b"moved");

    // Other 3xx statuses are still errors
    let error = client.get(server.url("/cached")).await.unwrap_err();
    assert!(matches!(error, Error::Http { status: 304, .. }), "{error}");
    assert_eq!(server.requests().len(), 3);
}

#[tokio::test]
async fn redirect_error_rejects_any_redirect() {
    let server = redirecting_server();
    let client = Client::builder().redirect(Redirect::Error).build().unwrap();

    let error = client.get(server.url("/old")).await.unwrap_err();
    assert!(matches!(error, Error::Network { .. }), "{error}");
    assert!(
        error.to_string().contains("Redirect not allowed: 301 to"),
        "{error}"
    );
    // A request may still follow them
    let response = client
        .request(Method::Get, server.url("/old"))
        .redirect(Redirect::Follow)
        .send()
        .await
        .unwrap();
    assert_eq!(response.text(), Some("arrived"));
}

#[tokio::test]
async fn max_redirects_limits_redirects_per_client_and_request() {
    let server = redirecting_server();
    let client = Client::builder().max_redirects(1).build().unwrap();

    let error = client.get(server.url("/old")).await.unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Too many redirects (more than 1)"),
        "{error}"
    );
    assert!(client.get(server.url("/middle")).await.is_ok());

    // Per request, in either order with `redirect`; the same settings reuse one client
    for _ in 0..2 {
        let response = client
            .request(Method::Get, server.url("/old"))
            .max_redirects(2)
            .send()
            .await
            .unwrap();
        assert_eq!(response.text(), Some("arrived"));
    }
    let response = client
        .request(Method::Get, server.url("/old"))
        .max_redirects(5)
        .redirect(Redirect::Manual)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status, 301);

    // The default limit is 20, like browsers
    let error = Client::new()
        .unwrap()
        .get(server.url("/loop"))
        .await
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("Too many redirects (more than 20)"),
        "{error}"
    );
}

#[tokio::test]
async fn absolute_urls_can_be_kept_from_replacing_the_base_url() {
    let api = TestServer::start(|_, _| Reply::new(200, "api"));
    let other = TestServer::start(|_, _| Reply::new(200, "other"));
    let client = Client::builder()
        .base_url(api.url("/v1"))
        .default_header("authorization", "Bearer SECRET")
        .allow_absolute_urls(false)
        .build()
        .unwrap();

    for result in [
        client.get(other.url("/steal")).await.map(|_| ()),
        client
            .request(Method::Get, other.url("/steal"))
            .send_streaming()
            .await
            .map(|_| ()),
    ] {
        let error = result.unwrap_err();
        assert!(
            matches!(&error, Error::InvalidInput { parameter, .. } if parameter == "url"),
            "{error}"
        );
    }
    assert!(
        other.requests().is_empty(),
        "nothing reaches the other host"
    );

    // Paths, including protocol-relative-looking ones, stay under the base URL
    for path in ["/items", "//other.example/x"] {
        assert_eq!(client.get(path).await.unwrap().bytes(), Some(&b"api"[..]));
    }
    // A request can still opt in
    let response = client
        .request(Method::Get, other.url("/"))
        .allow_absolute_urls(true)
        .send()
        .await
        .unwrap();
    assert_eq!(response.bytes(), Some(&b"other"[..]));
    // Without a base URL there's nothing to replace
    let plain = Client::builder()
        .allow_absolute_urls(false)
        .build()
        .unwrap();
    assert!(plain.get(other.url("/")).await.is_ok());
}

#[tokio::test]
async fn chunked_responses_are_reassembled() {
    let server = TestServer::start(|_, _| {
        Reply::raw(vec![
            (Duration::ZERO, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n"),
            (Duration::from_millis(20), "7\r\n{\"part\"\r\n"),
            (Duration::from_millis(20), "4\r\n:42}\r\n"),
            (Duration::ZERO, "0\r\n\r\n"),
        ])
    });

    let response = Client::new().unwrap().get(server.url("/")).await.unwrap();
    assert_eq!(response.json().unwrap()["part"], 42);
}

#[tokio::test]
async fn large_bodies_round_trip_intact() {
    let payload: Vec<u8> = (0..8 * 1024 * 1024).map(|i: u32| (i % 251) as u8).collect();
    let expected = payload.clone();
    let server = TestServer::start(move |req, _| {
        if req.method == "POST" {
            Reply::new(200, &req.body.len().to_string())
        } else {
            Reply::bytes(200, payload.clone()).header("content-type", "application/octet-stream")
        }
    });
    let client = Client::new().unwrap();

    let response = client.get(server.url("/download")).await.unwrap();
    assert_eq!(response.bytes().unwrap(), expected.as_slice());

    let response = client
        .post(server.url("/upload"))
        .bytes(expected.clone())
        .response_format(rust_fetch::types::ResponseFormat::Text)
        .send()
        .await
        .unwrap();
    assert_eq!(response.text().unwrap(), expected.len().to_string());
}

#[tokio::test]
async fn non_utf8_headers_and_text_are_decoded_lossily() {
    let server = TestServer::start(|_, _| {
        Reply::raw(vec![(
            Duration::ZERO,
            "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\nx-name: Zo\u{eb}\r\ncontent-length: 6\r\nconnection: close\r\n\r\n\u{FEFF}h\u{e9}",
        )])
    });

    let response = Client::new().unwrap().get(server.url("/")).await.unwrap();
    assert_eq!(response.text(), Some("hé"));
    assert_eq!(response.headers.get_first("x-name"), Some("Zoë"));
}

#[tokio::test]
async fn head_requests_have_empty_bodies() {
    let server =
        TestServer::start(|_, _| Reply::new(200, "").header("content-type", "application/json"));
    let response = Client::new()
        .unwrap()
        .request(Method::Head, server.url("/"))
        .send()
        .await
        .unwrap();
    assert!(matches!(response.body, ResponseBody::Empty));
}

// --- Failure handling -------------------------------------------------------

#[tokio::test]
async fn truncated_body_is_a_network_error_and_is_retried() {
    let server = TestServer::start(|_, i| {
        if i == 0 {
            Reply::raw(vec![(
                Duration::ZERO,
                "HTTP/1.1 200 OK\r\ncontent-length: 100\r\n\r\nonly ten..",
            )])
        } else {
            Reply::new(200, "complete").header("content-type", "text/plain")
        }
    });

    let error = Client::new()
        .unwrap()
        .get(server.url("/"))
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Network { .. }), "{error}");

    let client = Client::builder()
        .retry_config(fast_retries(1))
        .build()
        .unwrap();
    assert_eq!(
        client.get(server.url("/")).await.unwrap().text(),
        Some("complete")
    );
}

#[tokio::test]
async fn connection_closed_without_response_is_a_network_error() {
    let server = TestServer::start(|_, _| Reply::raw(vec![]));
    let error = Client::new()
        .unwrap()
        .get(server.url("/"))
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Network { .. }), "{error}");
    assert!(error.is_retryable());
}

#[tokio::test]
async fn slow_body_counts_toward_the_timeout() {
    // Headers arrive at once, but the body trickles in for longer than the timeout
    let server = TestServer::start(|_, _| {
        Reply::raw(vec![
            (
                Duration::ZERO,
                "HTTP/1.1 200 OK\r\ncontent-length: 4\r\n\r\nab",
            ),
            (Duration::from_secs(3), "cd"),
        ])
    });
    let client = Client::builder()
        .timeout(Duration::from_millis(300))
        .build()
        .unwrap();

    let started = Instant::now();
    let error = client.get(server.url("/")).await.unwrap_err();
    assert!(
        matches!(error, Error::Timeout { duration_ms: 300 }),
        "{error}"
    );
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn requests_without_timeout_wait_for_slow_servers() {
    let server =
        TestServer::start(|_, _| Reply::new(200, "eventually").delay(Duration::from_millis(400)));
    let client = Client::builder()
        .timeout(Duration::from_millis(50))
        .build()
        .unwrap();

    let response = client
        .request(Method::Get, server.url("/"))
        .no_timeout()
        .send()
        .await
        .unwrap();
    assert_eq!(response.status, 200);
}

#[tokio::test]
async fn backoff_grows_exponentially_between_attempts() {
    let server = TestServer::start(|_, _| Reply::new(503, "down"));
    let client = Client::builder()
        .retry_config(RetryConfig {
            max_retries: 3,
            initial_delay: Duration::from_millis(40),
            max_delay: Duration::from_secs(1),
            multiplier: 2.0,
            ..RetryConfig::default()
        })
        .build()
        .unwrap();

    let started = Instant::now();
    assert!(client.get(server.url("/")).await.is_err());
    // Jittered delays are at least half of 40 + 80 + 160 ms
    assert!(
        started.elapsed() >= Duration::from_millis(140),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(server.requests().len(), 4);
}

#[tokio::test]
async fn retry_status_list_is_configurable() {
    let server = TestServer::start(|_, i| {
        if i == 0 {
            Reply::new(409, "conflict")
        } else {
            Reply::new(200, "ok")
        }
    });
    let client = Client::builder()
        .retry_config(RetryConfig {
            retry_on_status: vec![409],
            ..fast_retries(1)
        })
        .build()
        .unwrap();

    assert_eq!(client.get(server.url("/")).await.unwrap().status, 200);
}

// --- Concurrency ------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_requests_share_one_client_across_threads() {
    let server = TestServer::start(|req, _| {
        Reply::new(200, &format!("{{\"path\":\"{}\"}}", req.target))
            .header("content-type", "application/json")
    });
    let client = Client::builder()
        .retry_config(fast_retries(2))
        .build()
        .unwrap();

    // tokio::spawn requires the request futures to be Send + 'static
    let tasks: Vec<_> = (0..64)
        .map(|i| {
            let client = client.clone();
            let url = server.url(&format!("/item/{i}"));
            tokio::spawn(async move { client.get(url).await })
        })
        .collect();

    for (i, task) in tasks.into_iter().enumerate() {
        let response = task.await.unwrap().unwrap();
        assert_eq!(response.json().unwrap()["path"], format!("/item/{i}"));
    }
    assert_eq!(server.requests().len(), 64);
}

// --- reqwest error mapping --------------------------------------------------

#[tokio::test]
async fn reqwest_errors_map_to_matching_kinds() {
    let server = TestServer::start(|req, _| match req.target.as_str() {
        "/slow" => Reply::new(200, "").delay(Duration::from_secs(2)),
        "/missing" => Reply::new(404, ""),
        _ => Reply::new(200, "not json"),
    });
    let raw = reqwest::Client::new();

    let builder = raw.get("http://exa mple.com").send().await.unwrap_err();
    assert!(matches!(Error::from(builder), Error::InvalidInput { .. }));

    let timeout = raw
        .get(server.url("/slow"))
        .timeout(Duration::from_millis(50))
        .send()
        .await
        .unwrap_err();
    assert!(matches!(Error::from(timeout), Error::Timeout { .. }));

    let status = raw
        .get(server.url("/missing"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap_err();
    assert!(matches!(
        Error::from(status),
        Error::Http { status: 404, .. }
    ));

    let decode = raw
        .get(server.url("/text"))
        .send()
        .await
        .unwrap()
        .json::<serde_json::Value>()
        .await
        .unwrap_err();
    assert!(matches!(Error::from(decode), Error::Parse { .. }));

    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let connect = raw
        .get(format!("http://127.0.0.1:{port}"))
        .send()
        .await
        .unwrap_err();
    assert!(matches!(Error::from(connect), Error::Network { .. }));
}

// --- Streaming, progress and multipart ----------------------------------------

#[tokio::test]
async fn streaming_returns_at_headers_and_yields_chunks() {
    let server = TestServer::start(|_, _| {
        Reply::raw(vec![
            (Duration::ZERO, "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n"),
            (Duration::ZERO, "5\r\nfirst\r\n"),
            (Duration::from_millis(300), "6\r\nsecond\r\n0\r\n\r\n"),
        ])
    });

    let started = Instant::now();
    let response = Client::new()
        .unwrap()
        .get_streaming(server.url("/"))
        .await
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_millis(250),
        "returned before the body finished"
    );
    assert_eq!(response.status, 200);
    assert_eq!(
        response.headers.get_first("content-type"),
        Some("text/plain")
    );
    assert_eq!(response.content_length(), None);
    assert!(format!("{response:?}").starts_with("StreamingResponse { status: 200"));

    let chunks: Vec<Vec<u8>> = response.into_stream().map(Result::unwrap).collect().await;
    assert_eq!(chunks.concat(), b"firstsecond");
    assert!(chunks.len() >= 2, "{chunks:?}");
}

#[tokio::test]
async fn streaming_error_statuses_are_http_errors_and_retried() {
    let server = TestServer::start(|_, i| {
        if i == 0 {
            Reply::new(503, "busy")
        } else {
            Reply::new(200, "streamed")
        }
    });

    let error = Client::new()
        .unwrap()
        .get_streaming(server.url("/"))
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Http { status: 503, body: Some(ref b), .. } if b == "busy"));

    let client = Client::builder()
        .retry_config(fast_retries(1))
        .build()
        .unwrap();
    let response = client.get_streaming(server.url("/")).await.unwrap();
    assert_eq!(response.bytes().await.unwrap(), b"streamed");
}

#[tokio::test]
async fn streaming_body_failures_surface_as_network_errors() {
    let server = TestServer::start(|_, _| {
        Reply::raw(vec![(
            Duration::ZERO,
            "HTTP/1.1 200 OK\r\ncontent-length: 50\r\n\r\npartial",
        )])
    });
    let response = Client::new()
        .unwrap()
        .get_streaming(server.url("/"))
        .await
        .unwrap();
    assert_eq!(response.content_length(), Some(50));
    let error = response.bytes().await.unwrap_err();
    assert!(matches!(error, Error::Network { .. }), "{error}");
}

#[tokio::test]
async fn download_progress_is_reported_per_chunk() {
    let body: Vec<u8> = vec![7; 3 * 1024 * 1024];
    let size = body.len() as u64;
    let server = TestServer::start(move |req, _| {
        if req.target == "/fail" {
            Reply::new(500, "no progress for errors")
        } else {
            Reply::bytes(200, body.clone())
        }
    });
    let events = Arc::new(Mutex::new(Vec::<Progress>::new()));

    let recorder = Arc::clone(&events);
    let response = Client::new()
        .unwrap()
        .request(Method::Get, server.url("/"))
        .on_download_progress(move |p| recorder.lock().unwrap().push(p))
        .send()
        .await
        .unwrap();
    assert_eq!(response.bytes().unwrap().len() as u64, size);

    let events = std::mem::take(&mut *events.lock().unwrap());
    assert!(
        events.len() > 1,
        "expected several chunks, got {}",
        events.len()
    );
    assert!(events.windows(2).all(|w| w[0].loaded < w[1].loaded));
    assert_eq!(
        events.last().unwrap(),
        &Progress {
            loaded: size,
            total: Some(size)
        }
    );

    // Streaming responses report progress as the stream is consumed
    let streamed = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&streamed);
    let response = Client::new()
        .unwrap()
        .request(Method::Get, server.url("/"))
        .on_download_progress(move |p| counter.store(p.loaded as usize, Ordering::SeqCst))
        .send_streaming()
        .await
        .unwrap();
    assert_eq!(response.bytes().await.unwrap().len() as u64, size);
    assert_eq!(streamed.load(Ordering::SeqCst) as u64, size);

    // Error bodies don't report progress
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let _ = Client::new()
        .unwrap()
        .request(Method::Get, server.url("/fail"))
        .on_download_progress(move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
        })
        .send()
        .await;
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn multipart_uploads_files_and_fields() {
    let server = TestServer::start(|_, _| Reply::new(200, ""));
    let form = Multipart::new().text("title", "Report").file(
        "upload",
        "report.pdf",
        Some("application/pdf".into()),
        b"%PDF-1.7".to_vec(),
    );

    Client::new()
        .unwrap()
        .post(server.url("/upload"))
        .header("content-type", "will be replaced")
        .multipart(&form)
        .send()
        .await
        .unwrap();

    let request = &server.requests()[0];
    assert_eq!(
        request.header_values("content-type"),
        vec![form.content_type()]
    );
    assert_eq!(request.body, form.to_bytes());
    let body = request.body_text();
    assert!(body.contains(
        "name=\"upload\"; filename=\"report.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7"
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn requests_with_progress_callbacks_are_send() {
    let server = TestServer::start(|_, _| Reply::new(200, "ok"));
    let client = Client::new().unwrap();
    let url = server.url("/");
    let task = tokio::spawn(async move {
        client
            .request(Method::Get, url)
            .on_download_progress(|_| {})
            .send_streaming()
            .await?
            .bytes()
            .await
    });
    assert_eq!(task.await.unwrap().unwrap(), b"ok");
}
