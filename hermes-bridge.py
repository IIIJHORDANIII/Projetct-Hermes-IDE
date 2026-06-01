#!/usr/bin/env python3
"""
Hermes IDE Bridge — HTTP API that wraps the real Hermes Agent.

This script starts a local HTTP server that the IDE connects to.
It creates a persistent AIAgent instance that maintains full conversation
history, tool access, skills, and memory — exactly like the CLI.
"""

import json
import sys
import os
import threading
import asyncio
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Add hermes-agent to Python path
HERMES_HOME = os.path.expanduser("~/.hermes")
HERMES_SOURCE = os.path.join(HERMES_HOME, "hermes-agent")
sys.path.insert(0, HERMES_SOURCE)

# Load .env
from hermes_cli.env_loader import load_hermes_dotenv
load_hermes_dotenv()

# Import after env is loaded
from run_agent import AIAgent

# ─── Global agent instance (persistent across messages) ───
agent = None
agent_lock = threading.Lock()

def init_agent():
    """Initialize the Hermes agent with default settings."""
    global agent
    
    # Load config
    import yaml
    config_path = os.path.join(HERMES_HOME, "config.yaml")
    config = {}
    if os.path.exists(config_path):
        with open(config_path) as f:
            config = yaml.safe_load(f) or {}

    model_config = config.get("model", {})
    
    agent = AIAgent(
        model=model_config.get("default", ""),
        base_url=model_config.get("base_url", ""),
        api_key=model_config.get("api_key", ""),
        provider=model_config.get("provider", ""),
        max_iterations=config.get("agent", {}).get("max_turns", 90),
        quiet_mode=True,
        save_trajectories=False,
    )
    print(f"[Bridge] Agent initialized with model: {agent.model or 'default'}")
    print(f"[Bridge] Provider: {agent.provider or 'auto'}")


class HermesHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the Hermes IDE bridge."""

    def log_message(self, format, *args):
        """Suppress default HTTP logging."""
        pass

    def send_json(self, data, status=200):
        """Send a JSON response."""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        """Handle GET requests."""
        path = urlparse(self.path).path

        if path == "/health":
            self.send_json({
                "status": "ok",
                "model": agent.model if agent else None,
                "provider": agent.provider if agent else None,
            })
        elif path == "/history":
            with agent_lock:
                messages = agent.messages if agent else []
                # Return conversation history (skip system message)
                history = []
                for msg in messages:
                    if msg.get("role") in ("user", "assistant"):
                        history.append({
                            "role": msg["role"],
                            "content": msg.get("content", ""),
                        })
                self.send_json({"messages": history})
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_POST(self):
        """Handle POST requests."""
        path = urlparse(self.path).path

        if path == "/chat":
            self.handle_chat()
        elif path == "/chat/stream":
            self.handle_chat_stream()
        elif path == "/reset":
            self.handle_reset()
        else:
            self.send_json({"error": "Not found"}, 404)

    def handle_chat_stream(self):
        """Handle streaming chat — sends deltas as they arrive via chunked JSON lines."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            message = data.get("message", "").strip()

            if not message:
                self.send_json({"error": "Empty message"}, 400)
                return

            # Send chunked response headers
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            def send_line(obj):
                line = json.dumps(obj) + "\n"
                chunk = f"{len(line):x}\r\n{line}\r\n"
                try:
                    self.wfile.write(chunk.encode("utf-8"))
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass

            with agent_lock:
                def on_delta(delta):
                    send_line({"type": "delta", "text": delta})

                response = agent.chat(message, stream_callback=on_delta)

            send_line({"type": "done", "response": response})
            # Final empty chunk
            try:
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                send_line({"type": "error", "error": str(e)})
            except:
                pass

    def handle_chat(self):
        """Handle chat messages — sends to Hermes and returns response."""
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            message = data.get("message", "").strip()

            if not message:
                self.send_json({"error": "Empty message"}, 400)
                return

            with agent_lock:
                # Stream deltas collected here
                stream_chunks = []

                def on_delta(delta):
                    stream_chunks.append(delta)

                # Run the conversation
                response = agent.chat(message, stream_callback=on_delta)

            self.send_json({
                "response": response,
                "stream": "".join(stream_chunks) if stream_chunks else None,
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            self.send_json({"error": str(e)}, 500)

    def handle_reset(self):
        """Reset the conversation."""
        global agent
        with agent_lock:
            agent.messages = []
            # Re-initialize system prompt
            from agent.system_prompt import build_system_prompt
            agent.messages.append({
                "role": "system",
                "content": build_system_prompt(agent)
            })
        self.send_json({"status": "reset"})


def main():
    """Start the bridge server."""
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 48123

    print(f"[Hermes IDE Bridge] Starting on port {port}...")
    init_agent()

    server = HTTPServer(("127.0.0.1", port), HermesHandler)
    print(f"[Hermes IDE Bridge] Ready at http://127.0.0.1:{port}")
    print(f"[Hermes IDE Bridge] Endpoints:")
    print(f"  GET  /health  — Check status")
    print(f"  POST /chat    — Send message {{\"message\": \"...\"}}")
    print(f"  GET  /history — Get conversation history")
    print(f"  POST /reset   — Reset conversation")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Hermes IDE Bridge] Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
