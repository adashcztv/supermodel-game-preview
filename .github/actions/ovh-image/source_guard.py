#!/usr/bin/env python3
"""Shared context, immutable Git export and serialized image builds; never deploys."""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
META = '.ovh-source.json'
SAFE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$')


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_suffix(path.suffix + '.pending')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temp.chmod(0o600)
    os.replace(temp, path)


def policies(root=ROOT):
    deployment = json.loads((root / 'deployment-policy.json').read_text())['projects']
    workflow = json.loads((root / 'workflow-policy.json').read_text())['projects']
    if set(workflow) - set(deployment):
        raise ValueError('Workflow registry contains a target absent from deployment policy.')
    for name, entry in deployment.items():
        if name not in workflow:
            workflow[name] = {'uuid': entry['uuid'], 'source_kind': 'new-target-source-binding-required',
                'source_limit': 'Registered target inherited the shared workflow; identify its actual repository and dev command before editing.',
                'release_guide': 'DEPLOYMENT.md', 'github_actions': 'preserve-existing-policy'}
    for name, entry in workflow.items():
        if entry['uuid'] != deployment[name]['uuid']:
            raise ValueError('Workflow target UUID differs from deployment registry: ' + name)
    return deployment, workflow


def target(name, root=ROOT, build=False):
    deployment, workflow = policies(root)
    if name not in deployment:
        raise ValueError('Unknown target; register the actual resource first.')
    p = {**workflow[name], 'strategy': deployment[name]['strategy'], 'name': name}
    if build and p['strategy'] == 'inactive-protected':
        raise ValueError('Retired target is protected; it cannot enter the build queue.')
    return p


def forbidden(path):
    parts = Path(path).parts
    if any(x in ('.git', '.workflow', 'node_modules', 'private', '.ssh', '.config') for x in parts):
        return True
    n = Path(path).name.lower()
    return ((n.startswith('.env') and not n.endswith(('.example', '.sample', '.template')))
            or n in ('signer.db', 'id_ed25519', 'id_rsa', 'api-token', 'coolify-ai-token')
            or n.endswith(('.sqlite', '.sqlite3', '.db', '.pem', '.key', '.p12', '.pfx')))


def snapshot(context):
    files = {}
    for p in sorted(context.rglob('*')):
        relative = p.relative_to(context).as_posix()
        if relative == META:
            continue
        if p.is_symlink():
            raise ValueError('Symlinks are not supported in frozen contexts: ' + relative)
        if not p.is_file():
            continue
        if forbidden(relative):
            raise ValueError('Private/data/dependency file in source context: ' + relative)
        files[relative] = {'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                           'mode': p.stat().st_mode & 0o777}
    if not files:
        raise ValueError('Empty source context.')
    return files


def source_hash(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def verify_source(context, project):
    metadata = json.loads((context / META).read_text())
    actual = snapshot(context)
    if metadata.get('project') != project or metadata.get('files') != actual:
        raise ValueError('Source context changed or belongs to another target.')
    if metadata.get('source_sha256') != source_hash(actual):
        raise ValueError('Source manifest digest mismatch.')
    if metadata.get('release_accepted') is not False:
        raise ValueError('Source provenance must not claim release acceptance.')
    return metadata


def freeze(project, repo, ref, output, root=ROOT):
    target(project, root, build=True)
    if output.exists():
        raise ValueError('Output already exists; reconcile it rather than replacing source.')
    commit = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', '--verify', '--end-of-options', ref + '^{commit}'], text=True).strip()
    data = subprocess.check_output(['git', '-C', str(repo), 'archive', '--format=tar', commit])
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        members = archive.getmembers()
        for member in members:
            p = Path(member.name)
            if p.is_absolute() or '..' in p.parts or not (member.isdir() or member.isfile()):
                raise ValueError('Unsafe archive member: ' + member.name)
            if forbidden(member.name) or member.name == META:
                raise ValueError('Private/generated file is tracked: ' + member.name)
        output.mkdir(parents=True, mode=0o700)
        for member in members:
            p = output / member.name
            if member.isdir():
                p.mkdir(parents=True, exist_ok=True)
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(archive.extractfile(member).read())
                p.chmod(member.mode & 0o777)
    files = snapshot(output)
    metadata = {'project': project, 'commit': commit, 'files': files,
                'source_sha256': source_hash(files), 'release_accepted': False}
    save(output / META, metadata)
    return {'project': project, 'commit': commit, 'files': len(files),
            'source_sha256': metadata['source_sha256'], 'context': str(output),
            'release_accepted': False}


def lock(path, timeout):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    start = time.monotonic()
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd, time.monotonic() - start
        except BlockingIOError:
            if time.monotonic() - start >= timeout:
                os.close(fd)
                raise TimeoutError('Build queue occupied; no build or deployment was started.')
            time.sleep(.2)


def build(project, context, label, dockerfile='Dockerfile', wait=30, root=ROOT, secrets=None):
    p = target(project, root, build=True)
    if not SAFE.fullmatch(label):
        raise ValueError('Use a short unique build label.')
    df = Path(dockerfile)
    if df.is_absolute() or '..' in df.parts:
        raise ValueError('Dockerfile must be inside the frozen source context.')
    context = context.resolve()
    if str(context).startswith(('/data/apps/', '/data/coolify/')):
        raise ValueError('Runtime or application data cannot be a build source.')
    metadata = verify_source(context, project)
    if dockerfile not in metadata['files']:
        raise ValueError('Dockerfile is not part of the frozen source manifest.')
    secret_args = []
    secret_ids = []
    secret_paths = {}
    for secret in secrets or []:
        match = re.fullmatch(r'id=([a-zA-Z0-9._-]+),src=(.+)', secret)
        if not match or not Path(match[2]).is_file() or match[1] in secret_ids:
            raise ValueError('Secret must be a unique BuildKit id and an existing protected file.')
        secret_path = Path(match[2]).resolve()
        if secret_path == context or context in secret_path.parents:
            raise ValueError('Build secrets must stay outside the frozen source context.')
        secret_ids.append(match[1]); secret_args += ['--secret', secret]
        secret_paths[match[1]] = secret_path
    if secret_paths:
        recipe = (context / dockerfile).read_text().replace('\\\n', ' ')
        if not re.search(r'^ARG\s+OVH_BUILD_INPUTS_SHA\b', recipe, re.MULTILINE):
            raise ValueError('Secret build requires ARG OVH_BUILD_INPUTS_SHA in its build stage.')
        secret_runs = [line for line in recipe.splitlines() if re.match(r'^RUN\s', line) and 'type=secret' in line]
        if not secret_runs or any(not re.search(r'\$\{?OVH_BUILD_INPUTS_SHA\b', line) for line in secret_runs):
            raise ValueError('Each secret-dependent RUN must use OVH_BUILD_INPUTS_SHA to invalidate cache.')
    slug = re.sub(r'[^a-z0-9._-]', '-', project.lower())
    folder = root / 'private/builds' / slug / label
    journal = folder / 'journal.json'
    fd, queued = lock(root / 'private/builds/global.lock', wait)
    try:
        metadata = verify_source(context, project)  # Recheck after waiting.
        secret_hashes = {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in secret_paths.items()}
        inputs_hash = hashlib.sha256(json.dumps({'source': metadata['source_sha256'],
            'secrets': secret_hashes}, sort_keys=True).encode()).hexdigest()
        if journal.exists():
            raise ValueError('Build label already has a journal; reconcile the image and log before retrying.')
        folder.mkdir(parents=True, mode=0o700)
        image = 'local/' + slug + ':' + label
        existing = subprocess.run(['docker', 'image', 'inspect', image], capture_output=True)
        if existing.returncode == 0:
            raise ValueError('Image tag already exists; do not overwrite its content.')
        state = {'project': project, 'uuid': p['uuid'], 'label': label,
                 'source_sha256': metadata['source_sha256'], 'commit': metadata.get('commit'),
                 'queued_seconds': round(queued, 3), 'phase': 'building', 'image': image,
                 'started_at': datetime.now(timezone.utc).isoformat(),
                 'build_secret_ids': secret_ids,
                 'build_inputs_sha256': inputs_hash,
                 'application_started': False, 'release_accepted': False}
        save(journal, state)
        print(json.dumps({'project': project, 'phase': 'building', 'journal': str(journal)}), flush=True)
        start = time.monotonic()
        with (folder / 'build.log').open('wb') as log:
            env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': os.environ.get('HOME', '/root'),
                   'DOCKER_BUILDKIT': '1'}
            result = subprocess.run(['docker', 'build', '--progress=plain', '--label',
                'org.ovh.source.sha256=' + metadata['source_sha256'], '-t', image,
                '--label', 'org.ovh.build.inputs.sha256=' + inputs_hash,
                '--build-arg', 'OVH_BUILD_INPUTS_SHA=' + inputs_hash,
                '-f', str(context / dockerfile), *secret_args, str(context)], env=env,
                stdout=log, stderr=subprocess.STDOUT)
        state['build_seconds'] = round(time.monotonic() - start, 3)
        state['exit_code'] = result.returncode
        state['phase'] = 'built' if result.returncode == 0 else 'failed'
        save(journal, state)
        if result.returncode:
            raise RuntimeError('Image build failed; inspect the protected build.log. Do not resubmit blindly.')
        verify_source(context, project)
        if secret_hashes != {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in secret_paths.items()}:
            raise ValueError('Build input changed while compiling; this image has not been accepted.')
        state['image_id'] = subprocess.check_output(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], text=True).strip()
        state['phase'] = 'source-verified'
        save(journal, state)
        return state
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def doctor(root=ROOT):
    deployment, workflow = policies(root)
    for name in ('WORKFLOW.md', 'DEPLOYMENT.md', 'HANDOFF.md'):
        if not (root / name).is_file():
            raise ValueError('Shared guide missing: ' + name)
    return {'registered_targets': len(deployment),
            'retired_protected': sum(x['strategy'] == 'inactive-protected' for x in deployment.values()),
            'uuid_bindings_match': True, 'guides_present': True,
            'production_or_wallet_actions': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    commands.add_parser('list'); commands.add_parser('doctor')
    c = commands.add_parser('context'); c.add_argument('project')
    f = commands.add_parser('freeze'); f.add_argument('project'); f.add_argument('--repo', type=Path, required=True)
    f.add_argument('--ref', required=True); f.add_argument('--output', type=Path, required=True)
    b = commands.add_parser('build'); b.add_argument('project'); b.add_argument('--context', type=Path, required=True)
    b.add_argument('--label', required=True); b.add_argument('--dockerfile', default='Dockerfile')
    b.add_argument('--wait', type=float, default=30)
    b.add_argument('--secret', action='append', default=[], help='BuildKit id=NAME,src=/protected/file; never a value in an argument')
    a = parser.parse_args()
    if a.action == 'doctor':
        value = doctor()
    elif a.action == 'list':
        d, w = policies(); value = [{'project': n, 'strategy': p['strategy'], 'source_kind': w[n]['source_kind']} for n,p in d.items()]
    elif a.action == 'context':
        value = target(a.project)
    elif a.action == 'freeze':
        value = freeze(a.project, a.repo.resolve(), a.ref, a.output.resolve())
    else:
        if ROOT != Path('/data/ovh-release'):
            raise ValueError('Run builds on OVH through your own SSH identity; local command does not deploy.')
        if not 0 <= a.wait <= 3600:
            raise ValueError('Build queue wait must be bounded to 0..3600 seconds.')
        value = build(a.project, a.context, a.label, a.dockerfile, a.wait, secrets=a.secret)
    print(json.dumps(value, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, TimeoutError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
