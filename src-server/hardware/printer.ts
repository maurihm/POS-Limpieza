import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AppSettings, PrintResult } from '../../src/types/index.ts';

const execFileAsync = promisify(execFile);

/**
 * Dispatches raw ESC/POS bytes to:
 * 1. SPOOLER: Windows winspool.drv RAW API (via PowerShell P/Invoke on Windows, or CUPS raw on Linux)
 * 2. SERIAL: Direct COM port / tty device write
 * 3. PREVIEW: Safe offline preview mode (always succeeds & returns preview_text for on-screen inspection)
 *
 * Per RNF & Edge Case #1: never throws unhandled exceptions during checkout; returns structured PrintResult.
 */
export async function sendRawEscPos(
  buffer: Buffer,
  previewText: string,
  settings: AppSettings
): Promise<PrintResult> {
  const mode = settings.printer_mode || 'PREVIEW';

  if (mode === 'PREVIEW') {
    return {
      printed: true,
      mode: 'PREVIEW',
      preview_text: previewText,
      escpos_hex_length: buffer.length,
    };
  }

  try {
    if (mode === 'SPOOLER') {
      if (process.platform === 'win32') {
        await sendWindowsRawSpooler(settings.printer_name || 'POS-80', buffer);
      } else {
        // Linux / macOS CUPS raw queue fallback
        await sendUnixCupsRaw(settings.printer_name || 'POS-80', buffer);
      }
      return {
        printed: true,
        mode: 'SPOOLER',
        preview_text: previewText,
        escpos_hex_length: buffer.length,
      };
    }

    if (mode === 'SERIAL') {
      const port = settings.printer_com_port || (process.platform === 'win32' ? 'COM3' : '/dev/usb/lp0');
      const devicePath = process.platform === 'win32' && /^COM\d+$/i.test(port) ? `\\\\.\\${port}` : port;
      fs.writeFileSync(devicePath, buffer);
      return {
        printed: true,
        mode: 'SERIAL',
        preview_text: previewText,
        escpos_hex_length: buffer.length,
      };
    }

    return {
      printed: false,
      mode,
      preview_text: previewText,
      escpos_hex_length: buffer.length,
      error: `Modo de impresora no reconocido: ${mode}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      printed: false,
      mode,
      preview_text: previewText,
      escpos_hex_length: buffer.length,
      error: `La impresora no respondió (${message}). Revisa el papel, cable o driver.`,
    };
  }
}

async function sendWindowsRawSpooler(printerName: string, buffer: Buffer): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `pos80_${Date.now()}_${Math.random().toString(36).slice(2)}.bin`);
  fs.writeFileSync(tmpFile, buffer);
  try {
    const safePrinter = printerName.replace(/'/g, "''");
    const safeFile = tmpFile.replace(/'/g, "''");
    const psScript = `
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendFile(string printer, string file) {
    byte[] bytes = File.ReadAllBytes(file);
    IntPtr hPrinter;
    if (!OpenPrinter(printer, out hPrinter, IntPtr.Zero))
      throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFOA { pDocName = "POS Ticket", pDataType = "RAW" };
      if (!StartDocPrinter(hPrinter, 1, di))
        throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      StartPagePrinter(hPrinter);
      IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
      try {
        Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
        int written;
        if (!WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written))
          throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
      } finally {
        Marshal.FreeCoTaskMem(pUnmanaged);
        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@
[RawPrinter]::SendFile('${safePrinter}', '${safeFile}')
`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      timeout: 8000,
    });
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

async function sendUnixCupsRaw(printerName: string, buffer: Buffer): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `pos80_${Date.now()}.bin`);
  fs.writeFileSync(tmpFile, buffer);
  try {
    await execFileAsync('lp', ['-d', printerName, '-o', 'raw', tmpFile], { timeout: 6000 });
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

export async function listSystemPrinters(): Promise<string[]> {
  const results: string[] = [];
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'],
        { timeout: 5000 }
      );
      results.push(
        ...stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    } else {
      try {
        const { stdout } = await execFileAsync('lpstat', ['-a'], { timeout: 3000 });
        results.push(
          ...stdout
            .split(/\r?\n/)
            .map((line) => line.split(' ')[0]?.trim())
            .filter(Boolean)
        );
      } catch {
        // CUPS may not have queues yet
      }
      // Also detect direct USB thermal printers on Linux (/dev/usb/lp*)
      if (fs.existsSync('/dev/usb')) {
        for (const entry of fs.readdirSync('/dev/usb')) {
          if (entry.startsWith('lp')) results.push(`/dev/usb/${entry}`);
        }
      }
    }
  } catch {
    // ignore detection errors
  }
  return results.length > 0 ? results : ['POS-80'];
}
