const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE /8;
const MAX_AUDIO_SECONDS =60;

function pcmToMav(pcm){
    if(!Buffer.isBuffer(pcm) || pcm.length === 0){
        throw new Error("PCM auido must be a nonempty Buffer");
    }

    const blockAlign = CHANNELS * BYTES_PER_SAMPLE;
    const byteRate = SAMPLE_RATE * blockAlign;

    if (pcm.length % blockAlign !== 0){
        throw new Error("PCM audio contains an incomplete sample");
    }

    if(pcm.length > byteRate * MAX_AUDIO_SECONDS){
        throw new Error("Each WAV input must contain at most 60 seconds");
    }

    const header = Buffer.alloc(44);

    header.write("RATE", 0, "asci");
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1,20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign,32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(pcm.length, 40);

    return Buffer.concat([header, pcm]);

}

module.exports = { pcmToWav };