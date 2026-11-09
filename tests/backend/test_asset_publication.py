"""Exercise the exact publisher with real local remotes; only npm is a fixture."""

import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/publish-assets.sh"


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()


@pytest.fixture
def publication(tmp_path):
    remote = tmp_path / "remote.git"
    writer = tmp_path / "writer"
    runner = tmp_path / "runner"
    git(tmp_path, "init", "--bare", "--initial-branch=main", str(remote))
    git(tmp_path, "clone", str(remote), str(writer))
    git(writer, "config", "user.name", "Fixture")
    git(writer, "config", "user.email", "fixture@example.invalid")
    (writer / ".gitignore").write_text("/desktop/plugin.js\n")
    (writer / "source").write_text("initial")
    git(writer, "add", ".")
    git(writer, "commit", "-m", "source")
    git(writer, "push", "origin", "main")
    git(tmp_path, "clone", str(remote), str(runner))
    binaries = tmp_path / "bin"
    binaries.mkdir()
    npm = binaries / "npm"
    npm.write_text(
        "#!/usr/bin/env python3\n"
        "import os, pathlib, subprocess, sys, time\n"
        "with open(os.environ['BUILD_LOG'], 'a') as log:\n"
        "    log.write(subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True))\n"
        "if sys.argv[3:] != ['run', 'build']: sys.exit(0)\n"
        "root = pathlib.Path.cwd()\n"
        "mode = os.environ.get('MODE', '')\n"
        "if mode == 'fail': sys.exit(1)\n"
        "if mode == 'missing': sys.exit(0)\n"
        "(root / 'desktop').mkdir(exist_ok=True)\n"
        "(root / 'desktop/plugin.js').write_text((root / 'source').read_text())\n"
        "# Unrelated build output must never enter the asset commit.\n"
        "(root / 'unrelated').write_text('untracked')\n"
        "marker = pathlib.Path(os.environ['MARKER'])\n"
        "if mode == 'paused':\n"
        "    marker.touch()\n"
        "    deadline = time.monotonic() + 10\n"
        "    while not marker.with_suffix('.release').exists():\n"
        "        if time.monotonic() > deadline: sys.exit(2)\n"
        "        time.sleep(0.02)\n"
        "if mode == 'concurrent' and not (root / 'built-once').exists():\n"
        "    (root / 'built-once').touch()\n"
        "    (marker.parent / root.name).touch()\n"
        "    deadline = time.monotonic() + 10\n"
        "    while not all((marker.parent / p).exists() for p in ['ready-a', 'ready-b']):\n"
        "        if time.monotonic() > deadline: sys.exit(2)\n"
        "        time.sleep(0.02)\n"
        "if mode == 'advance' or (mode == 'race' and not marker.exists()):\n"
        "    marker.write_text('raced')\n"
        "    writer = pathlib.Path(os.environ['WRITER'])\n"
        "    subprocess.run(['git', '-C', str(writer), 'pull', '--ff-only'], check=True)\n"
        "    p = writer / 'source'\n"
        "    p.write_text(p.read_text() + '-new')\n"
        "    for args in [['add', 'source'], ['commit', '-m', 'new source'], "
        "['push', 'origin', 'main']]:\n"
        "        subprocess.run(['git', '-C', str(writer), *args], check=True)\n"
    )
    npm.chmod(0o755)
    env = dict(os.environ, PATH=f"{binaries}:{os.environ['PATH']}",
               WRITER=str(writer), MARKER=str(tmp_path / "marker"),
               VALIDATED_SHA=git(runner, "rev-parse", "HEAD"),
               BUILD_LOG=str(tmp_path / "build.log"))
    return remote, writer, runner, env


def publish(publication, mode=""):
    _, _, runner, env = publication
    return subprocess.run(["bash", str(SCRIPT)], cwd=runner, env=dict(env, MODE=mode),
                          capture_output=True, text=True, timeout=30)


def test_bootstrap_and_unchanged(publication):
    remote, _, runner, env = publication
    git(remote, "config", "receive.denyNonFastForwards", "true")
    assert publish(publication).returncode == 0
    assert git(remote, "rev-parse", "main^") == env["VALIDATED_SHA"]
    assert git(remote, "show", "main:desktop/plugin.js") == "initial"
    assert git(remote, "diff-tree", "--no-commit-id", "--name-only", "-r", "main") == (
        "desktop/plugin.js"
    )
    before = git(remote, "rev-parse", "main")
    assert publish(publication).returncode == 0
    assert git(remote, "rev-parse", "main") == before
    assert git(runner, "status", "--short") == "?? unrelated"


def test_skip_when_source_advances_during_build(publication):
    remote, _, _, _ = publication
    result = publish(publication, "race")
    assert result.returncode == 0, result.stderr
    assert "skipping publication" in result.stdout
    assert_no_bundle(remote)
    assert git(remote, "show", "main:source") == "initial-new"


@pytest.mark.parametrize("mode", ["fail", "missing"])
def test_failed_or_continually_stale_build_never_publishes(publication, mode):
    remote, _, runner, _ = publication
    (runner / "desktop").mkdir()
    (runner / "desktop/plugin.js").write_text("old ignored output")
    result = publish(publication, mode)
    assert result.returncode != 0
    assert subprocess.run(["git", "-C", str(remote), "cat-file", "-e",
                           "main:desktop/plugin.js"], capture_output=True).returncode != 0


def test_permission_rejection_fails_without_retry(publication):
    remote, _, _, _ = publication
    hook = remote / "hooks/pre-receive"
    hook.write_text("#!/bin/sh\nexit 1\n")
    hook.chmod(0o755)
    before = git(remote, "rev-parse", "main")
    result = publish(publication)
    assert result.returncode != 0
    assert "Push rejected" in result.stdout
    assert git(remote, "rev-parse", "main") == before


@pytest.mark.parametrize("race", ["source", "bot-same", "bot-different"])
def test_main_advances_between_final_fetch_and_push(publication, tmp_path, race):
    remote, writer, _, env = publication
    git(remote, "config", "receive.denyNonFastForwards", "true")
    bot = race.startswith("bot-")
    path = "desktop/plugin.js" if bot else "source"
    content = "initial" if race == "bot-same" else "raced"
    if bot:
        git(writer, "config", "user.name", "github-actions[bot]")
        git(writer, "config", "user.email",
            "41898282+github-actions[bot]@users.noreply.github.com")
    real_git = shutil.which("git")
    # Interpose only at the push boundary, after the publisher's final fetch.
    wrapper = tmp_path / "bin/git"
    wrapper.write_text(
        '#!/bin/bash\nset -eu\n'
        'if [ "$1" = push ] && [ ! -f "$MARKER" ]; then\n'
        '  touch "$MARKER"\n'
        f'  "{real_git}" -C "$WRITER" pull --ff-only\n'
        '  mkdir -p "$WRITER/desktop"\n'
        f'  printf %s {content} > "$WRITER/{path}"\n'
        f'  "{real_git}" -C "$WRITER" add -f {path}\n'
        f'  "{real_git}" -C "$WRITER" commit --date=2000-01-01T00:00:00Z '
        '-m "chore(build): update compiled plugin assets"\n'
        f'  "{real_git}" -C "$WRITER" push origin main\n'
        'fi\n'
        f'exec "{real_git}" "$@"\n'
    )
    wrapper.chmod(0o755)
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    if bot:
        assert "retrying" in result.stdout
        assert git(remote, "show", "main:desktop/plugin.js") == "initial"
        assert git(remote, "rev-list", "--count", "main") == (
            "2" if race == "bot-same" else "3"
        )
    else:
        assert "skipping publication" in result.stdout
        assert_no_bundle(remote)
        assert git(writer, "show", "main:source") == "raced"
    assert set(Path(env["BUILD_LOG"]).read_text().splitlines()) == {env["VALIDATED_SHA"]}
    assert Path(env["MARKER"]).exists()


def test_workflow_keeps_pr_validation_unprivileged():
    workflow = (ROOT / ".github/workflows/build.yml").read_text()
    validation, publisher = workflow.split("\n  publish:\n")
    assert "pull_request:" in validation
    assert "pull_request_target" not in workflow
    assert "contents: write" not in validation
    assert "persist-credentials: true" not in validation
    assert "secrets." not in workflow
    assert "needs: [assets, hermes]" in publisher
    assert "github.ref == 'refs/heads/main'" in publisher
    assert "github.event_name == 'push' || github.event_name == 'workflow_dispatch'" in publisher
    # A late older run must not replace the newest run in a pending slot.
    assert not any(line.lstrip().startswith("concurrency:") for line in workflow.splitlines())
    assert 'bash "$RUNNER_TEMP/publish-assets.sh"' in publisher
    assert "npm --prefix frontend run build" in validation
    assert validation.index("run build") < validation.index("frontend test")
    assert 'git diff --exit-code "$BASE_SHA" HEAD -- desktop/plugin.js' in validation
    assert "actions/download-artifact@" in validation
    assert "ref: ${{ github.sha }}" in publisher
    assert "VALIDATED_SHA: ${{ github.sha }}" in publisher
    assert "ref: main" not in publisher


def test_competing_publishers_converge_without_duplicate_commits(publication, tmp_path):
    remote, _, _, env = publication
    git(remote, "config", "receive.denyNonFastForwards", "true")
    runners = [tmp_path / name for name in ["ready-a", "ready-b"]]
    # Signal files live in a separate directory from the checkouts.
    signals = tmp_path / "signals"
    signals.mkdir()
    env = dict(env, MODE="concurrent", MARKER=str(signals / "marker"))
    processes = []
    for runner in runners:
        git(tmp_path, "clone", str(remote), str(runner))
        processes.append(subprocess.Popen(["bash", str(SCRIPT)], cwd=runner, env=env,
                                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                          text=True))
    for process in processes:
        stdout, stderr = process.communicate(timeout=30)
        assert process.returncode == 0, stdout + stderr
    assert git(remote, "rev-list", "--count", "main") == "2"
    assert git(remote, "show", "main:desktop/plugin.js") == "initial"


@pytest.mark.parametrize("rollback", ["source", "bot"])
def test_rollback_between_final_fetch_and_push_is_preserved(publication, tmp_path, rollback):
    remote, writer, runner, env = publication
    rollback_sha = git(remote, "rev-parse", "main")
    advance_main(writer, bot=rollback == "bot",
                 path="desktop/plugin.js" if rollback == "bot" else "source")
    expected_sha = git(remote, "rev-parse", "main")
    if rollback == "source":
        git(runner, "fetch", "origin")
        env["VALIDATED_SHA"] = expected_sha
    real_git = shutil.which("git")
    push_log = tmp_path / "push.log"
    wrapper = tmp_path / "bin/git"
    wrapper.write_text(
        '#!/bin/bash\nset -eu\n'
        'if [ "$1" = push ]; then\n'
        f'  printf "%s\\n" "$@" >> "{push_log}"\n'
        '  if [ ! -f "$MARKER" ]; then\n'
        '    touch "$MARKER"\n'
        # Model an administrator rollback exactly after the last fetch.
        f'    "{real_git}" --git-dir="{remote}" update-ref refs/heads/main '
        f'{rollback_sha} {expected_sha}\n'
        '  fi\n'
        'fi\n'
        f'exec "{real_git}" "$@"\n'
    )
    wrapper.chmod(0o755)
    result = publish(publication)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "skipping publication" in result.stdout
    assert "stale info" in result.stderr
    assert git(remote, "rev-parse", "main") == rollback_sha
    assert_no_bundle(remote)
    assert git(runner, "rev-parse", "HEAD^") == expected_sha
    # Exactly one guarded attempt; no unguarded force, '+' refspec, or retry
    # that could restore the administrator's removed source/asset commit.
    assert push_log.read_text().splitlines() == [
        "push", f"--force-with-lease=refs/heads/main:{expected_sha}",
        "origin", "HEAD:refs/heads/main",
    ]


def test_out_of_order_validation_cannot_drop_newest_publisher(publication, tmp_path):
    remote, writer, oldest, env = publication
    workflow = (ROOT / ".github/workflows/build.yml").read_text()
    assert not any(line.lstrip().startswith("concurrency:") for line in workflow.splitlines())
    # Oldest is active. Newest finishes validation before middle. With a concurrency
    # group, newest would be pending and then cancelled by middle's arrival.
    active = subprocess.Popen(["bash", str(SCRIPT)], cwd=oldest,
                              env=dict(env, MODE="paused"), stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True)
    marker = Path(env["MARKER"])
    try:
        deadline = time.monotonic() + 10
        while not marker.exists():
            assert active.poll() is None, "oldest publisher exited before building"
            assert time.monotonic() < deadline, "oldest publisher did not build"
            time.sleep(0.02)
        advance_main(writer, content="middle")
        middle_sha = git(remote, "rev-parse", "main")
        advance_main(writer, content="newest")
        newest_sha = git(remote, "rev-parse", "main")
        for name, sha in [("newest", newest_sha), ("middle", middle_sha)]:
            runner = tmp_path / name
            git(tmp_path, "clone", str(remote), str(runner))
            result = publish((remote, writer, runner, dict(env, VALIDATED_SHA=sha)))
            assert result.returncode == 0, result.stdout + result.stderr
            if name == "middle":
                assert "skipping publication" in result.stdout
        published_sha = git(remote, "rev-parse", "main")
        assert git(remote, "rev-parse", "main^") == newest_sha
        assert git(remote, "show", "main:desktop/plugin.js") == "newest"
        marker.with_suffix(".release").touch()
        stdout, stderr = active.communicate(timeout=30)
        assert active.returncode == 0, stdout + stderr
        assert "skipping publication" in stdout
        assert git(remote, "rev-parse", "main") == published_sha
        assert git(remote, "rev-list", "--count", "main") == "4"
    finally:
        if active.poll() is None:
            active.kill()
            active.communicate()


@pytest.mark.parametrize("published", [False, True])
def test_actual_pr_bundle_policy_accepts_source_and_rejects_assets(publication, published):
    _, writer, _, env = publication
    if published:
        assert publish(publication).returncode == 0
        git(writer, "pull", "--ff-only")
    base = git(writer, "rev-parse", "HEAD")
    (writer / "source").write_text("source PR")
    git(writer, "add", "source")
    git(writer, "commit", "-m", "source PR")
    # Execute the exact PR check from the workflow, both before and after bootstrap.
    workflow = (ROOT / ".github/workflows/build.yml").read_text()
    command = next(line.removeprefix("        run: ") for line in workflow.splitlines()
                   if line.startswith("        run: git diff"))
    check_env = dict(env, BASE_SHA=base)
    assert subprocess.run(["bash", "-c", command], cwd=writer, env=check_env,
                          capture_output=True).returncode == 0
    (writer / "desktop").mkdir(exist_ok=True)
    (writer / "desktop/plugin.js").write_text("bundle in source PR")
    git(writer, "add", "-f", "desktop/plugin.js")
    git(writer, "commit", "-m", "forbidden generated change")
    assert subprocess.run(["bash", "-c", command], cwd=writer, env=check_env,
                          capture_output=True).returncode != 0


def assert_no_bundle(remote):
    assert subprocess.run(["git", "-C", str(remote), "cat-file", "-e",
                           "main:desktop/plugin.js"], capture_output=True).returncode != 0


def advance_main(writer, *, bot=False, path="source", content="new source"):
    git(writer, "pull", "--ff-only")
    target = writer / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)
    git(writer, "add", "-f", path)
    if bot:
        git(writer, "config", "user.name", "github-actions[bot]")
        git(writer, "config", "user.email",
            "41898282+github-actions[bot]@users.noreply.github.com")
    git(writer, "commit", "-m", "chore(build): update compiled plugin assets")
    git(writer, "push", "origin", "main")


@pytest.mark.parametrize("event", ["push", "workflow_dispatch"])
def test_newer_source_before_start_skips_without_build(publication, event):
    remote, writer, _, env = publication
    env["GITHUB_EVENT_NAME"] = event
    advance_main(writer)
    before = git(remote, "rev-parse", "main")
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert "skipping publication" in result.stdout
    assert git(remote, "rev-parse", "main") == before
    assert not Path(env["BUILD_LOG"]).exists()
    assert_no_bundle(remote)


@pytest.mark.parametrize("event", ["push", "workflow_dispatch"])
def test_manual_and_push_build_only_triggering_sha(publication, event):
    _, _, _, env = publication
    env["GITHUB_EVENT_NAME"] = event
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert set(Path(env["BUILD_LOG"]).read_text().splitlines()) == {env["VALIDATED_SHA"]}


@pytest.mark.parametrize("bot,path", [(True, "desktop/plugin.js"),
                                      (False, "desktop/plugin.js"), (True, "source")])
def test_only_bot_asset_commits_can_extend_validated_sha(publication, bot, path):
    remote, writer, _, env = publication
    advance_main(writer, bot=bot, path=path, content="concurrent output")
    before = git(remote, "rev-parse", "main")
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    if bot and path == "desktop/plugin.js":
        assert git(remote, "show", "main:desktop/plugin.js") == "initial"
        assert git(remote, "rev-parse", "main^") == before
        assert set(Path(env["BUILD_LOG"]).read_text().splitlines()) == {env["VALIDATED_SHA"]}
    else:
        assert "skipping publication" in result.stdout
        assert git(remote, "rev-parse", "main") == before
        assert not Path(env["BUILD_LOG"]).exists()


def test_missing_validated_sha_fails_closed(publication):
    remote, _, _, env = publication
    del env["VALIDATED_SHA"]
    before = git(remote, "rev-parse", "main")
    result = publish(publication)
    assert result.returncode != 0
    assert "VALIDATED_SHA is required" in result.stderr
    assert git(remote, "rev-parse", "main") == before


def test_rewritten_main_skips(publication):
    remote, writer, _, env = publication
    git(writer, "checkout", "--orphan", "replacement")
    git(writer, "commit", "-m", "rewritten history")
    git(writer, "push", "--force", "origin", "HEAD:main")
    before = git(remote, "rev-parse", "main")
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert "skipping publication" in result.stdout
    assert git(remote, "rev-parse", "main") == before
    assert not Path(env["BUILD_LOG"]).exists()


def test_asset_commit_cannot_hide_intervening_source_change(publication):
    remote, writer, _, env = publication
    advance_main(writer)
    advance_main(writer, bot=True, path="desktop/plugin.js")
    before = git(remote, "rev-parse", "main")
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert "skipping publication" in result.stdout
    assert git(remote, "rev-parse", "main") == before
    assert not Path(env["BUILD_LOG"]).exists()


def test_manual_run_can_validate_existing_bot_asset_commit(publication):
    remote, _, runner, env = publication
    assert publish(publication).returncode == 0
    env["VALIDATED_SHA"] = git(remote, "rev-parse", "main")
    Path(env["BUILD_LOG"]).unlink()
    env["GITHUB_EVENT_NAME"] = "workflow_dispatch"
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert "unchanged" in result.stdout
    assert git(remote, "rev-parse", "main") == env["VALIDATED_SHA"]
    assert git(runner, "rev-parse", "HEAD") == env["VALIDATED_SHA"]
    assert set(Path(env["BUILD_LOG"]).read_text().splitlines()) == {env["VALIDATED_SHA"]}


def test_multiple_bot_asset_commits_keep_build_pinned(publication):
    remote, writer, _, env = publication
    advance_main(writer, bot=True, path="desktop/plugin.js", content="first bundle")
    advance_main(writer, bot=True, path="desktop/plugin.js", content="second bundle")
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert git(remote, "show", "main:desktop/plugin.js") == "initial"
    assert set(Path(env["BUILD_LOG"]).read_text().splitlines()) == {env["VALIDATED_SHA"]}


def test_bot_merge_cannot_bypass_source_validation(publication):
    remote, writer, _, env = publication
    git(writer, "checkout", "-b", "unvalidated")
    (writer / "source").write_text("unvalidated backend")
    git(writer, "add", "source")
    git(writer, "commit", "-m", "unvalidated source")
    git(writer, "checkout", "main")
    advance_main(writer, bot=True, path="desktop/plugin.js")
    git(writer, "merge", "--no-ff", "unvalidated", "-m",
        "chore(build): update compiled plugin assets")
    git(writer, "push", "origin", "main")
    before = git(remote, "rev-parse", "main")
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert "skipping publication" in result.stdout
    assert git(remote, "rev-parse", "main") == before
    assert not Path(env["BUILD_LOG"]).exists()


def test_bot_asset_deletion_can_be_repaired_from_validated_build(publication):
    remote, writer, _, env = publication
    assert publish(publication).returncode == 0
    git(writer, "pull", "--ff-only")
    git(writer, "config", "user.name", "github-actions[bot]")
    git(writer, "config", "user.email",
        "41898282+github-actions[bot]@users.noreply.github.com")
    git(writer, "rm", "desktop/plugin.js")
    git(writer, "commit", "-m", "chore(build): update compiled plugin assets")
    git(writer, "push", "origin", "main")
    result = publish(publication)
    assert result.returncode == 0, result.stderr
    assert git(remote, "show", "main:desktop/plugin.js") == "initial"
    assert set(Path(env["BUILD_LOG"]).read_text().splitlines()) == {env["VALIDATED_SHA"]}
