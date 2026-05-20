// QR-Sync Core Logic

const SENDER_CHUNK_SIZE = 450; 
let senderChunks = [];
let senderInterval = null;
let currentChunkIndex = 0;
let isSending = false;
let senderFileMetadata = null;

const receiverChunks = new Map();
let receiverMetadata = null;
let qrScanner = null;
let isReceiving = false;

// Initialize on Load
window.onload = () => {
    logDebug("Application Initializing...");

    // DOM Elements
    const views = {
        send: document.getElementById('view-send'),
        receive: document.getElementById('view-receive')
    };
    const buttons = {
        modeSend: document.getElementById('btn-mode-send'),
        modeReceive: document.getElementById('btn-mode-receive'),
        startSend: document.getElementById('btn-start-send'),
        stopSend: document.getElementById('btn-stop-send'),
        download: document.getElementById('btn-download')
    };
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const transferControls = document.getElementById('transfer-controls');

    // --- View Management ---

    function switchView(mode) {
        logDebug(`Switching view to: ${mode}`);
        if (mode === 'send') {
            views.send.classList.remove('hidden');
            views.receive.classList.add('hidden');
            buttons.modeSend.classList.add('bg-indigo-600');
            buttons.modeSend.classList.remove('bg-zinc-800');
            buttons.modeReceive.classList.add('bg-zinc-800');
            buttons.modeReceive.classList.remove('bg-indigo-600');
            stopReceiver();
        } else {
            views.send.classList.add('hidden');
            views.receive.classList.remove('hidden');
            buttons.modeReceive.classList.add('bg-indigo-600');
            buttons.modeReceive.classList.remove('bg-zinc-800');
            buttons.modeSend.classList.add('bg-zinc-800');
            buttons.modeSend.classList.remove('bg-indigo-600');
            startReceiver();
        }
    }

    buttons.modeSend.onclick = () => switchView('send');
    buttons.modeReceive.onclick = () => switchView('receive');

    // --- Sender Logic ---

    if (dropZone) {
        dropZone.onclick = () => fileInput.click();
        fileInput.onchange = (e) => handleFile(e.target.files[0]);

        dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('border-indigo-500'); };
        dropZone.ondragleave = () => dropZone.classList.remove('border-indigo-500');
        dropZone.ondrop = (e) => {
            e.preventDefault();
            dropZone.classList.remove('border-indigo-500');
            handleFile(e.dataTransfer.files[0]);
        };
    }

    async function handleFile(file) {
        if (!file) return;
        logDebug(`Handling file: ${file.name} (${file.size} bytes)`);
        
        senderFileMetadata = {
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream'
        };

        try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            
            senderChunks = [];
            for (let i = 0; i < bytes.length; i += SENDER_CHUNK_SIZE) {
                senderChunks.push(bytes.slice(i, i + SENDER_CHUNK_SIZE));
            }

            document.getElementById('file-name').textContent = file.name;
            document.getElementById('file-info').textContent = `${(file.size / 1024).toFixed(1)} KB • ${senderChunks.length} chunks`;
            
            dropZone.classList.add('hidden');
            transferControls.classList.remove('hidden');
            updateSenderProgress(0);
            
            // Initial preview QR (Metadata)
            setTimeout(() => {
                logDebug("Generating initial metadata QR...");
                const initialPayload = `S|${senderFileMetadata.name}|${senderFileMetadata.size}|${senderChunks.length}|${senderFileMetadata.type}`;
                renderQR(initialPayload);
            }, 500);
        } catch (e) {
            logDebug(`File Error: ${e.message}`);
        }
    }

    function updateSenderProgress(pct) {
        document.getElementById('send-progress-pct').textContent = `${Math.round(pct)}%`;
        document.getElementById('send-progress-bar').style.width = `${pct}%`;
    }

    buttons.startSend.onclick = () => {
        if (isSending) return;
        const QrCodeClass = checkLibrary();
        if (!QrCodeClass) {
            logDebug("Start failed: QR Library not found");
            return;
        }
        
        logDebug("Starting transfer loop...");
        isSending = true;
        currentChunkIndex = -10; 
        const fps = parseInt(document.getElementById('fps-input').value) || 30;
        
        buttons.startSend.classList.add('opacity-50', 'pointer-events-none');
        
        senderInterval = setInterval(() => {
            sendNextFrame();
        }, 1000 / fps);
    };

    buttons.stopSend.onclick = () => {
        logDebug("Stopping transfer...");
        stopSender();
        dropZone.classList.remove('hidden');
        transferControls.classList.add('hidden');
    };

    function stopSender() {
        isSending = false;
        clearInterval(senderInterval);
        buttons.startSend.classList.remove('opacity-50', 'pointer-events-none');
    }

    function sendNextFrame() {
        let payload;
        
        if (currentChunkIndex < 0) {
            payload = `S|${senderFileMetadata.name}|${senderFileMetadata.size}|${senderChunks.length}|${senderFileMetadata.type}`;
        } else if (currentChunkIndex < senderChunks.length) {
            const chunk = senderChunks[currentChunkIndex];
            const b64 = bytesToBase64(chunk);
            payload = `D|${currentChunkIndex}|${b64}`;
            if (currentChunkIndex % 10 === 0) {
                updateSenderProgress((currentChunkIndex / senderChunks.length) * 100);
            }
        } else {
            payload = `E|${senderChunks.length}`;
            if (currentChunkIndex > senderChunks.length + 30) {
                currentChunkIndex = -10;
                return;
            }
        }

        renderQR(payload);
        currentChunkIndex++;
        
        if (currentChunkIndex === senderChunks.length) {
            updateSenderProgress(100);
        }
    }

    function renderQR(data) {
        const canvas = document.getElementById('qr-canvas');
        if (!canvas) {
            logDebug("Render failed: Canvas element not found");
            return;
        }
        const ctx = canvas.getContext('2d');
        
        try {
            const QrCodeClass = checkLibrary();
            if (!QrCodeClass) {
                logDebug("Render failed: QrCode library not found");
                return;
            }

            const qr = QrCodeClass.encodeText(data, QrCodeClass.Ecc.LOW);
            const canvasSize = 800; 
            const scale = Math.floor(canvasSize / qr.size) || 4;
            const actualSize = qr.size * scale;
            
            canvas.width = actualSize;
            canvas.height = actualSize;
            
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "black";
            
            for (let y = 0; y < qr.size; y++) {
                for (let x = 0; x < qr.size; x++) {
                    if (qr.getModule(x, y)) {
                        ctx.fillRect(x * scale, y * scale, scale, scale);
                    }
                }
            }
        } catch (e) {
            logDebug(`QR Render Error: ${e.message}`);
        }
    }

    // --- Receiver Logic ---

    async function startReceiver() {
        const videoElem = document.getElementById('camera-feed');
        if (!videoElem) return;
        
        receiverChunks.clear();
        receiverMetadata = null;
        isReceiving = true;
        
        updateReceiverUI();

        if (typeof QrScanner === 'undefined') {
            logDebug("Receiver failed: QrScanner library not loaded");
            return;
        }

        qrScanner = new QrScanner(
            videoElem,
            result => handleScan(result.data),
            {
                highlightScanRegion: true,
                maxScansPerSecond: 60
            }
        );

        try {
            await qrScanner.start();
            document.getElementById('no-camera').classList.add('hidden');
            logDebug("Camera started");
        } catch (e) {
            document.getElementById('no-camera').classList.remove('hidden');
            logDebug(`Camera error: ${e.message}`);
        }
    }

    function stopReceiver() {
        isReceiving = false;
        if (qrScanner) {
            qrScanner.stop();
            qrScanner.destroy();
            qrScanner = null;
        }
    }

    function handleScan(data) {
        if (!data || !isReceiving) return;

        if (data.startsWith('S|')) {
            const [_, name, size, total, type] = data.split('|');
            if (!receiverMetadata) {
                receiverMetadata = { name, size: parseInt(size), total: parseInt(total), type };
                document.getElementById('receive-file-info').textContent = `${name} (${(size / 1024).toFixed(1)} KB)`;
                document.getElementById('receive-status').textContent = 'Receiving';
                document.getElementById('receive-status').className = 'px-3 py-1 bg-indigo-600 text-white rounded-full text-xs uppercase tracking-widest font-bold';
                initChunkGrid(parseInt(total));
                logDebug(`Sync started: ${name}`);
            }
        } else if (data.startsWith('D|')) {
            const parts = data.split('|');
            if (parts.length < 3) return;
            
            const index = parseInt(parts[1]);
            const b64Data = parts[2];
            
            if (!receiverChunks.has(index)) {
                receiverChunks.set(index, base64ToBytes(b64Data));
                updateReceiverProgress();
                markChunkReceived(index);
                
                if (receiverMetadata && receiverChunks.size === receiverMetadata.total) {
                    checkCompletion();
                }
            }
        } else if (data.startsWith('E|')) {
            if (receiverMetadata && receiverChunks.size === receiverMetadata.total) {
                checkCompletion();
            }
        }
    }

    function initChunkGrid(total) {
        const grid = document.getElementById('chunk-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const count = Math.min(total, 1000);
        for (let i = 0; i < count; i++) {
            const dot = document.createElement('div');
            dot.id = `chunk-${i}`;
            dot.className = 'w-1.5 h-1.5 bg-zinc-800 rounded-full';
            grid.appendChild(dot);
        }
    }

    function markChunkReceived(index) {
        const dot = document.getElementById(`chunk-${index}`);
        if (dot) dot.className = 'w-1.5 h-1.5 bg-indigo-500 rounded-full';
    }

    function updateReceiverProgress() {
        if (!receiverMetadata) return;
        const pct = (receiverChunks.size / receiverMetadata.total) * 100;
        document.getElementById('receive-progress-pct').textContent = `${Math.round(pct)}%`;
        document.getElementById('receive-progress-bar').style.width = `${pct}%`;
    }

    function checkCompletion() {
        if (!receiverMetadata || receiverChunks.size < receiverMetadata.total) return;
        
        isReceiving = false;
        document.getElementById('receive-status').textContent = 'Done';
        document.getElementById('receive-status').className = 'px-3 py-1 bg-emerald-600 text-white rounded-full text-xs uppercase tracking-widest font-bold';
        document.getElementById('receive-actions').classList.remove('hidden');
        document.getElementById('final-file-info').textContent = `${receiverMetadata.name} • ${(receiverMetadata.size / 1024).toFixed(1)} KB`;
        
        if (qrScanner) qrScanner.stop();
        logDebug("Transfer complete");
    }

    buttons.download.onclick = () => {
        const sortedChunks = [];
        for (let i = 0; i < receiverMetadata.total; i++) {
            sortedChunks.push(receiverChunks.get(i));
        }
        
        const blob = new Blob(sortedChunks, { type: receiverMetadata.type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = receiverMetadata.name;
        a.click();
        URL.revokeObjectURL(url);
    };

    function updateReceiverUI() {
        document.getElementById('receive-actions').classList.add('hidden');
        document.getElementById('receive-progress-bar').style.width = '0%';
        document.getElementById('receive-progress-pct').textContent = '0%';
        document.getElementById('receive-status').textContent = 'Waiting';
        document.getElementById('receive-status').className = 'px-3 py-1 bg-zinc-900 text-zinc-500 rounded-full text-xs uppercase tracking-widest font-bold';
        document.getElementById('chunk-grid').innerHTML = '';
        document.getElementById('receive-file-info').textContent = 'Unknown file';
    }
};

// --- Global Helpers ---

function logDebug(msg) {
    console.log("[QR-SYNC]", msg);
    // Visual debug removed as per user request
}

function checkLibrary() {
    const lib = window.qrcodegen || (typeof qrcodegen !== 'undefined' ? qrcodegen : null);
    if (!lib || !lib.QrCode) return null;
    return lib.QrCode;
}

function base64ToBytes(base64) {
    const binString = atob(base64);
    const len = binString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
}

function bytesToBase64(bytes) {
    let binString = "";
    for (let i = 0; i < bytes.length; i++) {
        binString += String.fromCharCode(bytes[i]);
    }
    return btoa(binString);
}
