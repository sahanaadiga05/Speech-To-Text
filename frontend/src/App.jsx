import { useState } from 'react'
import { readPcmWav } from './readWav'
import './App.css'

function App() {
  // Service connection state.
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState(
    'Click below to check the connection.',
  )

  // Recording selection and validation state.
  const [file, setFile] = useState(null)
  const [language, setLanguage] = useState('English')
  const [audioInfo, setAudioInfo] = useState(null)
  const [fileError, setFileError] = useState('')
  const [isReading, setIsReading] = useState(false)

  async function checkServices() {
    setStatus('checking')
    setMessage('Checking transcription services...')

    try {
      const response = await fetch('/api/inference/health', {
        signal: AbortSignal.timeout(10000),
      })

      const result = await response.json()

      if (
        !response.ok ||
        result.status !== 'ready' ||
        result.inference?.status !== 'ready'
      ) {
        throw new Error(
          result.error || 'Transcription services are not ready.',
        )
      }

      setStatus('ready')
      setMessage('Transcription services are ready.')
    } catch (error) {
      console.error('Connection check failed:', error)
      setStatus('error')
      setMessage(
        'Cannot connect. Check that both backend servers are running.',
      )
    }
  }

  async function handleFileChange(event) {
    const input = event.target
    const selectedFile = input.files?.[0] ?? null

    // Clear details belonging to the previous selection.
    setFile(null)
    setAudioInfo(null)
    setFileError('')

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

  return (
    <main>
      <h1>Speech to Text</h1>

      <p>Upload a recording and follow its transcription.</p>

      <section data-status={status}>
        <h2>Service connection</h2>

        <p role="status" aria-live="polite">
          {message}
        </p>

        <button
          type="button"
          onClick={checkServices}
          disabled={status === 'checking'}
        >
          {status === 'checking' ? 'Checking...' : 'Check connection'}
        </button>
      </section>

      <section>
        <h2>Audio recording</h2>

        <p>
          Choose a 16 kHz, mono, 16-bit PCM WAV recording,
          up to 60 seconds long.
        </p>

        <div>
          <label htmlFor="language">Language: </label>

          <select
            id="language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="English">English</option>
            <option value="Chinese">Chinese</option>
            <option value="Indonesian">Indonesian</option>
          </select>
        </div>

        <div>
          <label htmlFor="audio-file">WAV file: </label>

          <input
            id="audio-file"
            type="file"
            accept=".wav,audio/wav"
            onChange={handleFileChange}
            disabled={isReading}
          />
        </div>

        {isReading && (
          <p role="status">
            Reading and checking the recording...
          </p>
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
            Duration: {audioInfo.audioSeconds.toFixed(3)} seconds
            <br />
            Size: {(file.size / 1024).toFixed(1)} KiB
            <br />
            16 kHz · Mono · 16-bit PCM
          </p>
        )}
      </section>
    </main>
  )
}

export default App