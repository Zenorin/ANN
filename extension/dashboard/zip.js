/* Minimal dependency-free ZIP writer (deflate via CompressionStream, UTF-8 names).
 * Usage:
 *   const zip = new ZipWriter();
 *   await zip.add('a/b.txt', 'hello');            // string | Uint8Array | ArrayBuffer | Blob
 *   const blob = await zip.finish();               // Blob (application/zip)
 */
(function (global) {
  'use strict';

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes, seed = 0) {
    let c = (seed ^ 0xffffffff) >>> 0;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (typeof input === 'string') return new TextEncoder().encode(input);
    if (typeof Blob !== 'undefined' && input instanceof Blob) return new Uint8Array(await input.arrayBuffer());
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new Error('ZipWriter: unsupported input type');
  }
  async function deflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function dosDateTime(d) {
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    return { date: date & 0xffff, time: time & 0xffff };
  }
  const NO_COMPRESS = /\.(png|jpe?g|gif|webp|avif|woff2?|zip|gz|br|mp4|webm|mp3|ogg|m4a|pdf|ico)$/i;

  class ZipWriter {
    constructor() { this.entries = []; this.names = new Set(); this.totalSize = 0; }
    has(name) { return this.names.has(name); }
    async add(name, input, opts = {}) {
      name = String(name).replace(/\\/g, '/').replace(/^\/+/, '');
      if (this.names.has(name)) throw new Error(`ZipWriter: duplicate entry ${name}`);
      const bytes = await toBytes(input);
      const crc = crc32(bytes);
      let method = 0;
      let data = bytes;
      const compress = opts.compress != null ? opts.compress : !NO_COMPRESS.test(name);
      if (compress && bytes.length > 32) {
        try { const d = await deflateRaw(bytes); if (d.length < bytes.length) { method = 8; data = d; } } catch { /* store */ }
      }
      const { date, time } = dosDateTime(opts.date || new Date());
      this.entries.push({ name, nameBytes: new TextEncoder().encode(name), crc, size: bytes.length, csize: data.length, data, method, date, time });
      this.names.add(name);
      this.totalSize += bytes.length;
    }
    async finish() {
      const parts = [];
      let offset = 0;
      const central = [];
      for (const e of this.entries) {
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true);
        lh.setUint16(4, 20, true);        // version needed
        lh.setUint16(6, 0x0800, true);    // flags: UTF-8 names
        lh.setUint16(8, e.method, true);
        lh.setUint16(10, e.time, true);
        lh.setUint16(12, e.date, true);
        lh.setUint32(14, e.crc, true);
        lh.setUint32(18, e.csize, true);
        lh.setUint32(22, e.size, true);
        lh.setUint16(26, e.nameBytes.length, true);
        lh.setUint16(28, 0, true);
        parts.push(lh.buffer, e.nameBytes, e.data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true);
        ch.setUint16(4, 0x0314, true);    // made by: UNIX, spec 2.0
        ch.setUint16(6, 20, true);
        ch.setUint16(8, 0x0800, true);
        ch.setUint16(10, e.method, true);
        ch.setUint16(12, e.time, true);
        ch.setUint16(14, e.date, true);
        ch.setUint32(16, e.crc, true);
        ch.setUint32(20, e.csize, true);
        ch.setUint32(24, e.size, true);
        ch.setUint16(28, e.nameBytes.length, true);
        ch.setUint16(30, 0, true);        // extra
        ch.setUint16(32, 0, true);        // comment
        ch.setUint16(34, 0, true);        // disk
        ch.setUint16(36, 0, true);        // internal attrs
        ch.setUint32(38, 0x81a40000, true); // external attrs: -rw-r--r--
        ch.setUint32(42, offset, true);
        central.push(ch.buffer, e.nameBytes);
        offset += 30 + e.nameBytes.length + e.csize;
      }
      const cdStart = offset;
      let cdSize = 0;
      for (const c of central) cdSize += c.byteLength;
      const eocd = new DataView(new ArrayBuffer(22));
      eocd.setUint32(0, 0x06054b50, true);
      eocd.setUint16(4, 0, true);
      eocd.setUint16(6, 0, true);
      eocd.setUint16(8, this.entries.length, true);
      eocd.setUint16(10, this.entries.length, true);
      eocd.setUint32(12, cdSize, true);
      eocd.setUint32(16, cdStart, true);
      eocd.setUint16(20, 0, true);
      return new Blob([...parts, ...central, eocd.buffer], { type: 'application/zip' });
    }
  }

  global.ZipWriter = ZipWriter;
  global.zipCrc32 = crc32;
})(typeof self !== 'undefined' ? self : globalThis);
