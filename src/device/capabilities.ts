/**
 * Browser & USB Serial Capabilities Detection
 * MICROCODE INSPECTOR — STAGE 3
 */

export interface BrowserCapabilityReport {
  readonly hasWebSerial: boolean;
  readonly isSecureContext: boolean;
  readonly isSupported: boolean;
  readonly limitationReason?: string;
}

/**
 * Checks if the current browser environment supports the W3C Web Serial API.
 * Strict conditions:
 * 1. navigator.serial must be present.
 * 2. Window context must be secure (localhost or HTTPS).
 */
export function detectBrowserCapabilities(): BrowserCapabilityReport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      hasWebSerial: false,
      isSecureContext: false,
      isSupported: false,
      limitationReason: 'Execution environment is not a browser window.',
    };
  }

  const isSecureContext = Boolean(window.isSecureContext);
  const hasWebSerial = 'serial' in navigator && typeof (navigator as any).serial?.requestPort === 'function';

  if (!isSecureContext) {
    return {
      hasWebSerial,
      isSecureContext: false,
      isSupported: false,
      limitationReason: 'Web Serial requires a secure context (HTTPS or http://localhost / http://127.0.0.1).',
    };
  }

  if (!hasWebSerial) {
    return {
      hasWebSerial: false,
      isSecureContext: true,
      isSupported: false,
      limitationReason: 'Web Serial API is unsupported in this browser. Please use desktop Google Chrome, Microsoft Edge, or Opera.',
    };
  }

  return {
    hasWebSerial: true,
    isSecureContext: true,
    isSupported: true,
  };
}

/**
 * Probes the local AVR companion agent on loopback without throwing exceptions.
 */
export async function probeLocalCompanion(
  baseUrl: string = 'http://127.0.0.1:8765',
  timeoutMs: number = 1500
): Promise<{ isReachable: boolean; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      return { isReachable: true, message: 'Local AVR companion is running.' };
    }
    return { isReachable: false, message: `Companion returned HTTP ${res.status}.` };
  } catch (err: any) {
    clearTimeout(timer);
    return {
      isReachable: false,
      message: err.name === 'AbortError' ? 'Companion connection timed out.' : 'Local AVR companion is not running.',
    };
  }
}
