const express = require("express");
const http = require("node:http");
const { WebSocket, WebSocketServer } = require("ws");
const {
    createIncrementalTranscriber
} = require("./incrementalTranscriber");

const HOST = "127.0.0.1";
const PORT = 3000;
const INFERENCE_URL = "http://127.0.0.1:8001";

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({
    server: server,
    path: "/ws",
    maxPayload: 64 * 1024
});

wss.on("error", (error) => {
    console.error("WebSocket server error:", error.message);
});

wss.on("connection", (socket) => {
    console.log("WebSocket client connected.");

    let session = null;

    const send = (payload) => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(payload));
        }
    };

    socket.on("error", (error) => {
        console.error("WebSocket client error:", error.message);
    });

    send({
        type: "connected",
        message: "Connected to the Node.js WebSocket server."
    });

    socket.on("message", (data, isBinary) => {
        // Receive binary PCM audio.
        if (isBinary) {
            if (session === null || session.ending === true) {
                send({
                    type: "error",
                    message: "This session is not accepting audio."
                });
                return;
            }

            if (
                !Buffer.isBuffer(data) ||
                data.length === 0 ||
                data.length % 2 !== 0
            ) {
                send({
                    type: "error",
                    message: "Send a nonempty chunk containing complete 16-bit samples."
                });
                return;
            }

            const byteRate =
                session.sample_rate * session.channels * 2;

            const nextBytes = session.received_bytes + data.length;

            if (
                nextBytes > byteRate * 60 ||
                session.chunks.length >= 1000
            ) {
                send({
                    type: "error",
                    message: "Session limit reached: 60 seconds or 1000 chunks."
                });
                socket.close(1009, "Audio limit exceeded");
                return;
            }

            session.chunks.push(Buffer.from(data));
            session.received_bytes = nextBytes;

            send({
                type: "chunk_received",
                chunk_bytes: data.length,
                received_bytes: session.received_bytes,
                audio_seconds: session.received_bytes / byteRate
            });

            // Request a newer snapshot when enough audio has arrived.
            session.transcriber.update();
            return;
        }

        // Receive JSON control commands.
        let message;

        try {
            message = JSON.parse(data.toString());
        } catch {
            send({
                type: "error",
                message: "Send valid JSON for session commands."
            });
            return;
        }

        if (message?.type === "start") {
            if (session !== null) {
                send({
                    type: "error",
                    message: "A session is already active."
                });
                return;
            }

            const language = message.language ?? "English";

            if (
                !["English", "Chinese", "Indonesian"].includes(language)
            ) {
                send({
                    type: "error",
                    message: "Unsupported language."
                });
                return;
            }

            const activeSession = {
                language: language,
                sample_rate: 16000,
                channels: 1,
                format: "pcm_s16le",
                chunks: [],
                received_bytes: 0,
                ending: false,
                transcriber: null
            };

            activeSession.transcriber = createIncrementalTranscriber(
                activeSession,
                INFERENCE_URL,
                send,
                () => {
                    if (session === activeSession) {
                        session = null;
                    }
                }
            );

            session = activeSession;

            send({
                type: "session_started",
                language: session.language,
                sample_rate: session.sample_rate,
                channels: session.channels,
                format: session.format
            });
            return;
        }

        if (message?.type === "end") {
            if (session === null) {
                send({
                    type: "error",
                    message: "No active session to end."
                });
                return;
            }

            if (session.ending === true) {
                send({
                    type: "error",
                    message: "This session is already finishing."
                });
                return;
            }

            // Flush the complete audio and finish after its final result.
            session.transcriber.finish();
            return;
        }

        send({
            type: "error",
            message: "Unknown session command."
        });
    });

    socket.on("close", () => {
        if (session !== null) {
            session.transcriber.stop();
            session = null;
        }

        console.log("WebSocket client disconnected.");
    });
});

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        service: "Node.js Backend"
    });
});

app.get("/api/inference/health", async (req, res) => {
    try {
        const response = await fetch(INFERENCE_URL + "/health", {
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new Error(
                "Python helper returned HTTP " + response.status
            );
        }

        const inference = await response.json();

        if (inference.status !== "ready") {
            throw new Error("Python model is not ready.");
        }

        res.json({
            status: "ready",
            backend: "Node.js + Express",
            inference: inference
        });
    } catch (error) {
        console.error("Inference health check failed:", error.message);

        res.status(503).json({
            status: "unavailable",
            error: "The Python inference helper is unavailable or not ready."
        });
    }
});

app.post(
    "/api/transcribe",
    express.raw({ type: "audio/wav", limit: 2_000_000 }),
    async (req, res) => {
        if (!req.is("audio/wav")) {
            return res.status(415).json({
                error: "Send audio with Content-Type: audio/wav."
            });
        }

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({
                error: "Send a nonempty WAV file."
            });
        }

        const language = req.get("X-ASR-Language") || "English";

        if (!["English", "Chinese", "Indonesian"].includes(language)) {
            return res.status(400).json({
                error: "Language must be English, Chinese, or Indonesian."
            });
        }

        try {
            const response = await fetch(
                INFERENCE_URL + "/transcribe",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "audio/wav",
                        "X-ASR-Language": language
                    },
                    body: req.body,
                    signal: AbortSignal.timeout(180_000)
                }
            );

            const result = await response.json();

            return res.status(response.status).json(result);
        } catch (error) {
            console.error("Transcription request failed:", error.message);

            const timedOut = error.name === "TimeoutError";

            return res.status(timedOut ? 504 : 502).json({
                error: timedOut
                    ? "The inference helper took too long to respond."
                    : "Could not get a valid response from the inference helper."
            });
        }
    }
);

app.use((error, req, res, next) => {
    console.error("Request processing failed:", error.message);

    const status = error.status || 500;

    res.status(status).json({
        error: status === 413
            ? "The uploaded file exceeds the 2,000,000-byte limit."
            : "Request could not be processed."
    });
});

server.on("error", (error) => {
    console.error("Backend server error:", error.message);
    process.exit(1);
});

server.listen(PORT, HOST, () => {
    console.log(`Backend running at http://${HOST}:${PORT}`);
});