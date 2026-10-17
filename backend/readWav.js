const { readFileSync } = require("node:fs");

function readPcmWav(filePath) {
    const file = readFileSync(filePath);

    if (
        file.length < 12 ||
        file.toString("ascii", 0, 4) !== "RIFF" ||
        file.toString("ascii", 8, 12) !== "WAVE"
    ) {
        throw new Error("The file must be a RIFF WAV file.");
    }

    const fileEnd = file.readUInt32LE(4) + 8;

    if (fileEnd < 12 || fileEnd > file.length) {
        throw new Error("The WAV file has an invalid length.");
    }

    let formatFound = false;
    let pcm = null;
    let offset = 12;

    while (offset + 8 <= fileEnd) {
        const id = file.toString("ascii", offset, offset + 4);
        const size = file.readUInt32LE(offset + 4);
        const start = offset + 8;
        const end = start + size;

        if (end > fileEnd) {
            throw new Error("The WAV file contains an incomplete section.");
        }

        if (id === "fmt ") {
            if (
                size < 16 ||
                file.readUInt16LE(start) !== 1 ||
                file.readUInt16LE(start + 2) !== 1 ||
                file.readUInt32LE(start + 4) !== 16000 ||
                file.readUInt32LE(start + 8) !== 32000 ||
                file.readUInt16LE(start + 12) !== 2 ||
                file.readUInt16LE(start + 14) !== 16
            ) {
                throw new Error("Use a standard 16 kHz, mono, 16-bit PCM WAV.");
            }

            formatFound = true;
        } else if (id === "data") {
            if (pcm !== null) {
                throw new Error("This reader expects one audio-data section.");
            }

            pcm = file.subarray(start, end);
        }

        offset = end + (size % 2);
    }

    if (
        !formatFound ||
        pcm === null ||
        pcm.length === 0 ||
        pcm.length % 2 !== 0
    ) {
        throw new Error("The WAV file must contain complete PCM samples.");
    }

    if (pcm.length > 32000 * 60) {
        throw new Error("Use at most 60 seconds of audio for this test.");
    }

    return pcm;
}

module.exports = { readPcmWav };