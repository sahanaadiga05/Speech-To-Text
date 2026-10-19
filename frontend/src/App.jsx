import { useEffect, useRef, useState } from 'react'
import { readPcmWav } from './readWav'
import { startTranscription } from './transcribeAudio'
import './App.css'

const EMPTY_METRICS = {
  firstTextSeconds: null,
  totalSeconds: null,
  inferenceSeconds: null,
  rtf: null,
}

function formatSeconds(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} s` : '—'
}

async function checkServices(signal) {
  const response = await fetch('/api/inference/health', {
    signal,
  })

  if (!response.ok) {
    throw new Error(
      'Transcription services are unavailable. Check that the Node.js backend and Python helper are running.',
    )
  }

  const result = await response.json()

  if (
    result.status !== 'ready' ||
    result.inference?.status !== 'ready'
  ) {
    throw new Error(
      result.error || 'The transcription model is not ready.',
    )
  }
}

function App() {
  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('English')
  const [audioInfo, setAudioInfo] = useState(null)
  const [fileError, setFileError] = useState('')
  const [isReading, setIsReading] = useState(false)

  const [isRunning, setIsRunning] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [sessionState, setSessionState] = useState('idle')
  const [sessionMessage, setSessionMessage] = useState(
    'Choose a recording to begin.',
  )

  const [progress, setProgress] = useState(0)
  const [transcription, setTranscription] = useState(null)
  const [metrics, setMetrics] = useState(EMPTY_METRICS)

  // Live elapsed time, measured from clicking Start.
  const [elapsedSeconds, setElapsedSeconds] = useState(null)

  const sessionRef = useRef(null)
  const runIdRef = useRef(0)
  const startedAtRef = useRef(null)
  const clockRef = useRef(null)

  useEffect(() => {
    return () => {
      runIdRef.current += 1

      clearInterval(clockRef.current)
      clockRef.current = null

      sessionRef.current?.cancel()
      sessionRef.current = null
    }
  }, [])

  function stopClock(atSeconds = null) {
    if (clockRef.current === null) {
      return
    }

    clearInterval(clockRef.current)
    clockRef.current = null

    if (startedAtRef.current !== null) {
      const seconds = Number.isFinite(atSeconds)
        ? atSeconds
        : (performance.now() - startedAtRef.current) / 1000

      setElapsedSeconds(seconds)
    }
  }

  function resetResults() {
    clearInterval(clockRef.current)
    clockRef.current = null
    startedAtRef.current = null

    setElapsedSeconds(null)
    setIsProcessing(false)
    setProgress(0)
    setTranscription(null)
    setMetrics(EMPTY_METRICS)
    setSessionState('idle')
    setSessionMessage('Ready when you are.')
  }

  async function handleFileChange(event) {
    const input = event.target
    const selectedFile = input.files?.[0] ?? null

    setFile(null)
    setAudioInfo(null)
    setFileError('')
    resetResults()

    if (!selectedFile) {
      return
    }

    setIsReading(true)

    try {
      const info = await readPcmWav(selectedFile)

      setFile(selectedFile)
      setAudioInfo(info)
    } catch (error) {
      setFileError(
        error.message || 'The recording could not be read.',
      )
      input.value = ''
    } finally {
      setIsReading(false)
    }
  }

  function handleLanguageChange(event) {
    setLanguage(event.target.value)
    resetResults()
  }

  async function handleStart() {
    if (
      !audioInfo ||
      isReading ||
      isRunning ||
      sessionRef.current
    ) {
      return
    }

    // Start before the readiness check.
    const startedAt = performance.now()

    resetResults()

    const runId = runIdRef.current + 1
    runIdRef.current = runId
    startedAtRef.current = startedAt

    setElapsedSeconds(0)
    setIsRunning(true)
    setSessionState('checking')
    setSessionMessage('Checking transcription services...')

    // Refresh the live display every 100 milliseconds.
    clockRef.current = setInterval(() => {
      if (runId !== runIdRef.current) {
        return
      }

      setElapsedSeconds(
        (performance.now() - startedAt) / 1000,
      )
    }, 100)

    const pcm = audioInfo.pcm
    const selectedLanguage = language

    const controller = new AbortController()

    sessionRef.current = {
      cancel: () => controller.abort(),
    }

    const healthTimer = setTimeout(() => {
      controller.abort()
    }, 10000)

    try {
      await checkServices(controller.signal)
      clearTimeout(healthTimer)

      if (runId !== runIdRef.current) {
        return
      }

      sessionRef.current = startTranscription({
        pcm,
        language: selectedLanguage,

        onEvent(event) {
          if (runId !== runIdRef.current) {
            return
          }

          // Use the same Start-click origin for both timers.
          const seconds =
            (performance.now() - startedAt) / 1000

          switch (event.type) {
            case 'connecting':
              setSessionState('connecting')
              setSessionMessage(
                'Connecting to the transcription service...',
              )
              break

            case 'session_started':
              setSessionState('uploading')
              setSessionMessage(
                'Sending the recording in audio chunks...',
              )
              break

            case 'chunk_received':
              setProgress(
                Math.min(
                  100,
                  Math.round(
                    (event.received_bytes / pcm.byteLength) * 100,
                  ),
                ),
              )
              break

            case 'upload_complete':
              setSessionMessage(
                'Upload complete. Waiting for the final transcript...',
              )
              break

            case 'processing':
              setIsProcessing(true)
              setSessionState('processing')
              setSessionMessage(
                'Transcribing the audio received so far...',
              )
              break

            case 'transcript':
              setTranscription(event)
              setIsProcessing(false)

              setMetrics((previous) => ({
                ...previous,

                firstTextSeconds: event.text.trim()
                  ? previous.firstTextSeconds ?? seconds
                  : previous.firstTextSeconds,

                // These are real measurements from the helper.
                inferenceSeconds: event.inference_seconds,
                rtf: event.rtf,

                totalSeconds: event.final
                  ? seconds
                  : previous.totalSeconds,
              }))

              if (event.final) {
                stopClock(seconds)
              }

              setSessionMessage(
                event.final
                  ? 'Final transcript received.'
                  : 'Partial transcript updated.',
              )
              break

            case 'session_ended':
              stopClock(seconds)
              setIsProcessing(false)
              setSessionState('complete')
              setSessionMessage('Transcription complete.')
              break

            case 'error':
            case 'cancelled':
              stopClock(seconds)
              setIsProcessing(false)
              setSessionState(event.type)
              setSessionMessage(event.message)
              break

            default:
              break
          }

          if (
            ['session_ended', 'error', 'cancelled'].includes(event.type)
          ) {
            sessionRef.current = null
            setIsRunning(false)
          }
        },
      })
    } catch (error) {
      if (runId !== runIdRef.current) {
        return
      }

      console.error('Could not start transcription:', error)

      stopClock()
      sessionRef.current = null

      setIsRunning(false)
      setIsProcessing(false)
      setSessionState('error')

      setSessionMessage(
        error.name === 'AbortError'
          ? 'The connection check timed out. Check your backend and model, then try again.'
          : error.message || 'Could not start transcription.',
      )
    } finally {
      clearTimeout(healthTimer)
    }
  }

  function handleStop() {
    // Ignore callbacks from the cancelled session.
    runIdRef.current += 1

    stopClock()

    sessionRef.current?.cancel()
    sessionRef.current = null

    setIsRunning(false)
    setIsProcessing(false)
    setSessionState('cancelled')
    setSessionMessage('The transcription session was stopped.')
  }

  const hasStarted = elapsedSeconds !== null
  const hasFirstText = Number.isFinite(metrics.firstTextSeconds)
  const hasFinalResult = Number.isFinite(metrics.totalSeconds)

  const waitingForFirstText =
    isRunning && !hasFirstText && !transcription?.final

  let pendingMeasurement = '—'

  if (hasStarted) {
    if (isRunning) {
      pendingMeasurement = 'Waiting'
    } else if (sessionState === 'cancelled') {
      pendingMeasurement = 'Stopped'
    } else if (sessionState === 'error') {
      pendingMeasurement = 'Unavailable'
    } else {
      pendingMeasurement = 'No result'
    }
  }

  const firstTextDisplay = hasFirstText
    ? formatSeconds(metrics.firstTextSeconds)
    : waitingForFirstText
      ? formatSeconds(elapsedSeconds)
      : '—'

  const firstTextNote = hasFirstText
    ? 'First text received'
    : waitingForFirstText
      ? 'Waiting for first text'
      : hasStarted
        ? 'No text received'
        : 'Starts when you click Start'

  const finalTimeNote = hasFinalResult
    ? 'Final transcript received'
    : isRunning
      ? 'Live elapsed time'
      : hasStarted
        ? 'Ended without a final result'
        : 'Starts when you click Start'

  const inferenceDisplay = Number.isFinite(metrics.inferenceSeconds)
    ? formatSeconds(metrics.inferenceSeconds)
    : isProcessing
      ? 'Processing…'
      : pendingMeasurement

  return (
    <main>
      <h1>Speech to Text</h1>

      <section>
        <h2>Audio recording</h2>

        <p>
          Choose a 16 kHz, mono, 16-bit PCM WAV recording,
          up to 60 seconds long.
        </p>

        <div>
          <label htmlFor="language">Language</label>

          <select
            id="language"
            value={language}
            onChange={handleLanguageChange}
            disabled={isReading || isRunning}
          >
            <option value="English">English</option>
            <option value="Chinese">Chinese</option>
            <option value="Indonesian">Indonesian</option>
          </select>
        </div>

        <div>
          <label htmlFor="audio-file">WAV file</label>

          <input
            id="audio-file"
            type="file"
            accept=".wav,audio/wav"
            onChange={handleFileChange}
            disabled={isReading || isRunning}
          />
        </div>

        {isReading && (
          <p role="status">Reading and checking the recording...</p>
        )}

        {fileError && (
          <p role="alert" className="file-error">
            {fileError}
          </p>
        )}

        {file && audioInfo && (
          <p>
            <strong>{file.name}</strong>
            <br />
            {audioInfo.audioSeconds.toFixed(3)} seconds
            {' · '}
            {(file.size / 1024).toFixed(1)} KiB
            <br />
            16 kHz · Mono · 16-bit PCM
          </p>
        )}

        <div className="session-actions">
          <button
            type="button"
            onClick={handleStart}
            disabled={!audioInfo || isReading || isRunning}
          >
            {isRunning
              ? sessionState === 'checking'
                ? 'Checking services...'
                : 'Transcribing...'
              : 'Start transcription'}
          </button>

          {isRunning && (
            <button
              type="button"
              className="secondary-button"
              onClick={handleStop}
            >
              Stop session
            </button>
          )}
        </div>

        <div>
          <label htmlFor="audio-upload">
            Audio upload: {progress}%
          </label>

          <progress id="audio-upload" value={progress} max="100" />
        </div>
      </section>

      <section data-status={sessionState}>
        <div className="transcript-heading">
          <h2>Transcript</h2>

          <span
            className="transcript-badge"
            data-final={Boolean(transcription?.final)}
          >
            {transcription
              ? transcription.final
                ? 'Final transcript'
                : `Revision ${transcription.revision}`
              : 'Awaiting audio'}
          </span>
        </div>

        <p role="status" aria-live="polite">
          {sessionMessage}
        </p>

        <div className="transcript-text" aria-live="polite">
          {transcription?.text ||
            (transcription?.final
              ? 'No speech was recognised.'
              : 'Your transcript will appear here.')}
        </div>

        <p>Partial text may change as more audio becomes available.</p>
      </section>

      <section className="wide-card">
  <h2>Performance</h2>

  <dl className="metrics-grid">
    <div>
      <dt>First text latency</dt>

      <dd
        className={
          hasFirstText || waitingForFirstText
            ? 'metric-number'
            : 'metric-status'
        }
      >
        {firstTextDisplay}

        <small className="metric-note">
          {firstTextNote}
        </small>
      </dd>
    </div>

    <div>
      <dt>Final result time</dt>

      <dd
        className={
          hasStarted ? 'metric-number' : 'metric-status'
        }
      >
        {formatSeconds(
          metrics.totalSeconds ?? elapsedSeconds,
        )}

        <small className="metric-note">
          {finalTimeNote}
        </small>
      </dd>
    </div>

    <div>
      <dt>Latest inference time</dt>

      <dd
        className={
          Number.isFinite(metrics.inferenceSeconds)
            ? 'metric-number'
            : 'metric-status'
        }
      >
        {inferenceDisplay}

        <small className="metric-note">
          {isProcessing
            ? 'Request in progress'
            : Number.isFinite(metrics.inferenceSeconds)
              ? 'Measured by the model service'
              : 'Waiting for a completed request'}
        </small>
      </dd>
    </div>

    <div>
      <dt>Latest request RTF</dt>

      <dd
        className={
          Number.isFinite(metrics.rtf)
            ? 'metric-number'
            : 'metric-status'
        }
      >
        {Number.isFinite(metrics.rtf)
          ? metrics.rtf.toFixed(3)
          : pendingMeasurement}

        <small className="metric-note">
          {Number.isFinite(metrics.rtf)
            ? 'Latest completed request'
            : 'Available after a model response'}
        </small>
      </dd>
    </div>
  </dl>
</section>
    </main>
  )
}

export default App