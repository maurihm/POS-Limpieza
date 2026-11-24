# POS Limpieza — Sistema Punto de Venta a Medida

Implementación completa (Fases 1, 2 y 3) basada en [especificaci_n_t_cnica_y_funcional_pos_personalizado.md](./especificaci_n_t_cnica_y_funcional_pos_personalizado.md).

## Instalación Rápida en Windows (como programa de escritorio)

1. Clona el repositorio en la laptop Windows (por ejemplo en `C:\POS-Limpieza`):
   ```powershell
   git clone <URL_DE_TU_REPO> C:\POS-Limpieza
   ```
2. Abre la carpeta `C:\POS-Limpieza` y haz **doble clic en `instalar_windows.bat`**.
   * Instala Node.js LTS automáticamente con `winget` si no lo tienes.
   * Instala dependencias y compila la aplicación.
   * Crea el programa **"POS Limpieza"** con su ícono en el **Escritorio** y en el **Menú Inicio** (abre en ventana propia sin barra de navegador y sin ventana negra de consola).
3. Para recibir futuras mejoras después de hacer `git push`: haz doble clic en **`actualizar_windows.bat`** (o desde Menú Inicio → *POS Limpieza* → *Actualizar POS Limpieza*). Tu base de datos en `data/` nunca se borra.
4. Para quitar accesos directos: **`desinstalar_windows.bat`**.

## Credenciales Iniciales (PIN 4 dígitos)
- **Dueña (Administrador):** `0000` (acceso total)
- **Ana (Cajero):** `1234` (permisos configurables en Ajustes)

## Arquitectura
- **Frontend:** React 19 + TypeScript + Tailwind CSS v4 (diseño minimalista 70/30 optimizado para 1366×768 y pantallas táctiles).
- **Base de Datos Local:** SQLite 3 en modo **WAL** (`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`) con precios en centavos enteros y redondeo *Half-Up*.
- **Backend Local:** Node.js 24 (`node:sqlite`, cero servidores externos que configurar) en `src-server/`.
- **Capa Tauri v2 (Rust):** `src-tauri/` con soporte `winspool.drv` RAW y puerto serial `COM`.

## Comandos de Desarrollo (Linux / Windows / macOS)

```bash
# Instalar dependencias
npm install

# Ejecutar en desarrollo (API SQLite + UI Vite)
npm run dev

# Ejecutar pruebas automatizadas (HU-01..HU-08, ESC/POS, Excel, PDF QR, Corte X/Z)
npm test

# Compilar y ejecutar en producción local (http://127.0.0.1:3420)
npm run build
npm start
```
