const socket = io();

const join = document.getElementById("join");
const joinForm = document.getElementById("joinForm");
const lobby = document.getElementById("lobby");
const userList = document.getElementById("userList");

const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const send = document.getElementById("send");

const requestBox = document.getElementById("requestBox");
const room = document.getElementById("room");
const roomTitle = document.getElementById("roomTitle");
const leaveBtn = document.getElementById("leaveBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const shareBtn = document.getElementById("shareBtn");

let peer = null;          // our PeerJS connection
let localStream = null;   // our camera + mic
let currentCall = null;   // the active call
let screenStream = null;  // our screen, while sharing

// ADDED: remembers things between list refreshes
let lastUsers = [];       // the latest list of people from the server
const pending = {};       // userId -> true while we wait for their answer
const cooldowns = {};     // userId -> time (in ms) when we can request again

// ==================== CHAT ====================

function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit("chatMessage", text);
    chatInput.value = "";
}

send.addEventListener("click", sendMessage);
chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});

socket.on("chatMessage", (msg) => {
    const p = document.createElement("p");
    p.textContent = "[" + msg.time + "] " + msg.name + ": " + msg.text;
    chatBox.appendChild(p);
    chatBox.scrollTop = chatBox.scrollHeight;
});

// ==================== JOIN ====================

join.addEventListener("click", () => {
    const name = document.getElementById("name").value.trim();
    const skills = document.getElementById("skills").value.trim();
    const knowSkill = document.getElementById("knowSkill").value.trim();

    if (!skills || !name || !knowSkill) {
        alert("Enter Full Details");
        return;
    }
    socket.emit("join", { name, skills, knowSkill });
    joinForm.style.display = "none";
    lobby.style.display = "block";
});

// ==================== PEOPLE LIST + REQUEST BUTTONS ====================

// ADDED: turns milliseconds into a text like "4:59"
function formatTime(ms) {
    const total = Math.ceil(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes + ":" + String(seconds).padStart(2, "0");
}

// ADDED: draws the people list. Moved into its own function so it can be
// redrawn every second while a countdown is running
function renderUserList() {
    const now = Date.now();

    for (const id in cooldowns) {
        if (cooldowns[id] <= now) delete cooldowns[id];
    }

    userList.innerHTML = "";
    let shown = 0;

    lastUsers.forEach((user) => {
        if (user.id === socket.id) return;
        shown++;

        // CHANGED: each person is now a card
        const li = document.createElement("li");
        li.className = "person-card";

        // the button comes FIRST, before the name
        const btn = document.createElement("button");
        if (user.roomId) {
            btn.textContent = "In a room";
            btn.disabled = true;
        } else if (cooldowns[user.id]) {
            btn.textContent = "Try again in " + formatTime(cooldowns[user.id] - now);
            btn.disabled = true;
        } else if (pending[user.id]) {
            btn.textContent = "Requested";
            btn.disabled = true;
        } else {
            btn.textContent = "Request";
            btn.addEventListener("click", () => {
                pending[user.id] = true;
                socket.emit("requestSwap", user.id);
                renderUserList();
            });
        }

        // name on top, skills underneath
        const info = document.createElement("div");
        info.className = "person-info";

        const nameEl = document.createElement("div");
        nameEl.className = "person-name";
        nameEl.textContent = user.name;

        const learnEl = document.createElement("div");
        learnEl.className = "person-skill";
        learnEl.textContent = "Wants to learn: " + user.skills;

        const teachEl = document.createElement("div");
        teachEl.className = "person-skill";
        teachEl.textContent = "Can teach: " + user.knowSkill;

        info.appendChild(nameEl);
        info.appendChild(learnEl);
        info.appendChild(teachEl);

        li.appendChild(btn);
        li.appendChild(info);
        userList.appendChild(li);
    });

    // ADDED: friendly message when nobody else is online
    if (shown === 0) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "No one else is online yet.";
        userList.appendChild(empty);
    }
}

// CHANGED: just saves the list and draws it
socket.on("userList", (users) => {
    lastUsers = users;
    renderUserList();
});

// ADDED: every second, redraw the list if any countdown is running
setInterval(() => {
    if (Object.keys(cooldowns).length > 0) renderUserList();
}, 1000);

// ==================== REQUESTS ====================

socket.on("incomingRequest", (req) => {
    const div = document.createElement("div");
    div.className = "request";

    const p = document.createElement("p");
    p.textContent = req.name + " wants to connect. They can teach " + req.teaches + " and want to learn " + req.wants + ".";

    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", () => {
        socket.emit("respondRequest", { fromId: req.fromId, accepted: true });
        div.remove();
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => {
        socket.emit("respondRequest", { fromId: req.fromId, accepted: false });
        div.remove();
    });

    div.appendChild(p);
    div.appendChild(acceptBtn);
    div.appendChild(rejectBtn);
    requestBox.appendChild(div);
});

// CHANGED: start the countdown for the person who rejected us
socket.on("requestRejected", (data) => {
    delete pending[data.id];
    cooldowns[data.id] = Date.now() + data.remainingMs;
    renderUserList();
    alert(data.name + " declined your request. You can try again in 5 minutes.");
});

// ADDED: the server says we are still in a cooldown with this person
socket.on("requestCooldown", (data) => {
    delete pending[data.id];
    cooldowns[data.id] = Date.now() + data.remainingMs;
    renderUserList();
});

// CHANGED: also resets that button
socket.on("requestFailed", (data) => {
    delete pending[data.id];
    renderUserList();
    alert(data.name + " is busy in another room right now.");
});

// ==================== VIDEO CALL ====================

let peerReady = null;   // ADDED: lets us wait until PeerJS is connected

socket.on("connect", () => {
    if (peer) peer.destroy();
    peer = new Peer(socket.id);

    // ADDED: resolves when PeerJS is ready to make and receive calls
    peerReady = new Promise((resolve) => peer.on("open", resolve));

    // ADDED: shows PeerJS problems instead of failing silently
    peer.on("error", (err) => {
        console.log("Peer error:", err.type);
        if (err.type === "peer-unavailable") {
            alert("The other person is not reachable yet. Leave the room and try again.");
        }
    });

    peer.on("call", async (call) => {
        try {
            await getLocalStream();
            call.answer(localStream);
            setupCall(call);
        } catch (err) {
            alert("Could not access camera or mic: " + err.message);
        }
    });
});

let localStreamPromise = null;   // ADDED: remembers the camera request in progress

// CHANGED: if two parts of the code ask for the camera at once, they now
// share one request instead of opening the camera twice
function getLocalStream() {
    if (!localStreamPromise) {
        localStreamPromise = navigator.mediaDevices
            .getUserMedia({ video: true, audio: true })
            .then((stream) => {
                localStream = stream;
                localVideo.srcObject = stream;
                return stream;
            })
            .catch((err) => {
                localStreamPromise = null;
                throw err;
            });
    }
    return localStreamPromise;
}

function setupCall(call) {
    currentCall = call;
        call.on("stream", (remoteStream) => {
        remoteVideo.srcObject = remoteStream;
        remoteVideo.play().catch(() => {});   // ADDED: forces playback if the browser paused it
    });
}

function swapVideoTrack(track) {
    const sender = currentCall.peerConnection
        .getSenders()
        .find((s) => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(track);
}

function stopScreenShare() {
    if (!screenStream) return;
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    if (localStream && currentCall) swapVideoTrack(localStream.getVideoTracks()[0]);
    shareBtn.textContent = "Share Screen";
}

function stopCall() {
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    if (currentCall) currentCall.close();
    currentCall = null;
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    localStreamPromise = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    shareBtn.textContent = "Share Screen";
}

shareBtn.addEventListener("click", async () => {
    if (!currentCall) {
        alert("Call is not connected yet.");
        return;
    }
    if (screenStream) {
        stopScreenShare();
        return;
    }
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const track = screenStream.getVideoTracks()[0];
        swapVideoTrack(track);
        track.onended = stopScreenShare;
        shareBtn.textContent = "Stop Sharing";
    } catch (err) {
        screenStream = null;
    }
});

// ==================== ROOM ====================

socket.on("roomReady", async (data) => {
    lobby.style.display = "none";
    room.style.display = "block";
    requestBox.innerHTML = "";
    roomTitle.textContent = "Room with " + data.partnerName;

    // ADDED: clear old "Requested" states so buttons are fresh after the room
    for (const id in pending) delete pending[id];

    try {
        await getLocalStream();
            if (data.isCaller) {
            await peerReady;   // ADDED: wait until PeerJS is connected before calling
            const call = peer.call(data.partnerId, localStream);
            setupCall(call);
        }
    } catch (err) {
        alert("Could not access camera or mic: " + err.message);
    }
});

socket.on("partnerLeft", () => {
    stopCall();
    alert("Your partner left the room.");
    room.style.display = "none";
    lobby.style.display = "block";
});

leaveBtn.addEventListener("click", () => {
    stopCall();
    socket.emit("leaveRoom");
    room.style.display = "none";
    lobby.style.display = "block";
});