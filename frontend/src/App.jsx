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

// Check readiness automatically when Start is clicked.
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
      result.error || 'The transcription model is not ready. Try again shortly.',
    )
  }
}

function App() {
  // Recording selection.
  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('English')
  const [audioInfo, setAudioInfo] = useState(null)
  const [fileError, setFileError] = useState('')
  const [isReading, setIsReading] = useState(false)

  // Transcription information.
  const [isRunning, setIsRunning] = useState(false)
  const [sessionState, setSessionState] = useState('idle')
  const [sessionMessage, setSessionMessage] = useState(
    'Choose a recording to begin.',
  )
  const [progress, setProgress] = useState(0)
  const [transcription, setTranscription] = useState(null)
  const [metrics, setMetrics] = useState(EMPTY_METRICS)

  // Store the current operation's cancellation control.
  const sessionRef = useRef(null)

  // Ignore callbacks from older operations.
  const runIdRef = useRef(0)

  useEffect(() => {
    return () => {
      runIdRef.current += 1
      sessionRef.current?.cancel()
      sessionRef.current = null
    }
  }, [])

  function resetResults() {
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
    // Require valid audio and prevent overlapping operations.
    if (
      !audioInfo ||
      isReading ||
      isRunning ||
      sessionRef.current
    ) {
      return
    }

    resetResults()
    setIsRunning(true)
    setSessionState('checking')
    setSessionMessage('Checking transcription services...')

    const pcm = audioInfo.pcm
    const selectedLanguage = language

    const runId = runIdRef.current + 1
    runIdRef.current = runId

    // Allow Stop to cancel the readiness check.
    const controller = new AbortController()

    sessionRef.current = {
      cancel: () => controller.abort(),
    }

    // Allow ten seconds for the readiness check.
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
              setSessionState('processing')
              setSessionMessage(
                'Transcribing the audio received so far...',
              )
              break

            case 'transcript':
              // Replace the previous text with the newest revision.
              setTranscription(event)

              setMetrics((previous) => ({
                ...previous,

                firstTextSeconds: event.text.trim()
                  ? previous.firstTextSeconds ?? event.elapsed_seconds
                  : previous.firstTextSeconds,

                inferenceSeconds: event.inference_seconds,
                rtf: event.rtf,

                totalSeconds: event.final
                  ? event.elapsed_seconds
                  : previous.totalSeconds,
              }))

              setSessionMessage(
                event.final
                  ? 'Final transcript received.'
                  : 'Partial transcript updated.',
              )
              break

            case 'session_ended':
              setSessionState('complete')
              setSessionMessage('Transcription complete.')
              break

            case 'error':
            case 'cancelled':
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

      sessionRef.current = null
      setIsRunning(false)
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
    runIdRef.current += 1

    sessionRef.current?.cancel()
    sessionRef.current = null

    setIsRunning(false)
    setSessionState('cancelled')
    setSessionMessage('The transcription session was stopped.')
  }

  return (
    <main>
      <h1>Speech to Text</h1>

      {/* Audio recording occupies the left grid column. */}
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

      {/* Transcript occupies the right grid column. */}
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

      {/* Performance spans both columns underneath the two cards. */}
      <section className="wide-card">
        <h2>Performance</h2>

        <dl className="metrics-grid">
          <div>
            <dt>First text latency</dt>
            <dd>{formatSeconds(metrics.firstTextSeconds)}</dd>
          </div>

          <div>
            <dt>Final result time</dt>
            <dd>{formatSeconds(metrics.totalSeconds)}</dd>
          </div>

          <div>
            <dt>Latest inference time</dt>
            <dd>{formatSeconds(metrics.inferenceSeconds)}</dd>
          </div>

          <div>
            <dt>Latest request RTF</dt>
            <dd>
              {Number.isFinite(metrics.rtf)
                ? metrics.rtf.toFixed(3)
                : '—'}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  )
}

export default App