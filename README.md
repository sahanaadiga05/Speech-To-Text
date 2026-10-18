# Speech To Text

A local speech-to-text application built with React, Node.js, and Qwen3-ASR running on CPU.

The application accepts a WAV recording, uploads its audio progressively through WebSockets, and displays revised transcripts followed by a final result.

## Features

- React interface for file selection, language selection, and transcription.
- Node.js and Express REST API.
- WebSocket audio upload and transcript updates.
- Qwen3-ASR-0.6B CPU inference through sherpa-onnx.
- English, Chinese, and Indonesian language options.
- WAV format and duration validation.
- Start and Stop controls.
- Upload progress, transcript revisions, and performance measurements.
- Resource monitoring and accuracy evaluation results.

No database is required for the current prototype.

## How transcription works

The browser sends 16-bit PCM audio chunks to the Node.js backend.

Node.js collects the audio and sends cumulative recordings to the Python inference helper. Transcription updates become eligible after approximately four additional seconds of audio have arrived.

Each inference request transcribes the audio received so far. The resulting text replaces the previous transcript because earlier words may change as more context becomes available.

This is incremental transcription using repeated offline inference. It does not preserve the model's decoding state between requests.

Within each session, one inference request runs at a time, and only the latest pending recording is retained. The final request covers the complete uploaded recording.

The Python helper loads one shared model and allows one inference request at a time.

## Tested environment

| Component | Tested configuration |
| --- | --- |
| Operating system | Windows 11 Home Single Language |
| OS build | 26300 |
| Processor | AMD Ryzen 5 5600H |
| CPU cores | 6 physical cores, 12 logical processors |
| Installed memory | 8 GB, approximately 7.38 GiB visible to Windows |
| Node.js | 22.14.0 |
| Python | 3.12.4, 64-bit |
| Model | Qwen/Qwen3-ASR-0.6B |
| Inference runtime | sherpa-onnx 1.13.8 |
| Execution device | CPU |
| Model configuration | INT8 encoder and decoder |
| Recognizer threads | 6 |

These are the tested specifications, not verified minimum requirements.

## Installation

The following PowerShell commands assume the project is located at:

```text
C:\BACKEND\STT
```

Adjust the paths if you use a different location.

If the application is already installed, skip this section and continue with “Running the application”.

### 1. Clone the repository

Run this only when creating a new checkout:

```powershell
git clone https://github.com/sahanaadiga05/Speech-To-Text.git 'C:\BACKEND\STT'
```

`git clone` downloads the repository and creates the local working directory.

### 2. Install the JavaScript dependencies

```powershell
npm --prefix 'C:\BACKEND\STT\backend' ci
npm --prefix 'C:\BACKEND\STT\frontend' ci
```

- `--prefix` selects the directory containing the relevant `package.json`.
- `ci` installs the dependency versions recorded in `package-lock.json`.
- Backend and frontend dependencies are installed separately.

### 3. Create the Python environment

Python 3.12 must be installed and available through the Windows Python launcher.

```powershell
py -3.12 -m venv 'C:\BACKEND\STT\inference\onnx-test\.venv'
```

- `py -3.12` selects Python 3.12.
- `-m venv` creates an isolated Python environment.
- The final path determines where that environment is stored.

Install the saved dependencies into that environment:

```powershell
& 'C:\BACKEND\STT\inference\onnx-test\.venv\Scripts\python.exe' -m pip install --only-binary=:all: -r 'C:\BACKEND\STT\inference\requirements-onnx.txt'
```

- `&` runs the executable specified by the quoted path.
- The explicit Python path selects the project's ONNX environment.
- `-m pip install` installs packages using that Python interpreter.
- `--only-binary=:all:` requests prebuilt packages.
- `-r` reads the package versions from the requirements file.

The requirements include inference, audio preparation, monitoring, and accuracy evaluation dependencies.

The normal ONNX application does not require the earlier PyTorch environment.

### 4. Download and extract the model

The model files are excluded from Git and must be downloaded separately.

```powershell
curl.exe --fail --location --output 'C:\BACKEND\STT\inference\onnx-test\qwen3-asr-int8.tar.bz2' 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2'
```

- `curl.exe` selects the curl program explicitly.
- `--fail` reports an error for unsuccessful HTTP responses.
- `--location` follows the GitHub download redirects.
- `--output` specifies the destination archive.

The download is approximately 838 MiB.

Extract it:

```powershell
tar.exe -xjf 'C:\BACKEND\STT\inference\onnx-test\qwen3-asr-int8.tar.bz2' -C 'C:\BACKEND\STT\inference\onnx-test'
```

- `-x` extracts the archive.
- `-j` selects bzip2 decompression.
- `-f` identifies the archive file.
- `-C` selects the extraction directory.

The following model files and tokenizer directory must exist:

```text
inference/onnx-test/
└── sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25/
    ├── conv_frontend.onnx
    ├── encoder.int8.onnx
    ├── decoder.int8.onnx
    └── tokenizer/
```

The helper expects this directory name and location.

## Running the application

Use three separate PowerShell terminals. Keep one instance of each service running.

### Terminal 1: Python inference helper

```powershell
& 'C:\BACKEND\STT\inference\onnx-test\.venv\Scripts\python.exe' -u 'C:\BACKEND\STT\inference\inference_http.py'
```

The explicit executable selects the ONNX environment. `-u` makes Python display its output without buffering.

Wait until the program prints the following message. This is expected output, not a command:

```text
Inference helper ready at http://127.0.0.1:8001/health
```

### Terminal 2: Node.js backend

```powershell
node 'C:\BACKEND\STT\backend\server.js'
```

This starts the Express API and WebSocket server on port 3000.

### Terminal 3: React development server

```powershell
npm --prefix 'C:\BACKEND\STT\frontend' run dev
```

This runs the frontend's Vite development server on port 5173.

Vite forwards `/api` requests and `/ws` connections to the Node.js backend.

### Verify the connection

Run this in another terminal:

```powershell
curl.exe --fail --max-time 10 'http://127.0.0.1:5173/api/inference/health'
```

`--max-time 10` limits the request to ten seconds.

A successful response includes:

```json
{
  "status": "ready",
  "backend": "Node.js + Express",
  "inference": {
    "status": "ready",
    "model": "Qwen/Qwen3-ASR-0.6B",
    "device": "cpu",
    "runtime": "sherpa-onnx"
  }
}
```

### Use the interface

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/) in a browser.

1. Click **Check connection**.
2. Select the recording's language.
3. Click **Choose File** and select a supported WAV recording.
4. Click **Start transcription**.
5. Follow the upload progress and transcript revisions.
6. Wait for the final transcript and performance measurements.

Suggested demonstration files:

| Language selection | File in the samples directory |
| --- | --- |
| English | `english_16k.wav` |
| Chinese | `noise2.wav` |
| Indonesian | `indonesian_original.wav` |

Short recordings below the update threshold may produce only a final transcript.

**Stop** cancels the current client session. Starting again begins a new session from the start of the recording. An inference request already running in the helper may continue until it finishes.

To shut down the application, press **Ctrl+C** in each service terminal.

## Supported audio

The interface accepts recordings with all of these properties:

| Property | Required value |
| --- | --- |
| Container | Standard RIFF/WAVE |
| Encoding | Signed 16-bit linear PCM |
| Sample rate | 16,000 Hz |
| Channels | 1, mono |
| Duration | More than zero and at most 60 seconds |
| File size | At most 2,000,000 bytes |

A `.wav` extension alone does not guarantee that the recording has the required encoding.

The original `samples/english.wav` uses a different sample rate and bit depth. Use the prepared `samples/english_16k.wav` for the application.

The interface validates audio but does not automatically convert unsupported recordings.

## REST API

The Node.js API runs at:

```text
http://127.0.0.1:3000
```

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Check the Node.js backend |
| GET | `/api/inference/health` | Check the inference helper through Node.js |
| POST | `/api/transcribe` | Transcribe a complete WAV recording |

For transcription, send the WAV bytes directly as the request body.

Headers:

```text
Content-Type: audio/wav
X-ASR-Language: English
```

Supported language values are `English`, `Chinese`, and `Indonesian`.

Example:

```powershell
curl.exe --include --max-time 200 --header 'Content-Type: audio/wav' --header 'X-ASR-Language: English' --data-binary '@C:\BACKEND\STT\samples\english_16k.wav' 'http://127.0.0.1:3000/api/transcribe'
```

- `--include` displays the response headers and body.
- `--max-time 200` allows up to 200 seconds for the request.
- `--header` supplies the content type and language.
- `--data-binary` sends the file bytes unchanged.
- `@` tells curl to read those bytes from the specified file.

Successful responses contain the language, transcript, audio duration, inference time, and real-time factor.

Invalid input returns an error response. A busy model returns HTTP 429.

## WebSocket protocol

The backend WebSocket address is:

```text
ws://127.0.0.1:3000/ws
```

The browser accesses `/ws` through the Vite proxy.

Client sequence:

1. Send a JSON start command.
2. Wait for `session_started`.
3. Send binary PCM chunks.
4. Send a JSON end command after uploading the audio.

Start command:

```json
{"type":"start","language":"English"}
```

End command:

```json
{"type":"end"}
```

Binary audio must be 16 kHz, mono, signed 16-bit little-endian PCM without a WAV header.

The supplied client normally sends 8,000-byte chunks, representing 250 milliseconds of audio.

Server messages include:

- `connected`
- `session_started`
- `chunk_received`
- `audio_ready`
- `processing`
- `transcript`
- `session_ended`
- `error`

A transcript message includes a revision number and a `final` flag.

Each transcript contains the current complete text. Clients should replace the previous text instead of appending the new revision.

## Verification commands

These commands are available for manual verification. They do not need to run every time the application starts.

### Queue behavior

```powershell
node 'C:\BACKEND\STT\backend\test_transcription_queue.js'
```

Checks that inference tasks do not overlap and that a newer pending task replaces an older pending task.

No running servers are required for this test.

### WebSocket session commands

Start the Node.js backend, then run:

```powershell
node 'C:\BACKEND\STT\backend\test_ws.js'
```

Checks the connection and the start/end command sequence without transcribing audio.

### Real-audio WebSocket transcription

Keep the Node.js backend and Python helper running, then run:

```powershell
node 'C:\BACKEND\STT\backend\test_transcription_ws.js'
```

Uploads the English sample progressively and checks that a final transcript and session completion message arrive.

### Frontend checks

```powershell
npm --prefix 'C:\BACKEND\STT\frontend' run lint
npm --prefix 'C:\BACKEND\STT\frontend' run build
```

- `lint` checks the frontend source using ESLint.
- `build` generates the production frontend files in `frontend/dist`.

The build command verifies frontend compilation. A production deployment arrangement is outside the current local development setup.

## Resource monitoring

Keep the Node.js backend and Python helper running, with no other transcription in progress.

```powershell
& 'C:\BACKEND\STT\inference\onnx-test\.venv\Scripts\python.exe' -u 'C:\BACKEND\STT\inference\benchmark_resources.py'
```

This script runs one English WebSocket test and samples CPU and memory usage for the existing backend and helper processes.

It creates a timestamped directory containing:

```text
benchmarks/<timestamp>/resources.json
benchmarks/<timestamp>/stream.log
```

The measurements cover the running transcription session. Model startup and loading are excluded.

Process CPU percentages are normalized so that the complete machine represents 100%.

## Recorded results

For one paced English WebSocket stream containing approximately 15.051 seconds of audio:

| Measurement | Recorded value |
| --- | --- |
| First transcript arrival | 9.521 seconds |
| Final transcript arrival | 24.444 seconds |
| Final inference request | 6.010 seconds |
| Final request RTF | 0.399 |
| Peak sampled ASR resident memory | 1,714.77 MiB |
| Peak sampled ASR private memory | 2,660.49 MiB |

Times for transcript arrival are measured from the client session's start.

The final request's RTF describes that individual inference request. It does not include all earlier prefix requests or the complete upload/session time.

Separate full-recording REST evaluations produced:

| Language | Evaluation recording | Inference time | RTF | Accuracy result |
| --- | --- | --- | --- | --- |
| English | `english_accuracy_16k.wav`, 19.020 s | 16.536 s | 0.869 | WER 12.903% |
| Chinese | `noise2.wav`, 22.833 s | 15.420 s | 0.675 | CER 18.868% |
| Indonesian | `indonesian_original.wav`, 3.713 s | 4.141 s | 1.115 | Not scored; verified reference pending |

English WER and Chinese CER use supplied reference transcripts with the normalization rules recorded in the performance report.

These are individual sample results, not language-wide accuracy measurements.

A two-client WebSocket test completed one stream successfully. The other received a model-busy error. This demonstrates the current admission behavior, not the hardware's maximum concurrent capacity.

See [the performance report](docs/performance-report.md) for methodology, resource measurements, accuracy calculations, scaling assumptions, runtime comparison, and limitations.

## Limitations

- One helper permits one inference request at a time.
- Requests competing for the shared recognizer can receive a busy response.
- Incremental updates repeat inference over cumulative audio.
- Intermediate pending updates may be skipped when inference is busy.
- Transcript wording can change between revisions.
- Stop does not provide pause/resume.
- The 60-second input limit has not been fully resource-profiled.
- Indonesian accuracy remains unscored without a verified reference.
- Large-scale capacity figures are estimates rather than measured deployment results.
- The current application is a local prototype.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Browser cannot open port 5173 | Start the Vite development server and keep its terminal running |
| Vite reports `ECONNREFUSED` for port 3000 | Start the Node.js backend |
| Inference health returns HTTP 503 | Check the Python helper terminal and wait for its ready message |
| Startup reports `EADDRINUSE` | Another server already occupies the port; check the existing instance before starting another |
| Python cannot import `sherpa_onnx` | Use the Python executable inside `inference/onnx-test/.venv` |
| WAV input is rejected | Check sample rate, channels, encoding, size, and duration |
| Model-busy error or HTTP 429 | Wait for the active inference request to finish |
| Upload reaches 100% but the result is pending | The final inference request may still be running |

Earlier errors remain visible in terminal history after a service recovers. Use a fresh health check to confirm its current state.

## Main project directories

```text
backend/
    Express API, WebSocket handling, WAV utilities,
    inference coordination, and Node.js test clients

frontend/
    React interface, browser WAV validation,
    WebSocket client, and Vite configuration

inference/
    Python HTTP helper, audio preparation,
    benchmark scripts, and saved Python dependencies

inference/onnx-test/
    Local Python environment and downloaded ONNX model;
    excluded from Git

samples/
    Demonstration audio and accuracy reference text

benchmarks/
    Saved transcription, accuracy, and resource results

docs/
    Performance report
```

Earlier PyTorch experiment scripts are retained for comparison. They are not required to run the current ONNX application.

## Upstream projects and sample sources

- [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [ONNX model archive](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2)
- [Original English demonstration recording](https://qianwen-res.oss-cn-beijing.aliyuncs.com/Qwen3-ASR-Repo/asr_en.wav)
- English and Chinese accuracy recordings and supplied references: the downloaded model archive's `test_wavs` directory
- [Indonesian sample source](https://github.com/bookbot-kids/speech-recognizer-bahasa-indonesian)