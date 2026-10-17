const WebSocket = require("ws");
const path = require("node:path");
const { readPcmWav } = require("./readWav");

const audioPath = path.join(
    __dirname,
    "..",
    "samples",
    "english_16k.wav"
);

const pcm = readPcmWav(audioPath);

const CHUNK_BYTES = 8000;
const BYTES_PER_SECOND = 32000;

let offset = 0;
let pacingTimer = null;
let finalReceived = false;
let completed = false;

const socket = new WebSocket("ws://127.0.0.1:3000/ws");

const deadline = setTimeout(() => {
    console.error("Transcription test timed out.");
    process.exitCode = 1;
    socket.terminate();
}, 240_000);

function sendNextChunk() {
    if (socket.readyState !== WebSocket.OPEN) {
        return;
    }

    if (offset >= pcm.length) {
        console.log("Upload complete. Waiting for transcription.");

        socket.send(JSON.stringify({
            type: "end"
        }));
        return;
    }

    const chunk = pcm.subarray(
        offset,
        Math.min(offset + CHUNK_BYTES, pcm.length)
    );

    offset += chunk.length;
    socket.send(chunk);
}

socket.on("open", () => {
    console.log("WebSocket connection opened.");
    console.log("Audio duration:", pcm.length / BYTES_PER_SECOND);
});

socket.on("message", (data) => {
    const message = JSON.parse(data.toString());

    if (message.type !== "chunk_received") {
        console.log("Received:", message);
    }

    if (message.type === "connected") {
        socket.send(JSON.stringify({
            type: "start",
            language: "English"
        }));
    } else if (message.type === "session_started") {
        sendNextChunk();
    } else if (message.type === "chunk_received") {
        if (message.received_bytes !== offset) {
            console.error("Server received an unexpected audio byte count.");
            process.exitCode = 1;
            socket.close();
            return;
        }

        const delayMs =
            message.chunk_bytes / BYTES_PER_SECOND * 1000;

        pacingTimer = setTimeout(sendNextChunk, delayMs);
    } else if (message.type === "transcript") {
                if (
            typeof message.text !== "string" ||
            typeof message.final !== "boolean"
        ) {
            console.error("Expected transcript text and a boolean final flag.");
            process.exitCode = 1;
            socket.close();
            return;
        }

        if (message.final === true) {
            finalReceived = true;
        }
    } else if (message.type === "session_ended") {
        if (finalReceived) {
            completed = true;
            console.log("Real-audio transcription test passed.");
        } else {
            console.error("Session ended without a final transcript.");
            process.exitCode = 1;
        }

        socket.close();
    } else if (message.type === "error") {
        console.error("Server error:", message.message);
        process.exitCode = 1;
        socket.close();
    }
});

socket.on("error", (error) => {
    console.error("Connection error:", error.message);
    process.exitCode = 1;
});

socket.on("close", () => {
    clearTimeout(deadline);
    clearTimeout(pacingTimer);

    if (!completed) {
        process.exitCode = 1;
    }

    console.log("Connection closed.");
});