"""
NOX Orchestrator — Controlled Auto-Loop Executor
Reads tasks, executes via Claude Code CLI, validates, loops.
"""

import subprocess
import json
import sys
import os
import glob
import argparse
from datetime import datetime, timezone
from pathlib import Path

# --- constants ---
ORCH_ROOT = Path(r"C:\work\nox\orchestration")
ENV_FILE = ORCH_ROOT / "scripts" / ".env"
STATE_FILE = ORCH_ROOT / "config" / "state.json"
TASKS_DIR = ORCH_ROOT / "tasks"
RESULTS_DIR = ORCH_ROOT / "results"
LOGS_DIR = ORCH_ROOT / "logs"
VALIDATOR = ORCH_ROOT / "validators" / "validate-result.ps1"
UPDATE_STATE = ORCH_ROOT / "scripts" / "update-state.ps1"

MAX_ROUNDS_GUARDRAIL = 7


def load_env(env_path: Path) -> dict[str, str]:
    """Load key=value pairs from .env file."""
    result = {}
    if not env_path.exists():
        return result
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            result[key] = value
    return result


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")


def write_log_file(round_num: int, lines: list[str]) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / f"round-{round_num:03d}.log"
    content = "\n".join(lines)
    log_path.write_text(content, encoding="utf-8")
    log(f"Log written: {log_path}")


def read_state() -> dict:
    if not STATE_FILE.exists():
        log(f"REJECT: state.json not found: {STATE_FILE}")
        sys.exit(2)
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log(f"REJECT: state.json parse error: {e}")
        sys.exit(2)


def find_task_file(round_num: int) -> Path | None:
    pattern = f"round-{round_num:03d}*"
    matches = list(TASKS_DIR.glob(pattern + ".md"))
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        # prefer exact match without suffix
        exact = TASKS_DIR / f"round-{round_num:03d}.md"
        if exact.exists():
            return exact
        return matches[0]
    return None


def find_result_file(round_num: int) -> Path:
    return RESULTS_DIR / f"round-{round_num:03d}.md"


def detect_current_round(state: dict) -> int | None:
    """Try to detect round number from state.json fields."""
    # check next_priority for round number pattern
    nxt = state.get("next_priority", "")
    if nxt:
        import re
        m = re.search(r"round[- ]?(\d{2,3})", nxt, re.IGNORECASE)
        if m:
            return int(m.group(1))

    # check current_step
    step = state.get("current_step", "")
    if step:
        import re
        m = re.search(r"round[- ]?(\d{2,3})", step, re.IGNORECASE)
        if m:
            return int(m.group(1))

    return None


def execute_task_via_cli(task_content: str) -> tuple[int, str]:
    """
    Execute task via Claude Code CLI.
    Returns (returncode, stdout).
    """
    env = os.environ.copy()

    # .env file takes priority, then fall back to environment variable
    dot_env = load_env(ENV_FILE)
    if "ANTHROPIC_API_KEY" in dot_env:
        env["ANTHROPIC_API_KEY"] = dot_env["ANTHROPIC_API_KEY"]

    api_key = env.get("ANTHROPIC_API_KEY")
    if not api_key:
        log(f"REJECT: ANTHROPIC_API_KEY not found. Set in {ENV_FILE} or environment variable.")
        sys.exit(2)

    try:
        result = subprocess.run(
            ["claude", "--print", "--dangerously-skip-permissions"],
            input=task_content,
            capture_output=True,
            text=True,
            timeout=600,
            env=env,
            cwd=r"C:\work\nox",
            shell=True,
            encoding="utf-8",
        )
        return result.returncode, result.stdout
    except FileNotFoundError:
        log("REJECT: claude CLI not found. Install Claude Code first.")
        sys.exit(2)
    except subprocess.TimeoutExpired:
        log("FAIL: Claude CLI execution timed out (600s)")
        return 1, ""


def run_validator(task_file: Path, result_file: Path) -> int:
    """
    Run validate-result.ps1.
    Returns: 0=PASS, 1=FAIL, 2=REJECT
    """
    if not VALIDATOR.exists():
        log(f"REJECT: Validator not found: {VALIDATOR}")
        sys.exit(2)

    try:
        result = subprocess.run(
            [
                "powershell", "-ExecutionPolicy", "Bypass", "-File",
                str(VALIDATOR),
                "-TaskFile", str(task_file),
                "-ResultFile", str(result_file),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            encoding="utf-8",
        )
        print(result.stdout)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        return result.returncode
    except subprocess.TimeoutExpired:
        log("FAIL: Validator timed out (60s)")
        return 1


def update_state(round_num: int, status: str) -> None:
    """Update state via update-state.ps1 (never direct modification)."""
    if not UPDATE_STATE.exists():
        log(f"REJECT: update-state.ps1 not found: {UPDATE_STATE}")
        sys.exit(2)

    try:
        subprocess.run(
            [
                "powershell", "-ExecutionPolicy", "Bypass", "-File",
                str(UPDATE_STATE),
                "-CurrentStep", f"round-{round_num:03d} {status}",
                "-NextPriority", f"round-{round_num + 1:03d}",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            encoding="utf-8",
        )
    except subprocess.TimeoutExpired:
        log("FAIL: update-state.ps1 timed out")


def run_loop(start_round: int, max_rounds: int) -> None:
    log("=== NOX ORCHESTRATOR (AUTO-LOOP) ===")
    log(f"Start round : {start_round:03d}")
    log(f"Max rounds  : {max_rounds}")
    log(f"Guardrail   : {MAX_ROUNDS_GUARDRAIL}")
    log("")

    effective_max = min(max_rounds, MAX_ROUNDS_GUARDRAIL)
    if max_rounds > MAX_ROUNDS_GUARDRAIL:
        log(f"[WARN] max_rounds ({max_rounds}) exceeds guardrail ({MAX_ROUNDS_GUARDRAIL}). Clamped.")

    rounds_executed = 0

    for i in range(effective_max):
        round_num = start_round + i
        log_lines = []
        ts = datetime.now(timezone.utc).isoformat()

        log(f"--- ROUND {round_num:03d} ---")
        log_lines.append(f"[{ts}] ROUND {round_num:03d} START")

        # --- find task ---
        task_file = find_task_file(round_num)
        if task_file is None:
            log(f"STOP: No task file found for round {round_num:03d}")
            log_lines.append(f"[{ts}] STOP: task not found")
            write_log_file(round_num, log_lines)
            break

        log(f"Task: {task_file}")
        log_lines.append(f"TaskFile: {task_file}")

        # --- check result already exists ---
        result_file = find_result_file(round_num)
        if result_file.exists():
            log(f"SKIP: Result already exists: {result_file}")
            log_lines.append(f"[{ts}] SKIP: result exists")
            write_log_file(round_num, log_lines)
            rounds_executed += 1
            continue

        # --- read task ---
        task_content = task_file.read_text(encoding="utf-8")
        if not task_content.strip():
            log(f"REJECT: Task file is empty: {task_file}")
            log_lines.append(f"[{ts}] REJECT: empty task")
            write_log_file(round_num, log_lines)
            sys.exit(2)

        # --- execute via Claude CLI ---
        log("Executing via Claude Code CLI...")
        log_lines.append(f"[{ts}] Executor: claude --print --dangerously-skip-permissions")

        returncode, output = execute_task_via_cli(task_content)

        if returncode != 0:
            log(f"FAIL: Claude CLI returned exit code {returncode}")
            log_lines.append(f"[{ts}] CLI exit code: {returncode}")
            log_lines.append(f"[{ts}] FAIL: executor error")
            write_log_file(round_num, log_lines)
            update_state(round_num, "FAIL")
            sys.exit(1)

        if not output.strip():
            log("FAIL: Claude CLI returned empty output")
            log_lines.append(f"[{ts}] FAIL: empty output")
            write_log_file(round_num, log_lines)
            update_state(round_num, "FAIL")
            sys.exit(1)

        # --- save result ---
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        result_file.write_text(output, encoding="utf-8")
        log(f"Result saved: {result_file}")
        log_lines.append(f"[{ts}] Result saved: {result_file}")

        # --- git commit ---
        log("Running git add & commit...")
        try:
            subprocess.run(
                ["git", "add", "."],
                capture_output=True, text=True, timeout=30,
                cwd=r"C:\work\nox", encoding="utf-8",
            )
            commit_msg = f"round-{round_num:03d}: auto-commit by orchestrator"
            commit_result = subprocess.run(
                ["git", "commit", "-m", commit_msg],
                capture_output=True, text=True, timeout=30,
                cwd=r"C:\work\nox", encoding="utf-8",
            )
            if commit_result.returncode == 0:
                log(f"Git commit OK: {commit_msg}")
                log_lines.append(f"[{ts}] Git commit: OK")
            else:
                log(f"Git commit skipped (no changes or error): {commit_result.stdout.strip()}")
                log_lines.append(f"[{ts}] Git commit: skipped")
        except subprocess.TimeoutExpired:
            log("WARN: git commit timed out")
            log_lines.append(f"[{ts}] Git commit: timeout")

        # --- validate ---
        log("Running validator...")
        validator_code = run_validator(task_file, result_file)

        if validator_code == 0:
            log(f"PASS: Round {round_num:03d}")
            log_lines.append(f"[{ts}] Validator: PASS")
            write_log_file(round_num, log_lines)
            update_state(round_num, "PASS")
            rounds_executed += 1

        elif validator_code == 2:
            log(f"REJECT: Validator rejected round {round_num:03d}")
            log_lines.append(f"[{ts}] Validator: REJECT")
            write_log_file(round_num, log_lines)
            update_state(round_num, "REJECT")
            sys.exit(2)

        else:
            log(f"FAIL: Validator failed round {round_num:03d}")
            log_lines.append(f"[{ts}] Validator: FAIL")
            write_log_file(round_num, log_lines)
            update_state(round_num, "FAIL")
            sys.exit(1)

        log("")

    log("")
    log(f"=== LOOP COMPLETE: {rounds_executed} round(s) executed ===")


def main() -> None:
    parser = argparse.ArgumentParser(description="NOX Orchestrator Auto-Loop")
    parser.add_argument(
        "--start-round",
        type=int,
        default=None,
        help="Starting round number. If omitted, auto-detect from state.json.",
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=MAX_ROUNDS_GUARDRAIL,
        help=f"Maximum rounds to execute (guardrail: {MAX_ROUNDS_GUARDRAIL}).",
    )

    args = parser.parse_args()

    # --- determine start round ---
    state = read_state()

    if args.start_round is not None:
        start_round = args.start_round
    else:
        detected = detect_current_round(state)
        if detected is None:
            log("REJECT: Cannot detect round number from state.json. Use --start-round N.")
            sys.exit(2)
        start_round = detected
        log(f"Auto-detected start round: {start_round:03d}")

    run_loop(start_round, args.max_rounds)


if __name__ == "__main__":
    main()
