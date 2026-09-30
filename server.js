const express = require("express");
const { Server } = require("socket.io");
const http = require("http");

const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use(express.static("public"));

const users = {};

function sendUserList() {
    io.emit("userList",Object.values(users));
}

io.on("connection", (socket) => {
    console.log("A new user connected:", socket.id);
    socket.on("join", (data) => {
        users[socket.id] = {
            id: socket.id,
            name: data.name,
            skills: data.skills,
            knowSkill: data.knowSkill,
        };
        sendUserList();
    });

    socket.on("disconnect", () => {
        console.log("A user left:", socket.id);
        delete users[socket.id];
        sendUserList();
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});

