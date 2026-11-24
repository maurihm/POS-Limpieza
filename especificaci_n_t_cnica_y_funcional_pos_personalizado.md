# Especificación Técnica y Funcional: Sistema Punto de Venta (POS) a Medida

**Versión del documento:** 1.0  
**Enfoque del negocio:** Tienda de productos de limpieza (Líquidos a granel/envasados, Jarcería y Envases) con venta al menudeo (Tienda) y mayoreo (Revendedores).  
**Filosofía de producto:** Minimalismo operativo, cero fricción para el cajero, 100% offline-first y consumo mínimo de recursos.

---

## 1. Visión General y Problemas a Resolver

Este documento define todos los requerimientos técnicos, de hardware, de datos, funcionales y de diseño para desarrollar un Punto de Venta propio que supere las limitaciones operativas de sistemas heredados (como uniCenta oPOS).

### 1.1 Dolores Operativos Resueltos por Diseño
1. **Un inventario, múltiples precios:** Vender el mismo producto a *Precio Tienda* o *Precio Revendedor* sin duplicar botones ni desfasar el stock.
2. **Promociones y Combos sin programación:** Crear paquetes (combos) y promociones (2x1, descuentos temporales) desde una interfaz visual sin escribir scripts.
3. **Interfaz táctil limpia con imágenes:** Operación fluida con ratón o pantalla táctil cuando el lector de códigos falla o para productos sin etiqueta (líquidos a granel).
4. **Control real del día a día:** Consulta instantánea de ventas del día (Corte X), reimpresión de tickets en dos clics y exportación real a Excel sin columnas desordenadas.
5. **Eficiencia de hardware:** Optimizado para equipos Windows con memoria RAM soldada y no ampliable (ej. Lenovo V14 G4 AMN).

---

## 2. Arquitectura y Stack Tecnológico Recomendado

Dado que el equipo destino corre Windows con RAM limitada/no ampliable y el negocio no puede detenerse si falla internet, el sistema debe ser **nativo/híbrido ligero** y **100% Offline-First**.

### 2.1 Arquitectura Propuesta (Opción Recomendada: Ligera y Moderna)
* **Contenedor de Escritorio:** **Tauri v2 (Rust)** — Consume entre 40 MB y 120 MB de RAM (hasta 5x menos que Electron o Java/uniCenta) y compila en un instalador Windows `.msi` / `.exe` de menos de 15 MB.
* **Frontend (UI):** **React + TypeScript + Tailwind CSS** — Permite una interfaz minimalista, reactiva, limpia y adaptable a pantallas de 14" (1366×768 o 1920×1080).
* **Base de Datos Local:** **SQLite 3 (en modo WAL - Write-Ahead Logging)** — Cero servidores que configurar (a diferencia de MySQL/PostgreSQL), resistente a apagones repentinos, búsquedas en milisegundos y respaldo en un solo archivo `.db`.
* **Alternativa Windows 100% Microsoft:** **.NET 8 (C#) + WPF / WinUI 3 + SQLite** — Excelente soporte nativo para el spooler de impresión de Windows y puertos COM.

### 2.2 Estructura Modular del Proyecto
```text
pos-app/
├── src-backend/ (Rust o C#)
│   ├── db/                 # Migraciones SQLite, repositorios, backups automáticos
│   ├── hardware/           # Módulos ESC/POS (POS-80), puertos USB/Spooler, cajón
│   ├── services/           # Lógica de negocio (cobro, cálculo de promos, kardex)
│   └── exports/            # Generación nativa .xlsx, .csv (UTF-8 BOM) y PDF (hojas QR)
├── src-frontend/ (React + TS)
│   ├── features/
│   │   ├── pos/            # Pantalla de cobro, carrito, modal de pago
│   │   ├── catalog/        # Productos, tarifas, combos, imágenes
│   │   ├── inventory/      # Existencias, ajustes, kardex, alertas
│   │   ├── sales-history/  # Búsqueda, reimpresión, devoluciones
│   │   ├── cash-register/  # Apertura, movimientos, Corte X y Corte Z
│   │   └── settings/       # Impresora, ticket, usuarios, respaldos
│   └── ui/                 # Componentes minimalistas reutilizables
└── assets/                 # Plantillas de recibos, sonidos sutiles de feedback
```

---

## 3. Hardware, Drivers e Integración a Bajo Nivel

### 3.1 Entorno de Ejecución (Host)
* **Sistema Operativo:** Windows 10 / Windows 11 (64 bits).
* **Hardware de referencia:** Laptop Lenovo V14 G4 AMN (RAM soldada, pantalla 14").
* **Resolución mínima garantizada:** `1366 × 768 px` (sin barras de desplazamiento horizontales en la pantalla de venta).

### 3.2 Impresora Térmica POS-80 (Papel térmico de 80 mm)

#### A. Drivers y Estrategia de Conexión
Para evitar depender de configuraciones frágiles de Java o drivers genéricos lentos, el sistema debe soportar **dos modos de comunicación** (seleccionables en Configuración):

1. **Modo Raw Windows Spooler (Recomendado por estabilidad):**
   * **Requisito previo:** Instalar el driver oficial del fabricante de la POS-80 (ej. *POS-80C / Xprinter / Generic Text Only*) en Windows.
   * **Implementación técnica:** Enviar bytes **ESC/POS crudos** directamente a la cola de Windows usando la API nativa de Windows (`winspool.drv`: `OpenPrinter`, `StartDocPrinter` con tipo `RAW`, `WritePrinter`, `EndDocPrinter`, `ClosePrinter`).
   * **Ventaja:** No bloquea puertos COM, funciona aunque se cambie el puerto USB físico de la laptop y permite reconexión automática.
2. **Modo Puerto Serial Virtual (COM) / USB Directo (Fallback):**
   * Uso de `libusb` / `WinUSB` o comunicación directa al puerto `COMx` (9600 o 115200 baudios, 8N1) para equipos sin driver de Windows instalado.

#### B. Especificaciones Físicas del Papel (80 mm)
* **Ancho imprimible estándar:** 72 mm (576 puntos a 203 DPI).
* **Columnas de texto (Fuente A, 12×24):** **48 caracteres** por línea (algunos modelos económicos usan 42; debe ser parámetro configurable: `42` o `48`).
* **Columnas de texto (Fuente B, 9×17):** **64 caracteres** por línea.

#### C. Comandos ESC/POS Obligatorios a Implementar
| Acción | Comando Hexadecimal | Notas Técnicas |
| :--- | :--- | :--- |
| Inicializar impresora | `1B 40` | Limpia el buffer antes de cada ticket. |
| Tabla de caracteres (Español) | `1B 74 02` (CP850) o `1B 74 13` (CP858) | Necesario para imprimir `ñ`, `Ñ`, `á`, `é`, `í`, `ó`, `ú`, `$`. Nunca enviar UTF-8 crudo si la impresora no lo soporta; codificar a CP850/CP858 antes de enviar. |
| Alineación Izquierda / Centro / Derecha | `1B 61 00` / `1B 61 01` / `1B 61 02` | Encabezados centrados, montos alineados a la derecha. |
| Negrita ON / OFF | `1B 45 01` / `1B 45 00` | Resaltar Total y Nombre del negocio. |
| Tamaño Doble Alto/Ancho | `1D 21 11` (normal: `1D 21 00`) | Para el nombre de la tienda y total final. |
| Avanzar papel y corte parcial | `1D 56 42 03` | Deja margen de 3 líneas antes de accionar la cuchilla. |
| Abrir cajón de dinero (Pin 2) | `1B 70 00 19 FA` | Envía pulso eléctrico por puerto RJ11 conectado a la POS-80. |

#### D. Plantilla Estándar de Ticket (48 caracteres)
```text
               [NOMBRE DEL NEGOCIO]
        Dirección / Teléfono / WhatsApp
------------------------------------------------
Folio: #000142              23/11/2026 17:45:12
Cajero: Ana                 Tarifa: TIENDA
------------------------------------------------
CANT  DESCRIPCION              P.UNIT    IMPORTE
------------------------------------------------
2.00  Cloro Blanqueador 1L      $15.00    $30.00
1.00  Atomizador Chico          $15.00    $15.00
1.00  PROMO 2x1 Pino 1L         $22.00    $22.00
------------------------------------------------
SUBTOTAL:                                 $67.00
DESCUENTO:                                -$0.00
TOTAL:                                    $67.00
------------------------------------------------
Pago (Efectivo):                         $100.00
Cambio:                                   $33.00
------------------------------------------------
          ¡Gracias por su preferencia!
     Conserve su ticket para aclaraciones
```

### 3.3 Lector de Códigos de Barras / QR
* **Driver:** Ninguno especial (Plug & Play estándar **USB HID Keyboard Emulation**).
* **Detección inteligente (Listener Global):** El sistema debe escuchar pulsaciones de teclado globalmente en la pantalla de venta. Si detecta una ráfaga de caracteres con intervalo `< 50 ms` terminada en `Enter`, lo interpreta como un escaneo de código de barras/QR y agrega el producto automáticamente, **sin obligar al cajero a hacer clic en una caja de texto**.
* **Tolerancia a fallos:** Como los lectores pueden fallar o desconectarse, el flujo completo de venta debe poder operarse al 100% mediante clics/toques en botones visuales y búsqueda rápida por nombre.

### 3.4 Cajón de Dinero (Opcional / Preparado para futuro)
* Conectado vía cable RJ11 a la parte trasera de la impresora POS-80.
* Se dispara automáticamente solo en pagos con **Efectivo** o al presionar un botón protegido por permiso ("Abrir cajón").

---

## 4. Modelo de Datos (Esquema SQLite)

Todas las operaciones de venta y movimiento de inventario deben ejecutarse dentro de **transacciones ACID**. Los precios se almacenan en **centavos (enteros)** o con precisión fija decimal para evitar errores de punto flotante (`0.1 + 0.2 != 0.3`).

### 4.1 Tablas Principales

1. **`roles` y `users`**
   * `users`: `id`, `name`, `pin_hash` (PIN rápido de 4 dígitos para cambio de turno), `password_hash`, `role_id`, `is_active`, `created_at`.
   * `roles`: `id`, `name` (`ADMIN`, `CAJERO`), `permissions_json` (banderas granulares).

2. **`categories`**
   * `id`, `name` (ej. *Líquidos*, *Envases*, *Jarcería*, *Combos*), `color_hex`, `image_path`, `sort_order`, `is_active`.

3. **`price_tiers` (Listas de Precios / Tarifas)**
   * `id`, `name` (ej. `Tienda`, `Revendedor`), `badge_color` (ej. `#2563EB` azul para Tienda, `#D97706` ámbar para Revendedor), `is_default` (boolean), `sort_order`.

4. **`products` (Un solo registro por artículo real)**
   * `id`, `sku` (código interno único), `barcode` (código de barras/QR, indexado), `name`, `category_id`.
   * `unit_type`: `PIECE` (piezas enteras) | `LITER` (fraccionable: `0.5`, `1.0`, `3.785`, etc.) | `WEIGHT`.
   * `cost_cents`: Costo de compra (visible solo para `ADMIN`).
   * `stock_quantity`: `REAL` (ej. `45.50` litros) — **Fuente única de verdad**.
   * `min_stock_alert`: `REAL` (umbral para alerta visual de reabastecimiento).
   * `is_bundle`: `BOOLEAN` (indica si es un combo armado por otros productos).
   * `track_inventory`: `BOOLEAN` (permite servicios o artículos sin control de stock).
   * `image_path`: Ruta local a la imagen optimizada en formato `.webp` (ej. `256×256 px`).
   * `show_in_pos`: `BOOLEAN`, `is_active`: `BOOLEAN` (borrado lógico para no romper historial).

5. **`product_prices` (Relación N precios por 1 producto)**
   * `id`, `product_id`, `price_tier_id`, `price_cents`.
   * *Restricción:* `UNIQUE(product_id, price_tier_id)`.
   * *Nota:* Si un producto no tiene precio asignado para `Revendedor`, el sistema usa automáticamente el precio por defecto (`Tienda`) y muestra un pequeño indicador visual.

6. **`bundle_items` (Receta de Combos / Paquetes)**
   * `id`, `bundle_product_id` (el combo), `component_product_id` (el producto real), `quantity` (ej. `1.0` L de Cloro + `1.0` envase).
   * *Regla:* Al vender 1 unidad del combo, se descuentan automáticamente las cantidades exactas de cada `component_product_id` en `products.stock_quantity`.

7. **`promotions` (Motor Nativo de Promociones)**
   * `id`, `name` (ej. *"2x1 Suavizante Fin de Semana"*).
   * `type`: `BUY_X_PAY_Y` (ej. 2x1, 3x2) | `PERCENT_DISCOUNT` | `FIXED_AMOUNT_DISCOUNT` | `BULK_QUANTITY_PRICE` (ej. a partir de 5 litros baja a $X).
   * `target_scope`: `PRODUCT` | `CATEGORY` | `ALL`.
   * `target_id`: ID del producto o categoría (nullable si es `ALL`).
   * `rule_json`: Parámetros estructurados (ej. `{"buy": 2, "pay": 1}` o `{"min_qty": 5, "unit_price_cents": 1400}`).
   * `valid_from`, `valid_until`, `days_of_week` (ej. `[6, 7]` para sábado y domingo), `is_active`.

8. **`cash_sessions` (Turnos / Cortes de Caja)**
   * `id`, `opened_by_user_id`, `closed_by_user_id`, `opened_at`, `closed_at`.
   * `opening_cash_cents` (fondo inicial de caja).
   * `expected_cash_cents`, `declared_cash_cents`, `difference_cents` (sobrante/faltante).
   * `status`: `OPEN` | `CLOSED`, `notes`.

9. **`cash_movements` (Entradas y Salidas de Efectivo)**
   * `id`, `cash_session_id`, `user_id`, `type` (`IN` | `OUT`), `amount_cents`, `reason` (ej. *"Pago a proveedor de envases"*, *"Retiro de efectivo"*), `created_at`.

10. **`sales`, `sale_items` y `sale_payments`**
    * `sales`: `id`, `folio` (correlativo legible), `cash_session_id`, `user_id`, `price_tier_id`, `subtotal_cents`, `discount_cents`, `total_cents`, `status` (`COMPLETED` | `VOIDED` | `PARTIALLY_REFUNDED`), `created_at`.
    * `sale_items`: `id`, `sale_id`, `product_id`, `product_name_snapshot`, `quantity`, `unit_price_cents`, `cost_cents_snapshot`, `discount_cents`, `line_total_cents`, `price_overridden` (boolean).
    * `sale_payments`: `id`, `sale_id`, `method` (`CASH` | `CARD` | `TRANSFER`), `amount_cents`, `tendered_cents`, `change_cents`.

11. **`inventory_movements` (Kardex Inmutable)**
    * `id`, `product_id`, `user_id`, `type` (`SALE`, `REFUND`, `PURCHASE`, `ADJUSTMENT`, `WASTE`, `BUNDLE_DEDUCTION`), `quantity_delta` (positivo o negativo), `stock_before`, `stock_after`, `reference_id` (ej. `sale_id`), `reason`, `created_at`.

12. **`audit_logs` (Bitácora de Seguridad)**
    * `id`, `user_id`, `action` (ej. `PRICE_OVERRIDE`, `SALE_VOID`, `STOCK_EDIT`, `DRAWER_OPEN_NO_SALE`), `details_json`, `created_at`.

---

## 5. Requerimientos Funcionales (RF)

### RF-01: Módulo de Punto de Venta (Cobro Rápido)
* **RF-01.1:** Agregar productos mediante toque/clic en tarjeta visual, búsqueda instantánea por texto (nombre o SKU) o escaneo de código de barras/QR.
* **RF-01.2:** **Selector de Tarifa en un clic (`Tienda` ↔ `Revendedor`):**
  * Al cambiar de tarifa, el sistema recalcula automáticamente los precios de los productos en el carrito actual (o pregunta si aplicar a todo el carrito) manteniendo **un solo inventario**.
  * Al finalizar e imprimir una venta en modo `Revendedor`, el sistema **regresa automáticamente a modo `Tienda`** para evitar errores con el siguiente cliente.
* **RF-01.3:** Soporte de cantidades fraccionadas para líquidos (ej. botones rápidos `0.5 L`, `1 L`, `4 L`, `20 L` o entrada numérica directa).
* **RF-01.4:** Edición rápida de precio en línea (protegida por permiso o PIN de administrador) con registro automático en `audit_logs`.
* **RF-01.5:** Descuento rápido por línea o al total del ticket (por porcentaje `%` o monto fijo `$`).
* **RF-01.6:** **Tickets en espera (Aparcar venta):** Permitir pausar una cuenta si un cliente olvidó algo, atender al siguiente y retomar la cuenta en un clic.
* **RF-01.7:** **Dividir cuenta (Split):** Permitir mover artículos de un ticket a otro cuando dos personas pagan por separado.
* **RF-01.8:** **Pago mixto:** Permitir cobrar una misma venta combinando métodos (ej. $100 en efectivo + $50 en transferencia), con cálculo automático de cambio y botones de billetes rápidos (`$20`, `$50`, `$100`, `$200`, `$500`, `Exacto`).

### RF-02: Catálogo de Productos, Imágenes y Tarifas
* **RF-02.1:** Alta, edición y desactivación de productos con asignación simultánea de *Precio Tienda*, *Precio Revendedor* y *Costo*.
* **RF-02.2:** Procesamiento automático de imágenes al subirlas: redimensionado automático a `256×256 px` y conversión a `.webp` para que el catálogo pese unos pocos megabytes y cargue al instante.
* **RF-02.3:** Edición rápida tipo hoja de cálculo ("Modo Edición Rápida") para actualizar decenas de precios o existencias de líquidos en una sola tabla sin abrir ficha por ficha.

### RF-03: Combos (Paquetes) y Promociones Nativas
* **RF-03.1:** Creación visual de Combos: seleccionar los artículos y cantidades que lo integran; el sistema muestra el costo sumado y sugiere el margen de ganancia.
* **RF-03.2:** Al vender un combo, el sistema valida y descuenta el inventario de cada producto componente y registra cada deducción en el Kardex.
* **RF-03.3:** Creación guiada de promociones (asistente paso a paso): *2x1 / 3x2*, *Descuento por categoría*, *Precio especial por volumen* (ej. a partir de 5 litros), con fechas de inicio/fin y activación/desactivación en un interruptor.

### RF-04: Gestión de Inventario y Kardex
* **RF-04.1:** Ingreso de mercancía (compras/abastecimiento) sumando al stock actual y actualizando costo si cambió.
* **RF-04.2:** Registro de ajustes manuales y mermas (derrames de líquidos, envases rotos) con motivo obligatorio.
* **RF-04.3:** Alertas visuales discretas (badge ámbar/rojo) cuando un producto alcance su `min_stock_alert`.
* **RF-04.4:** Historial Kardex por producto para rastrear exactamente cuándo entró, salió o se ajustó cada litro o pieza.

### RF-05: Historial de Ventas, Reimpresión y Devoluciones
* **RF-05.1:** Lista cargada automáticamente con las ventas de **Hoy** ordenadas de la más reciente a la más antigua (sin tener que presionar lupas vacías).
* **RF-05.2:** Filtros instantáneos por folio, rango de fechas, método de pago, tarifa (`Tienda`/`Revendedor`) o producto vendido.
* **RF-05.3:** Botón visible de **"Reimprimir Ticket"** (en un clic) que agrega la leyenda `*** REIMPRESIÓN ***` en el encabezado.
* **RF-05.4:** Botón de **"Reimprimir Último Ticket"** accesible directamente desde la pantalla principal de venta.
* **RF-05.5:** Cancelación total o devolución parcial (con autorización de Admin), reintegrando automáticamente las unidades (o componentes de combo) al inventario y descontando el dinero del corte de caja actual.

### RF-06: Control de Caja (Corte X y Corte Z)
* **RF-06.1:** **Apertura de caja:** Solicitar fondo inicial en efectivo al iniciar el día.
* **RF-06.2:** **Ventas del Día en Vivo (Corte X):** Pantalla de solo consulta accesible en cualquier momento que muestra total vendido, desglose por método de pago (Efectivo, Tarjeta, Transferencia), desglose por tarifa (Tienda vs. Revendedor), entradas/salidas de efectivo y efectivo esperado en caja. Incluye botón "Imprimir Corte X" **sin cerrar el turno**.
* **RF-06.3:** **Cierre de Caja (Corte Z):** Conteo guiado de efectivo (opcionalmente por denominación de billetes/monedas), cálculo automático de faltante o sobrante, cierre del turno e impresión del ticket resumen de cierre.

### RF-07: Importación/Exportación Excel y Generador de Hojas QR
* **RF-07.1:** **Exportación directa a Excel (`.xlsx`) y CSV (UTF-8 con BOM):**
  * Catálogo completo (SKU, Código, Nombre, Categoría, Costo, Precio Tienda, Precio Revendedor, Stock actual).
  * Lista de precios lista para compartir por WhatsApp (sin costos ni stock).
  * Reporte de ventas por periodo y reporte de utilidades (Ventas − Costos).
* **RF-07.2:** **Importación masiva desde Excel:** Plantilla descargable para dar de alta o actualizar masivamente precios y existencias con vista previa de cambios antes de confirmar.
* **RF-07.3:** **Generador de Hojas de Escaneo QR/Barras (PDF):** Seleccionar una categoría (ej. *Líquidos*) y generar automáticamente un PDF listo para imprimir en hoja carta con cuadrícula de imagen del producto, nombre, precio y su código QR/barras.

### RF-08: Seguridad, Usuarios y Respaldos
* **RF-08.1:** Cambio rápido de usuario mediante pantalla de PIN numérico (4 dígitos).
* **RF-08.2:** Matriz de permisos configurables:
  * **Cajero:** Vender, cambiar tarifa Tienda/Revendedor (configurable), reimprimir último ticket, registrar entradas/salidas con motivo, ver Corte X (configurable). **Bloqueado:** Ver costos/utilidades, editar inventario, borrar productos, cancelar ventas pasadas.
  * **Administrador (Dueña):** Acceso total.
* **RF-08.3:** **Respaldo automático:** Al realizar el Corte Z (y una vez al día en segundo plano), crear copia comprimida de la base de datos SQLite en una carpeta configurable (ej. carpeta sincronizada con Google Drive / OneDrive o memoria USB) manteniendo los últimos 30 días.

---

## 6. Requerimientos No Funcionales (RNF)

| Categoría | Requisito Medible |
| :--- | :--- |
| **Rendimiento (RAM)** | Consumo en reposo y operación normal **< 200 MB de RAM** para garantizar fluidez en equipos con 8 GB de RAM soldada junto con Windows 11. |
| **Velocidad de Respuesta** | Arranque de la app `< 3 segundos`. Búsqueda de productos en catálogo (hasta 5,000 SKUs) `< 50 ms`. Registro de venta e inicio de impresión `< 300 ms`. |
| **Disponibilidad Offline** | **100% funcional sin internet.** Ninguna operación de venta, inventario o impresión debe depender de conectividad externa. |
| **Integridad de Datos** | Uso de SQLite con `PRAGMA journal_mode = WAL;` y `PRAGMA foreign_keys = ON;`. Recuperación automática ante apagones sin corrupción de tablas. |
| **Usabilidad** | Un empleado nuevo debe poder aprender a cobrar, aplicar tarifa revendedor y reimprimir un ticket en **menos de 10 minutos** de capacitación. |
| **Resiliencia de Hardware** | Si la impresora POS-80 está apagada, desconectada o sin papel, la venta **se guarda igual** y se muestra una alerta no bloqueante con botón "Reintentar impresión". |
| **Instalación** | Instalador único `.exe`/`.msi` sin requerir que el usuario instale Java, MySQL ni servidores manuales. |

---

## 7. Historias de Usuario y Criterios de Aceptación

### HU-01: Venta a Revendedor con Descuento de Inventario Único
> **Como** cajera,  
> **Quiero** cambiar la tarifa de la venta actual a "Revendedor" con un solo clic,  
> **Para** cobrar el precio de mayoreo sin buscar botones duplicados y asegurando que el inventario se descuente del mismo almacén.

* **Dado** que existen `50.0 L` de *Cloro 1L* con precio Tienda `$15.00` y precio Revendedor `$11.00`.
* **Cuando** selecciono la tarifa `Revendedor`, agrego `10` unidades de *Cloro 1L* y finalizo el cobro.
* **Entonces** el total cobrado es `$110.00`, el inventario de *Cloro 1L* queda en `40.0 L`, el ticket indica `Tarifa: REVENDEDOR` y, al cerrarse el cobro, la pantalla vuelve automáticamente a tarifa `Tienda`.

### HU-02: Venta de Combo (Paquete) con Deducción Automática
> **Como** dueña del negocio,  
> **Quiero** crear un combo visualmente seleccionando sus productos internos,  
> **Para** lanzar promociones rápidas sin descuadrar mi inventario real de líquidos y envases.

* **Dado** que creo el combo *"Kit Limpieza ($35)"* compuesto por `1 L Cloro` + `1 L Pino` + `2 Envases 1L`.
* **Cuando** se vende `1` unidad de *"Kit Limpieza"*.
* **Entonces** el ticket muestra una línea por `$35.00` y el Kardex descuenta automáticamente `1` de Cloro, `1` de Pino y `2` de Envases 1L.

### HU-03: Creación de Promoción Temporal (2x1) sin Código
> **Como** dueña del negocio,  
> **Quiero** activar una promoción 2x1 para el fin de semana desde un formulario sencillo,  
> **Para** no depender de soporte técnico ni modificar scripts cada vez que lanzo una oferta.

* **Dado** que configuro una promo `2x1` para *Suavizante 1L ($20)* vigente sábado y domingo.
* **Cuando** el sábado la cajera agrega `2` unidades de *Suavizante 1L* al carrito.
* **Entonces** el sistema detecta la promo automáticamente, aplica un descuento visible de `-$20.00` (total `$20.00`) y descuenta `2` litros del stock. El lunes deja de aplicarse sola.

### HU-04: Reimpresión Rápida de Tickets
> **Como** cajera,  
> **Quiero** ver los tickets cobrados hoy y reimprimir cualquiera en menos de 3 segundos,  
> **Para** atender rápidamente a un cliente que pide copia o si el rollo de papel se atoró.

* **Dado** que un cliente pide copia de su ticket de hace 10 minutos.
* **Cuando** abro el módulo "Historial de Ventas".
* **Entonces** veo inmediatamente la lista de ventas de hoy sin tener que buscar manualmente; selecciono el ticket y al pulsar "Reimprimir" sale inmediatamente por la POS-80.

### HU-05: Consulta de Ventas del Día sin Cerrar Caja (Corte X)
> **Como** dueña,  
> **Quiero** consultar cuánto se ha vendido hoy y cuánto efectivo debe haber en caja sin cerrar el turno,  
> **Para** monitorear el negocio a medio día sin interrumpir las ventas.

* **Dado** que la caja está abierta y hay ventas registradas.
* **Cuando** entro a "Caja → Ver Resumen del Día (Corte X)".
* **Entonces** veo el desglose en vivo (Efectivo, Tarjeta, Transferencia, Total, Fondo inicial y Efectivo esperado) y puedo imprimirlo sin cerrar el turno actual.

### HU-06: Carga Masiva de Existencias de Líquidos
> **Como** soporte técnico o dueña,  
> **Quiero** ver todos los líquidos en una tabla editable o importarlos desde Excel,  
> **Para** actualizar rápidamente las existencias faltantes sin abrir 50 ventanas individuales.

* **Dado** que entro a "Inventario → Edición Rápida" y filtro por categoría *Líquidos*.
* **Cuando** escribo las cantidades actuales en la columna de stock y presiono "Guardar todo".
* **Entonces** todos los registros se actualizan en una sola transacción y se genera el movimiento correspondiente en el Kardex.

### HU-07: Operación Táctil ante Falla del Lector de Códigos
> **Como** cajera,  
> **Quiero** identificar los productos por su foto limpia y nombre claro agrupados por categoría,  
> **Para** seguir cobrando a la misma velocidad aunque el lector de códigos de barras deje de funcionar.

* **Dado** que el lector USB no responde.
* **Cuando** toco la categoría *Líquidos* y hago clic en la tarjeta con la foto de *Pinol 1L*.
* **Entonces** el producto se suma al carrito al instante con feedback visual y sonoro sutil.

### HU-08: Exportación Limpia a Excel para Lista de Precios
> **Como** dueña,  
> **Quiero** exportar mi catálogo a un archivo `.xlsx` con un clic,  
> **Para** abrirlo directamente en Excel con columnas limpias y compartir precios a revendedores por WhatsApp.

* **Dado** que presiono "Exportar → Lista de Precios (Excel)".
* **Cuando** abro el archivo generado en Microsoft Excel.
* **Entonces** todas las columnas (Producto, Categoría, Precio Tienda, Precio Revendedor) y acentos (`ñ`, `á`, `ó`) aparecen perfectamente formateados sin requerir pasos de importación manual.

---

## 8. Diseño UI/UX: Limpio, Minimalista e Intuitivo

El diseño elimina botones oscuros, iconos ambiguos sin texto (como las tijeras o impresoras confusas de uniCenta) y menús anidados innecesarios.

### 8.1 Principios de Diseño
1. **Todo botón lleva ícono + etiqueta corta en español:** Cero adivinanzas (ej. `[🖨️ Reimprimir]` en vez de un ícono suelto).
2. **Regla del 70/30 en la Pantalla de Ventas:** 70% a la izquierda para el catálogo visual limpio y buscador; 30% a la derecha para el ticket actual y el botón principal de cobro.
3. **Semáforo Visual de Tarifa (Prevención de Errores):**
   * En modo **Tienda**, el encabezado del carrito es blanco/gris limpio con badge azul.
   * Al activar **Revendedor**, la barra superior del carrito cambia a un tono **ámbar suave** con etiqueta clara `MODO REVENDEDOR ACTIVADO`, imposible de pasar por alto.
4. **Alto Contraste y Espaciado Generoso:** Diseñado para locales comerciales con luz intensa (modo claro limpio). Tamaño mínimo táctil de botones: `48 × 48 px`.

### 8.2 Paleta de Colores Sugerida
| Rol | Color (Hex) | Uso |
| :--- | :--- | :--- |
| Fondo principal | `#F8FAFC` | Lienzo limpio que reduce fatiga visual |
| Tarjetas / Superficies | `#FFFFFF` | Contenedores con borde sutil `#E2E8F0` |
| Texto principal | `#0F172A` | Máxima legibilidad |
| Texto secundario | `#64748B` | Categorías, folios, etiquetas auxiliares |
| Acción primaria (Cobrar) | `#16A34A` | Verde sólido y claro para el botón `COBRAR` |
| Tarifa Tienda | `#2563EB` | Azul neutro |
| Tarifa Revendedor | `#D97706` | Ámbar de atención (indica precio especial) |
| Peligro / Cancelar | `#DC2626` | Borrar ítem, anular venta, stock agotado |

### 8.3 Wireframe de la Pantalla Principal de Ventas
```text
+---------------------------------------------------------------------------------------------------+
| [☰ Menú]  POS LIMPIEZA   |  [ 🔍 Buscar producto o escanear... (F2) ]   |  Caja: Abierta | 👤 Ana |
+-------------------------------------------------------------------------+-------------------------+
| CATEGORÍAS:  [ Todos ]  [ Líquidos ]  [ Jarcería ]  [ Envases ] [Combos]| TARIFA: [Tienda|Revend.]|
+-------------------------------------------------------------------------+-------------------------+
|                                                                         | Ticket #0143   [⏸][✂][🗑]|
|  +--------------+  +--------------+  +--------------+  +--------------+ |-------------------------|
|  |   [Foto IA]  |  |   [Foto IA]  |  |   [Foto IA]  |  |   [Foto IA]  | | Cloro 1L          $30.00|
|  |              |  |              |  |              |  |              | |  [-] 2.00 [+]  $15 c/u  |
|  | Cloro 1L     |  | Pino 1L      |  | Suavizante   |  | Atomizador   | |-------------------------|
|  | $15.00       |  | $18.00       |  | $22.00       |  | $15.00       | | Atomizador Chico  $15.00|
|  | Stock: 42 L  |  | Stock: 18 L  |  | Stock: 3 L ! |  | Stock: 25 pz | |  [-] 1.00 [+]  $15 c/u  |
|  +--------------+  +--------------+  +--------------+  +--------------+ |-------------------------|
|                                                                         |                         |
|  +--------------+  +--------------+  +--------------+  +--------------+ |  (espacio carrito)      |
|  |   [Foto IA]  |  |   [Foto IA]  |  |   [Foto IA]  |  |   [Foto IA]  | |                         |
|  |              |  |              |  |              |  |              | |-------------------------|
|  | Jabón Trast. |  | Escoba Suave |  | Envase 1L    |  | Kit Limpieza | | Subtotal:        $45.00 |
|  | $24.00       |  | $45.00       |  | $8.00        |  | $35.00 [CMB] | | Descuento (F6):  -$0.00 |
|  +--------------+  +--------------+  +--------------+  +--------------+ | TOTAL:           $45.00 |
|                                                                         |-------------------------|
|                                                                         | [   COBRAR $45.00 (F12) ]|
+-------------------------------------------------------------------------+-------------------------+
| [🖨️ Reimprimir último (F9)]  [📋 En espera (1)]  [📊 Ventas de hoy]     | Impresora: ● POS-80 OK  |
+---------------------------------------------------------------------------------------------------+
```

### 8.4 Mapa de Navegación (Menú Lateral Minimalista)
Solo **6 secciones claras** (según permisos del rol):
1. **Vender** (Pantalla principal)
2. **Historial** (Ventas de hoy, reimprimir, devoluciones)
3. **Catálogo** (Productos, precios Tienda/Revendedor, combos, promociones)
4. **Inventario** (Existencias, edición rápida, entradas, mermas, Kardex)
5. **Caja y Reportes** (Corte X en vivo, Corte Z, entradas/salidas, exportar Excel)
6. **Ajustes** (Impresora POS-80, encabezado de ticket, usuarios/PIN, respaldos)

### 8.5 Atajos de Teclado Estándar
* `F2`: Enfocar barra de búsqueda.
* `F4`: Alternar tarifa `Tienda` ↔ `Revendedor`.
* `F6`: Aplicar descuento rápido.
* `F8`: Poner ticket actual en espera.
* `F9`: Reimprimir último ticket.
* `F12` o `Ctrl + Enter`: Abrir modal de Cobro.
* `Esc`: Cerrar modal actual.

---

## 9. Casos Borde (Edge Cases) y Reglas de Negocio Críticas

1. **Impresora POS-80 apagada o sin papel al momento de cobrar:**
   * *Comportamiento:* La venta se registra primero en SQLite (el dinero y el stock nunca se pierden). Si el envío al spooler/USB falla, se muestra un aviso claro: *"Venta #143 guardada, pero la impresora no respondió. Revisa el papel/cable"* con botón **[Reintentar Impresión]** y **[Continuar sin imprimir]**.
2. **Stock insuficiente o en cero:**
   * *Comportamiento:* Configurable en Ajustes (`Permitir venta con stock negativo con advertencia` por defecto). En tiendas físicas a veces llega mercancía que aún no se capturó en sistema; bloquear la venta detiene la fila. El sistema permite cobrar, deja el stock en negativo (ej. `-2 L`) y lo marca en rojo en Inventario para que la dueña lo regularice.
3. **Apagón o cierre forzado a mitad de una venta:**
   * *Comportamiento:* El carrito en curso se persiste automáticamente en almacenamiento local (`localStorage`/tabla temporal). Al volver a abrir el programa, pregunta *"¿Recuperar venta sin finalizar?"*.
4. **Cambio de tarifa a mitad de un ticket con precios editados a mano:**
   * *Comportamiento:* Al cambiar de `Tienda` a `Revendedor`, se actualizan todos los artículos normales del carrito, pero si el cajero ya había forzado un precio manual en una línea específica, se respeta ese precio manual o se muestra una confirmación.
5. **Redondeo en líquidos fraccionados:**
   * *Comportamiento:* Ejemplo: `0.33 L × $15.00 = $4.95`. Todo cálculo se redondea al centavo más cercano (*Half-Up*) por línea antes de sumar el subtotal, evitando diferencias de `$0.01` entre el ticket impreso y el corte de caja.
6. **Papel térmico puesto al revés (impresión en blanco):**
   * *Comportamiento:* Incluir en `Ajustes → Impresora` un botón **"Imprimir Ticket de Prueba"** acompañado de una breve nota visual de diagnóstico (*"Si sale papel en blanco, invierte el rollo y prueba de nuevo"*).
7. **Devolución de un Combo:**
   * *Comportamiento:* Al cancelar/devolver un combo, el sistema consulta la instantánea de componentes al momento de la venta y reintegra exactamente las cantidades de cada insumo al inventario.

---

## 10. Hoja de Ruta de Implementación (Roadmap)

### Fase 1: MVP Operativo en Tienda (Semanas 1–3)
* Estructura del proyecto (Tauri/React o C#/WPF) + SQLite en modo WAL.
* CRUD de Categorías y Productos con **Tarifas múltiples (Tienda y Revendedor)** y **stock único**.
* Pantalla de Ventas minimalista (táctil + buscador + soporte HID lector).
* Motor de impresión **ESC/POS para POS-80** (tickets + prueba de impresión + soporte de acentos CP850/CP858).
* Historial de ventas del día con reimpresión en 1 clic.
* Apertura de caja, Corte X en vivo y Corte Z.

### Fase 2: Potencia Operativa del Negocio (Semanas 4–5)
* Módulo visual de **Combos (Paquetes)** con deducción de componentes.
* Motor nativo de **Promociones** (2x1, descuentos por porcentaje/monto y por fechas).
* Módulo de Inventario con **Edición Rápida en tabla**, mermas y Kardex.
* Tickets en espera, división de cuenta (Split) y devoluciones parciales/totales.
* Roles y permisos con acceso rápido por PIN de 4 dígitos.

### Fase 3: Automatización y Herramientas de Gestión (Semana 6)
* Exportación/Importación nativa en **Excel (`.xlsx`)** y CSV (UTF-8 BOM).
* Generador automático de **Hojas de Escaneo QR en PDF** desde el catálogo.
* Compresor automático de imágenes de productos a `.webp`.
* Sistema de **respaldos automáticos diarios** (carpeta local / nube sincronizada).
* Empaquetado en instalador Windows `.msi`/`.exe`.