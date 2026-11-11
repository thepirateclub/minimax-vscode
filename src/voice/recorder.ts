import { spawn, type ChildProcess } from 'node:child_process';
import { parseDshowAudioDevices, pickMicrophone, recordArgs } from './devices';

// The recognition takes up to 500 seconds, the recording stops a bit earlier.
export const MAX_RECORD_SECONDS = 480;

export class VoiceError extends Error {}

// Runs ffmpeg and collects its stderr, the device list of DirectShow lives there.
function runForStderr(ffmpeg: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', () => resolve(stderr));
  });
}

export async function listMicrophones(ffmpeg: string): Promise<string[]> {
  if (process.platform !== 'win32') {
    return [];
  }
  const stderr = await runForStderr(ffmpeg, [
    '-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'
  ]);
  return parseDshowAudioDevices(stderr);
}

// One recording of the microphone. ffmpeg writes raw samples to stdout, they
// stay in memory: the live text reads them while the recording runs, and no
// temporary file is left on the disk. The stop asks ffmpeg to finish with
// "q", so the last samples are flushed.
export class Recorder {
  private child: ChildProcess | undefined;
  private chunks: Buffer[] = [];
  private size = 0;
  private joined: Uint8Array = new Uint8Array();
  private stderr = '';
  private closed: Promise<number | null> | undefined;

  constructor(
    private readonly ffmpeg: string,
    private readonly microphone: string
  ) {}

  async start(): Promise<void> {
    let device: string | undefined;
    if (process.platform === 'win32') {
      let devices: string[];
      try {
        devices = await listMicrophones(this.ffmpeg);
      } catch {
        throw new VoiceError(
          'ffmpeg was not found. Install ffmpeg or set minimax.ffmpegPath to record the voice.'
        );
      }
      device = pickMicrophone(devices, this.microphone);
      if (!device) {
        throw new VoiceError('No microphone was found.');
      }
    } else if (this.microphone.length > 0) {
      device = this.microphone;
    }
    const child = spawn(this.ffmpeg, recordArgs(process.platform, device, MAX_RECORD_SECONDS), {
      windowsHide: true
    });
    this.chunks = [];
    this.size = 0;
    this.joined = new Uint8Array();
    this.stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      this.chunks.push(chunk);
      this.size += chunk.length;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr += chunk.toString('utf8');
    });
    this.closed = new Promise((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(-1));
    });
    this.child = child;
    // A wrong device makes ffmpeg exit at once, the error is told now and
    // not after the reader has spoken for a minute.
    const early = await Promise.race([
      this.closed,
      new Promise<'running'>((resolve) => setTimeout(() => resolve('running'), 400))
    ]);
    if (early !== 'running') {
      this.child = undefined;
      throw new VoiceError(
        'The microphone could not be opened' + (device ? ' (' + device + ')' : '') + '. ' +
          (this.stderr.trim().split(/\r?\n/).pop() ?? '')
      );
    }
  }

  // The samples so far. The chunks are joined once per new data, the live
  // text asks every few seconds and the recording only grows.
  snapshot(): Uint8Array {
    if (this.joined.length !== this.size) {
      const whole = Buffer.concat(this.chunks, this.size);
      this.chunks = [whole];
      // An odd byte is half a sample, it waits for the next chunk.
      this.joined = new Uint8Array(whole.buffer, whole.byteOffset, whole.length - (whole.length % 2));
    }
    return this.joined;
  }

  async stop(): Promise<Uint8Array> {
    const child = this.child;
    if (!child) {
      throw new VoiceError('The recording is not running.');
    }
    child.stdin?.write('q');
    child.stdin?.end();
    const timer = setTimeout(() => child.kill(), 3000);
    await this.closed;
    clearTimeout(timer);
    this.child = undefined;
    const pcm = this.snapshot();
    if (pcm.length === 0) {
      throw new VoiceError('The recording is empty. ' + this.stderr.trim());
    }
    return pcm;
  }

  cancel(): void {
    this.child?.kill();
    this.child = undefined;
    this.chunks = [];
    this.size = 0;
  }
}
