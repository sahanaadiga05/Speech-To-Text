import json
import subprocess
from datetime import datetime
from pathlib import Path
from time import perf_counter, sleep

import psutil


# Locate the project from this script's location.
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Convert bytes into mebibytes: 1 MiB = 1,048,576 bytes.
MIB = 1024 * 1024

# Take resource measurements approximately twice per second.
SAMPLE_SECONDS = 0.5


def find_server_process(port):
    # Inspect TCP connections to find the process listening on this port.
    for connection in psutil.net_connections(kind="tcp"):
        if (
            connection.status == psutil.CONN_LISTEN
            and connection.laddr
            and connection.laddr.port == port
            and connection.pid is not None
        ):
            return psutil.Process(connection.pid)

    # Stop with a useful message if the required server is missing.
    raise RuntimeError(f"No server is listening on port {port}.")


def cpu_seconds(process):
    # CPU time includes work performed in user mode and system mode.
    times = process.cpu_times()
    return times.user + times.system


# Monitor the existing servers without starting another model.
processes = {
    "node_backend": find_server_process(3000),
    "python_asr": find_server_process(8001),
}

# We use logical processors to express CPU use as a share of the machine.
logical_cpus = psutil.cpu_count(logical=True) or 1

# Give each benchmark its own output directory.
run_name = datetime.now().strftime("%Y%m%d_%H%M%S")
output_dir = PROJECT_ROOT / "benchmarks" / run_name
output_dir.mkdir(parents=True, exist_ok=True)

test_path = PROJECT_ROOT / "backend" / "test_transcription_ws.js"
log_path = output_dir / "stream.log"

stats = {}
cpu_starts = {}

for name, process in processes.items():
    memory = process.memory_info()

    # Save the initial CPU time for calculating the average later.
    cpu_starts[name] = cpu_seconds(process)

    # Initialise psutil's CPU counter before taking interval measurements.
    process.cpu_percent(interval=None)

    stats[name] = {
        "pid": process.pid,
        "baseline_rss_mib": round(memory.rss / MIB, 2),
        "baseline_private_mib": round(memory.private / MIB, 2),
        "peak_rss_mib": round(memory.rss / MIB, 2),
        "peak_private_mib": round(memory.private / MIB, 2),
        "peak_cpu_percent_of_machine": 0.0,
    }

# Initialise the system CPU counter and record available physical memory.
psutil.cpu_percent(interval=None)
minimum_available_ram = psutil.virtual_memory().available
peak_system_cpu = 0.0

print("Running one English WebSocket stream...", flush=True)
print(f"Stream messages will be saved to: {log_path}", flush=True)

started = perf_counter()

# Save the existing test's normal output and errors in the same log.
with log_path.open("w", encoding="utf-8") as log:
    client = subprocess.Popen(
        ["node", str(test_path)],
        cwd=str(PROJECT_ROOT),
        stdout=log,
        stderr=subprocess.STDOUT,
    )

    try:
        # Continue sampling while the test client is running.
        while client.poll() is None:
            sleep(SAMPLE_SECONDS)

            peak_system_cpu = max(
                peak_system_cpu,
                psutil.cpu_percent(interval=None),
            )

            minimum_available_ram = min(
                minimum_available_ram,
                psutil.virtual_memory().available,
            )

            for name, process in processes.items():
                memory = process.memory_info()

                # Process CPU can exceed 100% when using multiple cores.
                # Divide by the logical CPU count to use a 0–100% machine scale.
                cpu_percent = (
                    process.cpu_percent(interval=None) / logical_cpus
                )

                stats[name]["peak_cpu_percent_of_machine"] = round(
                    max(
                        stats[name]["peak_cpu_percent_of_machine"],
                        cpu_percent,
                    ),
                    2,
                )

                stats[name]["peak_rss_mib"] = round(
                    max(stats[name]["peak_rss_mib"], memory.rss / MIB),
                    2,
                )

                stats[name]["peak_private_mib"] = round(
                    max(stats[name]["peak_private_mib"], memory.private / MIB),
                    2,
                )

    finally:
        # If this script is interrupted, stop its test client.
        # The existing Node and Python servers remain running.
        if client.poll() is None:
            client.terminate()
            client.wait()

elapsed = perf_counter() - started

for name, process in processes.items():
    used_cpu_seconds = cpu_seconds(process) - cpu_starts[name]

    stats[name]["average_cpu_percent_of_machine"] = round(
        100 * used_cpu_seconds / (elapsed * logical_cpus),
        2,
    )

report = {
    "streams_requested": 1,
    "streams_passed": int(client.returncode == 0),
    "client_exit_code": client.returncode,
    "measurement_seconds": round(elapsed, 3),
    "physical_cores": psutil.cpu_count(logical=False),
    "logical_cpus": logical_cpus,
    "total_ram_gib": round(
        psutil.virtual_memory().total / (1024 ** 3),
        2,
    ),
    "minimum_available_ram_mib": round(
        minimum_available_ram / MIB,
        2,
    ),
    "peak_system_cpu_percent": round(peak_system_cpu, 2),
    "processes": stats,
}

# Save the report and also display it in the terminal.
report_text = json.dumps(report, indent=2)
report_path = output_dir / "resources.json"
report_path.write_text(report_text, encoding="utf-8")

print(report_text)
print(f"\nResource report: {report_path}")
print(f"Transcription log: {log_path}")

if client.returncode != 0:
    raise SystemExit("The stream failed. Check stream.log for the error.")