const assert = require("node:assert/strict");
const { createTranscriptionQueue } = require("./transcriptionQueue");

async function main() {
    const executed = [];
    let active = false;

    let releaseFirst;

    const firstGate = new Promise((resolve) => {
        releaseFirst = resolve;
    });

    let finishTest;
    let failTest;

    const finished = new Promise((resolve, reject) => {
        finishTest = resolve;
        failTest = reject;
    });

    const queue = createTranscriptionQueue(async (task) => {
        assert.equal(active, false, "Tasks must not overlap.");

        active = true;
        executed.push(task);
        console.log("Running:", task);

        if (task === "A") {
            await firstGate;
        }

        active = false;

        if (task === "C") {
            finishTest();
        }
    }, failTest);

    const deadline = setTimeout(() => {
        failTest(new Error("Queue test timed out."));
    }, 5000);

    try {
        queue.submit("A");
        queue.submit("B");
        queue.submit("C");

        releaseFirst();
        await finished;

        assert.deepEqual(executed, ["A", "C"]);

        console.log("Queue test passed: no overlap, and B was skipped.");
    } finally {
        clearTimeout(deadline);
        queue.stop();
    }
}

main().catch((error) => {
    console.error("Queue test failed:", error.message);
    process.exitCode = 1;
});