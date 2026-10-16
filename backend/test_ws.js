const WebSocket = require("ws");

const socket = new WebSocket("ws://127.0.0.1:3000/ws");

const timer = setTimeout(() => {
    console.error();
})