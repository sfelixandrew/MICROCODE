/**
 * Cryptographic hashing utilities for MICROCODE INSPECTOR.
 * Uses native Web Crypto API in browser environments, with fallback for Node/test runners.
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
  } catch (err) {
    throw new Error('SHA-256 computation unavailable: no crypto API found in runtime environment.');
  }
}

