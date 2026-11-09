"""Synthetic OpenAI fixture, no credentials or external inference. Unknown prompts fail."""

import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if "PROJECTS_TEST" not in json.dumps(body.get("messages", [])):
            self.send_error(422, "Unknown fixture prompt")
            return
        # Echo the ACTUAL inference request model; browser tests assert propagation.
        has_attachment = "attachment content marker" in json.dumps(body.get("messages", []))
        attachment = "present" if has_attachment else "absent"
        content = f"PROJECTS_TEST_OK model={body.get('model')} attachment={attachment}"
        with open("/tmp/projects-inference-requests.jsonl", "a") as audit:
            audit.write(json.dumps(body) + "\n")
        result = {
            "id": "fixture",
            "object": "chat.completion",
            "model": "projects-test",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        self.send_response(200)
        self.send_header(
            "Content-Type", "text/event-stream" if body.get("stream") else "application/json"
        )
        self.end_headers()
        if body.get("stream"):
            chunk = {
                "id": "fixture",
                "object": "chat.completion.chunk",
                "model": "projects-test",
                "choices": [
                    {
                        "index": 0,
                        "delta": {"role": "assistant", "content": content},
                        "finish_reason": None,
                    }
                ],
            }
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            chunk["choices"][0]["delta"] = {}
            chunk["choices"][0]["finish_reason"] = "stop"
            self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())
        else:
            self.wfile.write(json.dumps(result).encode())


HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
