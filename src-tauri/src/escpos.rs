//! ESC/POS command constants and CP850/CP858 Spanish encoder for POS-80 thermal printers.

pub const ESC_INIT: [u8; 2] = [0x1B, 0x40];
pub const ESC_CP850: [u8; 3] = [0x1B, 0x74, 0x02];
pub const ESC_CP858: [u8; 3] = [0x1B, 0x74, 0x13];
pub const ESC_ALIGN_LEFT: [u8; 3] = [0x1B, 0x61, 0x00];
pub const ESC_ALIGN_CENTER: [u8; 3] = [0x1B, 0x61, 0x01];
pub const ESC_ALIGN_RIGHT: [u8; 3] = [0x1B, 0x61, 0x02];
pub const ESC_BOLD_ON: [u8; 3] = [0x1B, 0x45, 0x01];
pub const ESC_BOLD_OFF: [u8; 3] = [0x1B, 0x45, 0x00];
pub const ESC_SIZE_DOUBLE: [u8; 3] = [0x1D, 0x21, 0x11];
pub const ESC_SIZE_NORMAL: [u8; 3] = [0x1D, 0x21, 0x00];
pub const ESC_PARTIAL_CUT: [u8; 4] = [0x1D, 0x56, 0x42, 0x03];
pub const ESC_OPEN_DRAWER: [u8; 5] = [0x1B, 0x70, 0x00, 0x19, 0xFA];

pub fn encode_cp850(text: &str, cp858: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '\n' | '\r' | '\t' => out.push(ch as u8),
            ' '..='~' => out.push(ch as u8),
            'á' => out.push(0xA0),
            'í' => out.push(0xA1),
            'ó' => out.push(0xA2),
            'ú' => out.push(0xA3),
            'ñ' => out.push(0xA4),
            'Ñ' => out.push(0xA5),
            'é' => out.push(0x82),
            'ü' => out.push(0x81),
            'Ü' => out.push(0x9A),
            'Á' => out.push(0xB5),
            'É' => out.push(0x90),
            'Í' => out.push(0xD6),
            'Ó' => out.push(0xE0),
            'Ú' => out.push(0xE9),
            '¿' => out.push(0xA8),
            '¡' => out.push(0xAD),
            '°' => out.push(0xF8),
            '€' => out.push(if cp858 { 0xD5 } else { b'E' }),
            _ => out.push(b'?'),
        }
    }
    out
}
