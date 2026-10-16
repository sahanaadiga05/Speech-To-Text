const express = require("express");
const http = require("node:http");
const {WebSocketServer} = require("ws");


const HOST = "127.0.0.1";
const PORT = 3000;
const INFERENCE_URL = "http://127.0.0.1:8001";

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({
    server: server,
    path: "/ws",
    maxPayload : 64 * 1024
});

wss.on("error", (error) => {
    console.error("WebSocket server error:", error.message);
});

wss.on("connection", (socket) => {
    console.log("Websocket client connected");

    socket.on("error", (error) => {
        console.error("Websocket client error: ", error.message);
    });

    socket.send(JSON.stringify ({
        type: "connected",
        message: "Connected to the Node.js websocket server"
    }));

    socket.on("close", () =>{
        console.log("Websocket client disconnected");
    });
});

app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (req, res) =>{
    res.json({
        status:"ok",
        service: "Node.js Backend",
    });
});

app.get("/api/inference/health", async(req,res)=>{
    try{
        const response = await fetch(INFERENCE_URL + "/health", {
            signal: AbortSignal.timeout(5000)
        });

        if(!response.ok){
            throw new Error("Pyhton helper returned HTTP" + response.status);
        }

        const inference = await response.json();

        if(inference.status !== "ready"){
            throw new Error("Python model is not ready");
        }

        res.json({
            status:"ready",
            backend:"Node.js + Express",
            inference:inference,
        });
    }catch(error){
        console.error("Inference health chec failed:", error.message);

        res.status(503).json({
            status:"unavailable",
            error:"The python inference helper is unaviable or not ready"
        });
    }
});

app.post(
    "/api/transcribe",
    express.raw({ type: "audio/wav", limit: 2_000_000}),
    async(req,res)=>{
        if(!req.is("audio/wav")) {
            return res.status(415).json({
                error: "send audio with content-type: audio/wav."
            });
        }

        if(!Buffer.isBuffer(req.body) || req.body.length === 0){
            return res.status(400).json({
                error:"send a nonempty WAV file"
            });
        }

        const language = req.get("X-ASR-Language") || "English";

        if(!["English", "Chinese","Indonesian"].includes(language)){
            return res.status(400).json({
                error:"Language must be English, Chinese, or Indonesian"
            });
        }

        try{
            const response = await fetch(INFERENCE_URL + "/transcribe",{
                method:"POST",
                headers:{
                    "Content-Type":"audio/wav",
                    "X-ASR-Language":language
                },
                body: req.body,
                signal: AbortSignal.timeout(180_000)
            });

            const result = await response.json();

            return res.status(response.status).json(result);
        }
        catch (error){
            console.error("Transcription request failed", error.message);

            const timedOut = error.name === "TimeoutError";

            return res.status(timedOut ? 504 : 502).json({
                error: timedOut
                ? "The inference helper took too long to respond"
                : "Could not get a valid response from the inference helper"
            });
        }
    }
);

app.use((error, req,res,next)=>{
    console.error("Request processing failed:", error.message);

    const status = error.status || 500;

    res.status(status).json({
        error: status === 413
        ? "The uploaded file exceeds the 2,000,000-byte limit."
        : "Request could not be processed."
    });
});

server.on("error", (error) =>{
    console.error("backend server error:", error.message);
    process.exit(1);
});

server.listen(PORT, HOST, () =>{
    console.log(`Backend running at http://${HOST}:${PORT}`);
});