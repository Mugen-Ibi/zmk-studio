use super::commands::{
    acknowledge, finished, ActiveConnection, AvailableDevice, DataEvent, Result, Session,
    TransportError, WriteRequest,
};
use bluest::{Adapter, ConnectionEvent, Device, DeviceId};
use futures::StreamExt;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, State};
use tokio::{
    sync::{mpsc, oneshot},
    time::{sleep, timeout, timeout_at, Instant},
};
use uuid::Uuid;

const SVC_UUID: Uuid = Uuid::from_u128(0x00000000_0196_6107_c967_c5cfb1c2482a);
const RPC_CHRC_UUID: Uuid = Uuid::from_u128(0x00000001_0196_6107_c967_c5cfb1c2482a);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
fn bt_error(e: impl ToString) -> TransportError {
    TransportError::new("bluetooth", e)
}

#[command]
pub async fn gatt_connect(
    id: String,
    session_id: String,
    app_handle: AppHandle,
    state: State<'_, ActiveConnection>,
) -> Result<()> {
    let _lifecycle = state.lifecycle.lock().await;
    state.retire(None).await;
    let (sender, mut receiver) = mpsc::channel::<WriteRequest>(5);
    let (stop, mut stopped) = oneshot::channel();
    let (ready, readiness) = oneshot::channel();
    let (start, started) = oneshot::channel();
    let worker_id = session_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let _ = started.await;
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let operation = async {
            let adapter = timeout_at(deadline, Adapter::default())
                .await
                .map_err(bt_error)?
                .ok_or_else(|| bt_error("Bluetooth adapter unavailable"))?;
            timeout_at(deadline, adapter.wait_available())
                .await
                .map_err(bt_error)?
                .map_err(bt_error)?;
            let device_id: DeviceId = serde_json::from_str(&id).map_err(bt_error)?;
            let device = timeout_at(deadline, adapter.open_device(&device_id))
                .await
                .map_err(bt_error)?
                .map_err(bt_error)?;
            let result = async {
                if !timeout_at(deadline, device.is_connected()).await.map_err(bt_error)? { timeout_at(deadline, adapter.connect_device(&device)).await.map_err(bt_error)?.map_err(bt_error)?; }
                let service = timeout_at(deadline, device.discover_services_with_uuid(SVC_UUID)).await.map_err(bt_error)?.map_err(bt_error)?
                    .into_iter().next().ok_or_else(|| bt_error("Studio service missing"))?;
                let characteristic = timeout_at(deadline, service.discover_characteristics_with_uuid(RPC_CHRC_UUID)).await.map_err(bt_error)?.map_err(bt_error)?
                    .into_iter().next().ok_or_else(|| bt_error("Studio characteristic missing"))?;
                let mut notifications = timeout_at(deadline, characteristic.notify()).await.map_err(bt_error)?.map_err(bt_error)?;
                let mut events = timeout_at(deadline, adapter.device_connection_events(&device)).await.map_err(bt_error)?.map_err(bt_error)?;
                let _ = ready.send(());
                let read = async {
                    while let Some(value) = notifications.next().await {
                        let data = value.map_err(bt_error)?;
                        app_handle.emit("connection_data", DataEvent { session_id: &worker_id, data: &data }).map_err(bt_error)?;
                    }
                    Err(bt_error("Bluetooth notification stream ended"))
                };
                let write = async {
                    while let Some(request) = receiver.recv().await {
                        let result = characteristic.write(&request.data).await.map_err(bt_error);
                        acknowledge(request, result)?;
                    }
                    Ok(())
                };
                let disconnected = async {
                    while let Some(event) = events.next().await {
                        if event == ConnectionEvent::Disconnected { break; }
                    }
                    Err(bt_error("Bluetooth disconnected"))
                };
                tokio::select! { r = read => r, r = write => r, r = disconnected => r, _ = &mut stopped => Ok(()) }
            }.await;
            // Drop notification subscription before disconnecting.
            let _ = timeout(Duration::from_secs(2), adapter.disconnect_device(&device)).await;
            result
        };
        // Setup is bounded by the shared deadline; cleanup must finish before replacement.
        let result = operation.await;
        finished(&app_handle, &worker_id, result).await;
    });
    *state.conn.lock().await = Some(Session {
        id: session_id.clone(),
        sender,
        stop,
        task,
    });
    let _ = start.send(());
    match timeout(CONNECT_TIMEOUT + Duration::from_secs(3), readiness).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => {
            // A setup error drops readiness. Let the worker disconnect its device.
            state.retire(Some(&session_id)).await;
            Err(bt_error("Bluetooth setup failed"))
        }
        Err(_) => {
            // Abort a worker stuck in OS setup; its session is never published to TS.
            if let Some(session) = state.conn.lock().await.as_ref() {
                session.task.abort();
            }
            state.retire(Some(&session_id)).await;
            Err(bt_error("Bluetooth setup failed or timed out"))
        }
    }
}

#[cfg(target_os = "macos")]
async fn check_connected(adapter: &Adapter, device: &Device) -> bool {
    adapter.connect_device(device).await.is_ok()
}
#[cfg(not(target_os = "macos"))]
async fn check_connected(_: &Adapter, device: &Device) -> bool {
    device.is_connected().await
}

#[command]
pub async fn gatt_list_devices() -> Result<Vec<AvailableDevice>> {
    timeout(Duration::from_secs(6), async {
        let adapter = Adapter::default()
            .await
            .ok_or_else(|| bt_error("Bluetooth adapter unavailable"))?;
        adapter.wait_available().await.map_err(bt_error)?;
        let devices = adapter
            .discover_devices(&[SVC_UUID])
            .await
            .map_err(bt_error)?
            .take_until(sleep(Duration::from_secs(2)));
        futures::pin_mut!(devices);
        let mut result = vec![];
        while let Some(device) = devices.next().await {
            let device = device.map_err(bt_error)?;
            if check_connected(&adapter, &device).await {
                result.push(AvailableDevice {
                    label: device
                        .name_async()
                        .await
                        .unwrap_or_else(|_| "Unknown".to_string()),
                    id: serde_json::to_string(&device.id()).map_err(bt_error)?,
                });
            }
        }
        Ok(result)
    })
    .await
    .map_err(|_| bt_error("Bluetooth discovery timed out"))?
}
