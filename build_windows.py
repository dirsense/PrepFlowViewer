"""Build a relocatable Windows folder and distribution ZIP."""
import os
import argparse
import shutil
import subprocess
import sys
import re
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = '1.0'
EXE_NAME = f'PrepFlowViewer_v{VERSION}.exe'


def public_archive(package, dist, version):
    """Package the application and guides for a public Windows release."""
    if not re.fullmatch(r'\d+(?:\.\d+)*', version):
        raise ValueError('Invalid version number.')
    package, dist = Path(package).resolve(), Path(dist).resolve()
    required = [f'PrepFlowViewer_v{version}.exe', '_internal',
                'manual.html', 'manual.jp.html', 'DISTRIBUTION.txt', 'DISTRIBUTION.jp.txt', 'publish.example.ini']
    for name in required:
        if not (package / name).exists():
            raise RuntimeError(f'Missing distribution file: {name}')
    # Explicit entries keep local credentials and flow files out of public ZIPs.
    members = required + ['Python-LICENSE.txt', 'licenses']
    dist.mkdir(parents=True, exist_ok=True)
    destination = dist / f'PrepFlowViewer-v{version}-Windows-x64.zip'
    with tempfile.TemporaryDirectory(prefix='public-zip-', dir=dist) as temporary:
        staged = Path(temporary) / destination.name
        with zipfile.ZipFile(staged, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name in members:
                member = package / name
                files = sorted(member.rglob('*')) if member.is_dir() else [member]
                for file in files:
                    if file.is_file():
                        archive.write(file, Path('PrepFlowViewer') / file.relative_to(package))
        with zipfile.ZipFile(staged) as archive:
            if archive.testzip() is not None:
                raise RuntimeError('Distribution ZIP validation failed.')
        staged.replace(destination)
    return destination


def main():
    if os.name != 'nt':
        raise SystemExit('Build this application on Windows.')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-manual', action='store_true', help='Keep the existing packaged English guide unchanged')
    args = parser.parse_args()
    package = ROOT / 'dist/PrepFlowViewer'
    if package.resolve().parent != (ROOT / 'dist').resolve():
        raise SystemExit('Unexpected distribution directory.')
    manual = package / 'manual.html'
    manual_bytes = manual.read_bytes() if args.keep_manual else None
    manual_stat = manual.stat() if args.keep_manual else None
    env = dict(os.environ)
    env['PYTHONPATH'] = str(ROOT / '.build-tools')
    subprocess.run([
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
        '--onedir', '--windowed', '--name', 'PrepFlowViewer',
        '--distpath', str(ROOT / 'dist'), '--workpath', str(ROOT / 'build'),
        '--specpath', str(ROOT / 'build'),
        '--manifest', str(ROOT / 'windows.manifest'),
        '--add-data', f'{ROOT / "web"};web',
        '--add-data', f'{ROOT / "open_folder.ps1"};.',
        '--exclude-module', 'tkinter',
        str(ROOT / 'desktop_launcher.py'),
    ], cwd=ROOT, env=env, check=True)
    (package / 'PrepFlowViewer.exe').rename(package / EXE_NAME)
    shutil.copy2(ROOT / 'DISTRIBUTION.txt', package / 'DISTRIBUTION.txt')
    if args.keep_manual:
        manual.write_bytes(manual_bytes)
        os.utime(manual, ns=(manual_stat.st_atime_ns, manual_stat.st_mtime_ns))
    else:
        shutil.copy2(ROOT / 'manual.html', manual)
    shutil.copy2(ROOT / 'manual.jp.html', package / 'manual.jp.html')
    shutil.copy2(ROOT / 'DISTRIBUTION.jp.txt', package / 'DISTRIBUTION.jp.txt')
    shutil.copy2(ROOT / 'publish.example.ini', package / 'publish.example.ini')
    # Keep the bundled interpreter's license alongside the distribution.
    license_path = Path(sys.base_prefix) / 'LICENSE.txt'
    if license_path.exists():
        shutil.copy2(license_path, package / 'Python-LICENSE.txt')
    for distribution in (ROOT / '.build-tools').glob('*.dist-info'):
        for license_file in distribution.rglob('*'):
            if license_file.is_file() and license_file.name.upper().startswith(('LICENSE', 'COPYING')):
                destination = package / 'licenses' / distribution.stem / license_file.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(license_file, destination)
    # Keep dependency notices with the bundled runtime as well.
    shutil.copytree(package / 'licenses', package / '_internal/licenses', dirs_exist_ok=True)
    if (package / 'Python-LICENSE.txt').exists():
        shutil.copy2(package / 'Python-LICENSE.txt', package / '_internal/Python-LICENSE.txt')
    print(public_archive(package, ROOT / 'dist', VERSION))


if __name__ == '__main__':
    main()
