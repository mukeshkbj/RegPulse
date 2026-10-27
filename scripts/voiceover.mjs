// Generates the video voiceover with ElevenLabs, one MP3 per scene in video/audio/.
// Needs ELEVENLABS_API_KEY in .env.local. Optional: ELEVENLABS_VOICE_ID, ELEVENLABS_MODEL.
// Usage: npm run voiceover            (all scenes)
//        npm run voiceover 05-evidence (one scene, to redo a take)
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const key = process.env.ELEVENLABS_API_KEY;
// Default: "George", a warm British male voice from the ElevenLabs library. Swap for any voice ID you like.
const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
if (!key) { console.error('Add ELEVENLABS_API_KEY to .env.local first.'); process.exit(1); }

const { scenes } = JSON.parse(readFileSync('video/narration.json', 'utf8'));
const only = process.argv[2];
mkdirSync('video/audio', { recursive: true });

for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i];
  if (only && s.id !== only) continue;
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: s.text,
      model_id: model,
      // Neighbouring text keeps intonation consistent across separate clips.
      previous_text: scenes[i - 1]?.text,
      next_text: scenes[i + 1]?.text,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!res.ok) { console.error(`${s.id}: ${res.status} ${await res.text()}`); process.exit(1); }
  const file = `video/audio/${s.id}.mp3`;
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${file}  (${s.text.split(/\s+/).length} words)`);
}
