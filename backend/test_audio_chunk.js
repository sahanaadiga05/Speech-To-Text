const WebSocket = require("ws");

const socket = new WebSocket("ws://127.0.0.1:3000/ws");

const timer = setTimeout(()=>{
    console.error("Audio chunk test timed out");
    process.exitCode = 1;
    socket.terminate();
}, 5000);

socket.on("message", (data) =>{
    const message = JSON.parse(data.toString());
    console.log("Received:", message);

    if(message.type === "connected"){
        socket.send(JSON.stringify ({
            type:"start",
            language:"English"
        }));
    }else if(message.type === "session_started"){
        const chunk = Buffer.alloc(8000);
        socket.send(chunk);
    } else if(message.type === "chunk_received"){
        if (
            message.chunk_bytes !== 8000 ||
            message.received_bytes !== 8000 ||
            message.audio_seconds !== 0.25
        ) {
            console.error("Audio size or duration is incorrect");
            process.exitCode = 1;
            socket.close();
            return;
        }

        console.log("Audio size and duration verified");

        socket.send(JSON.stringify ({
            type:"end"
        }));

    } else if(message.type === "session_ended"){
        clearTimeout(timer);
        console.log("Audio chunk test passed");
        socket.close();
    } else if(message.type === "error"){
        console.error("Server error :", message.message);
        process.exitCode = 1;
        socket.close();
    }
});

socket.on("error", (error) =>{
    console.error("Connection error: ", error.message);
    process.exitCode =1;
});

socket.on("close", () =>{
    clearTimeout(timer);
    console.log("Connection closed");
});