async function transcribeWav(wav, language, inferenceUrl) {
    const response = await fetch(inferenceUrl + "/transcribe", {
        method: "POST",
        headers: {
            "Content-Type": "audio/wav",
            "X-ASR-Language": language
        },
        body: wav,
        signal: AbortSignal.timeout(180_000)
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(
            result.error || `Inference helper returned HTTP ${response.status}.`
        );
    }

    return result;
}

module.exports = { transcribeWav };