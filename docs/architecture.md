flowchart LR
    File["WAV recording"] --> UI["React Web UI"]
    UI -->|"Audio chunks via WebSocket"| Backend["Node.js + Express backend"]
    Backend -->|"WAV audio via local HTTP"| ASR["Python inference helper<br/>Qwen3-ASR + Sherpa-ONNX<br/>CPU"]
    ASR -->|"Transcript and inference metrics"| Backend
    Backend -->|"Partial and final results via WebSocket"| UI