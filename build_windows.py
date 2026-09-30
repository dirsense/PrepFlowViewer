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
        raise ValueError('バージョン番号が不正です。')
    package, dist = Path(package).resolve(), Path(dist).resolve()
    required = [f'PrepFlowViewer_v{version}.exe', '_internal',
                '操作ガイド.html', 'manual.en.html', 'はじめに.txt', 'publish.example.ini']
    for name in required:
        if not (package / name).exists():
            raise RuntimeError(f'配布対象のファイルがありません: {name}')
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
                raise RuntimeError('配布ZIPの検証に失敗しました。')
        staged.replace(destination)
    return destination


def main():
    if os.name != 'nt':
        raise SystemExit('Windows上でビルドしてください。')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-manual', action='store_true', help='既存の配布版の操作ガイドをそのまま保持する')
    args = parser.parse_args()
    package = ROOT / 'dist/PrepFlowViewer'
    if package.resolve().parent != (ROOT / 'dist').resolve():
        raise SystemExit('配布先フォルダーが想定した場所ではありません。')
    manual = package / '操作ガイド.html'
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
    shutil.copy2(ROOT / 'DISTRIBUTION.txt', package / 'はじめに.txt')
    if args.keep_manual:
        manual.write_bytes(manual_bytes)
        os.utime(manual, ns=(manual_stat.st_atime_ns, manual_stat.st_mtime_ns))
    else:
        shutil.copy2(ROOT / 'manual.html', manual)
    english_manual = (ROOT / 'manual.en.html').read_text(encoding='utf-8')
    (package / 'manual.en.html').write_text(
        english_manual.replace('href="manual.html"', 'href="操作ガイド.html"'), encoding='utf-8')
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
