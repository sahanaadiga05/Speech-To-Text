export function startTranscription({ pcm, language, onEvent }) {
  const bytesPerSecond = 32000
  const chunkBytes = 8000

  // Start measuring elapsed time before opening the connection.
  const started = performance.now()

  // Connect through Vite using the current page's address.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(
    `${protocol}//${window.location.host}/ws`,
  )

  let offset = 0
  let lastChunkBytes = 0
  let sendTimer = null
  let finished = false
  let finalReceived = false

  // Limit the duration of the complete session to four minutes.
  const timeoutTimer = setTimeout(() => {
    stop('error', 'The transcription session timed out.')
  }, 240000)

  // Forward an event to React, adding its arrival time.
  function emit(event) {
    onEvent({
      ...event,
      elapsed_seconds: (performance.now() - started) / 1000,
    })
  }

  function clearTimers() {
    clearTimeout(sendTimer)
    clearTimeout(timeoutTimer)
  }

  // Finish locally after an error or user cancellation.
  function stop(type, message) {
    if (finished) {
      return
    }

    finished = true
    clearTimers()
    socket.close()
    emit({ type, message })
  }

  function sendNextChunk() {
    if (finished || socket.readyState !== WebSocket.OPEN) {
      return
    }

    // All audio has been sent; request the final transcript.
    if (offset === pcm.byteLength) {
      socket.send(JSON.stringify({ type: 'end' }))
      emit({ type: 'upload_complete' })
      return
    }

    // The last chunk may be smaller than 8,000 bytes.
    const end = Math.min(offset + chunkBytes, pcm.byteLength)
    lastChunkBytes = end - offset

    socket.send(pcm.slice(offset, end))
    offset = end
  }

  socket.onmessage = (event) => {
    if (finished) {
      return
    }

    let message

    try {
      message = JSON.parse(event.data)
    } catch {
      stop('error', 'The server sent an unreadable response.')
      return
    }

    if (!message || typeof message.type !== 'string') {
      stop('error', 'The server sent an invalid session response.')
      return
    }

    if (message.type === 'error') {
      stop('error', message.message || 'Transcription failed.')
      return
    }

    // Confirm that the server acknowledged exactly what we sent.
    if (
      message.type === 'chunk_received' &&
      message.received_bytes !== offset
    ) {
      stop('error', 'The server acknowledged an unexpected audio size.')
      return
    }

    if (message.type === 'transcript' && message.final === true) {
      finalReceived = true
    }

    if (message.type === 'session_ended') {
      if (!finalReceived) {
        stop('error', 'The session ended without a final transcript.')
        return
      }

      finished = true
      clearTimers()
      emit(message)
      socket.close()
      return
    }

    emit(message)

    if (message.type === 'connected') {
      socket.send(JSON.stringify({
        type: 'start',
        language,
      }))
    } else if (message.type === 'session_started') {
      sendNextChunk()
    } else if (message.type === 'chunk_received') {
      // Pace the upload approximately like audio playback.
      const delay = (lastChunkBytes / bytesPerSecond) * 1000
      sendTimer = setTimeout(sendNextChunk, delay)
    }
  }

  socket.onerror = () => {
    stop('error', 'Could not maintain the WebSocket connection.')
  }

  socket.onclose = () => {
    if (!finished) {
      stop('error', 'The connection closed before transcription finished.')
    }
  }

  emit({ type: 'connecting' })

  // React will call this when the user stops the session.
  return {
    cancel() {
      stop('cancelled', 'The transcription session was stopped.')
    },
  }
}