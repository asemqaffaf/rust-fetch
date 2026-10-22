//! HTTP/1.1 connections, pooled like the node:http transport's agents
//! (`maxSockets` = `maxFreeSockets` = 256, `scheduling: 'lifo'`): at most 256
//! per origin, idle ones reused newest first and closed after 4 s.
//!
//! A finished connection goes back to the pool before its slot is freed, so
//! the request that gets the slot finds it. (hyper's own pool instead races a
//! new connection against one being returned, and opens far more than its
//! callers use under load.)

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::Full;
use hyper::client::conn::http1::{self, SendRequest};
use hyper_util::rt::TokioIo;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::{verify_server_name, WebPkiServerVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::server::ParsedCertificate;
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme,
};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpStream;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_rustls::TlsConnector;
use url::{Host, Url};

const MAX_CONNECTIONS_PER_ORIGIN: usize = 256;
// Below the 5 s keep-alive timeout of Node servers, so an idle connection
// isn't reused just as the server closes it
const IDLE_TIMEOUT: Duration = Duration::from_secs(4);

pub(crate) type Sender = SendRequest<Full<Bytes>>;

pub(crate) struct Pool {
    origins: Mutex<HashMap<String, Arc<Origin>>>,
    tls: TlsConnector,
}

struct Origin {
    slots: Arc<Semaphore>,
    /// Oldest first; requests take the newest
    idle: Mutex<VecDeque<(Sender, Instant)>>,
}

/// A connection in use, holding one of its origin's slots
pub(crate) struct Connection {
    pub(crate) sender: Sender,
    origin: Arc<Origin>,
    slot: OwnedSemaphorePermit,
}

impl Pool {
    pub(crate) fn new(tls: ClientConfig) -> Self {
        Self {
            origins: Mutex::default(),
            tls: TlsConnector::from(Arc::new(tls)),
        }
    }

    /// Wait for a free slot, then reuse an idle connection or open one
    pub(crate) async fn checkout(&self, url: &Url) -> Result<Connection, String> {
        let origin = self.origin(url);
        let slot = Arc::clone(&origin.slots)
            .acquire_owned()
            .await
            .expect("the semaphore is never closed");
        loop {
            let idle = lock(&origin.idle).pop_back();
            let Some((mut sender, since)) = idle else {
                break;
            };
            // An expired or closed connection is dropped (and so closed)
            if since.elapsed() < IDLE_TIMEOUT && sender.ready().await.is_ok() {
                return Ok(Connection {
                    sender,
                    origin,
                    slot,
                });
            }
        }
        let sender = self.connect(url).await?;
        Ok(Connection {
            sender,
            origin,
            slot,
        })
    }

    /// Open a new connection, taking a slot that is already held
    pub(crate) async fn reconnect(
        &self,
        url: &Url,
        connection: Connection,
    ) -> Result<Connection, String> {
        let Connection { origin, slot, .. } = connection;
        let sender = self.connect(url).await?;
        Ok(Connection {
            sender,
            origin,
            slot,
        })
    }

    fn origin(&self, url: &Url) -> Arc<Origin> {
        let mut origins = lock(&self.origins);
        let key = url.origin().ascii_serialization();
        if let Some(origin) = origins.get(&key) {
            return Arc::clone(origin);
        }
        let origin = Arc::new(Origin {
            slots: Arc::new(Semaphore::new(MAX_CONNECTIONS_PER_ORIGIN)),
            idle: Mutex::default(),
        });
        tokio::spawn(close_idle(Arc::downgrade(&origin)));
        origins.insert(key, Arc::clone(&origin));
        origin
    }

    async fn connect(&self, url: &Url) -> Result<Sender, String> {
        let host = url.host().ok_or_else(|| format!("No host in {url}"))?;
        let port = url
            .port_or_known_default()
            .ok_or_else(|| format!("No port for {url}"))?;
        let address = match &host {
            Host::Domain(domain) => TcpStream::connect((*domain, port)).await,
            Host::Ipv4(ip) => TcpStream::connect((*ip, port)).await,
            Host::Ipv6(ip) => TcpStream::connect((*ip, port)).await,
        };
        let tcp = address.map_err(|e| format!("Could not connect to {host}:{port}: {e}"))?;
        // Like Node's agents (`noDelay: true`)
        let _ = tcp.set_nodelay(true);
        if url.scheme() != "https" {
            return handshake(tcp).await;
        }
        let name = match host {
            Host::Domain(domain) => {
                ServerName::try_from(domain.to_owned()).map_err(|e| e.to_string())?
            }
            Host::Ipv4(ip) => ServerName::IpAddress(ip.into()),
            Host::Ipv6(ip) => ServerName::IpAddress(ip.into()),
        };
        let tls = self
            .tls
            .connect(name, tcp)
            .await
            .map_err(|e| format!("TLS connection to {host}:{port} failed: {e}"))?;
        handshake(tls).await
    }
}

impl Connection {
    /// Put the connection back for reuse (unless it was closed), then free its slot
    pub(crate) fn release(self) {
        let Connection {
            sender,
            origin,
            slot,
        } = self;
        if !sender.is_closed() {
            lock(&origin.idle).push_back((sender, Instant::now()));
        }
        drop(slot);
    }
}

async fn handshake(
    io: impl AsyncRead + AsyncWrite + Send + Unpin + 'static,
) -> Result<Sender, String> {
    let (sender, connection) = http1::handshake(TokioIo::new(io))
        .await
        .map_err(|e| format!("HTTP handshake failed: {e}"))?;
    tokio::spawn(connection);
    Ok(sender)
}

/// Close an origin's connections once they have been idle for 4 s
async fn close_idle(origin: Weak<Origin>) {
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        let Some(origin) = origin.upgrade() else {
            return;
        };
        let mut idle = lock(&origin.idle);
        while idle
            .front()
            .is_some_and(|(_, since)| since.elapsed() >= IDLE_TIMEOUT)
        {
            idle.pop_front();
        }
    }
}

/// TLS as Node does it by default: Mozilla's root certificates plus
/// `NODE_EXTRA_CA_CERTS`, and no verification with `NODE_TLS_REJECT_UNAUTHORIZED=0`
pub(crate) fn tls_config(
    reject_unauthorized: bool,
    extra_ca_certs: Option<&[u8]>,
) -> Result<ClientConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = ClientConfig::builder_with_provider(Arc::clone(&provider))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?;
    let verifier: Arc<dyn ServerCertVerifier> = if reject_unauthorized {
        let mut roots = RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        let mut trusted = Vec::new();
        if let Some(pem) = extra_ca_certs {
            for certificate in CertificateDer::pem_slice_iter(pem) {
                let certificate = certificate.map_err(|e| format!("NODE_EXTRA_CA_CERTS: {e}"))?;
                roots
                    .add(certificate.clone())
                    .map_err(|e| format!("NODE_EXTRA_CA_CERTS: {e}"))?;
                trusted.push(certificate);
            }
        }
        let webpki =
            WebPkiServerVerifier::builder_with_provider(Arc::new(roots), Arc::clone(&provider))
                .build()
                .map_err(|e| e.to_string())?;
        Arc::new(NodeVerifier { webpki, trusted })
    } else {
        Arc::new(AnyCertificate(provider))
    };
    let mut config = builder
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(config)
}

/// The standard verifier, which also accepts a certificate from
/// `NODE_EXTRA_CA_CERTS` that the server presents as is (often a self-signed
/// one marked as a CA), checking its name and dates, as OpenSSL and so Node do
#[derive(Debug)]
struct NodeVerifier {
    webpki: Arc<WebPkiServerVerifier>,
    trusted: Vec<CertificateDer<'static>>,
}

impl ServerCertVerifier for NodeVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let error = match self.webpki.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        ) {
            Ok(verified) => return Ok(verified),
            Err(error) => error,
        };
        if !self.trusted.iter().any(|trusted| trusted == end_entity) {
            return Err(error);
        }
        verify_server_name(&ParsedCertificate::try_from(end_entity)?, server_name)?;
        let (_, certificate) = x509_parser::parse_x509_certificate(end_entity)
            .map_err(|_| rustls::Error::InvalidCertificate(CertificateError::BadEncoding))?;
        let now = x509_parser::time::ASN1Time::from_timestamp(
            i64::try_from(now.as_secs()).unwrap_or(i64::MAX),
        )
        .map_err(|_| rustls::Error::InvalidCertificate(CertificateError::BadEncoding))?;
        if !certificate.validity().is_valid_at(now) {
            return Err(rustls::Error::InvalidCertificate(CertificateError::Expired));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.webpki.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.webpki.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.webpki.supported_verify_schemes()
    }
}

/// Accepts any certificate, but still checks handshake signatures
#[derive(Debug)]
struct AnyCertificate(Arc<CryptoProvider>);

impl ServerCertVerifier for AnyCertificate {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.0.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.0.signature_verification_algorithms.supported_schemes()
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
