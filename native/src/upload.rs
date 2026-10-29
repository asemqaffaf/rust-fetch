//! Pull one bounded JavaScript chunk only when hyper can write another frame.
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::{Body, Frame, SizeHint};
use napi::{
    bindgen_prelude::{Promise, Uint8Array},
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
    Status,
};
use napi_derive::napi;
use tokio::sync::Notify;

use crate::pool::lock;

pub(crate) const INVALID: &str = "RUST_FETCH_UPLOAD_INPUT: ";
pub type Next = ThreadsafeFunction<(), Promise<Chunk>, (), Status, false, true>;
pub type Control = ThreadsafeFunction<(), (), (), Status, false, true>;

#[napi(object)]
pub struct Chunk {
    pub done: bool,
    pub data: Option<Uint8Array>,
    pub end: Option<bool>,
    pub error: Option<String>,
    pub invalid_input: Option<bool>,
}

struct Completion {
    outcome: std::sync::Mutex<Option<Result<(), String>>>,
    changed: Notify,
    stopped: std::sync::atomic::AtomicBool,
    waker: futures_util::task::AtomicWaker,
}
impl Completion {
    fn finish(&self, outcome: Result<(), String>) {
        let mut current = lock(&self.outcome);
        if current.is_none() {
            *current = Some(outcome);
            self.changed.notify_waiters();
        }
    }
}

pub(crate) struct Upload {
    next: Arc<Next>,
    cancel: Arc<Control>,
    restart: Option<Control>,
    active: Option<Arc<Completion>>,
}
impl Upload {
    pub(crate) fn new(next: Next, cancel: Control, restart: Option<Control>) -> Self {
        Self {
            next: Arc::new(next),
            cancel: Arc::new(cancel),
            restart,
            active: None,
        }
    }
    pub(crate) fn body(&mut self) -> Outgoing {
        let completion = Arc::new(Completion {
            outcome: std::sync::Mutex::new(None),
            changed: Notify::new(),
            stopped: std::sync::atomic::AtomicBool::new(false),
            waker: futures_util::task::AtomicWaker::new(),
        });
        self.active = Some(Arc::clone(&completion));
        Outgoing::Stream(Box::new(Stream {
            next: Arc::clone(&self.next),
            cancel: Arc::clone(&self.cancel),
            completion,
            pending: None,
            ended: false,
        }))
    }
    pub(crate) async fn finished(&self) -> Result<(), String> {
        let Some(active) = &self.active else {
            return Ok(());
        };
        loop {
            let changed = active.changed.notified();
            if let Some(outcome) = lock(&active.outcome).clone() {
                return outcome;
            }
            changed.await;
        }
    }
    pub(crate) async fn replay(&mut self) -> Result<(), String> {
        let Some(restart) = &self.restart else {
            return Err(format!("{INVALID}A streaming body cannot be replayed for a redirect; provide a body factory"));
        };
        if let Some(active) = &self.active {
            active
                .stopped
                .store(true, std::sync::atomic::Ordering::Release);
            active.waker.wake();
        }
        self.cancel
            .call_async_catch(())
            .await
            .map_err(|e| e.to_string())?;
        restart
            .call_async_catch(())
            .await
            .map_err(|e| e.to_string())?;
        self.active = None;
        Ok(())
    }
}
impl Drop for Upload {
    fn drop(&mut self) {
        if let Some(active) = &self.active {
            active
                .stopped
                .store(true, std::sync::atomic::Ordering::Release);
            active.waker.wake();
        }
        let _ = self
            .cancel
            .call((), ThreadsafeFunctionCallMode::NonBlocking);
    }
}

pub(crate) enum Outgoing {
    Full(Full<Bytes>),
    Stream(Box<Stream>),
}
impl Outgoing {
    pub(crate) fn new(bytes: Option<&Bytes>, upload: Option<&mut Upload>) -> Self {
        upload.map_or_else(
            || Self::Full(Full::new(bytes.cloned().unwrap_or_default())),
            Upload::body,
        )
    }
}
impl Body for Outgoing {
    type Data = Bytes;
    type Error = std::io::Error;
    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
        match self.get_mut() {
            Self::Full(body) => Pin::new(body)
                .poll_frame(cx)
                .map(|frame| frame.map(|frame| frame.map_err(|never| match never {}))),
            Self::Stream(body) => Pin::new(body.as_mut()).poll_frame(cx),
        }
    }
    fn is_end_stream(&self) -> bool {
        match self {
            Self::Full(body) => body.is_end_stream(),
            Self::Stream(body) => body.ended,
        }
    }
    fn size_hint(&self) -> SizeHint {
        match self {
            Self::Full(body) => body.size_hint(),
            Self::Stream(_) => SizeHint::default(),
        }
    }
}

type Pending = Pin<Box<dyn Future<Output = Result<(Option<Bytes>, bool), String>> + Send>>;
pub(crate) struct Stream {
    next: Arc<Next>,
    cancel: Arc<Control>,
    completion: Arc<Completion>,
    pending: Option<Pending>,
    ended: bool,
}
impl Body for Stream {
    type Data = Bytes;
    type Error = std::io::Error;
    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, Self::Error>>> {
        let this = self.get_mut();
        this.completion.waker.register(cx.waker());
        if this.ended
            || this
                .completion
                .stopped
                .load(std::sync::atomic::Ordering::Acquire)
        {
            this.ended = true;
            return Poll::Ready(None);
        }
        let pending = this.pending.get_or_insert_with(|| {
            let next = Arc::clone(&this.next);
            Box::pin(async move {
                let step = next
                    .call_async_catch(())
                    .await
                    .map_err(|e| e.to_string())?
                    .await
                    .map_err(|e| e.to_string())?;
                if let Some(error) = step.error {
                    return Err(if step.invalid_input == Some(true) {
                        format!("{INVALID}{error}")
                    } else {
                        error
                    });
                }
                Ok((
                    step.data.map(|bytes| Bytes::copy_from_slice(&bytes)),
                    step.done || step.end == Some(true),
                ))
            })
        });
        let Poll::Ready(result) = pending.as_mut().poll(cx) else {
            return Poll::Pending;
        };
        this.pending = None;
        match result {
            Ok((bytes, end)) => {
                if end {
                    this.ended = true;
                    this.completion.finish(Ok(()));
                }
                Poll::Ready(bytes.map(|bytes| Ok(Frame::data(bytes))))
            }
            Err(error) => {
                this.ended = true;
                this.completion.finish(Err(error.clone()));
                Poll::Ready(Some(Err(std::io::Error::other(error))))
            }
        }
    }
}
impl Drop for Stream {
    fn drop(&mut self) {
        if !self.ended {
            self.completion.finish(Err(
                "The connection closed before the streaming upload was complete".into(),
            ));
            if !self
                .completion
                .stopped
                .load(std::sync::atomic::Ordering::Acquire)
            {
                let _ = self
                    .cancel
                    .call((), ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
    }
}
