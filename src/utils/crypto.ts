/**
 * Cryptographic hashing utilities for MICROCODE INSPECTOR.
 * Uses native Web Crypto API in browser environments, with fallback for Node/test runners.
 * Includes pure-TypeScript MD5 for offline partition table validation.
 */

export async function computeSha256(data: Uint8Array): Promise<string> {
  // Check for Web Crypto API (browser / modern Node)
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Node.js crypto fallback
  try {
    const nodeCrypto = await import('node:crypto');
    const hash = nodeCrypto.createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  } catch {
    throw new Error('SHA-256 computation unavailable: no crypto API found in runtime environment.');
  }
}

// Pure TypeScript implementation of MD5 for offline ESP-IDF partition table validation
function md5Cycle(x: Int32Array, k: number[]): void {
  let [a, b, c, d] = [x[0], x[1], x[2], x[3]];

  const cmn = (q: number, a: number, b: number, x: number, s: number, t: number) => {
    a = (a + q + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  };
  const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) =>
    cmn(c ^ (b | ~d), a, b, x, s, t);

  a = ff(a, b, c, d, k[0], 7, -680876936);
  d = ff(d, a, b, c, k[1], 12, -389564586);
  c = ff(c, d, a, b, k[2], 17, 606105819);
  b = ff(b, c, d, a, k[3], 22, -1044525330);
  a = ff(a, b, c, d, k[4], 7, -176418897);
  d = ff(d, a, b, c, k[5], 12, 1200080426);
  c = ff(c, d, a, b, k[6], 17, -1473231341);
  b = ff(b, c, d, a, k[7], 22, -45705983);
  a = ff(a, b, c, d, k[8], 7, 1770035416);
  d = ff(d, a, b, c, k[9], 12, -1958414417);
  c = ff(c, d, a, b, k[10], 17, -42063);
  b = ff(b, c, d, a, k[11], 22, -1990404162);
  a = ff(a, b, c, d, k[12], 7, 1804603682);
  d = ff(d, a, b, c, k[13], 12, -40341101);
  c = ff(c, d, a, b, k[14], 17, -1502002290);
  b = ff(b, c, d, a, k[15], 22, 1236535329);

  a = gg(a, b, c, d, k[1], 5, -165796510);
  d = gg(d, a, b, c, k[6], 9, -1069501632);
  c = gg(c, d, a, b, k[11], 14, 643717713);
  b = gg(b, c, d, a, k[0], 20, -373897302);
  a = gg(a, b, c, d, k[5], 5, -701558691);
  d = gg(d, a, b, c, k[10], 9, 38016083);
  c = gg(c, d, a, b, k[15], 14, -660478335);
  b = gg(b, c, d, a, k[4], 20, -405537848);
  a = gg(a, b, c, d, k[9], 5, 568446438);
  d = gg(d, a, b, c, k[14], 9, -1019803690);
  c = gg(c, d, a, b, k[3], 14, -187363961);
  b = gg(b, c, d, a, k[8], 20, 1163531501);
  a = gg(a, b, c, d, k[13], 5, -1444681467);
  d = gg(d, a, b, c, k[2], 9, -51403784);
  c = gg(c, d, a, b, k[7], 14, 1735328473);
  b = gg(b, c, d, a, k[12], 20, -1926607734);

  a = hh(a, b, c, d, k[5], 4, -378558);
  d = hh(d, a, b, c, k[8], 11, -2022574463);
  c = hh(c, d, a, b, k[11], 16, 1839030562);
  b = hh(b, c, d, a, k[14], 23, -35309556);
  a = hh(a, b, c, d, k[1], 4, -1530992060);
  d = hh(d, a, b, c, k[4], 11, 1272893353);
  c = hh(c, d, a, b, k[7], 16, -155497632);
  b = hh(b, c, d, a, k[10], 23, -1094730640);
  a = hh(a, b, c, d, k[13], 4, 681279174);
  d = hh(d, a, b, c, k[0], 11, -358537222);
  c = hh(c, d, a, b, k[3], 16, -722521979);
  b = hh(b, c, d, a, k[6], 23, 76029189);
  a = hh(a, b, c, d, k[9], 4, -640364487);
  d = hh(d, a, b, c, k[12], 11, -421815835);
  c = hh(c, d, a, b, k[15], 16, 530742520);
  b = hh(b, c, d, a, k[2], 23, -995338651);

  a = ii(a, b, c, d, k[0], 6, -198630844);
  d = ii(d, a, b, c, k[7], 10, 1126891415);
  c = ii(c, d, a, b, k[14], 15, -1416354905);
  b = ii(b, c, d, a, k[5], 21, -57434055);
  a = ii(a, b, c, d, k[12], 6, 1700485571);
  d = ii(d, a, b, c, k[3], 10, -1894986606);
  c = ii(c, d, a, b, k[10], 15, -1051523);
  b = ii(b, c, d, a, k[1], 21, -2054922799);
  a = ii(a, b, c, d, k[8], 6, 1873313359);
  d = ii(d, a, b, c, k[15], 10, -30611744);
  c = ii(c, d, a, b, k[6], 15, -1560198380);
  b = ii(b, c, d, a, k[13], 21, 1309151649);
  a = ii(a, b, c, d, k[4], 6, -145523070);
  d = ii(d, a, b, c, k[11], 10, -1120210379);
  c = ii(c, d, a, b, k[2], 15, 718787259);
  b = ii(b, c, d, a, k[9], 21, -343485551);

  x[0] = (x[0] + a) | 0;
  x[1] = (x[1] + b) | 0;
  x[2] = (x[2] + c) | 0;
  x[3] = (x[3] + d) | 0;
}

export function computeMd5Sync(data: Uint8Array): string {
  const n = data.length;
  const state = new Int32Array([1732584193, -271733879, -1732584194, 271733878]);
  let i = 64;

  for (; i <= n; i += 64) {
    const chunk = new Array<number>(16);
    for (let j = 0; j < 16; j++) {
      const idx = i - 64 + j * 4;
      chunk[j] = data[idx] | (data[idx + 1] << 8) | (data[idx + 2] << 16) | (data[idx + 3] << 24);
    }
    md5Cycle(state, chunk);
  }

  // Padding
  const tail = new Uint8Array(64);
  const remaining = n - (i - 64);
  tail.set(data.subarray(i - 64, n));
  tail[remaining] = 0x80;

  if (remaining >= 56) {
    const chunk = new Array<number>(16);
    for (let j = 0; j < 16; j++) {
      chunk[j] = tail[j * 4] | (tail[j * 4 + 1] << 8) | (tail[j * 4 + 2] << 16) | (tail[j * 4 + 3] << 24);
    }
    md5Cycle(state, chunk);
    tail.fill(0);
  }

  // Bit count (64-bit integer, low 32 bits and high 32 bits)
  const bitLenLow = (n * 8) & 0xffffffff;
  const bitLenHigh = Math.floor((n * 8) / 0x100000000) & 0xffffffff;
  tail[56] = bitLenLow & 0xff;
  tail[57] = (bitLenLow >>> 8) & 0xff;
  tail[58] = (bitLenLow >>> 16) & 0xff;
  tail[59] = (bitLenLow >>> 24) & 0xff;
  tail[60] = bitLenHigh & 0xff;
  tail[61] = (bitLenHigh >>> 8) & 0xff;
  tail[62] = (bitLenHigh >>> 16) & 0xff;
  tail[63] = (bitLenHigh >>> 24) & 0xff;

  const finalChunk = new Array<number>(16);
  for (let j = 0; j < 16; j++) {
    finalChunk[j] = tail[j * 4] | (tail[j * 4 + 1] << 8) | (tail[j * 4 + 2] << 16) | (tail[j * 4 + 3] << 24);
  }
  md5Cycle(state, finalChunk);

  let hex = '';
  for (let b = 0; b < 4; b++) {
    const word = state[b];
    for (let c = 0; c < 4; c++) {
      hex += ((word >>> (c * 8)) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

export async function computeMd5(data: Uint8Array): Promise<string> {
  return computeMd5Sync(data);
}


