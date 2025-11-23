
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Setup & Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const sessionsFile = path.join(dataDir, 'sessions.json');

const app = express();

const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.RAILWAY_STATIC_URL;
const port = isProduction ? (process.env.PORT || 4001) : 4001;

// --- Middleware ---
app.use(cors()); 
app.use(bodyParser.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// --- In-Memory Storage ---
const sessions = new Map();

// --- Persistence Helpers ---
const ensureDataDir = async () => {
    try {
        await fs.access(dataDir);
    } catch {
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (e) { /* Ignore */ }
    }
};

const loadSessions = async () => {
  try {
    await ensureDataDir();
    const raw = await fs.readFile(sessionsFile, 'utf-8').catch(() => '');
    if (raw) {
      const obj = JSON.parse(raw);
      Object.entries(obj).forEach(([k, v]) => sessions.set(k, v));
      console.log(`Loaded ${sessions.size} sessions from disk.`);
    }
  } catch (e) { /* Ignore */ }
};

const saveSessions = async () => {
  try {
    const obj = Object.fromEntries(sessions.entries());
    await fs.writeFile(sessionsFile, JSON.stringify(obj, null, 2));
  } catch (e) { /* Ignore */ }
};

// --- Helper: Get Base URL by Region ---
const getBaseUrl = (region) => {
    const r = (region || 'EU').toUpperCase();
    switch (r) {
        case 'US': return 'https://api-us.libreview.io';
        case 'AE': return 'https://api-ae.libreview.io';
        case 'JP': return 'https://api-jp.libreview.io';
        case 'AP': return 'https://api-ap.libreview.io';
        case 'EU': 
        default: return 'https://api-eu.libreview.io';
    }
};

// --- CRITICAL FIX: Retry Logic & Increased Timeout ---
// Mobile networks can be flaky. Retry the request if it fails.
const axiosWithRetry = async (config, retries = 3) => {
    try {
        return await axios(config);
    } catch (error) {
        const isTimeout = error.code === 'ECONNABORTED' || error.message.includes('timeout');
        const isServerErr = error.response?.status >= 500;
        
        if (retries > 0 && (isTimeout || isServerErr)) {
            console.log(`⚠️ Request failed (${isTimeout ? 'Timeout' : 'Error ' + error.response?.status}). Retrying... (${retries} attempts left)`);
            // Exponential backoff: 1s, 2s, 4s
            const delay = (4 - retries) * 1000; 
            await new Promise(resolve => setTimeout(resolve, delay));
            return axiosWithRetry(config, retries - 1);
        }
        throw error;
    }
};


// --- Routes ---

app.get('/', (req, res) => {
    res.send('Backend OK');
});

// 1. Connect / Login
app.post('/api/libre/connect', async (req, res) => {
  console.log("--- Login Attempt ---");
  try {
    const { email, password, region } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre gereklidir.' });

    const clientVersion = (req.body && req.body.clientVersion) ? String(req.body.clientVersion) : '4.16.0';
    const baseURL = getBaseUrl(region);
    
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'product': 'llu.android',
      'version': clientVersion,
      'accept-language': 'tr-TR',
      'Cache-Control': 'no-cache',
      'User-Agent': 'LibreLinkUp/4.16.0 (com.abbott.librelinkup)'
    };

    // Timeout increased to 60s to handle slow mobile networks
    const loginResp = await axiosWithRetry({
        method: 'post',
        url: `${baseURL}/llu/auth/login`,
        data: { email, password },
        headers,
        timeout: 60000 
    });
    
    if (!loginResp.data || (loginResp.data.status !== 0 && !loginResp.data.data?.authTicket?.token)) {
        return res.status(403).json({ error: 'Giriş başarısız. Bilgileri kontrol edin.' });
    }

    const token = loginResp.data.data?.authTicket?.token;
    const userId = loginResp.data.data?.user?.id;

    if (!token || !userId) {
        return res.status(403).json({ error: 'Token alınamadı.' });
    }

    const accountId = createHash('sha256').update(String(userId)).digest('hex');
    const sessionId = uuidv4();
    
    sessions.set(sessionId, { 
        token, 
        clientVersion, 
        userId, 
        accountId,
        region: region || 'EU',
        baseURL 
    });
    await saveSessions();
    
    console.log(`Login Success: ${email.substring(0,3)}***`);
    res.json({ success: true, sessionId });

  } catch (err) {
    console.error('Login Error:', err.message);
    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
        return res.status(504).json({ error: 'Libre sunucusuna ulaşılamadı (Zaman Aşımı).' });
    }
    if (err.response) {
        const msg = err.response.data?.error?.message || 'Giriş hatası.';
        return res.status(err.response.status).json({ error: msg });
    }
    res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// 2. Read Latest Value
app.get('/api/libre/read', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'sessionId missing' });
    
    const session = sessions.get(sessionId);
    if (!session) return res.status(401).json({ error: 'Session not found' });

    const baseURL = session.baseURL || 'https://api-eu.libreview.io';
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'product': 'llu.android',
      'version': session.clientVersion || '4.16.0',
      'Authorization': `Bearer ${session.token}`,
      'Account-Id': session.accountId,
      'accept-language': 'tr-TR',
      'Cache-Control': 'no-cache',
      'User-Agent': 'LibreLinkUp/4.16.0 (com.abbott.librelinkup)'
    };

    // Timeout 60s for reading
    const cons = await axiosWithRetry({
        method: 'get',
        url: `${baseURL}/llu/connections`,
        headers,
        timeout: 60000,
        validateStatus: () => true
    });
    
    if (cons.status === 401) {
        sessions.delete(sessionId);
        return res.status(401).json({ error: 'Token expired' });
    }
    
    const first = Array.isArray(cons.data?.data) ? (cons.data.data.find(c => c.pending === false) || cons.data.data[0]) : null;
    if (!first) return res.status(204).end();

    let reading = null;
    let trendArrow = null;
    let sensorInfo = null;
    
    const gm = first.connection?.glucoseMeasurement || first.glucoseMeasurement;
    if (gm) {
      reading = {
        value: Number(gm.Value ?? gm.value ?? 0),
        timestamp: new Date(gm.Timestamp ?? gm.MeasurementDate ?? Date.now()).toISOString()
      };
      trendArrow = gm.TrendArrow ?? gm.trendArrow;
    }

    if (first.sensor) {
        const activationTimestamp = first.sensor.a; 
        const serial = first.sensor.sn;
        
        // 1: Warmup, 2: Active, 3: Expired, 4: Ended, 5: Error
        const pt = first.sensor.pt;
        let stateStr = 'Bilinmiyor';
        switch (pt) {
            case 1: stateStr = 'Isınıyor'; break;
            case 2: stateStr = 'Aktif'; break;
            case 3: stateStr = 'Süresi Doldu'; break;
            case 4: stateStr = 'Bitti'; break;
            case 5: stateStr = 'Hata'; break;
            default: stateStr = `Durum ${pt}`;
        }

        // Calculate days left
        let daysLeft = 0;
        let startDate = new Date();
        let endDate = new Date();

        if (activationTimestamp) {
            startDate = new Date(activationTimestamp * 1000);
            endDate = new Date(startDate.getTime() + (14 * 24 * 60 * 60 * 1000)); // +14 days
            const now = Date.now();
            daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now) / (1000 * 60 * 60 * 24)));
        }

        sensorInfo = {
            serial: serial,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            daysLeft: daysLeft,
            state: stateStr
        };
    }

    // If reading missing or old, try graph (Retry logic here too)
    const isStale = !reading || (Date.now() - new Date(reading.timestamp).getTime() > 15 * 60 * 1000);
    const isWarmingUp = sensorInfo?.state === 'Isınıyor';

    if (isStale && !isWarmingUp) {
        const hist = await axiosWithRetry({
            method: 'get',
            url: `${baseURL}/llu/connections/${first.patientId}/graph?_t=${Date.now()}`,
            headers,
            timeout: 60000,
            validateStatus: () => true
        });
        const items = hist.data?.data?.graphData || [];
        if (Array.isArray(items) && items.length > 0) {
            items.sort((a, b) => new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime());
            const last = items[0];
            reading = {
                value: Number(last.Value ?? last.value ?? 0),
                timestamp: new Date(last.Timestamp ?? last.MeasurementDate ?? Date.now()).toISOString()
            };
        }
    }

    if (reading) {
        if (trendArrow !== null && trendArrow !== undefined) {
            reading.trendArrow = Number(trendArrow);
        }
        if (sensorInfo) {
            reading.sensor = sensorInfo;
        }
        res.json(reading);
    } else if (sensorInfo) {
        // Return just sensor info (e.g. Warmup)
        res.json({
            value: null,
            timestamp: new Date().toISOString(),
            sensor: sensorInfo
        });
    } else {
        res.status(204).end();
    }

  } catch (err) {
    console.error('Read Error:', err.message);
    res.status(204).end();
  }
});

app.post('/api/libre/disconnect', (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) sessions.delete(sessionId);
  saveSessions();
  res.json({ success: true });
});

app.get('/api/libre.ts', (req, res) => {
  res.type('application/javascript').send('// Dummy libre module to avoid MIME errors.');
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on port ${port}`);
  loadSessions();
});
