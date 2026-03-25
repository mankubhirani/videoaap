const socket = io('/');
const peer = new Peer(undefined, {
  // Use STUN for mobile NAT traversal
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  }
});

let myVideoStream;
let myId;
let myUsername = 'Guest';
let micOn = true;
let camOn = true;
let participantCount = 0;

const peerConnections = {};
const videoGrid = document.getElementById('videoGrid');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const participantEl = document.getElementById('participant-count');

// ── USERNAME MODAL ──
document.getElementById('joinBtn').addEventListener('click', startSession);
document.getElementById('usernameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startSession();
});

function startSession() {
  const val = document.getElementById('usernameInput').value.trim();
  myUsername = val || 'Guest_' + Math.floor(Math.random() * 999);
  document.getElementById('usernameModal').style.display = 'none';
  initMedia();
}

// ── MEDIA INIT ──
function initMedia() {
  // Mobile-safe constraints
  const constraints = {
    video: {
      facingMode: 'user',
      width: { ideal: 640 },
      height: { ideal: 480 }
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true
    }
  };

  navigator.mediaDevices.getUserMedia(constraints)
    .then((stream) => {
      myVideoStream = stream;
      addVideo(stream, myUsername + ' (You)', true, null, null, true);

      peer.on('call', (call) => {
        call.answer(stream);
        const vid = document.createElement('video');
        call.on('stream', (userStream) => {
          addVideo(userStream, 'Peer', false, vid, call.peer, false);
        });
        call.on('close', () => removeVideo(call.peer));
        call.on('error', (err) => console.error('call error:', err));
        peerConnections[call.peer] = call;
      });
    })
    .catch((err) => {
      showToast('Cam error: ' + err.message);
      console.error('getUserMedia error:', err);
    });
}

// ── PEER OPEN ──
peer.on('open', (id) => {
  myId = id;
  socket.emit('newUser', id, roomID, myUsername);
  addParticipant();
});

peer.on('error', (err) => {
  showToast('Peer: ' + err.type);
  console.error('Peer error:', err);
});

// ── SOCKET EVENTS ──
socket.on('userJoined', (id, username) => {
  showToast((username || 'Someone') + ' joined');
  addParticipant();
  if (!myVideoStream) return;

  const call = peer.call(id, myVideoStream);
  if (!call) return;

  const vid = document.createElement('video');
  call.on('stream', (userStream) => addVideo(userStream, username || 'Peer', false, vid, id, false));
  call.on('close', () => removeVideo(id));
  call.on('error', (err) => console.error(err));
  peerConnections[id] = call;
});

socket.on('userDisconnect', (id, username) => {
  showToast((username || 'Someone') + ' left');
  removeParticipant();
  if (peerConnections[id]) {
    peerConnections[id].close();
    delete peerConnections[id];
  }
  removeVideo(id);
});

socket.on('chatMessage', (msg, username) => {
  appendMessage(msg, username, username === myUsername);
  if (typeof window._notifyChatBadge === 'function') {
    window._notifyChatBadge();
  }
});

// ── VIDEO HELPERS ──
let selfWrapper = null;

function addVideo(stream, label, muted, existingVid, peerId, isSelf) {
  let wrapper;
  if (isSelf && selfWrapper) {
    // Update existing self video
    return;
  }

  wrapper = document.createElement('div');
  wrapper.classList.add('video-wrapper');
  if (isSelf) {
    wrapper.classList.add('is-self');
    selfWrapper = wrapper;
  }
  if (peerId) wrapper.dataset.peerId = peerId;

  const video = existingVid || document.createElement('video');
  video.srcObject = stream;
  video.muted = !!muted;
  // Critical: these attributes needed for iOS/Android autoplay
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  video.addEventListener('loadedmetadata', () => {
    video.play().catch((e) => console.warn('play() failed:', e));
  });

  const labelEl = document.createElement('div');
  labelEl.classList.add('video-label');
  labelEl.textContent = label;

  wrapper.appendChild(video);
  wrapper.appendChild(labelEl);
  videoGrid.appendChild(wrapper);

  updateGridLayout();
}

function removeVideo(peerId) {
  const el = videoGrid.querySelector(`[data-peer-id="${peerId}"]`);
  if (el) {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.9)';
    setTimeout(() => { el.remove(); updateGridLayout(); }, 300);
  }
}

// Dynamically update grid class and PiP for self
function updateGridLayout() {
  const wrappers = videoGrid.querySelectorAll('.video-wrapper:not(.is-self)');
  const total = wrappers.length;

  // Remove old grid classes
  videoGrid.classList.remove('two-up', 'many-up');

  if (selfWrapper) {
    if (total === 0) {
      // Only me — full width, no PiP
      selfWrapper.classList.remove('pip');
      videoGrid.style.gridTemplateColumns = '1fr';
      videoGrid.style.gridAutoRows = '220px';
    } else if (total === 1) {
      // 1 other — they get full, I go PiP
      selfWrapper.classList.add('pip');
      videoGrid.style.gridTemplateColumns = '1fr';
      videoGrid.style.gridAutoRows = '280px';
    } else {
      // Multiple — 2 col grid, I also in PiP
      selfWrapper.classList.add('pip');
      videoGrid.classList.add('two-up');
    }
  } else {
    if (total === 2) videoGrid.classList.add('two-up');
    if (total > 2) videoGrid.classList.add('many-up');
  }
}

// ── PARTICIPANT COUNT ──
function addParticipant() {
  participantCount++;
  updateCount();
}
function removeParticipant() {
  if (participantCount > 1) participantCount--;
  updateCount();
}
function updateCount() {
  participantEl.textContent = participantCount + ' ONLINE';
}

// ── MIC CONTROL ──
document.getElementById('micBtn').addEventListener('click', () => {
  if (!myVideoStream) return;
  micOn = !micOn;
  myVideoStream.getAudioTracks().forEach(t => t.enabled = micOn);
  const btn = document.getElementById('micBtn');
  btn.classList.toggle('off', !micOn);
  btn.querySelector('svg').innerHTML = micOn
    ? `<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
       <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
       <line x1="12" y1="19" x2="12" y2="23"/>
       <line x1="8" y1="23" x2="16" y2="23"/>`
    : `<line x1="1" y1="1" x2="23" y2="23"/>
       <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
       <path d="M17 16.95A7 7 0 0 1 5 12v-2"/>
       <line x1="12" y1="19" x2="12" y2="23"/>
       <line x1="8" y1="23" x2="16" y2="23"/>`;
  showToast(micOn ? 'Mic ON' : 'Mic OFF');
});

// ── CAM CONTROL ──
document.getElementById('camBtn').addEventListener('click', () => {
  if (!myVideoStream) return;
  camOn = !camOn;
  myVideoStream.getVideoTracks().forEach(t => t.enabled = camOn);
  const btn = document.getElementById('camBtn');
  btn.classList.toggle('off', !camOn);
  btn.querySelector('svg').innerHTML = camOn
    ? `<polygon points="23 7 16 12 23 17 23 7"/>
       <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>`
    : `<line x1="1" y1="1" x2="23" y2="23"/>
       <path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34"/>`;
  showToast(camOn ? 'Camera ON' : 'Camera OFF');
});

// ── END CALL ──
document.getElementById('endBtn').addEventListener('click', () => {
  if (myVideoStream) myVideoStream.getTracks().forEach(t => t.stop());
  window.location.href = '/';
});

// ── CHAT ──
document.getElementById('sendBtn').addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
});

function sendMessage() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chatMessage', msg, myUsername, roomID);
  chatInput.value = '';
  chatInput.style.height = 'auto';
}

function appendMessage(msg, username, isMe) {
  const div = document.createElement('div');
  div.classList.add('chat-msg');
  if (isMe) div.classList.add('mine');

  const sender = document.createElement('div');
  sender.classList.add('sender');
  sender.textContent = username;

  const bubble = document.createElement('div');
  bubble.classList.add('bubble');
  bubble.textContent = msg;

  div.appendChild(sender);
  div.appendChild(bubble);
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── TOAST ──
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}
