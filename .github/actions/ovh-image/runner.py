#!/usr/bin/env python3
"""Verify a frozen request before building. No OVH credentials or runtime actions."""
import hashlib, importlib.util, json, os, re, sys, tarfile, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('source_guard', ROOT / 'source_guard.py')
guard = importlib.util.module_from_spec(spec); spec.loader.exec_module(guard)

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def api(path):
    req = urllib.request.Request('https://api.github.com/repos/' + os.environ['GITHUB_REPOSITORY'] + '/' + path,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, timeout=60) as response: return json.load(response)

def asset(row, destination):
    # Signed asset redirect gets no GitHub Authorization header.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    req = urllib.request.Request(row['url'], headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/octet-stream'})
    try: response = urllib.request.build_opener(NoRedirect()).open(req, timeout=60)
    except urllib.error.HTTPError as exc:
        if exc.code not in (301, 302, 303, 307, 308): raise
        from urllib.parse import urlparse
        url = exc.headers['Location']; host = urlparse(url).hostname or ''
        if not host.endswith(('.githubusercontent.com', '.github.com')): raise ValueError('Untrusted asset redirect')
        response = urllib.request.urlopen(url, timeout=60)
    with response, destination.open('wb') as output:
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > 600 * 1024 * 1024: raise ValueError('Source archive is too large')
            output.write(block)
    if total != row['size']: raise ValueError('Incomplete asset')

def prepare():
    identifier = os.environ['REQUEST_RELEASE']; expected = os.environ['REQUEST_SHA256']
    if not identifier.isdigit() or not re.fullmatch('[a-f0-9]{64}', expected): raise ValueError('Invalid request identity')
    release = api('releases/' + identifier)
    assets = {a['name']: a for a in release['assets']}
    output = Path(os.environ['RUNNER_TEMP']) / 'ovh-build'; output.mkdir()
    request_path = output / 'request.json'; asset(assets['request.json'], request_path)
    if digest(request_path) != expected: raise ValueError('Request checksum mismatch')
    request = json.loads(request_path.read_text())
    if request['version'] != 1 or request['release_accepted'] is not False: raise ValueError('Not build provenance')
    if not re.fullmatch('[a-z0-9][a-z0-9._-]{0,79}', request['slug']): raise ValueError('Invalid image slug')
    df = Path(request['dockerfile'])
    if df.is_absolute() or '..' in df.parts: raise ValueError('Invalid Dockerfile')
    source_release = api('releases/' + str(request.get('source_release', identifier)))
    source_assets = {a['name']: a for a in source_release['assets']}
    archive = output / 'source.tar.gz'; asset(source_assets['source.tar.gz'], archive)
    if digest(archive) != request['archive_sha256']: raise ValueError('Archive checksum mismatch')
    context = output / 'context'; context.mkdir()
    with tarfile.open(archive) as source:
        members = source.getmembers(); names = set(); size = 0
        for member in members:
            path = Path(member.name); size += member.size
            if path.is_absolute() or '..' in path.parts or member.name in names or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe archive member')
            names.add(member.name)
            if member.name != guard.META and guard.forbidden(member.name): raise ValueError('Private source file')
        if size > 2 * 1024 ** 3: raise ValueError('Expanded source too large')
        # Ownership is discarded; exact selected Git file modes are preserved.
        for member in members:
            destination = context / member.name
            if member.isdir(): destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                with source.extractfile(member) as stream, destination.open('wb') as target:
                    while block := stream.read(1024 * 1024): target.write(block)
                destination.chmod(member.mode & 0o777)
    metadata = guard.verify_source(context, request['project'])
    if metadata['source_sha256'] != request['source_sha256'] or df.as_posix() not in metadata['files']:
        raise ValueError('Source or Dockerfile binding mismatch')
    public = request.get('public_build_env', {})
    allowed = set(json.loads((ROOT / 'public-build-keys.json').read_text()))
    if set(public) - allowed: raise ValueError('Non-public build input')
    # Build input JSON is explicitly allowlisted; never signer/API/SSH credentials.
    (output / 'build-env.json').write_text(json.dumps(public))
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as stream:
        for key, value in {'context':str(context), 'dockerfile':str(context / df),
            'cache_key':request['slug'] + '-' + hashlib.sha256(df.as_posix().encode()).hexdigest()[:12],
            'image_tag':'local/' + request['slug'] + ':' + request['label'],
            'registry_tag':'ghcr.io/' + os.environ['GITHUB_REPOSITORY'] + '/' + request['slug'] + ':' + request['label'],
            'source_sha256':request['source_sha256'], 'inputs_sha256':request['build_inputs_sha256'],
            'env_file':str(output / 'build-env.json')}.items():
            if '\n' in value or '\r' in value: raise ValueError('Invalid action output')
            stream.write(key + '=' + value + '\n')
    (output / 'started.json').write_text(json.dumps({'at':time.time()}))

def receipt():
    output = Path(os.environ['RUNNER_TEMP']) / 'ovh-build'
    request = json.loads((output / 'request.json').read_text())
    result = {k:request[k] for k in ['project','uuid','slug','label','commit','source_sha256','build_inputs_sha256','dockerfile']}
    result.update(version=1, workflow_commit=os.environ['GITHUB_SHA'], run_id=int(os.environ['GITHUB_RUN_ID']),
        run_attempt=int(os.environ['GITHUB_RUN_ATTEMPT']),
        image_id=os.environ['IMAGE_ID'], application_started=False, release_accepted=False,
        build_seconds=float(os.environ['BUILD_SECONDS']), provider='blacksmith', runner_name=os.environ['RUNNER_NAME'])
    if os.environ.get('IMAGE_REFERENCE'): result['image_reference']=os.environ['IMAGE_REFERENCE']
    else: result['archive_sha256']=digest(output / 'image.tar.zst')
    (output / 'receipt.json').write_text(json.dumps(result, indent=2))

def repository():
    output = Path(os.environ['RUNNER_TEMP']) / 'ovh-build'; output.mkdir()
    project = os.environ['OVH_PROJECT']; target = os.environ['OVH_TARGET_UUID']
    slug = re.sub('[^a-z0-9._-]', '-', project.lower())
    registry = output / 'registry'; registry.mkdir()
    (registry / 'deployment-policy.json').write_text(json.dumps({'projects':{project:{'uuid':target,'strategy':'two-slots'}}}))
    (registry / 'workflow-policy.json').write_text(json.dumps({'projects':{project:{'uuid':target}}}))
    context = output / 'context'
    meta = guard.freeze(project, Path(os.environ['GITHUB_WORKSPACE']), os.environ['GITHUB_SHA'], context, registry)
    public = json.loads(os.environ.get('OVH_PUBLIC_BUILD_ENV','{}') or '{}')
    allowed = set(json.loads((ROOT / 'public-build-keys.json').read_text()))
    if set(public)-allowed: raise ValueError('Unapproved public build key')
    env_path = output / 'build-env.json'; env_path.write_text(json.dumps(public))
    inputs = hashlib.sha256(json.dumps({'source':meta['source_sha256'], 'secrets':
        {'build_env':digest(env_path)} if public else {}},sort_keys=True).encode()).hexdigest()
    label = os.environ['GITHUB_SHA'][:12] + '-' + os.environ['GITHUB_RUN_ID']
    df = Path(os.environ['OVH_DOCKERFILE'])
    if df.is_absolute() or '..' in df.parts or not (context / df).is_file(): raise ValueError('Unbound Dockerfile')
    request = dict(project=project,uuid=target,slug=slug,label=label,commit=meta['commit'],source_sha256=meta['source_sha256'],
        build_inputs_sha256=inputs,dockerfile=df.as_posix())
    (output / 'request.json').write_text(json.dumps(request))
    (output / 'started.json').write_text(json.dumps({'at':time.time()}))
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as stream:
        for k,v in dict(context=str(context),dockerfile=str(context/df),cache_key=slug+'-'+hashlib.sha256(df.as_posix().encode()).hexdigest()[:12],
            image_tag='local/'+slug+':'+label,registry_tag='ghcr.io/'+os.environ['GITHUB_REPOSITORY']+'/'+slug+':'+label,
            source_sha256=meta['source_sha256'],inputs_sha256=inputs,env_file=str(env_path)).items():
            if '\n' in v or '\r' in v: raise ValueError('Invalid output')
            stream.write(k+'='+v+'\n')

if __name__ == '__main__':
    {'prepare':prepare, 'receipt':receipt, 'repository':repository}[sys.argv[1]]()
