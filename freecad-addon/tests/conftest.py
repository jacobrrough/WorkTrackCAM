# SPDX-License-Identifier: MIT

import sys
import pathlib

# Add the addon root to sys.path so integration modules can be imported
addon_root = pathlib.Path(__file__).resolve().parent.parent
if str(addon_root) not in sys.path:
    sys.path.insert(0, str(addon_root))
