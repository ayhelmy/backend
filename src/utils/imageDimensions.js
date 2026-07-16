'use strict';

/**
 * Reads pixel dimensions directly from PNG/JPEG file headers.
 * Avoids pulling in an image-processing dependency for this one use.
 */
function getImageDimensions(buffer) {
  // PNG: 8-byte signature, then IHDR chunk — width/height are big-endian
  // uint32 at fixed offsets 16 and 20.
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // JPEG: scan markers for the first SOF0–SOF3 segment, which holds height/width.
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length - 9) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width:  buffer.readUInt16BE(offset + 7),
        };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      offset += 2 + segmentLength;
    }
  }

  throw new Error('Unsupported image format — only PNG and JPEG are supported.');
}

module.exports = { getImageDimensions };
