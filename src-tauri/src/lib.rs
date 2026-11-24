pub mod escpos;
pub mod printer;

use serde::Serialize;

#[derive(Serialize)]
pub struct NativePrintResult {
    pub printed: bool,
    pub mode: String,
    pub error: Option<String>,
}

#[tauri::command]
fn print_escpos_raw(
    mode: String,
    printer_name: String,
    com_port: String,
    bytes: Vec<u8>,
) -> NativePrintResult {
    match mode.as_str() {
        "SPOOLER" => match printer::send_raw_spooler(&printer_name, &bytes) {
            Ok(_) => NativePrintResult {
                printed: true,
                mode,
                error: None,
            },
            Err(e) => NativePrintResult {
                printed: false,
                mode,
                error: Some(e),
            },
        },
        "SERIAL" => match printer::send_serial_com(&com_port, &bytes) {
            Ok(_) => NativePrintResult {
                printed: true,
                mode,
                error: None,
            },
            Err(e) => NativePrintResult {
                printed: false,
                mode,
                error: Some(e),
            },
        },
        _ => NativePrintResult {
            printed: true,
            mode: "PREVIEW".to_string(),
            error: None,
        },
    }
}

#[tauri::command]
fn open_cash_drawer_raw(mode: String, printer_name: String, com_port: String) -> NativePrintResult {
    let mut cmd = Vec::new();
    cmd.extend_from_slice(&escpos::ESC_INIT);
    cmd.extend_from_slice(&escpos::ESC_OPEN_DRAWER);
    print_escpos_raw(mode, printer_name, com_port, cmd)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            print_escpos_raw,
            open_cash_drawer_raw
        ])
        .run(tauri::generate_context!())
        .expect("Error al iniciar la aplicación POS Limpieza");
}
