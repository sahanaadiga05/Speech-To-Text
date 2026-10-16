from pathlib import Path
from time import perf_counter

import soundfile as sf
import torch
from qwen_asr import Qwen3ASRModel
from torch.ao.quantization import quantize_dynamic

print("Running file:", Path(__file__).resolve(), flush=True)

audio_path = Path(__file__).resolve().parent.parent / "samples" / "english.wav"
audio_info = sf.info(str(audio_path))

if audio_info.duration <= 0:
    raise ValueError("The audio file must contain audio.")

print(f"Audio duration: {audio_info.duration:.2f} seconds")
print("Loading Qwen3-ASR on CPU...", flush=True)

load_started = perf_counter()

model = Qwen3ASRModel.from_pretrained(
    "Qwen/Qwen3-ASR-0.6B",
    device_map="cpu",
    dtype=torch.float32,
    attn_implementation="sdpa",
    max_inference_batch_size=1,
    max_new_tokens=256,
)

print("Quantizing linear layers to INT8...", flush=True)

model.model = quantize_dynamic(
    model.model,
    {torch.nn.Linear},
    dtype=torch.qint8,
    inplace=True,
)

int8_layers = sum(
    isinstance(layer, torch.ao.nn.quantized.dynamic.Linear)
    for layer in model.model.modules()
)

print("INT8 linear layers:", int8_layers, flush=True)

if int8_layers == 0:
    raise RuntimeError("Quantization did not produce any INT8 linear layers.")

load_seconds = perf_counter() - load_started

print("Model device:", model.model.device)
print(f"Model loading + quantization time: {load_seconds:.2f} seconds")
print("Transcribing...", flush=True)

inference_started = perf_counter()

results = model.transcribe(
    audio=str(audio_path),
    language="English",
)

inference_seconds = perf_counter() - inference_started
result = results[0]
rtf = inference_seconds / audio_info.duration

print("Language:", result.language)
print("Transcription:", result.text)
print(f"Inference time: {inference_seconds:.2f} seconds")
print(f"Real-time factor (RTF): {rtf:.2f}")
