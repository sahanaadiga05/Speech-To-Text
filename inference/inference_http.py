import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import ClassVar
from io import BytesIO
from threading import Lock
from time import perf_counter

import torch

# Set CPU compute threads before importing and loading Qwen.
torch.set_num_threads(6)

from qwen_asr import Qwen3ASRModel
import soundfile as sf


HOST = "127.0.0.1"
PORT = 8001

MODEL_ID = "Qwen/Qwen3-ASR-0.6B"
SAMPLE_RATE = 16000

MAX_REQUEST_BYTES = 2_000_000
MAX_AUDIO_SECONDS = 60

# Allow only one inference request to use the shared model at a time.
MODEL_LOCK = Lock()


class InferenceHandler(BaseHTTPRequestHandler):
    model: ClassVar[Qwen3ASRModel | None] = None

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")

        self.send_response(status)
        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8",
        )
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self.send_json(404, {"error": "Endpoint not found."})
            return

        model = self.model

        if model is None:
            self.send_json(503, {"error": "Model is not ready."})
            return

        self.send_json(
            200,
            {
                "status": "ready",
                "model": MODEL_ID,
                "device": str(model.model.device),
            },
        )

    def do_POST(self):
        if self.path != "/transcribe":
            self.send_json(404, {"error": "Endpoint not found."})
            return

        model = self.model

        if model is None:
            self.send_json(503, {"error": "Model is not ready."})
            return

        # Read and validate the uploaded WAV file.
        try:
            length = int(self.headers.get("Content-Length", "0"))

            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError(
                    "Send a nonempty WAV file no larger than 2 MB."
                )

            language = self.headers.get("X-ASR-Language", "English")

            if language not in ("English", "Chinese", "Indonesian"):
                raise ValueError(
                    "Language must be English, Chinese, or Indonesian."
                )

            self.connection.settimeout(10)
            raw = self.rfile.read(length)

            if len(raw) != length:
                raise ValueError("The audio upload was incomplete.")

            with sf.SoundFile(BytesIO(raw)) as wav:
                if (
                    wav.format not in ("WAV", "WAVEX")
                    or wav.subtype != "PCM_16"
                ):
                    raise ValueError(
                        "Audio must be a 16-bit PCM WAV file."
                    )

                if (
                    wav.samplerate != SAMPLE_RATE
                    or wav.channels != 1
                ):
                    raise ValueError(
                        "Audio must be 16000 Hz and mono."
                    )

                if (
                    wav.frames <= 0
                    or wav.frames > SAMPLE_RATE * MAX_AUDIO_SECONDS
                ):
                    raise ValueError(
                        "Audio duration must be greater than 0 "
                        "and at most 60 seconds."
                    )

                audio = wav.read(dtype="float32")

            audio_seconds = len(audio) / SAMPLE_RATE

            if audio_seconds <= 0:
                raise ValueError(
                    "The WAV file contains no readable audio."
                )

        except (ValueError, sf.SoundFileError) as error:
            self.send_json(400, {"error": str(error)})
            return

        except TimeoutError:
            self.send_json(408, {"error": "Audio upload timed out."})
            return

        # Reject overlapping inference instead of building an unbounded queue.
        if not MODEL_LOCK.acquire(blocking=False):
            self.send_json(
                429,
                {"error": "Model is busy. Try again later."},
            )
            return

        try:
            # Print before starting the timer.
            print(
                "PyTorch compute threads:",
                torch.get_num_threads(),
                flush=True,
            )

            started = perf_counter()

            results = model.transcribe(
                audio=(audio, SAMPLE_RATE),
                language=language,
            )

            inference_seconds = perf_counter() - started
            result = results[0]

        except Exception as error:
            print("Inference failed:", error, flush=True)
            self.send_json(
                500,
                {"error": "CPU transcription failed."},
            )
            return

        finally:
            MODEL_LOCK.release()

        self.send_json(
            200,
            {
                "language": result.language,
                "text": result.text,
                "audio_seconds": round(audio_seconds, 3),
                "inference_seconds": round(inference_seconds, 3),
                "rtf": round(
                    inference_seconds / audio_seconds,
                    3,
                ),
            },
        )


if __name__ == "__main__":
    server = ThreadingHTTPServer(
        (HOST, PORT),
        InferenceHandler,
    )

    try:
        print("Loading Qwen3-ASR on CPU...", flush=True)

        InferenceHandler.model = Qwen3ASRModel.from_pretrained(
            MODEL_ID,
            device_map="cpu",
            dtype=torch.float32,
            attn_implementation="sdpa",
            max_inference_batch_size=1,
            max_new_tokens=256,
        )

        print(
            f"Inference helper ready at http://{HOST}:{PORT}/health",
            flush=True,
        )

        server.serve_forever()

    except KeyboardInterrupt:
        print("Stopping inference helper...", flush=True)

    finally:
        server.server_close()