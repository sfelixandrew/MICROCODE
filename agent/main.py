"""
MicroCode Inspector — Local AVR Companion Agent
Strictly binds to 127.0.0.1:8765.
Provides read-only AVRDUDE operations with Origin validation and session token protection.
"""
import json
import sys
from http import HTTPStatus
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional

from security import SecurityManager
from avrdude import AvrdudeRunner, AvrdudeError

HOST = "127.0.0.1"
PORT = 8765

security = SecurityManager()

class CompanionRequestHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler implementing strictly scoped endpoints."""

    def _send_cors_headers(self, origin: Optional[str] = None):
        allowed = origin if security.validate_origin(origin) else "http://localhost:5173"
        self.send_header("Access-Control-Allow-Origin", allowed)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-MicroCode-Session")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send_json_response(self, status: int, data: dict, origin: Optional[str] = None):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers(origin)
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers(origin)
        self.end_headers()

    def do_GET(self):
        origin = self.headers.get("Origin")
        if not security.validate_origin(origin):
            self._send_json_response(HTTPStatus.FORBIDDEN, {"error": "Origin not permitted"}, origin)
            return

        if self.path == "/health":
            health_data = AvrdudeRunner.check_health()
            self._send_json_response(HTTPStatus.OK, health_data, origin)
            return

        if self.path == "/session":
            # Issue the ephemeral session token to loopback client
            self._send_json_response(HTTPStatus.OK, {"sessionToken": security.session_token}, origin)
            return

        # Authenticated endpoints below
        session_token = self.headers.get("X-MicroCode-Session")
        if not security.validate_session_token(session_token):
            self._send_json_response(HTTPStatus.FORBIDDEN, {"error": "Invalid or missing session token"}, origin)
            return

        if self.path == "/ports":
            ports = security.enumerate_system_serial_ports()
            self._send_json_response(HTTPStatus.OK, {"ports": ports}, origin)
            return

        self._send_json_response(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found"}, origin)

    def do_POST(self):
        origin = self.headers.get("Origin")
        if not security.validate_origin(origin):
            self._send_json_response(HTTPStatus.FORBIDDEN, {"error": "Origin not permitted"}, origin)
            return

        session_token = self.headers.get("X-MicroCode-Session")
        if not security.validate_session_token(session_token):
            self._send_json_response(HTTPStatus.FORBIDDEN, {"error": "Invalid or missing session token"}, origin)
            return

        if self.path == "/read/uno":
            content_len = int(self.headers.get("Content-Length", 0))
            if content_len <= 0 or content_len > 8192:
                self._send_json_response(HTTPStatus.BAD_REQUEST, {"error": "Invalid request body length"}, origin)
                return

            try:
                body = json.loads(self.rfile.read(content_len).decode("utf-8"))
            except Exception:
                self._send_json_response(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"}, origin)
                return

            port = body.get("port", "").strip()
            baud = int(body.get("baud", 115200))

            if not port:
                self._send_json_response(HTTPStatus.BAD_REQUEST, {"error": "Missing required 'port' parameter."}, origin)
                return

            # Whitelist validation: reject non-existent or shell-injected ports
            if not security.is_port_whitelisted(port):
                self._send_json_response(HTTPStatus.BAD_REQUEST, {"error": f"Port '{port}' is not an active verified serial device."}, origin)
                return

            try:
                result = AvrdudeRunner.read_uno_flash(port=port, baud=baud)
                self._send_json_response(HTTPStatus.OK, result, origin)
            except AvrdudeError as avr_err:
                self._send_json_response(HTTPStatus.OK, {
                    "success": False,
                    "error": avr_err.message,
                    "code": avr_err.code,
                    "stderr": avr_err.stderr,
                }, origin)
            except Exception as e:
                self._send_json_response(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"Internal helper error: {str(e)}"}, origin)
            return

        self._send_json_response(HTTPStatus.NOT_FOUND, {"error": "Endpoint not found"}, origin)

    def log_message(self, format, *args):
        # Prevent logging sensitive strings or binary payloads
        sys.stderr.write(f"[AVR-COMPANION] {self.address_string()} - {format % args}\n")

def run_server():
    server_address = (HOST, PORT)
    httpd = HTTPServer(server_address, CompanionRequestHandler)
    print(f"MICROCODE INSPECTOR AVR Companion running at http://{HOST}:{PORT}")
    print(f"Session Token: {security.session_token}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nCompanion stopped cleanly.")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
