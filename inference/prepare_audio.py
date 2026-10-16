from pathlib import Path

import librosa
import soundfile as sf

root = Path(__file__).resolve().parent.parent
source = root / "samples" / "english.wav"
destination = root / "samples" / "english_16k.wav"

print("Preparing audio...", flush=True)

audio, sample_rate = librosa.load(
    str(source),
    sr=16000,
    mono=True,
)

sf.write(
    str(destination),
    audio,
    sample_rate,
    subtype="PCM_16",
)

print("Saved:", destination)
print("File bytes:", destination.stat().st_size)
print(sf.info(str(destination)))
