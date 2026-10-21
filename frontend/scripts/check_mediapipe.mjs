import fs from 'fs';
import path from 'path';

const taskFilePath = path.resolve('frontend/public/mediapipe/hand_landmarker.task');

if (!fs.existsSync(taskFilePath)) {
  console.error(`ERROR: File does not exist at ${taskFilePath}`);
  process.exit(1);
}

const stats = fs.statSync(taskFilePath);
console.log(`Checking ${taskFilePath} (${stats.size} bytes)`);

const buffer = fs.readFileSync(taskFilePath);

// Find End of Central Directory Record (EOCD signature 0x06054b50)
const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const eocdIndex = buffer.lastIndexOf(eocdSig);

if (eocdIndex === -1) {
  console.error('ERROR: No EOCD record found in ZIP!');
  process.exit(1);
}

const totalEntries = buffer.readUInt16LE(eocdIndex + 10);
const cdSize = buffer.readUInt32LE(eocdIndex + 12);
const cdOffset = buffer.readUInt32LE(eocdIndex + 16);

console.log(`EOCD verified: totalEntries=${totalEntries}, cdSize=${cdSize}, cdOffset=${cdOffset}`);

let offset = cdOffset;
const entries = [];

for (let i = 0; i < totalEntries; i++) {
  if (buffer.readUInt32LE(offset) !== 0x02014b50) {
    console.error(`ERROR: Invalid Central Directory header signature at offset ${offset}`);
    break;
  }
  const compSize = buffer.readUInt32LE(offset + 20);
  const uncompSize = buffer.readUInt32LE(offset + 24);
  const nameLen = buffer.readUInt16LE(offset + 28);
  const extraLen = buffer.readUInt16LE(offset + 30);
  const commentLen = buffer.readUInt16LE(offset + 32);
  const fileName = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

  entries.push({ fileName, compSize, uncompSize });
  offset += 46 + nameLen + extraLen + commentLen;
}

console.log('Central Directory entries in hand_landmarker.task:');
entries.forEach(e => console.log(` - ${e.fileName}: uncompressed=${e.uncompSize} bytes, compressed=${e.compSize} bytes`));
