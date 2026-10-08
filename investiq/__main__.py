"""Run the InvestIQ web app: ``python -m investiq [--demo] [--port 8000]``."""

import argparse
import os
import webbrowser


def load_dotenv(path: str = ".env") -> None:
    """Read KEY=VALUE lines from .env into the environment (existing variables win)."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip().strip('"').strip("'")
            if value:
                os.environ.setdefault(key.strip(), value)


def main():
    parser = argparse.ArgumentParser(description="InvestIQ stock research dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--demo", action="store_true", help="use synthetic offline data")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    if args.demo:
        os.environ["INVESTIQ_DATA_SOURCE"] = "demo"

    import uvicorn

    url = f"http://{args.host}:{args.port}"
    print(f"InvestIQ running at {url}")
    if not args.no_browser:
        webbrowser.open(url)
    uvicorn.run("investiq.api:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
