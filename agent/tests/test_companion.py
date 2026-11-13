"""
Unit & Integration Tests for AVR Companion Security and AVRDUDE Engine.
Uses Python's standard unittest library (zero external dependencies).
"""
import base64
import hashlib
import unittest
from unittest.mock import patch, MagicMock

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from security import SecurityManager, ALLOWED_ORIGINS
from avrdude import AvrdudeRunner, AvrdudeError, FLASH_SIZE_BYTES

class TestCompanionSecurity(unittest.TestCase):
    def setUp(self):
        self.security = SecurityManager()

    def test_session_token_generation_and_validation(self):
        token = self.security.session_token
        self.assertTrue(len(token) > 20)
        self.assertTrue(self.security.validate_session_token(token))
        self.assertFalse(self.security.validate_session_token("invalid_token_12345"))
        self.assertFalse(self.security.validate_session_token(None))
        self.assertFalse(self.security.validate_session_token(""))

    def test_origin_validation(self):
        for origin in ALLOWED_ORIGINS:
            self.assertTrue(self.security.validate_origin(origin))
            self.assertTrue(self.security.validate_origin(f"{origin}/"))

        self.assertFalse(self.security.validate_origin("http://evil-website.com"))
        self.assertFalse(self.security.validate_origin("http://localhost:3000"))
        self.assertTrue(self.security.validate_origin(None))  # Non-browser loopback clients

    def test_port_whitelist_and_command_injection_rejection(self):
        # Shell metacharacters must be unconditionally rejected
        self.assertFalse(self.security.is_port_whitelisted("COM1; rm -rf /"))
        self.assertFalse(self.security.is_port_whitelisted("COM1 && calc.exe"))
        self.assertFalse(self.security.is_port_whitelisted("COM1 | whoami"))
        self.assertFalse(self.security.is_port_whitelisted("COM1`touch hack`"))
        self.assertFalse(self.security.is_port_whitelisted("COM1$PATH"))
        self.assertFalse(self.security.is_port_whitelisted(""))

    def test_active_port_enumeration_format(self):
        ports = self.security.enumerate_system_serial_ports()
        self.assertIsInstance(ports, list)
        for p in ports:
            self.assertIn("port", p)
            self.assertIn("description", p)


class TestIntelHexParsing(unittest.TestCase):
    def test_parse_valid_hex_and_trailing_ff_reconstruction(self):
        # Valid Intel HEX with data at 0x0000: 4 bytes [0x0C, 0x94, 0x34, 0x00] (jmp 0x0034)
        # Checksum calculation:
        # byte_count=04, addr=0000, type=00, data=0C 94 34 00
        # sum = 04 + 00 + 00 + 00 + 0C + 94 + 34 + 00 = 0xD8
        # 2's complement = (-0xD8) & 0xFF = 0x28
        sample_hex = (
            ":040000000C94340028\n"
            ":00000001FF\n"  # EOF
        )

        image, read_count, padding_count = AvrdudeRunner.parse_intel_hex(sample_hex, total_size=FLASH_SIZE_BYTES)

        self.assertEqual(len(image), 32768)
        self.assertEqual(read_count, 4)
        self.assertEqual(padding_count, 32764)
        self.assertEqual(image[0], 0x0C)
        self.assertEqual(image[1], 0x94)
        self.assertEqual(image[2], 0x34)
        self.assertEqual(image[3], 0x00)
        # All unwritten trailing bytes must be reconstructed as 0xFF
        self.assertEqual(image[4], 0xFF)
        self.assertEqual(image[32767], 0xFF)

    def test_parse_hex_checksum_error(self):
        corrupted_hex = ":040000000C94340099\n:00000001FF\n"
        with self.assertRaises(AvrdudeError) as cm:
            AvrdudeRunner.parse_intel_hex(corrupted_hex)
        self.assertEqual(cm.exception.code, "HEX_CHECKSUM_ERROR")

    def test_parse_truncated_hex_line(self):
        truncated_hex = ":040000\n"
        with self.assertRaises(AvrdudeError) as cm:
            AvrdudeRunner.parse_intel_hex(truncated_hex)
        self.assertEqual(cm.exception.code, "TRUNCATED_HEX")


class TestAvrdudeRunner(unittest.TestCase):
    @patch("shutil.which")
    def test_missing_avrdude_executable(self, mock_which):
        mock_which.return_value = None
        with self.assertRaises(AvrdudeError) as cm:
            AvrdudeRunner.read_uno_flash(port="COM3")
        self.assertEqual(cm.exception.code, "AVRDUDE_NOT_FOUND")

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_bad_device_signature_rejection(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/avrdude"

        # Mock signature file creation with wrong signature (e.g. ATmega168: 1E 94 06)
        def side_effect(cmd, **kwargs):
            mem_arg = cmd[cmd.index("-U") + 1]
            out_file = ":".join(mem_arg.split(":")[2:-1])
            with open(out_file, "w") as f:
                f.write("0x1e 0x94 0x06\n")
            res = MagicMock()
            res.returncode = 0
            res.stderr = ""
            res.stdout = ""
            return res

        mock_run.side_effect = side_effect

        with self.assertRaises(AvrdudeError) as cm:
            AvrdudeRunner.read_uno_flash(port="COM3")
        self.assertEqual(cm.exception.code, "BAD_SIGNATURE")
        self.assertIn("Device signature mismatch", cm.exception.message)

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_lock_bits_mode3_blocking(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/avrdude"

        def side_effect(cmd, **kwargs):
            res = MagicMock()
            res.returncode = 0
            res.stderr = ""
            res.stdout = ""
            mem_arg = cmd[cmd.index("-U") + 1]
            out_file = ":".join(mem_arg.split(":")[2:-1])
            if "signature" in mem_arg:
                with open(out_file, "w") as f:
                    f.write("0x1e950f\n")
            elif "lock" in mem_arg:
                # Mode 3 lock bits: LB2=0, LB1=0 (0x3C & 0x03 == 0)
                with open(out_file, "w") as f:
                    f.write("0x3C\n")
            return res

        mock_run.side_effect = side_effect

        with self.assertRaises(AvrdudeError) as cm:
            AvrdudeRunner.read_uno_flash(port="COM3")
        self.assertEqual(cm.exception.code, "LOCK_PROTECTION_BLOCKED")
        self.assertIn("Mode 3", cm.exception.message)

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_unsupported_optiboot_readback(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/avrdude"

        def side_effect(cmd, **kwargs):
            res = MagicMock()
            res.stderr = ""
            res.stdout = ""
            mem_arg = cmd[cmd.index("-U") + 1]
            if "signature" in mem_arg:
                res.returncode = 0
                out_file = ":".join(mem_arg.split(":")[2:-1])
                with open(out_file, "w") as f:
                    f.write("0x1e950f\n")
            elif "lock" in mem_arg:
                res.returncode = 0
                out_file = ":".join(mem_arg.split(":")[2:-1])
                with open(out_file, "w") as f:
                    f.write("0x3F\n")
            elif "flash" in mem_arg:
                # Simulates Optiboot build without STK_READ_PAGE
                res.returncode = 1
                res.stderr = "avrdude: stk500_read(): protocol error, STK_READ_PAGE failed"
                res.stdout = ""
            return res

        mock_run.side_effect = side_effect

        with self.assertRaises(AvrdudeError) as cm:
            AvrdudeRunner.read_uno_flash(port="COM3")
        self.assertEqual(cm.exception.code, "UNSUPPORTED_BOOTLOADER")

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_subprocess_timeout(self, mock_run, mock_which):
        import subprocess
        mock_which.return_value = "/usr/bin/avrdude"
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["avrdude"], timeout=60)

        with self.assertRaises(AvrdudeError) as cm:
            AvrdudeRunner.read_uno_flash(port="COM3")
        self.assertEqual(cm.exception.code, "TIMEOUT")

    @patch("shutil.which")
    @patch("subprocess.run")
    def test_successful_uno_read_and_sha256(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/avrdude"

        def side_effect(cmd, **kwargs):
            # Assert subprocess argument array structure (never shell=True)
            self.assertIsInstance(cmd, list)
            self.assertFalse(kwargs.get("shell", False))
            self.assertIn("-p", cmd)
            self.assertIn("atmega328p", cmd)
            self.assertIn("-c", cmd)
            self.assertIn("arduino", cmd)

            # Assert zero write or erase arguments
            for arg in cmd:
                self.assertFalse(":w:" in arg, "No write operations allowed")
                self.assertFalse(arg == "-e", "No chip erase allowed")

            res = MagicMock()
            res.returncode = 0
            res.stderr = ""
            res.stdout = ""
            mem_arg = cmd[cmd.index("-U") + 1]
            out_file = ":".join(mem_arg.split(":")[2:-1])

            if "signature" in mem_arg:
                with open(out_file, "w") as f:
                    f.write("0x1e 0x95 0x0f\n")
            elif "lock" in mem_arg:
                with open(out_file, "w") as f:
                    f.write("0x3F\n")
            elif "flash" in mem_arg:
                with open(out_file, "w") as f:
                    f.write(":040000000C94340028\n:00000001FF\n")
            return res

        mock_run.side_effect = side_effect

        result = AvrdudeRunner.read_uno_flash(port="COM3", baud=115200)

        self.assertTrue(result["success"])
        self.assertEqual(result["totalBytes"], 32768)
        self.assertEqual(result["explicitReadBytes"], 4)
        self.assertEqual(result["erasedPaddingBytes"], 32764)
        self.assertEqual(len(result["sha256"]), 64)
        self.assertEqual(result["architecture"], "avr8")

        # Verify decoded base64 matches 32 KiB
        raw_bytes = base64.b64decode(result["base64"])
        self.assertEqual(len(raw_bytes), 32768)
        self.assertEqual(hashlib.sha256(raw_bytes).hexdigest(), result["sha256"])


class TestSafetyStaticInspection(unittest.TestCase):
    def test_no_destructive_avrdude_arguments_in_companion(self):
        companion_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        for fname in ["avrdude.py", "main.py", "security.py"]:
            fpath = os.path.join(companion_dir, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                code = f.read()
                self.assertNotIn(":w:", code, f"Destructive write mode found in {fname}")
                self.assertNotIn("shell=True", code, f"shell=True found in {fname}")
                self.assertNotIn("'-e'", code, f"Chip erase flag found in {fname}")


if __name__ == "__main__":
    unittest.main()
