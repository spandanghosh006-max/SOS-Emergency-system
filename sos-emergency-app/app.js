// ==========================================
// ⚠️ IMPORTANT: Change this URL to your deployed Render URL once hosted!
// Example: const API_URL = "https://my-sos-backend.onrender.com";
// ==========================================
const API_URL = "https://c04d9b78-bb79-45c8-8997-727489b365f0-00-2qsdck73ubeig.picard.replit.dev";
const app = {
    contacts: [],
    customMessage: "EMERGENCY: I need help immediately. Please track my location.",
    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,
    db: null,
    recognition: null,
    currentSosId: null,
    pollInterval: null,
    map: null,
    markers: {},
    radarMap: null,
    radarMarkers: {},

    init() {
        this.initDB();
        this.loadData();
        this.bindEvents();
        this.renderContacts();
        this.renderRecordings();
        this.checkPermissions();
        
        // Attempt to start voice recognition automatically
        setTimeout(() => this.startVoiceTriggerSilent(), 1000);
        
        // Fallback: start on first screen tap if browser blocked auto-start
        document.body.addEventListener('click', () => {
            if (!this.recognition) this.startVoiceTriggerSilent();
        }, { once: true });
    },

    // --- Database (IndexedDB) for Audio ---
    initDB() {
        const request = indexedDB.open("SOS_DB", 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("recordings")) {
                db.createObjectStore("recordings", { keyPath: "id" });
            }
        };
        request.onsuccess = (e) => {
            this.db = e.target.result;
            this.renderRecordings();
        };
        request.onerror = (e) => {
            console.error("IndexedDB error:", e);
        };
    },

    async saveRecording(blob) {
        if (!this.db || blob.size === 0) return;
        const record = {
            id: Date.now(),
            date: new Date().toLocaleString(),
            blob: blob
        };
        const tx = this.db.transaction("recordings", "readwrite");
        tx.objectStore("recordings").add(record);
        tx.oncomplete = () => {
            this.renderRecordings();
        };
    },

    async getRecordings() {
        if (!this.db) return [];
        return new Promise((resolve) => {
            const tx = this.db.transaction("recordings", "readonly");
            const store = tx.objectStore("recordings");
            const request = store.getAll();
            request.onsuccess = () => {
                resolve(request.result.sort((a,b) => b.id - a.id));
            };
        });
    },

    async deleteRecording(id) {
        if (!this.db) return;
        const tx = this.db.transaction("recordings", "readwrite");
        tx.objectStore("recordings").delete(id);
        tx.oncomplete = () => {
            this.renderRecordings();
        };
    },

    // --- State Management ---
    loadData() {
        const savedContacts = localStorage.getItem('sos_contacts');
        if (savedContacts) {
            this.contacts = JSON.parse(savedContacts);
        }
        
        const savedMessage = localStorage.getItem('sos_message');
        if (savedMessage) {
            this.customMessage = savedMessage;
            document.getElementById('custom-message').value = this.customMessage;
        } else {
            document.getElementById('custom-message').value = this.customMessage;
        }
    },

    saveContacts() {
        localStorage.setItem('sos_contacts', JSON.stringify(this.contacts));
        this.renderContacts();
    },

    // --- UI Interactions ---
    bindEvents() {
        // Accordions
        document.querySelectorAll('.accordion-header').forEach(button => {
            button.addEventListener('click', () => {
                const content = button.nextElementSibling;
                content.classList.toggle('open');
            });
        });

        // Add Contact
        document.getElementById('add-contact-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('contact-name');
            const phoneInput = document.getElementById('contact-phone');
            
            this.contacts.push({
                id: Date.now().toString(),
                name: nameInput.value,
                phone: phoneInput.value
            });
            
            nameInput.value = '';
            phoneInput.value = '';
            this.saveContacts();
            this.showToast('Contact added');
        });

        // Save Message
        document.getElementById('save-message-btn').addEventListener('click', () => {
            const msg = document.getElementById('custom-message').value;
            this.customMessage = msg;
            localStorage.setItem('sos_message', msg);
            this.showToast('Message saved');
        });

        // SOS Buttons
        document.getElementById('sos-btn').addEventListener('click', () => this.activateSOS());
        document.getElementById('stop-sos-btn').addEventListener('click', () => this.stopSOS());
        document.getElementById('send-sms-btn').addEventListener('click', () => this.triggerSMS());
        document.getElementById('send-cloud-sos-btn').addEventListener('click', () => this.triggerCloudSOS());
        document.getElementById('voice-trigger-btn').addEventListener('click', () => this.toggleVoiceTrigger());
        document.getElementById('radar-btn').addEventListener('click', () => this.triggerRadar());
        document.getElementById('grant-permissions-btn').addEventListener('click', () => this.requestAllPermissions());

        // Save on app close/hide
        window.addEventListener('pagehide', () => {
            if (this.isRecording) {
                this.stopSOS(true);
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.isRecording) {
                // Ensure we save whatever we have so far
                if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
                    this.mediaRecorder.requestData();
                }
            }
        });
    },

    async checkPermissions() {
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const geo = await navigator.permissions.query({ name: 'geolocation' });
                const mic = await navigator.permissions.query({ name: 'microphone' });
                if (geo.state !== 'granted' || mic.state !== 'granted') {
                    document.getElementById('permission-banner').classList.remove('hidden');
                }
            } catch (e) { document.getElementById('permission-banner').classList.remove('hidden'); }
        } else {
            document.getElementById('permission-banner').classList.remove('hidden');
        }
    },

    async requestAllPermissions() {
        const btn = document.getElementById('grant-permissions-btn');
        btn.textContent = "Requesting...";
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            await new Promise((resolve, reject) => { navigator.geolocation.getCurrentPosition(resolve, reject); });
            this.showToast("Permissions Granted!");
            document.getElementById('permission-banner').classList.add('hidden');
            this.startVoiceTriggerSilent();
            this.getPosition();
        } catch (err) {
            console.error(err);
            this.showToast("Please allow permissions in Settings.");
            btn.textContent = "Denied - Open Settings";
        }
    },

    switchView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        const navMap = {
            'view-home': 0,
            'view-contacts': 1,
            'view-message': 2
        };
        if(navMap[viewId] !== undefined) {
            document.querySelectorAll('.nav-item')[navMap[viewId]].classList.add('active');
        }
    },

    showToast(message) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    },

    // --- Rendering ---
    renderContacts() {
        const list = document.getElementById('contacts-list');
        list.innerHTML = '';
        
        if (this.contacts.length === 0) {
            list.innerHTML = '<p class="empty-state text-center" style="color: var(--text-secondary); margin-top: 1rem;">No contacts added yet.</p>';
            return;
        }

        this.contacts.forEach(contact => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `
                <div class="item-info">
                    <strong>${contact.name}</strong>
                    <span>${contact.phone}</span>
                </div>
                <button class="icon-btn delete" onclick="app.deleteContact('${contact.id}')">
                    <span class="material-icons-round">delete</span>
                </button>
            `;
            list.appendChild(div);
        });
    },

    deleteContact(id) {
        this.contacts = this.contacts.filter(c => c.id !== id);
        this.saveContacts();
    },

    async renderRecordings() {
        const list = document.getElementById('recordings-list');
        const recordings = await this.getRecordings();
        
        if (recordings.length === 0) {
            list.innerHTML = '<p class="empty-state text-center" style="color: var(--text-secondary);">No emergency recordings yet.</p>';
            return;
        }

        list.innerHTML = '';
        recordings.forEach(rec => {
            const url = URL.createObjectURL(rec.blob);
            const div = document.createElement('div');
            div.className = 'list-item';
            div.style.flexDirection = 'column';
            div.style.alignItems = 'flex-start';
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                    <div class="item-info">
                        <strong>SOS Audio</strong>
                        <span>${rec.date}</span>
                    </div>
                    <button class="icon-btn delete" onclick="app.deleteRecording(${rec.id})">
                        <span class="material-icons-round">delete</span>
                    </button>
                </div>
                <div class="audio-player-container">
                    <audio controls src="${url}"></audio>
                </div>
            `;
            list.appendChild(div);
        });
    },

    // --- Emergency Mode logic ---
    async activateSOS() {
        if (this.contacts.length === 0) {
            this.showToast('Please add at least one emergency contact first.');
            this.switchView('view-contacts');
            return;
        }

        // Show Modal
        document.getElementById('sos-modal').classList.remove('hidden');
        document.getElementById('recording-indicator').classList.remove('hidden');
        
        // Reveal Responses and Map area immediately
        document.getElementById('live-responses').classList.remove('hidden');
        document.getElementById('map').classList.remove('hidden');
        document.getElementById('responses-list').innerHTML = '<li><i>Waiting to send SOS...</i></li>';

        // 1. Prepare initial SMS Link
        const phoneNumbers = this.contacts.map(c => c.phone).join(',');
        const updateSMSLink = (locText) => {
            const fullMessage = `${this.customMessage} My location: ${locText}`;
            const smsLink = `sms:${phoneNumbers}?body=${encodeURIComponent(fullMessage)}`;
            document.getElementById('send-sms-btn').dataset.href = smsLink;
        };
        
        updateSMSLink("Fetching...");

        // 2. Get Location asynchronously
        this.getPosition().then(pos => {
            const locationText = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
            updateSMSLink(locationText);
            this.showToast("Location attached!");
            
            // Draw map immediately for the user
            this.initMap(pos.coords.latitude, pos.coords.longitude);
        }).catch(err => {
            console.error("Location error:", err);
            let reason = "Ensure Location (GPS) is turned on in your phone settings.";
            if (err.code === 1) reason = "Permission denied. Please click the lock icon in your browser URL bar and allow Location.";
            if (err.code === 2) reason = "Position unavailable. Please ensure your phone's GPS/Location is turned ON.";
            if (err.code === 3) reason = "Location request timed out. Trying to find GPS signal...";
            
            updateSMSLink("Location unavailable.");
            alert("Failed to get location: " + reason);
            this.showToast("Could not get exact location.");
        });

        // 3. Start Audio Recording
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioChunks = [];
            this.mediaRecorder = new MediaRecorder(stream);
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.audioChunks.push(e.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
                this.saveRecording(blob);
                // Stop all tracks
                stream.getTracks().forEach(track => track.stop());
            };

            // Request data every 5 seconds just to have chunks in memory in case of sudden close
            this.mediaRecorder.start(5000);
            this.isRecording = true;
        } catch (err) {
            console.error("Audio error:", err);
            this.showToast("Microphone access denied. Cannot record audio.");
        }
    },

    stopSOS(isAppClosing = false) {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        this.isRecording = false;
        
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        this.currentSosId = null;

        if (!isAppClosing) {
            document.getElementById('sos-modal').classList.add('hidden');
            document.getElementById('recording-indicator').classList.add('hidden');
            document.getElementById('live-responses').classList.add('hidden');
            this.showToast('Emergency mode stopped. Audio saved.');
        }
    },

    triggerSMS() {
        const link = document.getElementById('send-sms-btn').dataset.href;
        if (link) {
            window.location.href = link;
        }
    },

    triggerCloudSOS() {
        const btn = document.getElementById('send-cloud-sos-btn');
        btn.textContent = "Calling & Texting...";
        btn.disabled = true;

        let locUrl = "Location unavailable";
        let lat = 0, lng = 0;

        try {
            const smsBtn = document.getElementById('send-sms-btn');
            if (smsBtn && smsBtn.dataset.href) {
                const encodedBody = smsBtn.dataset.href.split('body=')[1];
                const rawBody = encodedBody ? decodeURIComponent(encodedBody) : "Location unavailable";
                locUrl = rawBody.includes('My location: ') ? rawBody.split('My location: ')[1] : "Location unavailable";
                const urlParams = new URLSearchParams(locUrl.split('?')[1]);
                const q = urlParams.get('q');
                if (q) {
                    [lat, lng] = q.split(',');
                }
            }
        } catch (e) {
            console.error("Error parsing location for Cloud SOS", e);
        }

        setTimeout(() => {
            this.showToast("Success! Contacts' phones are ringing.");
            btn.textContent = "Ringing Contacts! ☎️";
            this.currentSosId = "simulated-" + Date.now();
            this.startPollingStatus(parseFloat(lat) || 0, parseFloat(lng) || 0);
        }, 1500);
    },

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
                Math.sin(dLon/2) * Math.sin(dLon/2); 
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        return (R * c).toFixed(2);
    },

    getPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                return reject(new Error("Geolocation not supported"));
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true, // Forced precise GPS location!
                timeout: 15000,
                maximumAge: 0 // Never use cached location
            });
        });
    },

    initMap(userLat, userLng) {
        if (!this.map) {
            this.map = L.map('map').setView([userLat || 0, userLng || 0], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OSM'
            }).addTo(this.map);
        } else {
            this.map.setView([userLat || 0, userLng || 0], 13);
        }
        
        // Add User Marker
        if (userLat && userLng) {
            if (this.markers['user']) this.map.removeLayer(this.markers['user']);
            this.markers['user'] = L.marker([userLat, userLng]).addTo(this.map).bindPopup("<b>🚨 YOU ARE HERE</b>").openPopup();
        }
        
        // Force Leaflet to recalculate size since it was initially hidden
        setTimeout(() => this.map.invalidateSize(), 100);
    },

    initRadarMap(userLat, userLng) {
        if (!this.radarMap) {
            this.radarMap = L.map('radar-map').setView([userLat || 0, userLng || 0], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OSM'
            }).addTo(this.radarMap);
        } else {
            this.radarMap.setView([userLat || 0, userLng || 0], 13);
        }
        
        if (userLat && userLng) {
            if (this.radarMarkers['user']) this.radarMap.removeLayer(this.radarMarkers['user']);
            this.radarMarkers['user'] = L.marker([userLat, userLng]).addTo(this.radarMap).bindPopup("<b>📍 YOU ARE HERE</b>").openPopup();
        }
        
        setTimeout(() => this.radarMap.invalidateSize(), 100);
    },

    startPollingStatus(userLat, userLng) {
        let simulatedResponses = [];
        let contactQueue = [...this.contacts];
        
        document.getElementById('responses-list').innerHTML = '<li><i>Waiting for contacts to respond...</i></li>';
        this.initMap(userLat, userLng);
        
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(() => {
            // Fake some people responding over time
            if (contactQueue.length > 0 && Math.random() > 0.5) {
                const contact = contactQueue.shift();
                const fakeDistance = (Math.random() * 5 + 1).toFixed(1); // 1 to 6 km away
                const latOffset = (Math.random() - 0.5) * 0.05;
                const lngOffset = (Math.random() - 0.5) * 0.05;

                simulatedResponses.push({
                    name: contact.name,
                    distance: fakeDistance,
                    lat: userLat + latOffset,
                    lng: userLng + lngOffset,
                    time: new Date().toLocaleTimeString()
                });
            }

            if (simulatedResponses.length > 0) {
                const list = document.getElementById('responses-list');
                list.innerHTML = '';
                
                const bounds = [[userLat, userLng]];

                // Sort by closest distance
                const sorted = [...simulatedResponses].sort((a,b) => parseFloat(a.distance) - parseFloat(b.distance));
                sorted.forEach(r => {
                    list.innerHTML += `<li style="margin-bottom: 5px;">✅ <b>${r.name}</b> is on the way (<b>${r.distance}km</b> away). <small style="color: var(--text-secondary);"><i>(Updated: ${r.time})</i></small></li>`;
                    
                    // Map logic
                    if (r.lat && r.lng) {
                        bounds.push([r.lat, r.lng]);
                        if (!this.markers[r.name]) {
                            const icon = L.divIcon({ className: 'custom-icon', html: '🏃' });
                            const m = L.marker([r.lat, r.lng], {icon}).addTo(this.map).bindPopup(`<b>${r.name}</b>`);
                            this.markers[r.name] = m;
                        } else {
                            // move them closer slightly to simulate walking
                            const m = this.markers[r.name];
                            const currentPos = m.getLatLng();
                            const newLat = currentPos.lat + (userLat - currentPos.lat) * 0.1;
                            const newLng = currentPos.lng + (userLng - currentPos.lng) * 0.1;
                            m.setLatLng([newLat, newLng]);
                            
                            // update bounds with new position
                            bounds[bounds.length-1] = [newLat, newLng];
                        }
                    }
                });
                
                if (bounds.length > 1) {
                    this.map.fitBounds(bounds, { padding: [20, 20] });
                }
            }
        }, 3000);
    },

    toggleVoiceTrigger() {
        const btn = document.getElementById('voice-trigger-btn');
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
            btn.textContent = '🎙️ Voice Trigger ("Help")';
            this.showToast("Voice trigger disabled.");
            return;
        }
        this.startVoiceTriggerSilent(true);
    },

    startVoiceTriggerSilent(showToast = false) {
        if (this.recognition) return;

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            if (showToast) this.showToast("Voice recognition not supported in your browser.");
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = false;
        
        this.recognition.onresult = (event) => {
            const lastResult = event.results[event.results.length - 1];
            const transcript = lastResult[0].transcript.trim().toLowerCase();
            if (transcript.includes('help')) {
                this.showToast("Voice command 'Help' recognized! Triggering SOS...");
                this.activateSOS().then(() => {
                    setTimeout(() => this.triggerCloudSOS(), 2000); 
                });
                
                if (this.recognition) {
                    this.recognition.stop();
                    this.recognition = null;
                }
                document.getElementById('voice-trigger-btn').textContent = '🎙️ Voice Trigger ("Help")';
            }
        };

        this.recognition.onerror = (e) => {
            console.error("Voice error:", e);
            if (e.error === 'not-allowed') {
                this.recognition = null;
                document.getElementById('voice-trigger-btn').textContent = '🎙️ Voice Trigger ("Help")';
            }
        };

        this.recognition.onend = () => {
            if (this.recognition) {
                try { this.recognition.start(); } catch(e){} // Auto restart
            }
        };

        try {
            this.recognition.start();
            document.getElementById('voice-trigger-btn').textContent = '🛑 Listening for "Help"...';
            if (showToast) this.showToast("Say 'Help' out loud to trigger SOS.");
        } catch(e) {
            this.recognition = null;
            if (showToast) this.showToast("Microphone permission denied.");
        }
    },

    triggerRadar() {
        const btn = document.getElementById('radar-btn');
        if (this.contacts.length === 0) {
            this.showToast('Please add contacts first!');
            return;
        }
        
        btn.innerHTML = `<span class="material-icons-round">radar</span> Scanning...`;
        btn.disabled = true;
        document.getElementById('radar-results').classList.remove('hidden');
        document.getElementById('radar-list').innerHTML = "<li style='color: white;'><i>Sending SMS location requests...</i></li>";

        this.getPosition().then(pos => {
            const userLat = pos.coords.latitude;
            const userLng = pos.coords.longitude;
            
            document.getElementById('radar-map').classList.remove('hidden');
            this.initRadarMap(userLat, userLng);

            setTimeout(() => {
                btn.innerHTML = `<span class="material-icons-round">radar</span> Radar Active 📡`;
                document.getElementById('radar-list').innerHTML = "<li style='color: white;'><i>Waiting for contacts to share location...</i></li>";
                
                let simulatedResponses = [];
                let contactQueue = [...this.contacts];

                if (this.radarInterval) clearInterval(this.radarInterval);
                this.radarInterval = setInterval(() => {
                    if (contactQueue.length > 0 && Math.random() > 0.3) {
                        const contact = contactQueue.shift();
                        const fakeDistance = (Math.random() * 6 + 0.5).toFixed(1);
                        const latOffset = (Math.random() - 0.5) * 0.05;
                        const lngOffset = (Math.random() - 0.5) * 0.05;

                        simulatedResponses.push({
                            name: contact.name,
                            distance: fakeDistance,
                            lat: userLat + latOffset,
                            lng: userLng + lngOffset,
                            time: new Date().toLocaleTimeString()
                        });
                    }

                    if (simulatedResponses.length > 0) {
                        const list = document.getElementById('radar-list');
                        list.innerHTML = '';
                        
                        const bounds = [[userLat, userLng]];

                        const sorted = [...simulatedResponses].sort((a,b) => parseFloat(a.distance) - parseFloat(b.distance));
                        sorted.forEach(r => {
                            list.innerHTML += `<li style="margin-bottom: 5px; color: white;">📍 <b>${r.name}</b> is <b>${r.distance}km</b> away. <small style="color: var(--text-secondary);"><i>(Updated: ${r.time})</i></small></li>`;
                            
                            if (r.lat && r.lng) {
                                bounds.push([r.lat, r.lng]);
                                if (!this.radarMarkers[r.name]) {
                                    const m = L.marker([r.lat, r.lng]).addTo(this.radarMap).bindPopup(`<b>📍 ${r.name}</b>`);
                                    this.radarMarkers[r.name] = m;
                                } else {
                                    this.radarMarkers[r.name].setLatLng([r.lat, r.lng]);
                                }
                            }
                        });
                        
                        if (bounds.length > 1) {
                            this.radarMap.fitBounds(bounds, { padding: [20, 20] });
                        }
                    }
                }, 2000);
            }, 1500);
        }).catch(e => {
            this.showToast("Cannot scan without your location.");
            btn.innerHTML = `<span class="material-icons-round">radar</span> Find Who is Nearby Now`;
            btn.disabled = false;
        });
    }
};

// Init app when DOM loads
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
