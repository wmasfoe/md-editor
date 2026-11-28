//! System "open with" requests: decoding, identity and queue ordering.
//!
//! macOS hands the app a list of file URLs through `on_open_urls`; the same
//! callback also fires again when the app is already running. Two separate
//! problems live here, and the audit found both:
//!
//! * Decoding dropped every path after the first markdown one, so opening A and
//!   B together only opened A.
//! * Nothing carried a request identity, so a duplicate wake-up for the same
//!   request was indistinguishable from the user opening the same file twice.
//!   Those two cases need opposite handling: the duplicate must be consumed
//!   once, the deliberate double-open must stay two queue items.
//!
//! This module is deliberately pure: it turns URLs into identified requests and
//! tracks which identities were already consumed. It performs no I/O and knows
//! nothing about windows, so the ordering contract is testable without a GUI.

use std::path::{Path, PathBuf};

/// One file the system asked the app to open.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SystemOpenRequest {
    /// Stable identity for this delivery.
    ///
    /// Composed of the callback's delivery sequence and the index within that
    /// batch. The pairing matters:
    ///
    /// * A duplicate wake-up re-delivers the *same* callback contents, so it
    ///   reproduces the same identity and is consumed once.
    /// * Two independent Finder opens are two separate callbacks, so they get
    ///   different delivery sequences even for the same path, and both stay in
    ///   the queue.
    ///
    /// A per-call index alone cannot express that difference: both deliveries
    /// would start at index 0 and collide.
    pub(crate) identity: String,
    pub(crate) path: PathBuf,
}

/// Hands out monotonically increasing delivery sequences.
///
/// Kept as its own type so the "which delivery is this?" decision is explicit
/// at the call site instead of being an ambient counter hidden in a helper.
#[derive(Debug, Default)]
pub(crate) struct DeliverySequence(u64);

impl DeliverySequence {
    /// The sequence number for the next `on_open_urls` callback.
    pub(crate) fn next(&mut self) -> u64 {
        let sequence = self.0;
        self.0 += 1;
        sequence
    }
}

/// Turns the URLs of one `on_open_urls` callback into requests, in arrival order.
///
/// `delivery` is that callback's [`DeliverySequence`] number; it is what makes
/// two deliberate opens distinct while a repeated wake-up stays identical.
///
/// Unsupported or unreadable entries are reported and skipped, but they never
/// stop the entries after them: the audit's requirement is that a bad item does
/// not block the queue.
pub(crate) fn requests_from_urls(
    delivery: u64,
    urls: impl IntoIterator<Item = String>,
    is_supported: impl Fn(&Path) -> bool,
) -> Vec<SystemOpenRequest> {
    let mut requests: Vec<SystemOpenRequest> = Vec::new();
    for url in urls {
        let Some(path) = decode_file_url(&url) else {
            continue;
        };
        if !is_supported(&path) {
            continue;
        }
        let identity = format!("{delivery}:{}", requests.len());
        requests.push(SystemOpenRequest { identity, path });
    }
    requests
}

/// Decodes one file URL, or `None` when it is not a local file URL.
///
/// Percent-encoded spaces, `#` and CJK must survive: the audit verified those
/// paths, and a naive `str::replace` on the URL text would corrupt them.
fn decode_file_url(url: &str) -> Option<PathBuf> {
    let parsed = url::Url::parse(url).ok()?;
    parsed.to_file_path().ok()
}

/// FIFO queue that consumes each request identity at most once.
#[derive(Debug, Default)]
pub(crate) struct SystemOpenQueue {
    pending: std::collections::VecDeque<SystemOpenRequest>,
    consumed: std::collections::HashSet<String>,
}

impl SystemOpenQueue {
    /// Enqueues requests, dropping any identity that was already consumed.
    ///
    /// Returns the identities that were accepted, which is what the ingress log
    /// reports so a rehearsal can tell "the OS never delivered it" apart from
    /// "the app dropped it".
    pub(crate) fn enqueue(
        &mut self,
        requests: impl IntoIterator<Item = SystemOpenRequest>,
    ) -> Vec<String> {
        let mut accepted = Vec::new();
        for request in requests {
            if self.consumed.contains(&request.identity)
                || self
                    .pending
                    .iter()
                    .any(|queued| queued.identity == request.identity)
            {
                continue;
            }
            accepted.push(request.identity.clone());
            self.pending.push_back(request);
        }
        accepted
    }

    /// The next request, without consuming it.
    ///
    /// The consumer waits on this rather than dequeuing eagerly. Dequeuing first
    /// and then finding the workspace busy loses the item: it is already marked
    /// consumed, so nothing retries it and the file never opens (OPEN-03).
    pub(crate) fn front(&self) -> Option<&SystemOpenRequest> {
        self.pending.front()
    }

    /// Removes and returns the next request, marking its identity consumed.
    pub(crate) fn dequeue(&mut self) -> Option<SystemOpenRequest> {
        let request = self.pending.pop_front()?;
        self.consumed.insert(request.identity.clone());
        Some(request)
    }
}

/// One observation about the system-open path.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum IngressEvent {
    /// macOS called `on_open_urls`. `url_count` is how many supported requests
    /// that delivery produced, so a rehearsal can see a delivery that carried
    /// nothing usable.
    Delivered { delivery: u64, url_count: usize },
    /// The queue handed this request to the workspace.
    Consumed { identity: String, path: PathBuf },
}

impl IngressEvent {
    /// One JSON object per line.
    ///
    /// Hand-rolled instead of `serde_json` so the writer stays allocation-light
    /// and the shape is obvious at a glance in a rehearsal log.
    fn to_json_line(&self) -> String {
        fn escape(text: &str) -> String {
            text.chars()
                .fold(String::with_capacity(text.len()), |mut out, ch| {
                    match ch {
                        '"' => out.push_str("\\\""),
                        '\\' => out.push_str("\\\\"),
                        '\n' => out.push_str("\\n"),
                        other => out.push(other),
                    }
                    out
                })
        }
        match self {
            Self::Delivered {
                delivery,
                url_count,
            } => format!(
                "{{\"event\":\"delivered\",\"delivery\":{delivery},\"urlCount\":{url_count}}}"
            ),
            Self::Consumed { identity, path } => format!(
                "{{\"event\":\"consumed\",\"identity\":\"{}\",\"path\":\"{}\"}}",
                escape(identity),
                escape(&path.display().to_string())
            ),
        }
    }
}

/// Appends ingress events to a file when one is configured.
///
/// Disabled unless `INKPOINT_OPEN_INGRESS_LOG` names a path, so normal runs pay
/// nothing. The rehearsal and E2E runs enable it because the test spec requires
/// ingress and consumption order as evidence: without both records you cannot
/// tell "the OS never delivered the file" from "the app dropped it".
#[derive(Clone, Debug, Default)]
pub(crate) struct IngressLog {
    path: Option<PathBuf>,
}

/// Environment variable naming the ingress log file.
pub(crate) const INGRESS_LOG_ENV: &str = "INKPOINT_OPEN_INGRESS_LOG";

impl IngressLog {
    pub(crate) fn from_env() -> Self {
        Self {
            path: std::env::var_os(INGRESS_LOG_ENV)
                .map(PathBuf::from)
                .filter(|path| path.is_absolute()),
        }
    }

    /// Writes one line. Failures are reported and swallowed: losing a diagnostic
    /// line must never break opening a document.
    pub(crate) fn record(&self, event: IngressEvent) {
        let Some(path) = self.path.as_ref() else {
            return;
        };
        use std::io::Write as _;
        let line = format!("{}\n", event.to_json_line());
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(line.as_bytes()) {
                    eprintln!("Could not append to the open-ingress log: {error}");
                }
            }
            Err(error) => {
                eprintln!("Could not open the open-ingress log: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn markdown(path: &Path) -> bool {
        crate::document::is_markdown(path)
    }

    /// OPEN-01: one callback carrying A and B must produce both requests in
    /// arrival order.
    ///
    /// The audit repro passed A and B to the URL callback and only A opened,
    /// because the handler used `find` and kept a single path.
    #[test]
    fn open01_every_supported_url_in_one_callback_becomes_a_request() {
        let requests = requests_from_urls(
            0,
            vec!["file:///tmp/a.md".to_owned(), "file:///tmp/b.md".to_owned()],
            markdown,
        );
        assert_eq!(
            requests.iter().map(|r| r.path.clone()).collect::<Vec<_>>(),
            vec![PathBuf::from("/tmp/a.md"), PathBuf::from("/tmp/b.md")],
            "both URLs must become requests, in arrival order"
        );
    }

    /// OPEN-01: an unsupported or malformed entry is skipped without blocking
    /// the valid entries after it.
    #[test]
    fn open01_invalid_entries_do_not_block_later_valid_ones() {
        let requests = requests_from_urls(
            0,
            vec![
                "file:///tmp/notes.txt".to_owned(),
                "not a url".to_owned(),
                "https://example.com/remote.md".to_owned(),
                "file:///tmp/valid.md".to_owned(),
            ],
            markdown,
        );
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].path, PathBuf::from("/tmp/valid.md"));
    }

    /// OPEN-04: percent-encoded spaces, `#` and CJK survive decoding.
    #[test]
    fn open04_decodes_spaces_hash_and_cjk_paths() {
        let requests = requests_from_urls(
            0,
            vec!["file:///tmp/%E4%B8%AD%E6%96%87%20%E7%A9%BA%E6%A0%BC%23%E4%BA%95.md".to_owned()],
            markdown,
        );
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].path, PathBuf::from("/tmp/中文 空格#井.md"));
    }

    /// OPEN-02: two independent opens of the same path are two queue items.
    #[test]
    fn open02_two_independent_opens_of_one_path_stay_two_items() {
        let mut queue = SystemOpenQueue::default();
        let mut deliveries = DeliverySequence::default();
        // First deliberate open: its own callback.
        let first = requests_from_urls(
            deliveries.next(),
            vec!["file:///tmp/a.md".to_owned()],
            markdown,
        );
        queue.enqueue(first);
        // Second deliberate open of the same path: a separate callback, so a
        // separate delivery sequence.
        let second = requests_from_urls(
            deliveries.next(),
            vec!["file:///tmp/a.md".to_owned()],
            markdown,
        );
        queue.enqueue(second);

        // Two deliberate opens are two queue items, so two dequeues succeed.
        assert_eq!(
            queue.dequeue().map(|request| request.path),
            Some(PathBuf::from("/tmp/a.md")),
            "the first deliberate open is one item"
        );
        assert_eq!(
            queue.dequeue().map(|request| request.path),
            Some(PathBuf::from("/tmp/a.md")),
            "the second deliberate open is its own item"
        );
        assert!(queue.dequeue().is_none());
    }

    /// OPEN-02: a duplicate wake-up carrying the same request identity is
    /// consumed once, not twice.
    #[test]
    fn open02_duplicate_wakeup_for_one_identity_is_consumed_once() {
        let mut queue = SystemOpenQueue::default();
        let request = requests_from_urls(0, vec!["file:///tmp/a.md".to_owned()], markdown)
            .into_iter()
            .next()
            .expect("one request");
        let identity = request.identity.clone();
        queue.enqueue([request]);
        // The same delivery arrives again, same identity.
        let duplicate = SystemOpenRequest {
            identity,
            path: PathBuf::from("/tmp/a.md"),
        };
        let accepted = queue.enqueue([duplicate]);
        assert!(
            accepted.is_empty(),
            "a repeated identity must not be enqueued again"
        );
        assert!(queue.dequeue().is_some());
        assert!(queue.dequeue().is_none(), "the identity is consumed once");
    }

    /// OPEN-03: looking at the next request must not consume it.
    ///
    /// The consumer waits for the workspace to be ready before dequeuing. If the
    /// wait path consumed the item, a busy workspace would lose the file: the
    /// identity is spent and nothing retries it.
    #[test]
    fn open03_peeking_does_not_consume_the_request() {
        let mut queue = SystemOpenQueue::default();
        let request = requests_from_urls(0, vec!["file:///tmp/a.md".to_owned()], markdown)
            .into_iter()
            .next()
            .expect("one request");
        queue.enqueue([request.clone()]);

        // Repeated peeks, as a consumer waiting for readiness would do.
        for _ in 0..3 {
            assert_eq!(
                queue.front().map(|queued| queued.identity.clone()),
                Some(request.identity.clone())
            );
        }
        // The item is still deliverable afterwards.
        assert_eq!(
            queue.dequeue().map(|queued| queued.path),
            Some(request.path)
        );
    }

    /// OPEN-03: a consumed identity stays consumed, so a wake-up that arrives
    /// after the attempt is not silently retried.
    #[test]
    fn open03_consumed_identity_is_not_retried() {
        let mut queue = SystemOpenQueue::default();
        let request = requests_from_urls(0, vec!["file:///tmp/a.md".to_owned()], markdown)
            .into_iter()
            .next()
            .expect("one request");
        let identity = request.identity.clone();
        queue.enqueue([request]);
        assert!(queue.dequeue().is_some());

        let retry = SystemOpenRequest {
            identity,
            path: PathBuf::from("/tmp/a.md"),
        };
        assert!(queue.enqueue([retry]).is_empty());
        assert!(
            queue.dequeue().is_none(),
            "a consumed identity must not be delivered a second time"
        );
    }

    /// The ingress log must record delivery and consumption as separate events.
    ///
    /// The test spec needs both to tell "the OS never delivered it" apart from
    /// "the app dropped it", so a single merged line would not be evidence.
    #[test]
    fn ingress_log_records_delivery_and_consumption_separately() {
        let dir = tempfile::tempdir().unwrap();
        let log_path = dir.path().join("ingress.jsonl");
        let log = IngressLog {
            path: Some(log_path.clone()),
        };

        log.record(IngressEvent::Delivered {
            delivery: 3,
            url_count: 2,
        });
        log.record(IngressEvent::Consumed {
            identity: "3:0".to_owned(),
            path: PathBuf::from("/tmp/中文 空格#井.md"),
        });

        let contents = std::fs::read_to_string(&log_path).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        assert_eq!(lines.len(), 2, "one event per line: {contents:?}");
        assert!(lines[0].contains("\"event\":\"delivered\""));
        assert!(lines[0].contains("\"urlCount\":2"));
        assert!(lines[1].contains("\"event\":\"consumed\""));
        assert!(lines[1].contains("3:0"));
        assert!(
            lines[1].contains("中文 空格#井.md"),
            "the decoded path is recorded verbatim: {}",
            lines[1]
        );
    }

    /// A log with no configured path must not create a file or panic.
    #[test]
    fn ingress_log_without_a_path_is_a_no_op() {
        let log = IngressLog { path: None };
        log.record(IngressEvent::Delivered {
            delivery: 0,
            url_count: 1,
        });
    }
}
