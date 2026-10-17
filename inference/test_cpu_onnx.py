# Path builds file paths safely.
from pathlib import Path

# perf_counter measures elapsed time accurately.
from time import perf_counter

# These packages provide the inference engine and WAV reader.
import sherpa_onnx
import soundfile as sf

# Locate the directory containing this script: STT/inference.
inference_dir = Path(__file__).resolve().parent

# Locate the extracted ONNX model directory.
model_dir = (
    inference_dir
    / "onnx-test"
    / "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25"
)

# Go up to STT, then locate our existing converted recording.
audio_path = inference_dir.parent / "samples" / "english_16k.wav"

# Read audio samples as floating-point numbers and obtain the sample rate.
audio, sample_rate = sf.read(str(audio_path), dtype="float32")

# Require a nonempty, one-dimensional array: one audio channel.
if audio.ndim != 1 or audio.size == 0:
    raise ValueError("The recording must contain nonempty mono audio.")

# Require the same 16 kHz input used by our existing application.
if sample_rate != 16000:
    raise ValueError("The recording must have a 16000 Hz sample rate.")

# Samples divided by samples per second gives duration in seconds.
audio_seconds = audio.size / sample_rate

# An f-string inserts the duration; .3f displays three decimal places.
print(f"Audio duration: {audio_seconds:.3f} seconds", flush=True)
print("Loading Qwen3-ASR ONNX on CPU...", flush=True)

# Record the starting time before loading the model.
load_started = perf_counter()

# Create the recognizer using the downloaded model components.
recognizer = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
    conv_frontend=str(model_dir / "conv_frontend.onnx"),
    encoder=str(model_dir / "encoder.int8.onnx"),
    decoder=str(model_dir / "decoder.int8.onnx"),
    tokenizer=str(model_dir / "tokenizer"),
    num_threads=6,          # Start with six CPU compute threads.
    sample_rate=16000,     # Configure the audio feature extractor.
    feature_dim=128,       # Qwen3-ASR uses 128 mel features per frame.
    provider="cpu",        # Run inference on the CPU.
    max_new_tokens=256,    # Limit generated output tokens.
)

# Subtract the starting time to obtain model loading duration.
load_seconds = perf_counter() - load_started

print(f"Model loading time: {load_seconds:.3f} seconds", flush=True)
print("Transcribing the full recording...", flush=True)

# Start timing this transcription request separately from model loading.
inference_started = perf_counter()

# Create a separate recognition request; this does not open a WebSocket.
stream = recognizer.create_stream()

# Tell the recognizer that this recording contains English speech.
stream.set_option("language", "English")

# Supply the recording and its sample rate to the request.
stream.accept_waveform(sample_rate, audio)

# Run recognition; this call waits until transcription finishes.
recognizer.decode_stream(stream)

# Retrieve the resulting transcript.
text = stream.result.text

# Measure the complete recognition request duration.
inference_seconds = perf_counter() - inference_started

# RTF compares processing duration with recording duration.
rtf = inference_seconds / audio_seconds

print("Transcription:", text, flush=True)
print(f"Inference time: {inference_seconds:.3f} seconds", flush=True)
print(f"Real-time factor (RTF): {rtf:.3f}", flush=True)

# Keep the model loaded so we can inspect its memory use next.
input("Model remains loaded. Press Enter to exit...")