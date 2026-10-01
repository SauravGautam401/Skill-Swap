const express = require("express");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use(express.static("public"));

const users = {};

// ADDED: how long a person must wait after being rejected (5 minutes)
const COOLDOWN_MS = 10 * 1000;

// ADDED: remembers who is blocked from requesting whom
// key = "requesterId:targetId", value = time when they can request again
const cooldowns = {};

function sendUserList() {
    io.emit("userList",Object.values(users));
}

function leaveRoom(socketId){
    const me = users[socketId];
    if(!me || !me.roomId) return;

    const roomId = me.roomId;
    me.roomId = null;

    for (const id in users){
        if(id !== socketId && users[id].roomId === roomId){
            users[id].roomId = null;
            io.to(id).emit("partnerLeft");
        }
    }
    sendUserList();
}

io.on("connection", (socket) => {
    console.log("A new user connected:", socket.id);
    socket.on("join", (data) => {
        users[socket.id] = {
            id: socket.id,
            name: data.name,
            skills: data.skills,
            knowSkill: data.knowSkill,
            roomId: null,
        };
        sendUserList();
    });

    socket.on("chatMessage", (text) => {
        const user = users[socket.id];
        if(!user) return;

        const clean = String(text).trim().slice(0,300);
        if(!clean) return;

        io.emit("chatMessage", {
            name: user.name,
            text: clean,
            time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
        });
    });

    socket.on("requestSwap", (targetId) => {
        const me = users[socket.id];
        const target = users[targetId];
        if(!me || !target || targetId === socket.id) return;

        // ADDED: if this person was rejected recently, don't send the request
        const key = socket.id + ":" + targetId;
        if (cooldowns[key] && cooldowns[key] > Date.now()) {
            socket.emit("requestCooldown", { id: targetId, remainingMs: cooldowns[key] - Date.now() });
            return;
        }

        if(me.roomId || target.roomId){
            // CHANGED: also sends the id, so the browser can reset that button
            socket.emit("requestFailed", { name: target.name, id: targetId });
            return;
        }
        io.to(targetId).emit("incomingRequest", {
            fromId:socket.id,
            name:me.name,
            teaches:me.knowSkill,
            wants:me.skills,
        });
    });

    socket.on("respondRequest", ({fromId , accepted}) => {
        const me = users[socket.id];
        const other = users[fromId];
        if(!me || !other) return;

        if(!accepted){
            // ADDED: start the 5 minute cooldown for this pair
            cooldowns[fromId + ":" + socket.id] = Date.now() + COOLDOWN_MS;

            // CHANGED: now also sends who rejected (id) and how long the wait is
            io.to(fromId).emit("requestRejected", { name: me.name, id: socket.id, remainingMs: COOLDOWN_MS });
            return;
        }
        if(me.roomId ||other.roomId) return;

        const roomId = "room-"+fromId +"-" +socket.id;
        me.roomId = roomId;
        other.roomId = roomId;

        io.to(fromId).emit("roomReady",{ roomId, partnerName: me.name, partnerId: socket.id, isCaller: true });
        socket.emit("roomReady",{ roomId, partnerName: other.name, partnerId: fromId, isCaller: false });
        sendUserList();
    });

    socket.on("leaveRoom", () => {
        leaveRoom(socket.id);
    });

    socket.on("disconnect", () => {
        console.log("A user left:", socket.id);
        leaveRoom(socket.id);

        // ADDED: clean up cooldown records that involve this person
        for (const key in cooldowns) {
            if (key.includes(socket.id)) delete cooldowns[key];
        }

        delete users[socket.id];
        sendUserList();
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});