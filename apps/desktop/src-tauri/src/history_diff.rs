use serde::Serialize;
use similar::{Algorithm, ChangeTag, TextDiff};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiffRange {
    kind: String,
    current_len: usize,
    snapshot_len: usize,
}

#[tauri::command]
pub async fn diff_history_lines(
    current_text: String,
    snapshot_text: String,
) -> Result<Vec<DiffRange>, String> {
    tauri::async_runtime::spawn_blocking(move || diff_ranges(&current_text, &snapshot_text))
        .await
        .map_err(|error| format!("History diff task failed: {error}"))
}

fn diff_ranges(current_text: &str, snapshot_text: &str) -> Vec<DiffRange> {
    let current = lines(current_text);
    let snapshot = lines(snapshot_text);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Patience)
        .diff_slices(&current, &snapshot);
    let mut ranges: Vec<DiffRange> = Vec::new();
    for change in diff.iter_all_changes() {
        let kind = match change.tag() {
            ChangeTag::Equal => "unchanged",
            ChangeTag::Delete => "removed",
            ChangeTag::Insert => "added",
        };
        if let Some(last) = ranges.last_mut().filter(|range| range.kind == kind) {
            match kind {
                "unchanged" => {
                    last.current_len += 1;
                    last.snapshot_len += 1;
                }
                "removed" => last.current_len += 1,
                _ => last.snapshot_len += 1,
            }
        } else {
            ranges.push(DiffRange {
                kind: kind.to_string(),
                current_len: usize::from(kind != "added"),
                snapshot_len: usize::from(kind != "removed"),
            });
        }
    }
    ranges
}

fn lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_compact_ranges_for_insertions_and_deletions() {
        assert_eq!(
            diff_ranges("a\nwork\nz", "a\nrestored\nz"),
            vec![
                DiffRange {
                    kind: "unchanged".into(),
                    current_len: 1,
                    snapshot_len: 1
                },
                DiffRange {
                    kind: "removed".into(),
                    current_len: 1,
                    snapshot_len: 0
                },
                DiffRange {
                    kind: "added".into(),
                    current_len: 0,
                    snapshot_len: 1
                },
                DiffRange {
                    kind: "unchanged".into(),
                    current_len: 1,
                    snapshot_len: 1
                },
            ]
        );
    }

    #[test]
    fn empty_and_crlf_inputs_match_line_semantics() {
        assert!(diff_ranges("", "").is_empty());
        assert_eq!(diff_ranges("a\r\nb", "a\nb").len(), 1);
    }

    #[test]
    #[ignore = "manual same-fixture performance probe"]
    fn compare_legacy_and_similar_on_large_sparse_edit() {
        use std::time::Instant;

        let current = (0..4_000).map(|i| format!("line-{i}")).collect::<Vec<_>>();
        let snapshot = (0..4_000)
            .map(|i| {
                if i % 100 == 0 {
                    format!("edited-{i}")
                } else {
                    format!("line-{i}")
                }
            })
            .collect::<Vec<_>>();
        let start = Instant::now();
        let _ = diff_ranges(&current.join("\n"), &snapshot.join("\n"));
        let myers = start.elapsed();

        let start = Instant::now();
        let mut dp = vec![vec![0usize; snapshot.len() + 1]; current.len() + 1];
        for i in 1..=current.len() {
            for j in 1..=snapshot.len() {
                dp[i][j] = if current[i - 1] == snapshot[j - 1] {
                    dp[i - 1][j - 1] + 1
                } else {
                    dp[i - 1][j].max(dp[i][j - 1])
                };
            }
        }
        let legacy = start.elapsed();
        println!("same fixture 4000 lines/40 edits: similar={myers:?}, legacy LCS={legacy:?}");
    }
}
