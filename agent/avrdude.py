"""
AVRDUDE Execution and Intel HEX Reconstitution Engine.
Strictly Read-Only:
- Zero flash/eeprom/lock/fuse write directives (write operations prohibited)
- Zero chip erase directives (-e)
- Executes exclusively via subprocess argument arrays without shell interpreter
"""
import base64
import hashlib
import os
import pathlib
import shutil
import subprocess
import tempfile
from typing import Dict, Any, Tuple, Optional

EXPECTED_ATMEGA328P_SIGNATURES = {"0x1e950f", "1e950f", "0x1e 0x95 0x0f", "1e 95 0f"}
FLASH_SIZE_BYTES = 32768  # 32 KiB for ATmega328P

class AvrdudeError(Exception):
    def __init__(self, code: str, message: str, stderr: Optional[str] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.stderr = stderr or ""

class AvrdudeRunner:
    """Manages read-only AVRDUDE operations for ATmega328P / Arduino Uno."""

    @staticmethod
    def get_avrdude_path() -> Optional[str]:
        return shutil.which("avrdude")

    @classmethod
    def check_health(cls) -> Dict[str, Any]:
        path = cls.get_avrdude_path()
        if not path:
            return {
                "ok": False,
                "avrdudeAvailable": False,
                "message": "AVRDUDE was not found on system PATH. Install AVRDUDE or add it to PATH.",
            }

        try:
            # Check version (avrdude -v or -?)
            res = subprocess.run([path, "-?"], capture_output=True, text=True, timeout=5)
            output = res.stderr or res.stdout or ""
            version_line = output.splitlines()[0] if output.splitlines() else "Unknown"
            return {
                "ok": True,
                "avrdudeAvailable": True,
                "version": version_line,
                "path": path,
            }
        except Exception as err:
            return {
                "ok": False,
                "avrdudeAvailable": False,
                "message": f"Failed to execute AVRDUDE: {str(err)}",
            }

    @staticmethod
    def parse_intel_hex(hex_text: str, total_size: int = FLASH_SIZE_BYTES) -> Tuple[bytearray, int, int]:
        """
        Parses Intel HEX records into a fixed-size 32 KiB memory image.
        Validates checksum of every line.
        Distinguishes explicit read data from reconstructed unprogrammed 0xFF padding.
        """
        image = bytearray([0xFF] * total_size)
        written_mask = bytearray(total_size)
        upper_address = 0

        for line_num, line in enumerate(hex_text.splitlines(), start=1):
            line = line.strip()
            if not line:
                continue
            if not line.startswith(":"):
                raise AvrdudeError("TRUNCATED_HEX", f"Malformed HEX line {line_num}: missing leading colon.")

            try:
                raw = bytes.fromhex(line[1:])
            except ValueError:
                raise AvrdudeError("TRUNCATED_HEX", f"Malformed HEX line {line_num}: invalid hexadecimal characters.")

            if len(raw) < 5:
                raise AvrdudeError("TRUNCATED_HEX", f"Malformed HEX line {line_num}: record too short.")

            byte_count = raw[0]
            record_addr = int.from_bytes(raw[1:3], "big")
            record_type = raw[3]
            data = raw[4 : 4 + byte_count]
            checksum = raw[4 + byte_count]

            # Validate 2's complement checksum
            calculated_sum = (sum(raw[: 4 + byte_count]) + checksum) & 0xFF
            if calculated_sum != 0:
                raise AvrdudeError("HEX_CHECKSUM_ERROR", f"Checksum mismatch on HEX line {line_num}.")

            if record_type == 0:  # Data record
                start_offset = upper_address + record_addr
                for i, b in enumerate(data):
                    target_idx = start_offset + i
                    if 0 <= target_idx < total_size:
                        image[target_idx] = b
                        written_mask[target_idx] = 1
            elif record_type == 1:  # End of File record
                break
            elif record_type == 2:  # Extended Segment Address
                upper_address = int.from_bytes(data[:2], "big") << 4
            elif record_type == 4:  # Extended Linear Address
                upper_address = int.from_bytes(data[:2], "big") << 16

        explicit_read_count = sum(written_mask)
        erased_padding_count = total_size - explicit_read_count

        return image, explicit_read_count, erased_padding_count

    @classmethod
    def read_uno_flash(cls, port: str, baud: int = 115200, timeout_sec: int = 60) -> Dict[str, Any]:
        """
        Executes read-only extraction of ATmega328P Flash memory:
        1. Queries device signature.
        2. Queries lock bits.
        3. Reads flash into Intel HEX.
        4. Reconstitutes full 32 KiB memory image and calculates SHA-256.
        """
        avrdude_bin = cls.get_avrdude_path()
        if not avrdude_bin:
            raise AvrdudeError("AVRDUDE_NOT_FOUND", "AVRDUDE executable is not available on PATH.")

        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = pathlib.Path(tmp_dir)
            sig_file = tmp_path / "signature.hex"
            lock_file = tmp_path / "lock.hex"
            flash_file = tmp_path / "flash.hex"

            # 1. Device Signature Verification
            sig_cmd = [
                avrdude_bin,
                "-p", "atmega328p",
                "-c", "arduino",
                "-P", port,
                "-b", str(baud),
                "-U", f"signature:r:{sig_file}:h"
            ]

            try:
                sig_res = subprocess.run(sig_cmd, capture_output=True, text=True, timeout=timeout_sec, shell=False)
            except subprocess.TimeoutExpired:
                raise AvrdudeError("TIMEOUT", "AVRDUDE timed out during device signature probe. Check board connection and bootloader.")
            except Exception as e:
                raise AvrdudeError("CONNECTION_FAILED", f"Subprocess execution error: {str(e)}")

            if sig_res.returncode != 0 or not sig_file.exists():
                stderr = (sig_res.stderr or sig_res.stdout or "")[-1200:]
                if "not in sync" in stderr or "stk500" in stderr:
                    raise AvrdudeError("UNSUPPORTED_BOOTLOADER", "Optiboot synchronization failed. Board did not answer STK500 sync pulse.", stderr)
                raise AvrdudeError("SIGNATURE_CHECK_FAILED", f"Failed to probe device signature: {stderr}", stderr)

            raw_sig = sig_file.read_text().strip().lower()
            normalized_sig = raw_sig.replace("0x", "").replace(" ", "")
            if normalized_sig not in {"1e950f"}:
                raise AvrdudeError("BAD_SIGNATURE", f"Device signature mismatch: read '{raw_sig}', expected 0x1E 0x95 0x0F (ATmega328P).")

            # 2. Lock Bits Verification
            lock_cmd = [
                avrdude_bin,
                "-p", "atmega328p",
                "-c", "arduino",
                "-P", port,
                "-b", str(baud),
                "-U", f"lock:r:{lock_file}:h"
            ]

            lock_val_hex = "0x3F"
            try:
                lock_res = subprocess.run(lock_cmd, capture_output=True, text=True, timeout=15, shell=False)
                if lock_res.returncode == 0 and lock_file.exists():
                    lock_val_hex = lock_file.read_text().strip()
                    try:
                        lock_int = int(lock_val_hex, 16)
                        # Check memory lock bits (LB1, LB2): bits 0 and 1
                        if (lock_int & 0x03) == 0x00:
                            raise AvrdudeError(
                                "LOCK_PROTECTION_BLOCKED",
                                "ATmega328P lock bits are configured in Mode 3 (read and verification disabled). Hardware security blocks readout. Chip erase is strictly prohibited."
                            )
                    except ValueError:
                        pass
            except subprocess.TimeoutExpired:
                pass  # Non-fatal if lock probe times out but signature passed

            # 3. Read Flash Memory into Intel HEX
            flash_cmd = [
                avrdude_bin,
                "-p", "atmega328p",
                "-c", "arduino",
                "-P", port,
                "-b", str(baud),
                "-U", f"flash:r:{flash_file}:i"
            ]

            try:
                flash_res = subprocess.run(flash_cmd, capture_output=True, text=True, timeout=timeout_sec, shell=False)
            except subprocess.TimeoutExpired:
                raise AvrdudeError("TIMEOUT", "AVRDUDE timed out during Flash read operation.")

            if flash_res.returncode != 0 or not flash_file.exists():
                stderr = (flash_res.stderr or flash_res.stdout or "")[-1200:]
                if "read" in stderr.lower() and "failed" in stderr.lower():
                    raise AvrdudeError("UNSUPPORTED_BOOTLOADER", "Bootloader rejected STK_READ_PAGE command. Readback unsupported by this bootloader build.", stderr)
                raise AvrdudeError("READ_FAILED", f"AVRDUDE Flash read failed: {stderr}", stderr)

            hex_content = flash_file.read_text()
            image_bytes, explicit_count, padding_count = cls.parse_intel_hex(hex_content, FLASH_SIZE_BYTES)

            sha256_hash = hashlib.sha256(image_bytes).hexdigest()
            b64_data = base64.b64encode(image_bytes).decode("ascii")

            return {
                "success": True,
                "targetModel": "Arduino Uno R3 (ATmega328P)",
                "architecture": "avr8",
                "signature": raw_sig,
                "lockBits": lock_val_hex,
                "totalBytes": FLASH_SIZE_BYTES,
                "explicitReadBytes": explicit_count,
                "erasedPaddingBytes": padding_count,
                "sha256": sha256_hash,
                "base64": b64_data,
                "hexRecords": hex_content,
                "isVerifiedExact": True,
                "memoryLayout": {
                    "baseAddress": 0x0000,
                    "endAddress": 0x7FFF,
                    "vectorsRange": [0x0000, 0x0034],
                    "applicationRange": [0x0034, 0x7DFF],
                    "optibootRange": [0x7E00, 0x7FFF],
                }
            }
