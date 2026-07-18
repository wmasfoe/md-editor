use std::{
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::platform_contract::is_main_webview;

const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const TOKEN_ID_SEED_MODULUS: u64 = u32::MAX as u64;

#[derive(Clone)]
pub(crate) struct SaveCommitGate {
    inner: Arc<Mutex<SaveGateState>>,
}

#[derive(Debug)]
struct SaveGateState {
    process_nonce: u64,
    current_epoch: u64,
    current_token_id: u64,
    highest_admitted_sequence: u64,
    highest_committed_sequence: u64,
    poison_recoveries: u64,
    active_critical_jobs: u64,
    max_critical_jobs: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSaveOrderingToken {
    pub(crate) epoch: u64,
    pub(crate) id: u64,
    pub(crate) runtime_sequence: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum NativeSaveDestination {
    CurrentPath { path: String },
    Prompt { suggested_path: Option<String> },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveWarning {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum NativeSaveResult {
    Committed {
        runtime_sequence: u64,
        file_path: String,
        warnings: Vec<SaveWarning>,
    },
    NotCommitted {
        disposition: &'static str,
        runtime_sequence: u64,
        phase: &'static str,
        error_code: Option<String>,
    },
    SupersededBeforeCommit {
        reason: &'static str,
        runtime_sequence: u64,
        current_epoch: u64,
        highest_admitted_runtime_sequence: u64,
    },
    Indeterminate {
        runtime_sequence: u64,
        error_code: String,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum AttachSaveRuntimeResult {
    Attached {
        epoch: u64,
        id: u64,
        sequence_seed: u64,
    },
    Rejected {
        reason: &'static str,
    },
    Indeterminate {
        error_code: String,
    },
}

pub(crate) enum SavePathResolution {
    Selected(PathBuf),
    Cancelled,
    Failed {
        phase: &'static str,
        error_code: String,
    },
}

pub(crate) enum SaveCommitResult {
    Committed {
        file_path: String,
        warnings: Vec<SaveWarning>,
    },
    Failed {
        phase: &'static str,
        error_code: String,
    },
}

impl Default for SaveCommitGate {
    fn default() -> Self {
        Self::new(process_nonce())
    }
}

impl SaveCommitGate {
    fn new(process_nonce: u64) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SaveGateState {
                process_nonce,
                current_epoch: 0,
                current_token_id: 0,
                highest_admitted_sequence: 0,
                highest_committed_sequence: 0,
                poison_recoveries: 0,
                active_critical_jobs: 0,
                max_critical_jobs: 0,
            })),
        }
    }

    pub(crate) fn attach_blocking(&self) -> AttachSaveRuntimeResult {
        let mut state = self.lock_recovering_poison();
        mark_critical_job_started(&mut state);
        let next_token_id = if state.current_token_id == 0 {
            Some(first_token_id(state.process_nonce))
        } else {
            state.current_token_id.checked_add(1)
        };
        let result = match (state.current_epoch.checked_add(1), next_token_id) {
            (Some(epoch), Some(id)) => {
                if epoch > MAX_JS_SAFE_INTEGER || id > MAX_JS_SAFE_INTEGER {
                    mark_critical_job_finished(&mut state);
                    return AttachSaveRuntimeResult::Indeterminate {
                        error_code: "save-runtime-epoch-exhausted".to_string(),
                    };
                }
                state.current_epoch = epoch;
                state.current_token_id = id;
                state.highest_admitted_sequence = 0;
                state.highest_committed_sequence = 0;
                AttachSaveRuntimeResult::Attached {
                    epoch,
                    id,
                    sequence_seed: 0,
                }
            }
            _ => AttachSaveRuntimeResult::Indeterminate {
                error_code: "save-runtime-epoch-exhausted".to_string(),
            },
        };
        mark_critical_job_finished(&mut state);
        result
    }

    pub(crate) fn run_save_job<ResolvePath, Commit>(
        &self,
        ordering_token: NativeSaveOrderingToken,
        markdown_lf: &str,
        resolve_path: ResolvePath,
        commit: Commit,
    ) -> NativeSaveResult
    where
        ResolvePath: FnOnce() -> SavePathResolution,
        Commit: FnOnce(&PathBuf, &[u8]) -> SaveCommitResult,
    {
        let mut state = self.lock_recovering_poison();
        run_save_job_with_state(
            &mut state,
            ordering_token,
            markdown_lf,
            resolve_path,
            commit,
        )
    }

    fn lock_recovering_poison(&self) -> MutexGuard<'_, SaveGateState> {
        match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                let mut state = poisoned.into_inner();
                state.poison_recoveries = state.poison_recoveries.saturating_add(1);
                state.active_critical_jobs = 0;
                self.inner.clear_poison();
                state
            }
        }
    }

    #[cfg(test)]
    fn snapshot(&self) -> SaveGateSnapshot {
        let state = self.lock_recovering_poison();
        SaveGateSnapshot {
            process_nonce: state.process_nonce,
            current_epoch: state.current_epoch,
            current_token_id: state.current_token_id,
            highest_admitted_sequence: state.highest_admitted_sequence,
            highest_committed_sequence: state.highest_committed_sequence,
            poison_recoveries: state.poison_recoveries,
            active_critical_jobs: state.active_critical_jobs,
            max_critical_jobs: state.max_critical_jobs,
        }
    }
}

impl NativeSaveResult {
    pub(crate) fn indeterminate(runtime_sequence: u64, error_code: impl Into<String>) -> Self {
        Self::Indeterminate {
            runtime_sequence,
            error_code: error_code.into(),
        }
    }

    pub(crate) fn rejected_non_main(runtime_sequence: u64) -> Self {
        Self::NotCommitted {
            disposition: "failed",
            runtime_sequence,
            phase: "validation",
            error_code: Some("non-main-webview".to_string()),
        }
    }
}

pub(crate) fn reject_non_main_attach(label: &str) -> Option<AttachSaveRuntimeResult> {
    (!is_main_webview(label)).then_some(AttachSaveRuntimeResult::Rejected {
        reason: "non-main-webview",
    })
}

pub(crate) fn reject_non_main_save(label: &str, runtime_sequence: u64) -> Option<NativeSaveResult> {
    (!is_main_webview(label)).then(|| NativeSaveResult::rejected_non_main(runtime_sequence))
}

fn run_save_job_with_state<ResolvePath, Commit>(
    state: &mut SaveGateState,
    ordering_token: NativeSaveOrderingToken,
    markdown_lf: &str,
    resolve_path: ResolvePath,
    commit: Commit,
) -> NativeSaveResult
where
    ResolvePath: FnOnce() -> SavePathResolution,
    Commit: FnOnce(&PathBuf, &[u8]) -> SaveCommitResult,
{
    if ordering_token.runtime_sequence == 0 {
        return not_committed(
            ordering_token.runtime_sequence,
            "validation",
            "runtime-sequence-zero",
        );
    }
    if ordering_token.runtime_sequence > MAX_JS_SAFE_INTEGER {
        return not_committed(
            ordering_token.runtime_sequence,
            "validation",
            "runtime-sequence-overflow",
        );
    }
    if markdown_lf.contains('\r') {
        return not_committed(
            ordering_token.runtime_sequence,
            "validation",
            "markdown-not-canonical-lf",
        );
    }
    if ordering_token.epoch != state.current_epoch || ordering_token.id != state.current_token_id {
        return NativeSaveResult::SupersededBeforeCommit {
            reason: "retired-epoch",
            runtime_sequence: ordering_token.runtime_sequence,
            current_epoch: state.current_epoch,
            highest_admitted_runtime_sequence: state.highest_admitted_sequence,
        };
    }
    if ordering_token.runtime_sequence <= state.highest_admitted_sequence {
        return NativeSaveResult::SupersededBeforeCommit {
            reason: "non-monotonic-sequence",
            runtime_sequence: ordering_token.runtime_sequence,
            current_epoch: state.current_epoch,
            highest_admitted_runtime_sequence: state.highest_admitted_sequence,
        };
    }

    state.highest_admitted_sequence = ordering_token.runtime_sequence;
    mark_critical_job_started(state);
    let result = (|| {
        let path = match resolve_path() {
            SavePathResolution::Selected(path) => path,
            SavePathResolution::Cancelled => {
                return NativeSaveResult::NotCommitted {
                    disposition: "cancelled",
                    runtime_sequence: ordering_token.runtime_sequence,
                    phase: "dialog",
                    error_code: None,
                };
            }
            SavePathResolution::Failed { phase, error_code } => {
                return not_committed(ordering_token.runtime_sequence, phase, error_code);
            }
        };

        match commit(&path, markdown_lf.as_bytes()) {
            SaveCommitResult::Committed {
                file_path,
                warnings,
            } => {
                state.highest_committed_sequence = ordering_token.runtime_sequence;
                NativeSaveResult::Committed {
                    runtime_sequence: ordering_token.runtime_sequence,
                    file_path,
                    warnings,
                }
            }
            SaveCommitResult::Failed { phase, error_code } => {
                not_committed(ordering_token.runtime_sequence, phase, error_code)
            }
        }
    })();
    mark_critical_job_finished(state);
    result
}

fn not_committed(
    runtime_sequence: u64,
    phase: &'static str,
    error_code: impl Into<String>,
) -> NativeSaveResult {
    NativeSaveResult::NotCommitted {
        disposition: "failed",
        runtime_sequence,
        phase,
        error_code: Some(error_code.into()),
    }
}

fn mark_critical_job_started(state: &mut SaveGateState) {
    state.active_critical_jobs = state.active_critical_jobs.saturating_add(1);
    state.max_critical_jobs = state.max_critical_jobs.max(state.active_critical_jobs);
}

fn mark_critical_job_finished(state: &mut SaveGateState) {
    state.active_critical_jobs = state.active_critical_jobs.saturating_sub(1);
}

fn process_nonce() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(1)
        .max(1)
}

fn first_token_id(process_nonce: u64) -> u64 {
    process_nonce % TOKEN_ID_SEED_MODULUS + 1
}

#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
struct SaveGateSnapshot {
    process_nonce: u64,
    current_epoch: u64,
    current_token_id: u64,
    highest_admitted_sequence: u64,
    highest_committed_sequence: u64,
    poison_recoveries: u64,
    active_critical_jobs: u64,
    max_critical_jobs: u64,
}

#[cfg(test)]
mod tests {
    use std::{
        panic::{catch_unwind, AssertUnwindSafe},
        path::Path,
        sync::{mpsc, Arc, Barrier},
        thread,
        time::Duration,
    };

    use super::*;

    #[test]
    fn attach_retires_the_previous_epoch_and_resets_sequence_watermarks() {
        let gate = SaveCommitGate::new(0);
        assert_eq!(gate.attach_blocking(), attached(1, 1));
        assert!(matches!(
            run_success(&gate, token(1, 1, 1), "/tmp/a.md"),
            NativeSaveResult::Committed { .. }
        ));
        assert_eq!(gate.attach_blocking(), attached(2, 2));

        let retired = run_success(&gate, token(1, 1, 2), "/tmp/old.md");
        assert!(matches!(
            retired,
            NativeSaveResult::SupersededBeforeCommit {
                reason: "retired-epoch",
                ..
            }
        ));
        assert_eq!(gate.snapshot().highest_admitted_sequence, 0);
    }

    #[test]
    fn higher_native_delivery_rejects_a_delayed_lower_sequence_before_side_effects() {
        let gate = SaveCommitGate::new(0);
        let _ = gate.attach_blocking();
        assert!(matches!(
            run_success(&gate, token(1, 1, 3), "/tmp/c.md"),
            NativeSaveResult::Committed { .. }
        ));
        let side_effect = Arc::new(Mutex::new(false));
        let observed = Arc::clone(&side_effect);
        let delayed = gate.run_save_job(
            token(1, 1, 2),
            "B\n",
            || {
                *observed.lock().unwrap() = true;
                SavePathResolution::Selected(PathBuf::from("/tmp/b.md"))
            },
            |path, _| committed(path),
        );

        assert!(matches!(
            delayed,
            NativeSaveResult::SupersededBeforeCommit {
                reason: "non-monotonic-sequence",
                ..
            }
        ));
        assert!(!*side_effect.lock().unwrap());
        assert_eq!(gate.snapshot().highest_committed_sequence, 3);
    }

    #[test]
    fn one_gate_serializes_jobs_and_reattach_behind_an_active_commit() {
        let gate = SaveCommitGate::new(0);
        let _ = gate.attach_blocking();
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let worker_gate = gate.clone();
        let worker_entered = Arc::clone(&entered);
        let worker_release = Arc::clone(&release);
        let worker = thread::spawn(move || {
            worker_gate.run_save_job(
                token(1, 1, 1),
                "B\n",
                || SavePathResolution::Selected(PathBuf::from("/tmp/b.md")),
                |path, _| {
                    worker_entered.wait();
                    worker_release.wait();
                    committed(path)
                },
            )
        });
        entered.wait();

        let attach_gate = gate.clone();
        let (sender, receiver) = mpsc::channel();
        let attach = thread::spawn(move || sender.send(attach_gate.attach_blocking()).unwrap());
        assert!(receiver.recv_timeout(Duration::from_millis(20)).is_err());
        release.wait();
        assert!(matches!(
            worker.join().unwrap(),
            NativeSaveResult::Committed { .. }
        ));
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(1)).unwrap(),
            attached(2, 2)
        );
        attach.join().unwrap();
        assert_eq!(gate.snapshot().max_critical_jobs, 1);
    }

    #[test]
    fn poison_recovery_preserves_gate_identity_and_allows_higher_work() {
        let gate = SaveCommitGate::new(0);
        let _ = gate.attach_blocking();
        let panic = catch_unwind(AssertUnwindSafe(|| {
            gate.run_save_job(
                token(1, 1, 1),
                "panic\n",
                || SavePathResolution::Selected(PathBuf::from("/tmp/panic.md")),
                |_, _| panic!("simulated helper panic"),
            );
        }));
        assert!(panic.is_err());

        let recovered = run_success(&gate, token(1, 1, 2), "/tmp/recovered.md");
        assert!(matches!(recovered, NativeSaveResult::Committed { .. }));
        let snapshot = gate.snapshot();
        assert_eq!(snapshot.process_nonce, 0);
        assert_eq!(snapshot.poison_recoveries, 1);
        assert_eq!(snapshot.highest_committed_sequence, 2);
    }

    #[test]
    fn validation_cancel_failure_and_warning_keep_commit_certainty_explicit() {
        let gate = SaveCommitGate::new(0);
        let _ = gate.attach_blocking();
        let path_resolution_called = Arc::new(Mutex::new(false));
        let observed = Arc::clone(&path_resolution_called);
        let crlf = gate.run_save_job(
            token(1, 1, 1),
            "bad\r\n",
            || {
                *observed.lock().unwrap() = true;
                SavePathResolution::Selected(PathBuf::from("/tmp/crlf.md"))
            },
            |path, _| committed(path),
        );
        assert!(matches!(
            crlf,
            NativeSaveResult::NotCommitted {
                phase: "validation",
                ..
            }
        ));
        assert!(!*path_resolution_called.lock().unwrap());

        let cancelled = gate.run_save_job(
            token(1, 1, 2),
            "cancel\n",
            || SavePathResolution::Cancelled,
            |path, _| committed(path),
        );
        assert!(matches!(
            cancelled,
            NativeSaveResult::NotCommitted {
                disposition: "cancelled",
                phase: "dialog",
                ..
            }
        ));

        let failed = gate.run_save_job(
            token(1, 1, 3),
            "fail\n",
            || SavePathResolution::Selected(PathBuf::from("/tmp/fail.md")),
            |_, _| SaveCommitResult::Failed {
                phase: "rename",
                error_code: "rename-failed".to_string(),
            },
        );
        assert!(matches!(
            failed,
            NativeSaveResult::NotCommitted {
                disposition: "failed",
                phase: "rename",
                ..
            }
        ));

        let warned = gate.run_save_job(
            token(1, 1, 4),
            "warn\n",
            || SavePathResolution::Selected(PathBuf::from("/tmp/warn.md")),
            |path, _| SaveCommitResult::Committed {
                file_path: path.to_string_lossy().into_owned(),
                warnings: vec![SaveWarning {
                    code: "asset-directory-registration-failed",
                    message: "scope failed".to_string(),
                }],
            },
        );
        assert!(matches!(
            warned,
            NativeSaveResult::Committed { warnings, .. } if warnings.len() == 1
        ));
        assert_eq!(gate.snapshot().highest_committed_sequence, 4);
    }

    #[test]
    fn spawn_blocking_runs_the_native_helper_off_the_async_caller_thread() {
        let caller_thread = thread::current().id();
        let helper_thread = tauri::async_runtime::block_on(async {
            tauri::async_runtime::spawn_blocking(|| thread::current().id())
                .await
                .unwrap()
        });

        assert_ne!(helper_thread, caller_thread);
    }

    #[test]
    fn non_main_authorization_rejects_before_touching_the_gate() {
        let gate = SaveCommitGate::new(0);
        let _ = gate.attach_blocking();
        let before = gate.snapshot();

        assert!(matches!(
            reject_non_main_attach("settings"),
            Some(AttachSaveRuntimeResult::Rejected {
                reason: "non-main-webview"
            })
        ));
        assert!(matches!(
            reject_non_main_save("settings", 1),
            Some(NativeSaveResult::NotCommitted {
                error_code: Some(error),
                ..
            }) if error == "non-main-webview"
        ));
        assert!(reject_non_main_save("main", 1).is_none());
        assert_eq!(gate.snapshot(), before);
    }

    #[test]
    fn serde_contract_matches_the_typescript_adapter_payloads() {
        let attach = serde_json::to_value(AttachSaveRuntimeResult::Attached {
            epoch: 2,
            id: 7,
            sequence_seed: 0,
        })
        .unwrap();
        assert_eq!(
            attach,
            serde_json::json!({
                "status": "attached",
                "epoch": 2,
                "id": 7,
                "sequenceSeed": 0
            })
        );

        let committed = serde_json::to_value(NativeSaveResult::Committed {
            runtime_sequence: 4,
            file_path: "/chosen/post.md".to_string(),
            warnings: vec![SaveWarning {
                code: "asset-directory-registration-failed",
                message: "scope failed".to_string(),
            }],
        })
        .unwrap();
        assert_eq!(committed["status"], "committed");
        assert_eq!(committed["runtimeSequence"], 4);
        assert_eq!(committed["filePath"], "/chosen/post.md");

        let destination: NativeSaveDestination = serde_json::from_value(serde_json::json!({
            "kind": "prompt",
            "suggestedPath": "/suggested/post.md"
        }))
        .unwrap();
        assert_eq!(
            destination,
            NativeSaveDestination::Prompt {
                suggested_path: Some("/suggested/post.md".to_string())
            }
        );
    }

    fn run_success(
        gate: &SaveCommitGate,
        ordering_token: NativeSaveOrderingToken,
        path: &str,
    ) -> NativeSaveResult {
        gate.run_save_job(
            ordering_token,
            "markdown\n",
            || SavePathResolution::Selected(PathBuf::from(path)),
            |path, _| committed(path),
        )
    }

    fn committed(path: &Path) -> SaveCommitResult {
        SaveCommitResult::Committed {
            file_path: path.to_string_lossy().into_owned(),
            warnings: vec![],
        }
    }

    fn token(epoch: u64, id: u64, runtime_sequence: u64) -> NativeSaveOrderingToken {
        NativeSaveOrderingToken {
            epoch,
            id,
            runtime_sequence,
        }
    }

    fn attached(epoch: u64, id: u64) -> AttachSaveRuntimeResult {
        AttachSaveRuntimeResult::Attached {
            epoch,
            id,
            sequence_seed: 0,
        }
    }
}
