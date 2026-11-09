/**
 * ffmpeg arguments of the live MP3 encoder (server/utils/mixer.ts): f32le stereo 48 kHz in,
 * bare CBR 192k frames out (576 bytes, 1152 samples each). test/pcmBlocks.test.ts decodes
 * their output to check the client's sample numbering.
 */
export const MP3_ENCODE_ARGS = [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0',
  '-c:a', 'libmp3lame', '-b:a', '192k', '-flush_packets', '1',
  '-id3v2_version', '0', '-write_xing', '0', '-f', 'mp3', 'pipe:1', // bare frames only
]
