"""Seed and serve a built demo: python scripts/demo.py [--port 8000]."""

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8000, type=int)
    args = parser.parse_args()
    if not (ROOT / "dist" / "index.html").is_file():
        parser.error("Сначала выполните npm install и npm run build")

    from backend.seed import seed_demo as seed_tasks
    from backend.team_proposals import seed_demo as seed_teams
    from backend.localize_demo import localize_demo_data
    from backend.open_data_seed import seed_open_data_tasks
    import uvicorn

    seed_tasks()
    seed_teams()
    localize_demo_data()
    seed_open_data_tasks()
    print(f"\nLovelab → http://{args.host}:{args.port}\n", flush=True)
    uvicorn.run("backend.integration:app", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
