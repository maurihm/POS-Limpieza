//! Native Windows winspool.drv RAW printer transport + Serial COM fallback.

use std::fs::OpenOptions;
use std::io::Write;

#[cfg(windows)]
pub fn send_raw_spooler(printer_name: &str, data: &[u8]) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W,
    };

    let mut printer_wide: Vec<u16> = OsStr::new(printer_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut doc_name: Vec<u16> = OsStr::new("POS Limpieza Ticket")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut data_type: Vec<u16> = OsStr::new("RAW")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut handle = ptr::null_mut();
        if OpenPrinterW(printer_wide.as_mut_ptr(), &mut handle, ptr::null_mut()) == 0 {
            return Err(format!("No se pudo abrir la impresora '{}'", printer_name));
        }

        let doc_info = DOC_INFO_1W {
            pDocName: doc_name.as_mut_ptr(),
            pOutputFile: ptr::null_mut(),
            pDatatype: data_type.as_mut_ptr(),
        };

        let job_id = StartDocPrinterW(handle, 1, &doc_info as *const _ as *const u8);
        if job_id == 0 {
            ClosePrinter(handle);
            return Err("Error al iniciar documento RAW en Windows Spooler".into());
        }

        if StartPagePrinter(handle) == 0 {
            EndDocPrinter(handle);
            ClosePrinter(handle);
            return Err("Error al iniciar página en Windows Spooler".into());
        }

        let mut written: u32 = 0;
        let ok = WritePrinter(
            handle,
            data.as_ptr() as *const _,
            data.len() as u32,
            &mut written,
        );

        EndPagePrinter(handle);
        EndDocPrinter(handle);
        ClosePrinter(handle);

        if ok == 0 {
            return Err("Error al escribir bytes ESC/POS a la impresora".into());
        }
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn send_raw_spooler(printer_name: &str, data: &[u8]) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let mut child = Command::new("lp")
        .args(["-d", printer_name, "-o", "raw"])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar lp: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(data)
            .map_err(|e| format!("Error enviando datos a lp: {}", e))?;
    }
    let status = child
        .wait()
        .map_err(|e| format!("Error esperando lp: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("lp retornó código {:?}", status.code()))
    }
}

pub fn send_serial_com(port: &str, data: &[u8]) -> Result<(), String> {
    let device_path = if cfg!(windows) && port.to_uppercase().starts_with("COM") {
        format!("\\\\.\\{}", port)
    } else {
        port.to_string()
    };

    let mut file = OpenOptions::new()
        .write(true)
        .open(&device_path)
        .map_err(|e| format!("No se pudo abrir el puerto '{}': {}", device_path, e))?;

    file.write_all(data)
        .map_err(|e| format!("Error escribiendo al puerto '{}': {}", device_path, e))?;
    Ok(())
}
