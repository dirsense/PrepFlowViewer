"""System file pickers; Windows uses its native API without Tcl/Tk."""
import os
from pathlib import Path


def choose_file(*, title, directory, filename="", save=False, multiple=False, filetypes=None):
    from localization import translate
    title = translate(title)
    if filetypes:
        filetypes = [(translate(label), pattern) for label, pattern in filetypes]
    if os.name != "nt":
        import tkinter as tk
        from tkinter import filedialog
        window = None
        try:
            window = tk.Tk()
            window.withdraw()
            window.attributes("-topmost", True)
            options = dict(parent=window, title=title, initialdir=str(directory),
                           filetypes=filetypes or [("Tableau Prep", "*.tflx *.tfl")])
            if save:
                options.update(initialfile=filename, defaultextension=Path(filename).suffix,
                               confirmoverwrite=True)
            picker = filedialog.asksaveasfilename if save else (filedialog.askopenfilenames if multiple else filedialog.askopenfilename)
            value = picker(**options)
            if multiple:
                return [Path(p).resolve() for p in value]
            return Path(value).resolve() if value else None
        except tk.TclError as exc:
            raise RuntimeError("Could not open the file picker.") from exc
        finally:
            if window is not None:
                window.destroy()

    return _choose_windows(title=title, directory=directory, filename=filename,
                           save=save, multiple=multiple, filetypes=filetypes)


def choose_directory(*, title, directory=None):
    from localization import translate
    title = translate(title)
    if os.name != 'nt':
        import tkinter as tk
        from tkinter import filedialog
        window = tk.Tk()
        window.withdraw()
        try:
            value = filedialog.askdirectory(parent=window, title=title, mustexist=True)
            return Path(value).resolve() if value else None
        finally:
            window.destroy()
    return _choose_windows(title=title, directory=directory, folder=True)


def _choose_windows(**options):
    from windows_file_dialog import choose
    return choose(**options)
