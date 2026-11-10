use super::commands::{
    acknowledge, finished, supervise, ActiveConnection, AvailableDevice, DataEvent, Result,
    Session, TransportError, WriteRequest,
};
use tauri::{command, AppHandle, Emitter, State};
use tauri_plugin_cli::CliExt;
use tokio::io::{AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot};
use tokio_serial::{available_ports, SerialPortBuilderExt, SerialPortType};

pub async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, data: &[u8]) -> Result<()> {
    writer
        .write_all(data)
        .await
        .map_err(|e| TransportError::new("serial_write", e))
}

#[command]
pub async fn serial_connect(
    id: String,
    session_id: String,
    app_handle: AppHandle,
    state: State<'_, ActiveConnection>,
) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    state.retire(None).await;
    let port = tokio_serial::new(id, 9600)
        .open_native_async()
        .map_err(|e| TransportError::new("serial_open", e))?;
    #[cfg(unix)]
    let port = {
        let mut port = port;
        port.set_exclusive(false)
            .map_err(|e| TransportError::new("serial_open", e))?;
        port
    };
    let (mut reader, mut writer) = tokio::io::split(port);
    let (sender, mut receiver) = mpsc::channel::<WriteRequest>(5);
    let (stop, stopped) = oneshot::channel();
    let worker_id = session_id.clone();
    let (start, started) = oneshot::channel();
    let task = tauri::async_runtime::spawn(async move {
        let _ = started.await;
        let read = async {
            let mut buffer = [0u8; 1024];
            loop {
                let size = reader
                    .read(&mut buffer)
                    .await
                    .map_err(|e| TransportError::new("serial_read", e))?;
                if size == 0 {
                    return Err(TransportError::new("disconnected", "Serial stream ended"));
                }
                app_handle
                    .emit(
                        "connection_data",
                        DataEvent {
                            session_id: &worker_id,
                            data: &buffer[..size],
                        },
                    )
                    .map_err(|e| TransportError::new("event", e))?;
            }
        };
        let write = async {
            while let Some(request) = receiver.recv().await {
                let result = write_frame(&mut writer, &request.data).await;
                acknowledge(request, result)?;
            }
            Ok(())
        };
        let result = supervise(read, write, stopped).await;
        drop(reader);
        drop(writer);
        finished(&app_handle, &worker_id, result).await;
    });
    *state.conn.lock().await = Some(Session {
        id: session_id,
        sender,
        stop,
        task,
    });
    let _ = start.send(());
    Ok(())
}

#[command]
pub async fn serial_list_devices(app_handle: AppHandle) -> Result<Vec<AvailableDevice>> {
    let ports = tokio::task::spawn_blocking(available_ports)
        .await
        .map_err(|e| TransportError::new("serial_list", e))?
        .map_err(|e| TransportError::new("serial_list", e))?;
    let mut candidates = ports
        .into_iter()
        .filter_map(|pi| {
            if let SerialPortType::UsbPort(u) = pi.port_type {
                Some(AvailableDevice {
                    id: pi.port_name,
                    label: u.product.unwrap_or("Unnamed device".to_string()),
                })
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if let Ok(m) = app_handle.cli().matches() {
        if let Some(p) = m.args.get("serial-port") {
            if let serde_json::Value::String(path) = &p.value {
                candidates.push(AvailableDevice {
                    id: path.clone(),
                    label: format!("CLI Port: {path}"),
                });
            }
        }
    }
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io,
        pin::Pin,
        task::{Context, Poll},
    };
    struct ShortWriter {
        bytes: Vec<u8>,
        fail_after: Option<usize>,
        zero: bool,
    }
    impl AsyncWrite for ShortWriter {
        fn poll_write(
            mut self: Pin<&mut Self>,
            _: &mut Context<'_>,
            data: &[u8],
        ) -> Poll<io::Result<usize>> {
            if self.fail_after.is_some_and(|n| self.bytes.len() >= n) {
                return Poll::Ready(Err(io::Error::other("injected failure")));
            }
            let size = if self.zero { 0 } else { data.len().min(2) };
            self.bytes.extend_from_slice(&data[..size]);
            Poll::Ready(Ok(size))
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
        fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }
    #[tokio::test]
    async fn partial_writes_send_the_entire_frame() {
        let mut writer = ShortWriter {
            bytes: vec![],
            fail_after: None,
            zero: false,
        };
        write_frame(&mut writer, &[1, 2, 3, 4, 5]).await.unwrap();
        assert_eq!(writer.bytes, vec![1, 2, 3, 4, 5]);
    }
    #[tokio::test]
    async fn zero_and_partial_io_failures_are_errors() {
        for (zero, fail_after) in [(true, None), (false, Some(2))] {
            let mut writer = ShortWriter {
                bytes: vec![],
                fail_after,
                zero,
            };
            assert_eq!(
                write_frame(&mut writer, &[1, 2, 3, 4])
                    .await
                    .unwrap_err()
                    .code,
                "serial_write"
            );
        }
    }
}
