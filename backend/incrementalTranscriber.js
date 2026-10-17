const { pcmToWav } = require("./wav");
const { transcribeWav } = require("./inferenceClient");
const { createTranscriptionQueue } = require("./transcriptionQueue");

const UPDATE_SECONDS = 4;

function createIncrementalTranscriber(
    session,
    inferenceUrl,
    send,
    onComplete
) {
    const byteRate = session.sample_rate * session.channels * 2;
    const updateBytes = byteRate * UPDATE_SECONDS;

    let lastQueuedBytes = 0;
    let lastResult = null;
    let lastResultBytes = 0;
    let revision = 0;
    let stopped = false;

    const queue = createTranscriptionQueue(async (task) => {
        if (stopped) {
            return;
        }

        let result = lastResult;

        if (lastResult === null || lastResultBytes !== task.audioBytes) {
            send({
                type: "processing",
                audio_seconds: task.audioBytes / byteRate,
                message: "Transcribing the audio received so far."
            });

            result = await transcribeWav(
                task.wav,
                session.language,
                inferenceUrl
            );

            if (stopped) {
                return;
            }

            lastResult = result;
            lastResultBytes = task.audioBytes;
        }

        const isFinal =
            session.ending === true &&
            task.audioBytes === session.received_bytes;

        revision += 1;

        send({
            type: "transcript",
            revision: revision,
            final: isFinal,
            language: result.language,
            text: result.text,
            audio_seconds: result.audio_seconds,
            inference_seconds: result.inference_seconds,
            rtf: result.rtf
        });

        if (isFinal) {
            complete();
        }
    }, fail);

    function complete() {
        if (stopped) {
            return;
        }

        stopped = true;
        queue.stop();
        send({ type: "session_ended" });
        onComplete();
    }

    function fail(error) {
        if (stopped) {
            return;
        }

        stopped = true;
        queue.stop();

        send({
            type: "error",
            message: error.message
        });

        onComplete();
    }

    function submitSnapshot(reportReady = false) {
        try {
            const pcm = Buffer.concat(
                session.chunks,
                session.received_bytes
            );

            const wav = pcmToWav(pcm);

            if (reportReady) {
                send({
                    type: "audio_ready",
                    pcm_bytes: pcm.length,
                    wav_bytes: wav.length,
                    audio_seconds: pcm.length / byteRate
                });
            }

            queue.submit({
                wav: wav,
                audioBytes: pcm.length
            });
        } catch (error) {
            fail(error);
        }
    }

    return {
        update() {
            if (stopped || session.ending === true) {
                return;
            }

            if (session.received_bytes - lastQueuedBytes < updateBytes) {
                return;
            }

            lastQueuedBytes = session.received_bytes;
            submitSnapshot();
        },

        finish() {
            if (stopped || session.ending === true) {
                return;
            }

            session.ending = true;

            if (session.received_bytes === 0) {
                complete();
                return;
            }

            submitSnapshot(true);
        },

        stop() {
            stopped = true;
            queue.stop();
        }
    };
}

module.exports = { createIncrementalTranscriber };