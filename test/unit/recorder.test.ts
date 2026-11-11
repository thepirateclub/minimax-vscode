import { describe, expect, it } from 'vitest';
import { parseDshowAudioDevices, pickMicrophone, recordArgs } from '../../src/voice/devices';

const DSHOW = [
  '[in#0 @ 0000] "OBS Virtual Camera" (none)',
  '[in#0 @ 0000] "Stream Mix A L/R (2- Revelator IO 24)" (audio)',
  '[in#0 @ 0000]   Alternative name "@device_cm_{33D9}\wave_{A611}"',
  '[in#0 @ 0000] "Mic/Inst 1/2 (2- Revelator IO 24)" (audio)',
  '[in#0 @ 0000] "Webcam" (video)',
  'Error opening input file dummy.'
].join('\n');

describe('the microphones of ffmpeg', () => {
  it('lists only the audio devices of DirectShow', () => {
    expect(parseDshowAudioDevices(DSHOW)).toEqual([
      'Stream Mix A L/R (2- Revelator IO 24)',
      'Mic/Inst 1/2 (2- Revelator IO 24)'
    ]);
  });

  it('takes the device of the setting when it exists', () => {
    const devices = parseDshowAudioDevices(DSHOW);
    expect(pickMicrophone(devices, 'Stream Mix A L/R (2- Revelator IO 24)')).toBe(
      'Stream Mix A L/R (2- Revelator IO 24)'
    );
  });

  it('prefers a microphone over a mix when nothing is set', () => {
    // The first device of a sound card is often a loopback mix, not a voice.
    expect(pickMicrophone(parseDshowAudioDevices(DSHOW), '')).toBe(
      'Mic/Inst 1/2 (2- Revelator IO 24)'
    );
    expect(pickMicrophone(['Line In', 'Микрофон (Realtek)'], '')).toBe('Микрофон (Realtek)');
    expect(pickMicrophone(['Line In'], '')).toBe('Line In');
    expect(pickMicrophone([], '')).toBeUndefined();
  });

  it('streams raw mono 16 kHz samples to stdout, the live text reads them', () => {
    const args = recordArgs('win32', 'Mic 1', 480);
    expect(args).toEqual([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'dshow', '-i', 'audio=Mic 1',
      '-t', '480', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'
    ]);
  });

  it('uses the default input on macOS and Linux', () => {
    expect(recordArgs('darwin', undefined, 60).slice(3, 7)).toEqual(['-f', 'avfoundation', '-i', ':default']);
    expect(recordArgs('linux', undefined, 60).slice(3, 7)).toEqual(['-f', 'pulse', '-i', 'default']);
  });
});
