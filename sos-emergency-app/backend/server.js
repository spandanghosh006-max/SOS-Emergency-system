require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store for SOS sessions and Radar sessions
const activeSessions = {};
const activeRadars = {};

// Helper: Calculate Haversine distance in km
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  var R = 6371; // Radius of the earth in km
  var dLat = deg2rad(lat2-lat1);
  var dLon = deg2rad(lon2-lon1); 
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
          Math.sin(dLon/2) * Math.sin(dLon/2); 
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
}
function deg2rad(deg) { return deg * (Math.PI/180) }

// ==========================================
// 🚨 SOS EMERGENCY MODE ROUTES
// ==========================================

app.post('/api/sos', async (req, res) => {
    const { lat, lng } = req.body;
    const sosId = Math.random().toString(36).substring(2, 10);
    activeSessions[sosId] = { lat, lng, responses: [] };
    
    // Automatically determine the public URL
    const serverUrl = process.env.PUBLIC_URL || `https://${req.get('host')}`; 

    res.json({ success: true, sosId, serverUrl, message: 'SOS tracking session created!' });
});

app.get('/api/sos/status/:id', (req, res) => {
    const session = activeSessions[req.params.id];
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json({ responses: session.responses });
});

app.get('/respond/:id', (req, res) => {
    const sosId = req.params.id;
    const contactName = req.query.name || "Friend";
    if (!activeSessions[sosId]) return res.send("<h1 style='color:white;text-align:center;font-family:sans-serif;'>SOS Session Ended or Invalid.</h1>");

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Emergency Response</title>
        <style>
            body { font-family: sans-serif; text-align: center; padding: 20px; background: #0f172a; color: white; }
            button { background: #ef4444; color: white; padding: 15px 30px; font-size: 18px; border: none; border-radius: 10px; cursor: pointer; margin-top: 20px; font-weight: bold; width: 100%;}
            button:active { opacity: 0.8; }
            #status { margin-top: 15px; color: #10b981; font-weight: bold; }
        </style>
    </head>
    <body>
        <h2>🚨 EMERGENCY SOS 🚨</h2>
        <p>Hi <b>${contactName}</b>, Spandan has triggered a critical SOS alert and needs help.</p>
        <button id="help-btn">I AM ON MY WAY</button>
        <p id="status"></p>
        <script>
            document.getElementById('help-btn').onclick = function() {
                const status = document.getElementById('status');
                status.innerText = "Locating you to calculate distance...";
                navigator.geolocation.getCurrentPosition(pos => {
                    fetch('/api/respond/${sosId}', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: "${contactName}", lat: pos.coords.latitude, lng: pos.coords.longitude })
                    }).then(() => {
                        status.innerText = "✅ Response sent! Spandan has been notified you are coming. Please hurry.";
                        document.getElementById('help-btn').style.display = 'none';
                    });
                }, err => { status.innerText = "Location permission denied. Cannot calculate distance."; }, { enableHighAccuracy: false });
            };
        </script>
    </body>
    </html>`;
    res.send(html);
});

app.post('/api/respond/:id', (req, res) => {
    const sosId = req.params.id;
    const session = activeSessions[sosId];
    if (!session) return res.status(404).send('Not found');

    const { name, lat, lng } = req.body;
    let distance = getDistanceFromLatLonInKm(session.lat, session.lng, lat, lng).toFixed(1);
    
    session.responses.push({ name, distance, time: new Date().toLocaleTimeString(), lat, lng });
    res.json({ success: true });
});


// ==========================================
// 📍 CONTACT RADAR ROUTES (Non-Emergency)
// ==========================================

app.post('/api/radar/request', async (req, res) => {
    const { lat, lng } = req.body;
    const radarId = Math.random().toString(36).substring(2, 10);
    activeRadars[radarId] = { lat, lng, responses: [] };
    
    // Automatically determine the public URL
    const serverUrl = process.env.PUBLIC_URL || `https://${req.get('host')}`; 

    res.json({ success: true, radarId, serverUrl, message: 'Radar session created!' });
});

app.get('/api/radar/status/:id', (req, res) => {
    const session = activeRadars[req.params.id];
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.json({ responses: session.responses });
});

app.get('/radar/:id', (req, res) => {
    const radarId = req.params.id;
    const contactName = req.query.name || "Friend";
    if (!activeRadars[radarId]) return res.send("<h1 style='color:white;text-align:center;font-family:sans-serif;'>Radar Session Ended.</h1>");

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Location Radar</title>
        <style>
            body { font-family: sans-serif; text-align: center; padding: 20px; background: #0f172a; color: white; }
            button { background: #8b5cf6; color: white; padding: 15px 30px; font-size: 18px; border: none; border-radius: 10px; cursor: pointer; margin-top: 20px; width: 100%; font-weight: bold;}
            #status { margin-top: 15px; color: #10b981; font-weight: bold; }
        </style>
    </head>
    <body>
        <h2>📍 SOS Contact Radar</h2>
        <p>Hi <b>${contactName}</b>, Spandan is currently checking who is nearby.</p>
        <button id="share-btn">SHARE MY LOCATION</button>
        <p id="status"></p>
        <script>
            document.getElementById('share-btn').onclick = function() {
                const status = document.getElementById('status');
                status.innerText = "Getting location...";
                navigator.geolocation.getCurrentPosition(pos => {
                    fetch('/api/radar/${radarId}', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: "${contactName}", lat: pos.coords.latitude, lng: pos.coords.longitude })
                    }).then(() => {
                        status.innerText = "✅ Location shared successfully! You can close this page.";
                        document.getElementById('share-btn').style.display = 'none';
                    });
                }, err => { status.innerText = "Permission denied."; }, { enableHighAccuracy: false });
            };
        </script>
    </body>
    </html>`;
    res.send(html);
});

app.post('/api/radar/:id', (req, res) => {
    const radarId = req.params.id;
    const session = activeRadars[radarId];
    if (!session) return res.status(404).send('Not found');

    const { name, lat, lng } = req.body;
    let distance = getDistanceFromLatLonInKm(session.lat, session.lng, lat, lng).toFixed(1);
    
    // Update or add
    const existing = session.responses.find(r => r.name === name);
    if (existing) {
        existing.distance = distance;
        existing.lat = lat;
        existing.lng = lng;
        existing.time = new Date().toLocaleTimeString();
    } else {
        session.responses.push({ name, distance, time: new Date().toLocaleTimeString(), lat, lng });
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚨 SOS Backend running on port ${PORT}`);
    console.log(`=========================================`);
});
