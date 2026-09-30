# PrepFlow Viewer

**English** | [日本語](README.jp.md)

https://github.com/user-attachments/assets/2a0d59ca-eb2d-4ffc-8e18-4a47c0b9e8a4

**Understand your flow at a glance.**

A Windows tool for opening and inspecting Tableau Prep flows instantly, without loading source data. You do not need Tableau Prep installed to view a flow.

Explore `.tfl` / `.tflx` files, edit formulas and output destinations, and export individual or multiple flows as self-contained HTML viewers. You can also run flows and publish them to Tableau Server. The interface supports Japanese, English, French, Spanish, German and Brazilian Portuguese.

## Download and launch

**[Download for Windows](https://github.com/dirsense/PrepFlowViewer/releases/latest/download/PrepFlowViewer-v1.0-Windows-x64.zip)** · [Release notes](https://github.com/dirsense/PrepFlowViewer/releases/latest)



1. Right-click it and select **Extract All**.
2. Open `PrepFlowViewer_v1.0.exe` in the extracted folder. Keep the `_internal` folder alongside the EXE.

Requires Windows 10 / 11 (64-bit) and Microsoft Edge WebView2. No Python installation is needed. Running flows requires Tableau Prep Builder with a valid license.

## How to use

**[Open the illustrated English guide](https://dirsense.github.io/PrepFlowViewer/manual.html)**

See the guide for viewing, editing, saving, exporting HTML, running and publishing flows. The distribution ZIP also includes the English guide as `manual.html`.

## For developers

<details>
<summary>Repository layout, development and builds</summary>

### Repository layout

| File or folder | Purpose |
| --- | --- |
| `prepflow.py` | Flow parsing, saving, HTML generation and local server |
| `desktop_launcher.py` | Windows app entry point and desktop window |
| `flow_runner.py` / `tableau_publish.py` | Prep CLI execution / Server publishing |
| `output_edit.py` / `formula_types.py` | Output editing / formula type inference |
| `web/` | Interface, styles and translations; script order is in `assets.json` |
| `tests/` / `samples/` | Automated tests / sample flows |
| `manual.html` / `manual.jp.html` / `docs/media/` | English and Japanese guides / README media |
| `build_windows.py` | Windows build and distribution ZIP packaging |

See the [UI development guide](web/README.md) for details on the frontend architecture.

### Run from source and test

Use Python 3.10 or later. Node.js 22 or later is used for formatting and testing the interface code.

```powershell
python -m pip install tableauserverclient==0.41
python prepflow.py --serve
```

```powershell
python -m unittest discover -s tests -v
npm ci
npm test
npm run format:check
```

### Build the Windows app

Use 64-bit Python on Windows. The distribution build has been verified with Python 3.13.

```powershell
python -m pip install --target .build-tools pyinstaller==6.22.3 pywebview==6.2.1 tableauserverclient==0.41
python build_windows.py
```

The app and guides are generated in `dist/PrepFlowViewer/`, with the distribution ZIP at `dist/PrepFlowViewer-v1.0-Windows-x64.zip`. The version is defined by `VERSION` in `build_windows.py`.

The English and Japanese guides are maintained in `manual.html` and `manual.jp.html`. Changes on main are automatically published to GitHub Pages.

</details>
