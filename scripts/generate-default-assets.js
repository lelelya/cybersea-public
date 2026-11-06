// Procedural public defaults: no photographs, recordings, or external artwork.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}
function png(file, width, height, pixel) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = pixel(x / width, y / height);
    for (let c = 0; c < 3; c++) raw[y * (width * 3 + 1) + 1 + x * 3 + c] = Math.max(0, Math.min(255, Math.round(rgb[c])));
  }
  fs.writeFileSync(path.join(root, file), Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
for (const size of [192, 512]) png(`public/icon-${size}.png`, size, size, (x,y) => {
  const wave = Math.abs(y - .5 - Math.sin(x * Math.PI * 3) * .08) < .022 && x > .2 && x < .8;
  const ring = Math.abs(Math.hypot(x-.5,y-.5)-.34) < .012;
  return wave || ring ? [103,226,209] : [6,23,39];
});
// Keep the author's AI-generated deep-sea-bg.png unchanged.
// Four-second seamless synthetic noise loops. These are generated signals, not field recordings.
fs.mkdirSync(path.join(root, 'audio'), {recursive:true});
for (const [index, name] of ['ocean','rain','wind'].entries()) {
  const rate = 16000, count = rate * 4, pcm = Buffer.alloc(count*2);
  let seed = 12345 + index, smooth = 0;
  for(let i=0;i<count;i++) {
    seed = (Math.imul(seed,1664525)+1013904223) >>> 0;
    const noise = seed/0x80000000-1;
    smooth = smooth * .95 + noise * .05;
    const fade = Math.min(1,i/400,(count-1-i)/400);
    const value = (index===1 ? noise*.1 : smooth*.6) * fade;
    pcm.writeInt16LE(Math.round(value*32767),i*2);
  }
  const wav = Buffer.alloc(44);
  wav.write('RIFF'); wav.writeUInt32LE(36+pcm.length,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(rate,24); wav.writeUInt32LE(rate*2,28);
  wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(pcm.length,40);
  fs.writeFileSync(path.join(root,'audio',name+'.wav'),Buffer.concat([wav,pcm]));
}
console.log('Generated default icons and synthetic ambient audio; original background preserved');
