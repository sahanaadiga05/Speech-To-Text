const WebSocket = require("ws");

const socket = new WebSocket("ws://127.0.0.1:3000/ws");

const timer = setTimeout(() =>{
    console.error("Session test timed out");
    process.exitCode = 1;
    socket.terminate();
}, 5000);

socket.on("open", () =>{
    console.log("Websocket connection opened");
});

socket.on("message", (data) =>{
    console.log("Recived:", data.toString());

    const message = JSON.parse(data.toString());

    if(message.type === "connected"){
        socket.send(JSON.stringify ({
            type:"start",
            language:"English"
        }));
    } else if(message.type === "session_started") {
        socket.send(JSON.stringify({
            type: "end"
        }));
    }
    else if(message.type === "session_ended"){
        clearTimeout(timer);
        console.log("session start/end test passed");
        socket.close();
    } else if(message.type === "error"){
        console.error("server rejected the command:", message.message);
        process.exitCode =1;
        socket.close();
    }
});

socket.on("error", (error)=>{
    console.error("WebSocket error: ", error.message);
    process.exitCode =1;
});

socket.on("close", () =>{
    clearTimeout(timer);
    console.log("Websocket conenction closed");
});