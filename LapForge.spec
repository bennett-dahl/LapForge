# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for LapForge Flask backend.

Build with a clean venv (not conda) to avoid conda compatibility issues:
    .buildenv/Scripts/python.exe -m PyInstaller --clean --noconfirm LapForge.spec
"""

import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None
project_root = os.path.abspath('.')

# Dynamically-loaded tool modules (importlib in LapForge/tools/__init__.py)
tools_hiddenimports = collect_submodules('LapForge.tools')

# Lazy imports in app.py and sync modules
lazy_hiddenimports = [
    'LapForge.sync.bundle',
    'LapForge.sync.engine',
    'LapForge.sync.secrets',
    'LapForge.sync.cloud_google',
    'LapForge.processing',
    'LapForge.parsers.pi_toolbox_export',
]

# Third-party packages that need help with hidden imports
thirdparty_hiddenimports = [
    'keyring.backends',
    'keyring.backends.Windows',
    'flask.json',
    'authlib.integrations.flask_client',
    'google.oauth2.credentials',
    'google.auth.transport.requests',
    'googleapiclient.discovery',
    'googleapiclient.http',
    'googleapiclient._helpers',
]

all_hiddenimports = tools_hiddenimports + lazy_hiddenimports + thirdparty_hiddenimports

a = Analysis(
    [os.path.join('LapForge', '__main__.py')],
    pathex=[project_root],
    binaries=[],
    datas=[
        (os.path.join('LapForge', 'templates'), os.path.join('LapForge', 'templates')),
        (os.path.join('LapForge', 'static'), os.path.join('LapForge', 'static')),
    ],
    hiddenimports=all_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'unittest', 'test', 'xmlrpc',
        'pydoc', 'doctest', 'pdb', 'profile',
    ],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='LapForge',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=os.path.join('electron', 'icons', 'icon.png') if os.path.exists(os.path.join('electron', 'icons', 'icon.png')) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='backend',
)
