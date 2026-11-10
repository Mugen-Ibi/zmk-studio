use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager, State};
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Debug, Serialize, Deserialize)]
pub struct AvailableDevice {
    pub label: String,
    pub id: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct TransportError {
    pub code: &'static str,
    pub message: String,
}
impl TransportError {
    pub fn new(code: &'static str, message: impl ToString) -> Self {
        Self {
            code,
            message: message.to_string(),
        }
    }
}
pub type Result<T> = std::result::Result<T, TransportError>;
pub struct WriteRequest {
    pub data: Vec<u8>,
    pub reply: oneshot::Sender<Result<()>>,
}
pub struct Session {
    pub id: String,
    pub sender: mpsc::Sender<WriteRequest>,
    pub stop: oneshot::Sender<()>,
    pub task: tauri::async_runtime::JoinHandle<()>,
}
#[derive(Default)]
pub struct ActiveConnection {
    pub lifecycle: Mutex<()>,
    pub conn: Mutex<Option<Session>>,
}
impl ActiveConnection {
    pub async fn remove_if_owner(&self, id: &str) {
        let mut guard = self.conn.lock().await;
        if guard.as_ref().is_some_and(|s| s.id == id) {
            guard.take();
        }
    }
    // Caller owns lifecycle; no worker needs it to finish.
    pub async fn retire(&self, id: Option<&str>) {
        let old = {
            let mut guard = self.conn.lock().await;
            if id.is_some_and(|id| guard.as_ref().is_none_or(|s| s.id != id)) {
                return;
            }
            guard.take()
        };
        if let Some(old) = old {
            let _ = old.stop.send(());
            let _ = old.task.await;
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataEvent<'a> {
    pub session_id: &'a str,
    pub data: &'a [u8],
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloseEvent<'a> {
    session_id: &'a str,
    error: Option<String>,
}

pub async fn finished(app: &AppHandle, id: &str, result: Result<()>) {
    let state = app.state::<ActiveConnection>();
    state.remove_if_owner(id).await;
    let _ = app.emit(
        "connection_disconnected",
        CloseEvent {
            session_id: id,
            error: result.err().map(|e| e.message),
        },
    );
}

#[command]
pub async fn transport_send_data(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, ActiveConnection>,
) -> Result<()> {
    send_data(&state, &session_id, data).await
}

pub async fn send_data(state: &ActiveConnection, session_id: &str, data: Vec<u8>) -> Result<()> {
    let sender = {
        let guard = state.conn.lock().await;
        guard
            .as_ref()
            .filter(|s| s.id == session_id)
            .ok_or_else(|| {
                TransportError::new("disconnected", "This connection is no longer active")
            })?
            .sender
            .clone()
    };
    let (reply, response) = oneshot::channel();
    sender
        .send(WriteRequest { data, reply })
        .await
        .map_err(|e| TransportError::new("closed", e))?;
    response
        .await
        .map_err(|e| TransportError::new("closed", e))?
}

#[command]
pub async fn transport_close(session_id: String, state: State<'_, ActiveConnection>) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    state.retire(Some(&session_id)).await;
    Ok(())
}

pub fn acknowledge(request: WriteRequest, result: Result<()>) -> Result<()> {
    let _ = request.reply.send(result.clone());
    result
}

pub async fn supervise(
    read: impl std::future::Future<Output = Result<()>>,
    write: impl std::future::Future<Output = Result<()>>,
    stop: oneshot::Receiver<()>,
) -> Result<()> {
    tokio::select! { r = read => r, r = write => r, _ = stop => Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::future::pending;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    async fn session(
        state: &ActiveConnection,
        id: &str,
    ) -> (mpsc::Receiver<WriteRequest>, Arc<AtomicBool>) {
        let (sender, receiver) = mpsc::channel(5);
        let (stop, stopped) = oneshot::channel();
        let finished = Arc::new(AtomicBool::new(false));
        let done = finished.clone();
        let task = tauri::async_runtime::spawn(async move {
            let _ = stopped.await;
            done.store(true, Ordering::SeqCst);
        });
        *state.conn.lock().await = Some(Session {
            id: id.to_string(),
            sender,
            stop,
            task,
        });
        (receiver, finished)
    }

    #[tokio::test]
    async fn stale_cleanup_and_close_cannot_remove_new_session() {
        let state = ActiveConnection::default();
        let (_receiver, done) = session(&state, "B").await;
        state.remove_if_owner("A").await;
        state.retire(Some("A")).await;
        assert_eq!(state.conn.lock().await.as_ref().unwrap().id, "B");
        assert!(!done.load(Ordering::SeqCst));
        state.retire(Some("B")).await;
        assert!(done.load(Ordering::SeqCst)); // close joins the worker
        assert!(state.conn.lock().await.is_none());
    }

    #[tokio::test]
    async fn missing_and_closed_channels_return_errors() {
        let state = ActiveConnection::default();
        assert_eq!(
            send_data(&state, "A", vec![1]).await.unwrap_err().code,
            "disconnected"
        );
        let (receiver, _) = session(&state, "A").await;
        drop(receiver);
        assert_eq!(
            send_data(&state, "A", vec![1]).await.unwrap_err().code,
            "closed"
        );
        state.retire(None).await;
    }

    #[tokio::test]
    async fn ipc_waits_for_io_and_propagates_ble_write_error() {
        let state = ActiveConnection::default();
        let (mut receiver, _) = session(&state, "A").await;
        let send = send_data(&state, "A", vec![1, 2, 3]);
        let worker = async {
            let request = receiver.recv().await.unwrap();
            assert_eq!(request.data, vec![1, 2, 3]);
            acknowledge(
                request,
                Err(TransportError::new("bluetooth", "write failed")),
            )
            .unwrap_err();
        };
        let (result, _) = tokio::join!(send, worker);
        assert_eq!(result.unwrap_err().message, "write failed");
        state.retire(None).await;
    }

    #[tokio::test]
    async fn worker_failure_or_cancellation_ends_sibling_tasks() {
        let (_stop, stopped) = oneshot::channel();
        let error = supervise(
            pending(),
            async { Err(TransportError::new("io", "failure")) },
            stopped,
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "io");
        let (stop, stopped) = oneshot::channel();
        stop.send(()).unwrap();
        assert!(supervise(pending(), pending(), stopped).await.is_ok());
    }
}
