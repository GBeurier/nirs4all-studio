//! Access boundary for the loopback control plane and explicitly trusted proxies.

use std::collections::BTreeMap;
use url::Url;

#[derive(Clone, Default)]
pub struct HttpAccessPolicy {
    session_token: Option<String>,
    allowed_origins: Vec<String>,
}

impl HttpAccessPolicy {
    pub(crate) fn from_environment() -> Result<Self, String> {
        let session_token = std::env::var("NIRS4ALL_STUDIO_SESSION_TOKEN").ok();
        if session_token.as_ref().is_some_and(|token| {
            token.len() < 32
                || token.len() > 256
                || !token.bytes().all(|byte| byte.is_ascii_alphanumeric())
        }) {
            return Err(
                "NIRS4ALL_STUDIO_SESSION_TOKEN must contain 32..256 ASCII letters/digits".into(),
            );
        }
        let mut allowed_origins = Vec::new();
        if let Ok(configured) = std::env::var("NIRS4ALL_STUDIO_ALLOWED_ORIGINS") {
            for origin in configured.split(',').map(str::trim) {
                let parsed =
                    parse_origin(origin).ok_or("Invalid NIRS4ALL_STUDIO_ALLOWED_ORIGINS entry")?;
                allowed_origins.push(parsed.origin().ascii_serialization());
            }
        }
        Ok(Self {
            session_token,
            allowed_origins,
        })
    }

    pub(crate) fn validate(
        &self,
        headers: &BTreeMap<String, String>,
        has_body: bool,
    ) -> Result<(), (u16, &'static str)> {
        let host = headers.get("host").ok_or((400, "missing_host"))?;
        let target = parse_origin(&format!("http://{host}")).ok_or((400, "invalid_host"))?;
        let local_host = is_loopback(&target);
        let configured_host = self.allowed_origins.iter().any(|origin| {
            parse_origin(origin).is_some_and(|allowed| {
                parse_origin(&format!("{}://{host}", allowed.scheme())).is_some_and(|authority| {
                    allowed.host_str() == authority.host_str()
                        && allowed.port_or_known_default() == authority.port_or_known_default()
                })
            })
        });
        if !local_host && !configured_host {
            return Err((403, "untrusted_host"));
        }
        let authenticated = self.session_token.as_ref().is_some_and(|expected| {
            headers
                .get("x-nirs4all-session")
                .is_some_and(|provided| token_matches(expected, provided))
        });
        if self.session_token.is_some() && !authenticated {
            return Err((401, "session_token_required"));
        }
        if let Some(origin) = headers.get("origin") {
            // Chromium serializes packaged-file fetch origins as null, but
            // its WebSocket handshake uses file://. Both require the private
            // Electron main-process credential, never ambient local trust.
            if !(matches!(origin.as_str(), "null" | "file://") && authenticated) {
                let origin = parse_origin(origin).ok_or((403, "untrusted_origin"))?;
                let permitted = (local_host && is_loopback(&origin))
                    || self
                        .allowed_origins
                        .contains(&origin.origin().ascii_serialization());
                if !permitted {
                    return Err((403, "untrusted_origin"));
                }
            }
        }
        if has_body {
            let json = headers.get("content-type").is_some_and(|value| {
                value
                    .split(';')
                    .next()
                    .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("application/json"))
            });
            if !json {
                return Err((415, "json_content_type_required"));
            }
        }
        Ok(())
    }
}

fn parse_origin(value: &str) -> Option<Url> {
    let parsed = Url::parse(value).ok()?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || value.chars().any(char::is_whitespace)
    {
        return None;
    }
    Some(parsed)
}

fn is_loopback(origin: &Url) -> bool {
    matches!(origin.host(), Some(url::Host::Domain("localhost")))
        || matches!(origin.host(), Some(url::Host::Ipv4(address)) if address.is_loopback())
        || matches!(origin.host(), Some(url::Host::Ipv6(address)) if address.is_loopback())
}

fn token_matches(expected: &str, provided: &str) -> bool {
    // Fixed-size digests avoid prefix comparison and variable secret lengths.
    use sha2::{Digest, Sha256};
    let expected = Sha256::digest(expected.as_bytes());
    let provided = Sha256::digest(provided.as_bytes());
    expected
        .iter()
        .zip(provided)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::{Arc, Mutex},
    };

    fn exchange(
        request: &str,
        policy: HttpAccessPolicy,
        state: Arc<Mutex<crate::SidecarState>>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            crate::handle_connection_with_access(
                stream,
                &state,
                &crate::WebSocketConnectionManager::new(),
                crate::ServerLimits::default(),
                &policy,
            )
            .unwrap();
        });
        let mut client = TcpStream::connect(address).unwrap();
        client
            .set_read_timeout(Some(std::time::Duration::from_secs(3)))
            .unwrap();
        client.write_all(request.as_bytes()).unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        server.join().unwrap();
        response
    }

    fn headers(host: &str, origin: Option<&str>) -> BTreeMap<String, String> {
        let mut values = BTreeMap::from([
            ("host".into(), host.into()),
            (
                "content-type".into(),
                "application/json; charset=utf-8".into(),
            ),
        ]);
        if let Some(origin) = origin {
            values.insert("origin".into(), origin.into());
        }
        values
    }

    #[test]
    fn local_browser_and_native_clients_remain_usable() {
        let policy = HttpAccessPolicy::default();
        for host in ["127.0.0.1:8000", "localhost", "[::1]:8000"] {
            assert!(policy.validate(&headers(host, None), true).is_ok());
            assert!(policy
                .validate(&headers(host, Some("http://localhost:5173")), true)
                .is_ok());
        }
    }

    #[test]
    fn external_origin_dns_rebinding_and_simple_json_bodies_are_refused() {
        let policy = HttpAccessPolicy::default();
        for origin in [
            "https://untrusted.example",
            "http://localhost.attacker.example",
            "null",
            "file://",
            "file:///",
        ] {
            assert_eq!(
                policy.validate(&headers("127.0.0.1:8000", Some(origin)), true),
                Err((403, "untrusted_origin"))
            );
        }
        assert_eq!(
            policy.validate(&headers("untrusted.example", None), false),
            Err((403, "untrusted_host"))
        );
        let mut request = headers("localhost", None);
        request.insert("content-type".into(), "text/plain".into());
        assert_eq!(
            policy.validate(&request, true),
            Err((415, "json_content_type_required"))
        );
    }

    #[test]
    fn electron_token_is_required_even_without_origin() {
        let policy = HttpAccessPolicy {
            session_token: Some("a".repeat(64)),
            allowed_origins: vec![],
        };
        let mut request = headers("localhost", Some("null"));
        assert_eq!(
            policy.validate(&request, false),
            Err((401, "session_token_required"))
        );
        request.insert("x-nirs4all-session".into(), "a".repeat(64));
        assert!(policy.validate(&request, false).is_ok());
        request.insert("origin".into(), "file://".into());
        assert!(policy.validate(&request, false).is_ok());
        request.insert("x-nirs4all-session".into(), "b".repeat(64));
        assert_eq!(
            policy.validate(&request, false),
            Err((401, "session_token_required"))
        );
    }

    #[test]
    fn configured_proxy_origin_requires_exact_authority() {
        let policy = HttpAccessPolicy {
            session_token: None,
            allowed_origins: vec!["https://studio.example:8443".into()],
        };
        assert!(policy
            .validate(
                &headers("studio.example:8443", Some("https://studio.example:8443")),
                true
            )
            .is_ok());
        assert!(policy
            .validate(
                &headers(
                    "studio.example:8443",
                    Some("https://studio.example.attacker:8443")
                ),
                true
            )
            .is_err());
        assert!(policy
            .validate(&headers("studio.example:9999", None), false)
            .is_err());
        let standard_https = HttpAccessPolicy {
            session_token: None,
            allowed_origins: vec!["https://studio.example".into()],
        };
        for host in ["studio.example", "studio.example:443"] {
            assert!(standard_https
                .validate(&headers(host, Some("https://studio.example")), false)
                .is_ok());
        }
        assert!(standard_https
            .validate(&headers("studio.example:80", None), false)
            .is_err());
    }

    #[test]
    fn live_http_refuses_cross_origin_mutation_and_duplicate_headers() {
        let config = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(
            crate::SidecarState::with_native_jobs_and_app_settings_dir(
                Arc::new(crate::NativeJobRuntime::default()),
                config.path(),
            ),
        ));
        let body = r#"{"pipeline_id":"audit-only"}"#;
        let response = exchange(&format!("POST /api/app/favorites HTTP/1.1\r\nHost: localhost\r\nOrigin: https://untrusted.example\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{body}", body.len()), HttpAccessPolicy::default(), Arc::clone(&state));
        assert!(response.starts_with("HTTP/1.1 403"));
        assert!(!response.contains("Access-Control-Allow-Origin"));
        assert_eq!(std::fs::read_dir(config.path()).unwrap().count(), 0);
        let response = exchange(
            "GET /api/health HTTP/1.1\r\nHost: localhost\r\nhost: untrusted.example\r\n\r\n",
            HttpAccessPolicy::default(),
            state,
        );
        assert!(response.starts_with("HTTP/1.1 400"));
    }

    #[test]
    fn live_token_auth_precedes_body_read_and_supports_cors_preflight() {
        let config = tempfile::tempdir().unwrap();
        let state = Arc::new(Mutex::new(
            crate::SidecarState::with_native_jobs_and_app_settings_dir(
                Arc::new(crate::NativeJobRuntime::default()),
                config.path(),
            ),
        ));
        let token = "a".repeat(64);
        let policy = HttpAccessPolicy {
            session_token: Some(token.clone()),
            allowed_origins: vec![],
        };
        let started = std::time::Instant::now();
        let response = exchange(
            "POST /api/app/favorites HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1000\r\n\r\n",
            policy.clone(),
            Arc::clone(&state),
        );
        assert!(response.starts_with("HTTP/1.1 401"));
        assert!(started.elapsed() < std::time::Duration::from_secs(1));
        for (method, status) in [("GET", 200), ("OPTIONS", 204)] {
            let response = exchange(&format!("{method} /api/health HTTP/1.1\r\nHost: localhost\r\nOrigin: null\r\nX-Nirs4all-Session: {token}\r\n\r\n"), policy.clone(), Arc::clone(&state));
            assert!(response.starts_with(&format!("HTTP/1.1 {status}")));
            assert!(response.contains("Access-Control-Allow-Origin: null\r\n"));
            assert!(!response.contains(&token));
        }
        let response = exchange("GET /ws HTTP/1.1\r\nHost: localhost\r\nOrigin: https://untrusted.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n", HttpAccessPolicy::default(), state);
        assert!(response.starts_with("HTTP/1.1 403"));
    }
}
