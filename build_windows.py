"""Build a relocatable Windows folder and distribution ZIP."""
import os
import argparse
import shutil
import subprocess
import sys
import re
import tempfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = '1.0'
EXE_NAME = f'PrepFlowViewer_v{VERSION}.exe'


def archive_password():
    path = ROOT / 'build-password.txt'
    if not path.is_file():
        raise RuntimeError('ビルド用のZIPパスワード設定がありません。')
    password = path.read_text(encoding='utf-8').rstrip('\r\n')
    if not password:
        raise RuntimeError('ZIPパスワードが空です。')
    return password


def seven_zip_path():
    command = shutil.which('7z') or str(Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / '7-Zip/7z.exe')
    if not Path(command).is_file():
        raise RuntimeError('パスワード付きZIPの作成には7-Zipが必要です。')
    return command


def run_seven_zip(arguments, password, cwd=None):
    # Do not let a subprocess exception or command log expose the password.
    result = subprocess.run([seven_zip_path(), *arguments, '-p' + password, '-y', '-bso0', '-bsp0'],
                            cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError(f'ZIPの作成・検証に失敗しました（終了コード {result.returncode}）。')


def split_archives(package, dist, version, password):
    if not re.fullmatch(r'\d+(?:\.\d+)*', version):
        raise ValueError('バージョン番号が不正です。')
    dist = Path(dist).resolve()
    package = Path(package).resolve()
    destination = dist / f'v{version}_{date.today():%Y%m%d}'
    if destination.resolve().parent != dist:
        raise ValueError('配布先フォルダーが想定した場所ではありません。')
    exe_name = f'PrepFlowViewer_v{version}.exe'
    if not (package / '_internal').is_dir() or not (package / exe_name).is_file():
        raise RuntimeError('配布対象のEXEまたは_internalがありません。')
    # Stage and verify both archives before replacing a same-day release.
    with tempfile.TemporaryDirectory(prefix='split-zip-', dir=dist) as temporary:
        for archive, member in [('a.zip', '_internal'), ('b.zip', exe_name)]:
            output = Path(temporary) / archive
            run_seven_zip(['a', '-tzip', '-mem=AES256', str(output), member], password, cwd=package)
            run_seven_zip(['t', str(output)], password)
        destination.mkdir(exist_ok=True)
        for archive in ['a.zip', 'b.zip']:
            (Path(temporary) / archive).replace(destination / archive)
    return destination


def main():
    if os.name != 'nt':
        raise SystemExit('Windows上でビルドしてください。')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-manual', action='store_true', help='既存の配布版の操作ガイドをそのまま保持する')
    args = parser.parse_args()
    password = archive_password()
    seven_zip_path()
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
    # Keep dependency notices inside the runtime-only archive as well.
    shutil.copytree(package / 'licenses', package / '_internal/licenses', dirs_exist_ok=True)
    if (package / 'Python-LICENSE.txt').exists():
        shutil.copy2(package / 'Python-LICENSE.txt', package / '_internal/Python-LICENSE.txt')
    print(split_archives(package, ROOT / 'dist', VERSION, password))


if __name__ == '__main__':
    main()
