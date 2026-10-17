export async function readPcmWav(file) {
  // Require a selected, nonempty file within our API's upload limit.
  if (!file || file.size === 0 || file.size > 2_000_000) {
    throw new Error('Choose a nonempty WAV file no larger than 2,000,000 bytes.')
  }

  // Read the browser's File object into a block of bytes.
  const buffer = await file.arrayBuffer()

  // A RIFF/WAVE file needs at least its 12-byte container header.
  if (buffer.byteLength < 12) {
    throw new Error('The file is too short to be a WAV recording.')
  }

  // DataView lets us read numbers stored at specific byte positions.
  const view = new DataView(buffer)

  // Convert four bytes at a position into a section name.
  function readTag(position) {
    return String.fromCharCode(
      ...new Uint8Array(buffer, position, 4),
    )
  }

  // Check the container identifier and its audio-file type.
  if (readTag(0) !== 'RIFF' || readTag(8) !== 'WAVE') {
    throw new Error('Choose a standard RIFF/WAVE recording.')
  }

  // RIFF's stored size excludes its first eight bytes.
  const riffEnd = view.getUint32(4, true) + 8

  // Reject an impossible or incomplete container.
  if (riffEnd < 12 || riffEnd > buffer.byteLength) {
    throw new Error('The WAV file is incomplete or has an invalid size.')
  }

  let offset = 12       // Start after the container header.
  let formatFound = false
  let pcm = null       // No audio section has been found yet.

  // Each section starts with a four-byte name and four-byte size.
  while (offset + 8 <= riffEnd) {
    const tag = readTag(offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + size

    if (end > riffEnd) {
      throw new Error('A WAV section extends beyond the available data.')
    }

    if (tag === 'fmt ') {
      // A standard PCM format section needs at least sixteen bytes.
      if (formatFound || size < 16) {
        throw new Error('The WAV format section is invalid or duplicated.')
      }

      const formatCode = view.getUint16(start, true)
      const channels = view.getUint16(start + 2, true)
      const sampleRate = view.getUint32(start + 4, true)
      const byteRate = view.getUint32(start + 8, true)
      const blockAlign = view.getUint16(start + 12, true)
      const bitsPerSample = view.getUint16(start + 14, true)

      // These values describe our supported audio format.
      if (
        formatCode !== 1 ||
        channels !== 1 ||
        sampleRate !== 16000 ||
        bitsPerSample !== 16 ||
        blockAlign !== 2 ||
        byteRate !== 32000
      ) {
        throw new Error('Use a 16 kHz, mono, 16-bit PCM WAV recording.')
      }

      formatFound = true
    } else if (tag === 'data') {
      if (pcm !== null) {
        throw new Error('WAV files with multiple audio sections are unsupported.')
      }

      // Copy only the audio bytes, excluding headers and metadata.
      pcm = buffer.slice(start, end)
    }

    // Odd-sized sections have one padding byte before the next section.
    offset = end + (size % 2)
  }

  if (offset !== riffEnd) {
    throw new Error('The WAV file contains an incomplete section or padding.')
  }

  // Sixteen-bit samples occupy two bytes, so the length must be even.
  if (!formatFound || pcm === null || pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) {
    throw new Error('The WAV file must contain valid format and audio sections.')
  }

  // 16,000 samples/second × one channel × two bytes/sample.
  const audioSeconds = pcm.byteLength / 32000

  if (audioSeconds > 60) {
    throw new Error('Choose a recording no longer than 60 seconds.')
  }

  // Supply the extracted audio and its validated properties to React.
  return {
    pcm,
    audioSeconds,
    sampleRate: 16000,
    channels: 1,
    bitsPerSample: 16,
  }
}