from __future__ import annotations

import argparse
import json
import traceback
from pathlib import Path

from .audio_engine import analyze_audio, render_extended


def main() -> int:
    parser = argparse.ArgumentParser(prog="mp3_fit")
    subparsers = parser.add_subparsers(dest="command", required=True)

    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--input", required=True)
    render_parser.add_argument("--target", required=True, type=float)
    render_parser.add_argument("--output", required=True)
    render_parser.add_argument("--bitrate", default="192k")
    render_parser.add_argument("--variant", default=1, type=int)

    args = parser.parse_args()

    try:
        if args.command == "render":
            source = Path(args.input)
            output = Path(args.output)
            _, analysis = analyze_audio(source)
            result = render_extended(
                source,
                args.target,
                output,
                analysis,
                variant_seed=args.variant,
                output_bitrate=args.bitrate,
            )
            print(json.dumps({
                "ok": True,
                "outputPath": str(result.output_path),
                "duration": result.duration,
                "message": analysis.message,
            }))
            return 0
    except Exception:
        print(json.dumps({
            "ok": False,
            "message": traceback.format_exc(),
        }))
        return 1

    print(json.dumps({"ok": False, "message": "Unknown command."}))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
