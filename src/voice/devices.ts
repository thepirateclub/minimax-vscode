// The microphone is recorded by ffmpeg in the extension host: a webview of
// VS Code gets no access to the media devices.

// The devices of DirectShow come in lines like
// [in#0 @ 0000] "Mic/Inst 1/2 (Revelator)" (audio)
export function parseDshowAudioDevices(stderr: string): string[] {
  const devices: string[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const match = /"([^"]+)"\s+\(audio\)\s*$/.exec(line);
    if (match && !line.includes('Alternative name')) {
      devices.push(match[1]!);
    }
  }
  return devices;
}

// The first device of a sound card is often a loopback mix, not a voice, so
// a device named as a microphone wins over the order of the list.
export function pickMicrophone(devices: string[], preferred: string): string | undefined {
  if (preferred.length > 0 && devices.includes(preferred)) {
    return preferred;
  }
  const mic = devices.find((name) => /mic|микрофон/i.test(name));
  return mic ?? devices[0];
}

// The recognition needs no stereo and no high rate: mono 16 kHz keeps the
// requests small and the accuracy the same. The samples go to stdout, the
// live text takes the recording while it still runs.
export function recordArgs(
  platform: NodeJS.Platform,
  device: string | undefined,
  maxSeconds: number
): string[] {
  const input =
    platform === 'win32'
      ? ['-f', 'dshow', '-i', 'audio=' + (device ?? '')]
      : platform === 'darwin'
        ? ['-f', 'avfoundation', '-i', ':' + (device ?? 'default')]
        : ['-f', 'pulse', '-i', device ?? 'default'];
  return [
    '-hide_banner', '-loglevel', 'error',
    ...input,
    '-t', String(maxSeconds), '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'
  ];
}
