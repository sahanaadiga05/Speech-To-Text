# Performance and Accuracy Report

## 1. Test environment

| Item | Configuration |
|---|---|
| Test date | 18 October 2026 |
| CPU | AMD Ryzen 5 5600H with Radeon Graphics |
| Physical cores | 6 |
| Logical processors | 12 |
| Visible physical RAM | 7.38 GiB |
| Operating system | Microsoft Windows 11 Home Single Language |
| Windows version | 10.0.26300 |
| Windows build | 26300 |
| Main backend | Node.js + Express |
| Streaming transport | WebSockets using ws |
| Inference helper | Python standard-library HTTP server |
| Model | Qwen/Qwen3-ASR-0.6B |
| Inference runtime | sherpa-onnx 1.13.8 |
| Execution device | CPU |
| Model files | INT8 encoder and decoder; separate convolution frontend |
| Inference threads | 6 |
| Maximum generated tokens | 256 |

## 2. Processing method

The frontend sends 16 kHz, mono, 16-bit PCM audio in small
WebSocket chunks, approximately matching playback speed.

Node.js collects the audio and requests transcription of the
audio received so far, approximately every four seconds.

Each inference request transcribes a cumulative audio prefix.
This implementation therefore repeats some earlier processing.
It does not reuse model state between successive prefixes.

Each session allows one active inference request and retains
the latest pending snapshot. Intermediate pending snapshots
can be replaced by newer audio.

The Python helper shares one loaded recognizer and permits
one inference request at a time.

## 3. Single-stream latency

Recording: english_16k.wav, approximately 15.051 seconds.

| Measurement | Result |
|---|---:|
| First transcript received | 9.521 seconds |
| Audio upload completed | 15.746 seconds |
| Final transcript received | 24.444 seconds |
| Final result after upload completed | 8.698 seconds |
| Final inference request duration | 6.010 seconds |
| Final inference request RTF | 0.399 |
| Resource-monitoring window | 25.231 seconds |

Latency values come from the WebSocket client's elapsed timer.
The resource-monitoring window also includes client startup
and the sampling interval around test completion.

The four inference requests processed audio prefixes of
4, 8, 12 and approximately 15.051 seconds.

Their reported inference durations were:

- 4-second prefix: 5.377 seconds
- 8-second prefix: 3.772 seconds
- 12-second prefix: 4.974 seconds
- Final prefix: 6.010 seconds

Total reported inference time across the four requests was
20.133 seconds.

The final request's RTF describes only that request.
Capacity planning must also account for repeated prefix work.

## 4. CPU and memory measurements

Resources were sampled approximately every 0.5 seconds during
one successful English WebSocket session, with the model
already loaded.

CPU percentages use all 12 logical processors as 100%.
Average process CPU covers the complete monitoring window,
including audio upload and waiting.

| Process | Average CPU | Sampled peak CPU | Sampled peak RSS | Sampled peak private allocation |
|---|---:|---:|---:|---:|
| Node backend | 0.11% | 2.61% | 30.05 MiB | 32.32 MiB |
| Python ASR helper | 33.42% | 58.66% | 1714.77 MiB | 2660.49 MiB |

Peak sampled system CPU utilization was 94.8%.
Minimum available system RAM was 341.91 MiB.

RSS represents memory resident in physical RAM.
Private allocation can include memory that is not currently
resident in RAM.

System measurements include other running applications.
Sampled peaks can miss spikes shorter than the sampling interval.
These measurements exclude model startup.

## 5. Two-session overlap test

Two English WebSocket clients were launched concurrently.

| Client | Result |
|---|---|
| Stream 1 | Received a model-busy error at 4.533 seconds |
| Stream 2 | Completed successfully; first text at 8.826 seconds and final text at 26.005 seconds |

Both clients established WebSocket sessions.
One client was rejected when its inference request overlapped
with another request holding the recognizer lock.

This demonstrates the current single-inference restriction
and busy-error handling. The laptop's maximum hardware
concurrency remains unmeasured.

## 6. Full-recording API results

These are separate REST requests used to collect final
transcripts for language testing.

| Language | Recording | Audio duration | Inference duration | Request RTF |
|---|---|---:|---:|---:|
| English | english_accuracy_16k.wav | 19.020 s | 16.536 s | 0.869 |
| Mandarin | noise2.wav | 22.833 s | 15.420 s | 0.675 |
| Indonesian | indonesian_original.wav | 3.713 s | 4.141 s | 1.115 |

Request RTF equals inference duration divided by audio duration.
These values exclude the cumulative-prefix work used in the
WebSocket workflow.

## 7. Transcript accuracy

English was evaluated against the supplied f1_noise.wav
reference after conversion of its audio to 16 kHz PCM.

English normalization:
lowercase, remove punctuation, collapse repeated spaces,
and strip surrounding whitespace.

- Reference words: 31
- Correctly matched words: 28
- Substitutions: 2
- Deletions: 1
- Insertions: 1
- WER: 12.903%

Mandarin was evaluated against the supplied noise2.wav
reference, removing Unicode punctuation and all whitespace.

- Reference characters: 53
- Correctly matched characters: 44
- Substitutions: 9
- Deletions: 0
- Insertions: 1
- CER: 18.868%

English and Mandarin references came from the downloaded
model package's test_wavs/transcript.txt.

Indonesian returned:
"Sepulang sekolah, Fitri sangat lapar."

Indonesian transcription functionality was demonstrated.
Its WER remains unscored pending a verified reference.

WER and CER count different units. These results describe
individual test recordings; broader accuracy evaluation
requires additional reference-labelled recordings.

## 8. Illustrative capacity estimates

### 8.1 Scope and assumptions

These are planning estimates for a future worker pool.
The measured prototype currently runs one shared recognizer
and rejects overlapping inference requests.

The proposed design assigns one model worker to each active
call leg. A routing layer would direct each session's requests
to its assigned worker.

Each worker has its own loaded model. Model sharing, batching
and silence-based reductions are not assumed.

For arithmetic, one vCPU is treated approximately as one
logical processor on the test machine. Actual performance
must be calibrated on the selected server CPU.

### 8.2 Estimated budget per worker

CPU calculation:

- Sampled ASR peak: 58.66% of 12 logical processors.
- Equivalent CPU use: 0.5866 × 12 = 7.0392 logical CPU units.
- Choose a planning utilization target of 75%.
- Required reservation: 7.0392 / 0.75 = 9.3856 CPU units.
- Round up to a budget of 10 vCPU per worker.

This reservation includes spare CPU capacity. It is separate
from the recognizer's configuration of six inference threads.

Memory calculation:

- Sampled peak private allocation: 2660.49 MiB.
- Convert to GiB: 2660.49 / 1024 = approximately 2.598 GiB.
- Add a planning allowance of 30%: 2.598 × 1.30 = 3.378 GiB.
- Round up to a budget of 4 GiB per worker.

Private allocation is used as a planning input rather than
relying only on the smaller observed resident working set.
The 4 GiB budget still requires validation during startup
and with longer recordings.

### 8.3 Example server configuration

Assume a hypothetical server containing:

- 64 vCPU
- 64 GiB RAM

Reserve 4 vCPU and 8 GiB RAM per server for the operating
system, Node gateway and supporting services.

Resources available to workers:

- CPU: 64 - 4 = 60 vCPU
- RAM: 64 - 8 = 56 GiB

Worker slots permitted by each resource:

- CPU: floor(60 / 10) = 6 workers
- RAM: floor(56 / 4) = 14 workers

CPU is the limiting resource in this example.
Use six worker slots per server for the estimates below.

Here, floor means round down; ceil means round up.

### 8.4 Estimated resources by target concurrency

| Target concurrent call legs | Assumed workers | Worker CPU budget (vCPU) | Worker RAM budget (GiB) | Estimated example servers |
|---|---:|---:|---:|---:|
| 50 | 50 | 500 | 200 | 9 |
| 100 | 100 | 1,000 | 400 | 17 |
| 200 | 200 | 2,000 | 800 | 34 |
| 500 | 500 | 5,000 | 2,000 | 84 |
| 1,000 | 1,000 | 10,000 | 4,000 | 167 |

Formulas:

- Workers = target concurrent call legs
- Worker CPU budget = workers × 10 vCPU
- Worker RAM budget = workers × 4 GiB
- Server count = ceil(workers / 6)

The worker-budget columns exclude server-level reservations
and unused resources caused by server sizing.

Total provisioned pool resources would be:

- Provisioned CPU = server count × 64 vCPU
- Provisioned RAM = server count × 64 GiB

For example, the 50-call scenario uses nine example servers:
576 provisioned vCPU and 576 GiB provisioned RAM.

Separate load-balancing services and additional standby
servers would require their own resource allowances.

### 8.5 Interpretation and validation

The estimated server counts describe resource packing under
the stated assumptions. They are not measured simultaneous
real-time call capacities.

The resource profile came from one approximately 15-second
English recording. The prototype allows recordings up to
60 seconds, but resource use at that limit has not been profiled.

Across the four cumulative-prefix requests, reported inference
time totalled 20.133 seconds for approximately 15.051 seconds
of incoming audio: a ratio of approximately 1.338.

Consequently, assigning separate workers addresses overlapping
request rejection but does not establish a real-time latency
guarantee for each call.

Before relying on these estimates, measure multiple workers
on the target server, including longer recordings, model
startup, sustained load, latency and memory consumption.

The final-request RTF of 0.399 must not be used by itself
to infer concurrent-call capacity, because earlier cumulative
prefixes also consume inference time.

## 9. Runtime choice and researched alternative

### 9.1 Why this project uses Sherpa-ONNX

Initial experiments used Qwen3-ASR through the
PyTorch/Transformers runtime on CPU. Transcription worked,
but long processing times and low available system memory
were observed during development.

The project subsequently evaluated Qwen3-ASR with
Sherpa-ONNX, using INT8 encoder and decoder models.
This configuration produced usable incremental results
on the available laptop and became the selected runtime.

The measurements in Sections 3–7 describe the selected
configuration. Earlier exploratory runs were not a controlled
comparison between runtimes, so they should not be treated
as a universal performance ranking.

### 9.2 Alternative: Whisper with whisper.cpp

whisper.cpp is a C/C++ implementation of Whisper inference.
It supports CPU execution, Windows and quantized models.

Multilingual Whisper tiny or base would be candidates for
a future comparison. Multilingual weights are needed for
English, Mandarin and Indonesian; .en variants are English-only.

| Aspect | Current Qwen3-ASR solution | Whisper with whisper.cpp |
|---|---|---|
| Local testing | Implemented and measured | Researched; not benchmarked in this project |
| CPU execution | Demonstrated through Sherpa-ONNX | Supported by the runtime |
| Memory | Sampled peak private allocation of approximately 2.60 GiB | Depends on model and quantization; needs local measurement |
| Incremental output | Repeated cumulative-prefix inference | Includes a microphone streaming example; integration and latency need evaluation |
| Languages | All three requested languages returned transcripts | Multilingual models support the three requested languages |
| Accuracy | English WER and Mandarin CER measured | Requires the same reference-based evaluation |

A smaller quantized Whisper model might reduce resource
requirements. This remains an untested hypothesis for this
machine. Accuracy, particularly for noisy speech, numbers
and names, would need comparison.

The existence of a streaming example does not establish
that the alternative would meet the desired latency.

### 9.3 What to test next

- Compare multilingual Whisper tiny and base with the selected
  Qwen runtime using the same recordings.
- Use comparable CPU budgets and distinguish model loading,
  warm-up and inference measurements.
- Measure first-text latency, final-result latency, CPU,
  resident memory and private allocation.
- Compare English and Indonesian WER and Mandarin CER
  using verified references.
- Obtain a verified Indonesian reference before scoring it.
- Test longer recordings and multiple simultaneous streams.

## 10. Conclusion

The prototype demonstrates a React frontend, Node.js backend,
WebSocket audio transfer and CPU-based Qwen3-ASR inference.

Partial and final transcripts were demonstrated, and all three
requested languages returned transcription results.

The evaluation records latency, CPU and memory observations,
reference-based English and Mandarin accuracy, a two-session
overlap test and illustrative capacity estimates.

The current helper permits one active inference request.
Repeated cumulative-prefix processing increases computation.
These are important constraints for future concurrency and
latency improvements.

The sizing figures are planning estimates. Target-server
load tests are needed before claiming production capacity.

Indonesian accuracy remains unscored pending a verified
reference transcript.

## 11. References

- Qwen3-ASR official project:
  https://github.com/QwenLM/Qwen3-ASR

- Sherpa-ONNX official project:
  https://github.com/k2-fsa/sherpa-onnx

- whisper.cpp official project:
  https://github.com/ggml-org/whisper.cpp

- Whisper official project:
  https://github.com/openai/whisper