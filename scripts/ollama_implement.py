#!/usr/bin/env python3
"""Send an implementation spec to a local Ollama model and save the result.

Claude writes the spec (docs/specs/*.md); this script asks the local model
(default: qwen3.5:4b) to produce the implementation. The output is written to
--out so that Claude can review it before it is adopted into the project.

Only the Python standard library is used.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_HOST = "http://localhost:11434"
DEFAULT_MODEL = "qwen3.5:4b"

SYSTEM_PROMPT = (
    "You are an implementation assistant. Follow the specification exactly. "
    "Do not add features that are not in the specification. "
    "Output only the requested file content, with no explanations outside code comments."
)


def build_prompt(spec_text, target):
    lines = [
        "Implement the following specification.",
        "",
        "Target file: %s" % target if target else "Target file: (decide from the specification)",
        "",
        "=== SPECIFICATION ===",
        spec_text,
        "=== END SPECIFICATION ===",
    ]
    return "\n".join(lines)


def strip_code_fence(text):
    """Remove a single surrounding ``` fence if the model wrapped its output in one."""
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")
        lines = lines[1:]  # drop the opening fence line (with optional language tag)
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines) + "\n"
    return text


def generate(host, model, prompt, timeout):
    body = json.dumps({
        "model": model,
        "system": SYSTEM_PROMPT,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2},
    }).encode("utf-8")
    req = urllib.request.Request(
        host.rstrip("/") + "/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data.get("response", "")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("spec", help="path to the specification markdown file")
    parser.add_argument("--out", required=True,
                        help="file to write the generated output to (not the project file itself)")
    parser.add_argument("--target", default="",
                        help="intended path of the implementation file (for the prompt only)")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--timeout", type=int, default=600)
    parser.add_argument("--force", action="store_true", help="overwrite --out if it exists")
    args = parser.parse_args()

    if os.path.exists(args.out) and not args.force:
        sys.exit("refusing to overwrite %s (use --force)" % args.out)

    with open(args.spec, encoding="utf-8") as f:
        spec_text = f.read()

    try:
        result = strip_code_fence(
            generate(args.host, args.model, build_prompt(spec_text, args.target), args.timeout))
    except urllib.error.URLError as e:
        sys.exit("failed to reach Ollama at %s: %s" % (args.host, e))

    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(result)
    print("wrote %d chars to %s (model: %s)" % (len(result), args.out, args.model))


if __name__ == "__main__":
    main()
