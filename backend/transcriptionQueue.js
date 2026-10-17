function createTranscriptionQueue(runTask, onError) {
    let running = false;
    let pending = null;
    let stopped = false;

    async function processPending() {
        if (running || stopped) {
            return;
        }

        running = true;

        try {
            while (pending !== null && !stopped) {
                const task = pending;
                pending = null;

                await runTask(task);
            }
        } catch (error) {
            stopped = true;
            pending = null;
            onError(error);
        } finally {
            running = false;
        }
    }

    return {
        submit(task) {
            if (stopped) {
                return;
            }

            pending = task;
            processPending();
        },

        stop() {
            stopped = true;
            pending = null;
        }
    };
}

module.exports = { createTranscriptionQueue };