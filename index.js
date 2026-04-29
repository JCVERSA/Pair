const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Store active connections
const sessions = new Map();

// Clean up old sessions
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
        if (now - session.timestamp > 300000) { // 5 minutes
            if (session.sock) session.sock.end();
            sessions.delete(id);
            const sessionPath = `./sessions/${id}`;
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        }
    }
}, 60000);

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.post('/get-code', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.json({ success: false, message: 'Phone number is required' });
        }

        // Remove all non-numeric characters
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        
        if (cleanNumber.length < 10) {
            return res.json({ success: false, message: 'Invalid phone number' });
        }

        const sessionId = `session_${Date.now()}`;
        const sessionPath = `./sessions/${sessionId}`;

        if (!fs.existsSync('./sessions')) {
            fs.mkdirSync('./sessions');
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['Chrome (Linux)', '', '']
        });

        sock.ev.on('creds.update', saveCreds);

        // Request pairing code
        const code = await sock.requestPairingCode(cleanNumber);
        
        sessions.set(sessionId, {
            sock,
            timestamp: Date.now()
        });

        // Format code as XXX-XXX
        const formattedCode = code.match(/.{1,4}/g)?.join('-') || code;

        res.json({ 
            success: true, 
            code: formattedCode,
            message: 'Enter this code in WhatsApp > Linked Devices > Link a Device > Link with phone number instead'
        });

        // Handle connection
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                console.log(`✅ Session ${sessionId} connected`);
            }
            
            if (connection === 'close') {
                console.log(`❌ Session ${sessionId} closed`);
                sessions.delete(sessionId);
                if (fs.existsSync(sessionPath)) {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                }
            }
        });

    } catch (error) {
        console.error('Error:', error);
        res.json({ 
            success: false, 
            message: 'Error generating pairing code. Please try again.' 
        });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Visit: http://localhost:${PORT}`);
});
