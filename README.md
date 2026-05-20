# QR-QuickSend Technical Specification

## Overview
QR-QuickSend is a browser-based file transfer utility that uses high-frequency QR code flashing to transmit binary data across the visual spectrum. It is designed for static hosting environments and requires no server-side logic.

## Data Transmission Protocol

### Frame Structure
Transmission consists of three frame types encoded as plain text within the QR modules:

1.  **Metadata Frame (S):** `S|<filename>|<filesize_bytes>|<total_chunks>|<mime_type>`
    - Transmitted at the start of the session for a fixed duration (10 frames) to allow receiver synchronization and buffer initialization.
2.  **Data Frame (D):** `D|<chunk_index>|<base64_payload>`
    - `chunk_index`: Zero-based integer.
    - `base64_payload`: 450-byte binary slice converted to Base64. Base64 is used to ensure 7-bit ASCII compatibility across varying scanner implementations, preventing UTF-8 decoding errors.
3.  **End Frame (E):** `E|<total_chunks>`
    - Signals completion of the transmission sequence.

### Chunking Strategy
- **Chunk Size:** 450 bytes (pre-Base64). This results in approximately 600 characters per QR code.
- **QR Version:** Dynamic, targeting Version 10-15.
- **Error Correction:** Level L (7% recovery). Low ECC is selected to maximize data density per frame while maintaining sufficient readability for modern high-resolution sensors.

## Implementation Details

### Sender Engine
- **Timing:** Utilizes `setInterval` calibrated to the user-defined FPS (default 30).
- **Rendering:** Direct Canvas 2D API manipulation. `image-rendering: pixelated` is applied via CSS to prevent anti-aliasing on high-DPI displays, ensuring sharp module boundaries.
- **State Machine:** Loops back to metadata after the final data chunk to allow late-joining receivers to capture file headers.

### Receiver Engine
- **Decoding:** Powered by the Nimiq `qr-scanner` library (WASM build). Decoding occurs in a dedicated Web Worker to prevent UI thread blocking.
- **Reassembly:** Chunks are stored in a `Map<number, Uint8Array>`. This allows for out-of-order delivery which occurs during frame drops.
- **Persistence:** On completion, the Map is sorted by key, concatenated into a single `Blob`, and exposed via `URL.createObjectURL` for client-side download.

## Dependencies
- `qrcodegen v1.8.0`: High-performance QR generation.
- `qr-scanner v1.4.2`: WASM-accelerated QR decoding.
- `Tailwind CSS`: UI layout and styling.

## Performance Constraints
- **Maximum Throughput:** Theoretically ~13.5 KB/s at 30 FPS.
- **Memory:** Binary data is held in RAM; effective file size limit is dictated by the browser's heap size (recommended < 50MB).
- **Environmental Factors:** Requires high screen brightness and stable ambient lighting. Exposure-related "washout" on the receiver sensor is the primary cause of frame loss.
