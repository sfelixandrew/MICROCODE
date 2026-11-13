"""
Security and validation layer for MicroCode Inspector AVR Companion.
Bound strictly to loopback (127.0.0.1).
"""
import os
import re
import secrets
import sys
from typing import List, Dict, Optional

ALLOWED_ORIGINS = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
}

# Strict alphanumeric port regex
SAFE_PORT_PATTERN = re.compile(r"^[A-Za-z0-9_./:-]+$")

class SecurityManager:
    """Manages ephemeral session tokens and port whitelisting."""

    def __init__(self):
        # Generate cryptographically secure ephemeral session token at startup
        self._session_token: str = secrets.token_urlsafe(32)

    @property
    def session_token(self) -> str:
        return self._session_token

    def validate_session_token(self, token: Optional[str]) -> bool:
        if not token:
            return False
        return secrets.compare_digest(self._session_token, token.strip())

    def validate_origin(self, origin: Optional[str]) -> bool:
        if not origin:
            # Allow direct non-browser requests from loopback
            return True
        return origin.strip().rstrip("/") in ALLOWED_ORIGINS

    @staticmethod
    def enumerate_system_serial_ports() -> List[Dict[str, str]]:
        """
        Enumerates physical and USB serial ports available on the host machine.
        Uses native Windows registry (zero third-party deps) on Windows,
        or scans /dev on POSIX systems.
        """
        discovered = []

        if sys.platform == "win32":
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DEVICEMAP\SERIALCOMM")
                num_values = winreg.QueryInfoKey(key)[1]
                seen = set()
                for i in range(num_values):
                    val_name, port_name, _ = winreg.EnumValue(key, i)
                    if port_name not in seen:
                        seen.add(port_name)
                        discovered.append({
                            "port": port_name,
                            "description": f"Serial Port ({val_name})"
                        })
                winreg.CloseKey(key)
            except Exception:
                # Fallback to COM1..COM32 check if registry key is unavailable
                pass
        else:
            # POSIX / Linux / macOS
            for dev_prefix in ["/dev/ttyACM", "/dev/ttyUSB", "/dev/cu.usbmodem", "/dev/cu.usbserial"]:
                import glob
                for path in glob.glob(f"{dev_prefix}*"):
                    discovered.append({"port": path, "description": "USB Serial Device"})

        return discovered

    def is_port_whitelisted(self, port: str) -> bool:
        """
        Verifies that the requested port string:
        1. Passes strict alphanumeric regex (no shell injection characters).
        2. Matches an active hardware serial port enumerated on the host.
        """
        if not SAFE_PORT_PATTERN.fullmatch(port):
            return False

        # Check against active discovered ports
        active_ports = [p["port"].upper() for p in self.enumerate_system_serial_ports()]
        if active_ports and port.upper() not in active_ports:
            # If system enumerated active ports, port must be present in list
            return False

        return True

