//! 마켓 네이티브 받기(서버 없는 앱 기기 볼트, 서버가 실패했을 때 대신 받기). 규칙은 서버 server/src/marketFetch.ts 와 같다:
//! https 만(http 는 이 기기 설정으로만)·사설 주소 거부(접속에 쓰는 이름 풀이로)·리다이렉트마다 다시·프록시 없음·identity 만·
//! 크기는 받는 동안 센다·시간은 요청 전체에. 주소 판정 표와 시험 벡터는 서버와 같은 것을 쓴다
//! (server/test/fixtures/address-vectors.json, 표는 docs/guides/development.md 「마켓 받기와 나가는 요청」).
//!
//! JS 의 tauri-plugin-http(fetch)로 받지 않는 이유: 화면 쪽에서는 실제 접속 주소를 볼 수 없어 사설 IP 판정을 할 수 없다.
//! 앱 자체 명령이라 capabilities 없이 모든 창에서 불린다(Tauri 2 기본, build.rs 에 앱 매니페스트 없음).

use std::error::Error as StdError;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::header::{ACCEPT_ENCODING, CONTENT_ENCODING, CONTENT_LENGTH, LOCATION};
use reqwest::redirect::Policy;
use reqwest::Url;

const MAX_REDIRECTS: u32 = 5;
/// 요청 하나(리다이렉트 포함) 전체 상한 — core MARKET_LIMITS.requestMs
const REQUEST_MS: u64 = 30_000;
/// 패키지 하나 상한 — 화면이 넘기는 max_bytes 를 이 위로 받지 않는다(core MARKET_LIMITS.packageBytes)
const PACKAGE_BYTES: u64 = 16 * 1024 * 1024;

fn private_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..128).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..32).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || a >= 224
}

fn embedded_v4(x: &[u8]) -> Ipv4Addr {
    Ipv4Addr::new(x[0], x[1], x[2], x[3])
}

fn private_v6(ip: Ipv6Addr) -> bool {
    let x = ip.octets();
    let zero = |from: usize, to: usize| x[from..to].iter().all(|v| *v == 0);
    // ::/96 — ::, ::1, 옛 IPv4 호환. 받을 일이 없어 품은 IPv4 와 상관없이 막는다
    if zero(0, 12) {
        return true;
    }
    if x[0] & 0xfe == 0xfc
        || (x[0] == 0xfe && x[1] & 0xc0 == 0x80)
        || (x[0] == 0xfe && x[1] & 0xc0 == 0xc0)
        || x[0] == 0xff
    {
        return true;
    }
    if x[..6] == [0, 0x64, 0xff, 0x9b, 0, 1] {
        return true; // 64:ff9b:1::/48 지역용 NAT64
    }
    if x[..4] == [0x20, 0x01, 0, 0]
        || x[..4] == [0x20, 0x01, 0x0d, 0xb8]
        || x[..6] == [0x20, 0x01, 0, 2, 0, 0]
        || (x[0] == 1 && x[1] == 0 && zero(2, 8))
    {
        return true; // Teredo·문서용·벤치마크·버림
    }
    if zero(0, 10) && x[10] == 0xff && x[11] == 0xff {
        return private_v4(embedded_v4(&x[12..])); // ::ffff:0:0/96 사상
    }
    if zero(0, 8) && x[8] == 0xff && x[9] == 0xff && zero(10, 12) {
        return private_v4(embedded_v4(&x[12..])); // ::ffff:0:0:0/96 SIIT
    }
    if x[..4] == [0, 0x64, 0xff, 0x9b] && zero(4, 12) {
        return private_v4(embedded_v4(&x[12..])); // 64:ff9b::/96 NAT64
    }
    if x[0] == 0x20 && x[1] == 0x02 {
        return private_v4(embedded_v4(&x[2..6])); // 2002::/16 6to4
    }
    false
}

/// 사설·특수 주소인가(주소 판정 표)
pub fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => private_v4(v),
        IpAddr::V6(v) => private_v6(v),
    }
}

#[cfg_attr(not(test), allow(dead_code))] // 시험이 서버와 같은 글자 벡터로 대조한다
/// 글자로: `[`·`]`·zone id 를 벗기고 파싱. 파싱하지 못하면 막는다(fail-closed — std 는 IPv4 의 앞자리 0 도 거부한다)
pub fn is_private_str(s: &str) -> bool {
    let mut t = s.trim();
    if t.starts_with('[') && t.ends_with(']') {
        t = &t[1..t.len() - 1];
    }
    if let Some(i) = t.find('%') {
        t = &t[..i];
    }
    t.parse::<IpAddr>().map(is_private_ip).unwrap_or(true)
}

/// 첫 주소와 리다이렉트 주소마다: 프로토콜·사용자 정보·IP 글자 사설 주소(IP 글자는 resolver 를 타지 않는다)
pub fn check_url(url: &Url, allow_http: bool, allow_private: bool) -> Result<(), &'static str> {
    match url.scheme() {
        "https" => {}
        "http" if allow_http => {}
        _ => return Err("market_url_protocol"),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("market_url_credentials");
    }
    // IPv6 글자의 host_str 은 대괄호를 품는다("[::1]") — 벗겨 파싱한다. 10진·16진 IPv4 꼴은 URL 파서가 이미 점 꼴로 바꿨다
    let host = url.host_str().ok_or("market_url_invalid")?;
    let host = host
        .strip_prefix('[')
        .and_then(|h| h.strip_suffix(']'))
        .unwrap_or(host);
    if let Ok(ip) = host.parse::<IpAddr>() {
        if !allow_private && is_private_ip(ip) {
            return Err("market_private_address");
        }
    }
    Ok(())
}

/// 지킴 둘째 줄: 실제로 붙은 주소(첫 줄은 resolver)
pub fn check_remote(addr: Option<SocketAddr>, allow_private: bool) -> Result<(), &'static str> {
    match addr {
        Some(a) if !allow_private && is_private_ip(a.ip()) => Err("market_private_address"),
        _ => Ok(()),
    }
}

/// reqwest 는 이 결과로만 접속한다 — 판정한 풀이가 곧 접속 주소다(DNS 재바인딩을 막는 자리)
#[derive(Clone)]
pub struct GuardResolver {
    pub allow_private: bool,
    /// 막았는지 — reqwest 오류에서 원인을 다시 찾는 대신 이 표시로 market_private_address 를 고른다
    pub blocked: Arc<AtomicBool>,
}

impl GuardResolver {
    pub async fn lookup(
        &self,
        host: &str,
    ) -> Result<Vec<SocketAddr>, Box<dyn StdError + Send + Sync>> {
        let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, 0)).await?.collect();
        if addrs.is_empty() {
            return Err("no address".into());
        }
        if !self.allow_private && addrs.iter().any(|a| is_private_ip(a.ip())) {
            self.blocked.store(true, Ordering::SeqCst);
            return Err("market_private_address".into());
        }
        Ok(addrs)
    }
}

impl Resolve for GuardResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let me = self.clone();
        Box::pin(async move {
            let addrs = me.lookup(name.as_str()).await?;
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

fn request_error(e: &reqwest::Error, blocked: &AtomicBool) -> String {
    if blocked.load(Ordering::SeqCst) {
        "market_private_address".into()
    } else if e.is_timeout() {
        "market_timeout".into()
    } else {
        "market_fetch_failed:network".into()
    }
}

/// 실패는 "market_…" 코드(이유가 있으면 "market_fetch_failed:<이유>"). 시험이 시간 상한을 줄 수 있게 안쪽 함수로 둔다
pub(crate) async fn fetch_inner(
    input: &str,
    max_bytes: u64,
    expect_size: Option<u64>,
    allow_http: bool,
    allow_private: bool,
    deadline: Duration,
) -> Result<Vec<u8>, String> {
    let start = Instant::now();
    let blocked = Arc::new(AtomicBool::new(false));
    let client = reqwest::Client::builder()
        // 시스템·환경 변수 프록시를 쓰지 않는다 — 프록시가 이름을 풀면 판정이 무의미하다
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .dns_resolver(Arc::new(GuardResolver {
            allow_private,
            blocked: blocked.clone(),
        }))
        .build()
        .map_err(|_| "market_fetch_failed:client".to_string())?;
    let mut url = Url::parse(input).map_err(|_| "market_url_invalid".to_string())?;
    let mut redirects = 0;
    loop {
        check_url(&url, allow_http, allow_private)?;
        let left = deadline
            .checked_sub(start.elapsed())
            .ok_or("market_timeout")?;
        let mut resp = client
            .get(url.clone())
            .header(ACCEPT_ENCODING, "identity")
            // 홉마다 남은 시간만 — 전체에 하나의 기한
            .timeout(left)
            .send()
            .await
            .map_err(|e| request_error(&e, &blocked))?;
        check_remote(resp.remote_addr(), allow_private)?;
        let status = resp.status();
        if status.is_redirection() {
            let loc = resp
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or(format!("market_fetch_failed:http_{}", status.as_u16()))?
                .to_string();
            if redirects >= MAX_REDIRECTS {
                return Err("market_too_many_redirects".into());
            }
            redirects += 1;
            url = url
                .join(&loc)
                .map_err(|_| "market_url_invalid".to_string())?;
            continue;
        }
        if status.as_u16() != 200 {
            return Err(format!("market_fetch_failed:http_{}", status.as_u16()));
        }
        if let Some(enc) = resp.headers().get(CONTENT_ENCODING) {
            if !enc
                .to_str()
                .map(|s| s.trim().eq_ignore_ascii_case("identity"))
                .unwrap_or(false)
            {
                return Err("market_fetch_failed:content-encoding".into());
            }
        }
        let declared = resp
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        if let Some(n) = declared {
            if n > max_bytes {
                return Err("market_too_large".into());
            }
            if expect_size.is_some_and(|e| e != n) {
                return Err("market_size_mismatch".into());
            }
        }
        let limit = expect_size.map_or(max_bytes, |e| e.min(max_bytes));
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| request_error(&e, &blocked))?
        {
            if (body.len() + chunk.len()) as u64 > limit {
                return Err(if (body.len() + chunk.len()) as u64 > max_bytes {
                    "market_too_large"
                } else {
                    "market_size_mismatch"
                }
                .into());
            }
            body.extend_from_slice(&chunk);
        }
        if expect_size.is_some_and(|e| e != body.len() as u64) {
            return Err("market_size_mismatch".into());
        }
        return Ok(body);
    }
}

/// JS: `invoke("market_fetch", { url, maxBytes, expectSize, allowHttp, allowPrivate, timeoutMs })` → ArrayBuffer.
/// allowHttp·allowPrivate 는 그 기기 설정(동기화되지 않음)에서 화면이 읽어 넘긴다
#[tauri::command]
pub async fn market_fetch(
    url: String,
    max_bytes: u64,
    expect_size: Option<u64>,
    allow_http: bool,
    allow_private: bool,
    timeout_ms: Option<u64>,
) -> Result<tauri::ipc::Response, String> {
    let deadline = Duration::from_millis(timeout_ms.unwrap_or(REQUEST_MS).min(REQUEST_MS));
    fetch_inner(
        &url,
        max_bytes.min(PACKAGE_BYTES),
        expect_size,
        allow_http,
        allow_private,
        deadline,
    )
    .await
    .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{IpAddr, TcpListener};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    #[derive(serde::Deserialize)]
    struct Vectors {
        blocked: Vec<String>,
        allowed: Vec<String>,
    }

    /// server/test/netGuard.test.ts 와 같은 파일(한쪽만 고치지 않게)
    fn vectors() -> Vectors {
        serde_json::from_str(include_str!(
            "../../../server/test/fixtures/address-vectors.json"
        ))
        .unwrap()
    }

    #[test]
    fn address_table_matches_server_vectors() {
        let v = vectors();
        for s in &v.blocked {
            assert!(is_private_str(s), "blocked: {s:?}");
        }
        for s in &v.allowed {
            assert!(!is_private_str(s), "allowed: {s:?}");
        }
        assert!(is_private_ip("127.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(!is_private_ip("1.1.1.1".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn check_url_rules() {
        let u = |s: &str| reqwest::Url::parse(s).unwrap();
        assert_eq!(
            check_url(&u("http://example.com/"), false, false),
            Err("market_url_protocol")
        );
        assert_eq!(check_url(&u("http://example.com/"), true, false), Ok(()));
        assert_eq!(
            check_url(&u("ftp://example.com/"), true, true),
            Err("market_url_protocol")
        );
        assert_eq!(
            check_url(&u("https://u:p@example.com/"), false, false),
            Err("market_url_credentials")
        );
        for s in [
            "https://127.0.0.1/",
            "https://[::1]/",
            "http://[::ffff:7f00:1]/",
            "http://2130706433/",
            "https://0x7f.1/",
            "https://[fe80::1]/",
        ] {
            assert_eq!(
                check_url(&u(s), true, false),
                Err("market_private_address"),
                "{s}"
            );
            assert_eq!(check_url(&u(s), true, true), Ok(()), "{s}");
        }
        assert_eq!(check_url(&u("https://example.com/"), false, false), Ok(()));
        assert_eq!(
            check_remote(Some("127.0.0.1:80".parse().unwrap()), false),
            Err("market_private_address")
        );
        assert_eq!(
            check_remote(Some("127.0.0.1:80".parse().unwrap()), true),
            Ok(())
        );
        assert_eq!(
            check_remote(Some("1.1.1.1:443".parse().unwrap()), false),
            Ok(())
        );
    }

    /// 접속 수를 세는 작은 HTTP 응답기
    fn responder() -> (u16, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                c.fetch_add(1, Ordering::SeqCst);
                std::thread::spawn(move || {
                    let mut line = String::new();
                    let mut reader = BufReader::new(stream.try_clone().unwrap());
                    if reader.read_line(&mut line).is_err() {
                        return;
                    }
                    loop {
                        let mut h = String::new();
                        if reader.read_line(&mut h).is_err() || h == "\r\n" || h.is_empty() {
                            break;
                        }
                    }
                    let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let head = |status: &str, extra: &str, body: &[u8]| {
                        format!("HTTP/1.1 {status}\r\ncontent-length: {}\r\nconnection: close\r\n{extra}\r\n", body.len()).into_bytes()
                    };
                    let mut out: Vec<u8>;
                    if path == "/ok" {
                        out = head("200 OK", "", b"hello");
                        out.extend_from_slice(b"hello");
                    } else if path == "/big" {
                        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nconnection: close\r\n\r\n");
                        let chunk = vec![1u8; 16 * 1024];
                        for _ in 0..64 {
                            if stream.write_all(&chunk).is_err() {
                                return;
                            }
                        }
                        return;
                    } else if path == "/gz" {
                        out = head("200 OK", "content-encoding: gzip\r\n", b"raw");
                        out.extend_from_slice(b"raw");
                    } else if let Some(n) = path.strip_prefix("/r/") {
                        let n: u32 = n.parse().unwrap();
                        if n < 6 {
                            out = head("302 Found", &format!("location: /r/{}\r\n", n + 1), b"");
                        } else {
                            out = head("200 OK", "", b"done");
                            out.extend_from_slice(b"done");
                        }
                    } else if let Some(n) = path.strip_prefix("/slow/") {
                        std::thread::sleep(Duration::from_millis(150));
                        let n: u32 = n.parse().unwrap();
                        if n < 3 {
                            out = head("302 Found", &format!("location: /slow/{}\r\n", n + 1), b"");
                        } else {
                            out = head("200 OK", "", b"done");
                            out.extend_from_slice(b"done");
                        }
                    } else {
                        out = head("404 Not Found", "", b"");
                    }
                    let _ = stream.write_all(&out);
                });
            }
        });
        (port, count)
    }

    fn run<T>(f: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(f)
    }

    const T: Duration = Duration::from_secs(5);

    #[test]
    fn fetch_ip_literal_rules() {
        let (port, count) = responder();
        let url = format!("http://127.0.0.1:{port}");
        assert_eq!(
            run(fetch_inner(&format!("{url}/ok"), 1000, None, true, true, T)).unwrap(),
            b"hello"
        );
        assert_eq!(
            run(fetch_inner(
                &format!("{url}/ok"),
                1000,
                Some(4),
                true,
                true,
                T
            )),
            Err("market_size_mismatch".into())
        );
        assert_eq!(
            run(fetch_inner(
                &format!("{url}/big"),
                100_000,
                None,
                true,
                true,
                T
            )),
            Err("market_too_large".into())
        );
        assert_eq!(
            run(fetch_inner(
                &format!("{url}/r/0"),
                1000,
                None,
                true,
                true,
                T
            )),
            Err("market_too_many_redirects".into())
        );
        assert_eq!(
            run(fetch_inner(
                &format!("{url}/r/1"),
                1000,
                None,
                true,
                true,
                T
            ))
            .unwrap(),
            b"done"
        );
        assert_eq!(
            run(fetch_inner(&format!("{url}/gz"), 1000, None, true, true, T)),
            Err("market_fetch_failed:content-encoding".into())
        );
        let before = count.load(Ordering::SeqCst);
        assert_eq!(
            run(fetch_inner(
                &format!("{url}/ok"),
                1000,
                None,
                true,
                false,
                T
            )),
            Err("market_private_address".into())
        );
        assert_eq!(
            run(fetch_inner(
                &format!("{url}/ok"),
                1000,
                None,
                false,
                true,
                T
            )),
            Err("market_url_protocol".into())
        );
        assert_eq!(count.load(Ordering::SeqCst), before);
    }

    #[test]
    fn resolver_blocks_private_names_before_connecting() {
        let (port, count) = responder();
        let url = format!("http://localhost:{port}/ok");
        // 이름이라 check_url 은 지나고, GuardResolver 가 막는다 — 접속 0
        assert_eq!(
            run(fetch_inner(&url, 1000, None, true, false, T)),
            Err("market_private_address".into())
        );
        assert_eq!(count.load(Ordering::SeqCst), 0);
        // 허용하면 resolver 가 준 주소로 접속한다
        assert_eq!(
            run(fetch_inner(&url, 1000, None, true, true, T)).unwrap(),
            b"hello"
        );
        assert!(count.load(Ordering::SeqCst) >= 1);
        // resolver 를 직접
        let blocked = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let r = GuardResolver {
            allow_private: false,
            blocked: blocked.clone(),
        };
        assert!(run(r.lookup("localhost")).is_err());
        assert!(blocked.load(Ordering::SeqCst));
    }

    #[test]
    fn deadline_covers_all_redirects() {
        let (port, _) = responder();
        let url = format!("http://127.0.0.1:{port}/slow/1");
        assert_eq!(
            run(fetch_inner(
                &url,
                1000,
                None,
                true,
                true,
                Duration::from_millis(300)
            )),
            Err("market_timeout".into())
        );
        assert_eq!(
            run(fetch_inner(
                &url,
                1000,
                None,
                true,
                true,
                Duration::from_secs(5)
            ))
            .unwrap(),
            b"done"
        );
    }
}
