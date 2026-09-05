from __future__ import annotations

project = "dag-ml-data"
author = "G. Beurier"
copyright = "2026, G. Beurier"

extensions = [
    "myst_parser",
    "sphinx_copybutton",
    "sphinx_design",
    "sphinx.ext.autosectionlabel",
    "sphinxext.opengraph",
]

source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}
root_doc = "index"

exclude_patterns = [
    "_build",
    "Thumbs.db",
    ".DS_Store",
    # The full ML_DATA implementation source spec (and its index) is internal
    # design material kept close to the code, not part of the published nav.
    "design",
    "_private",
]

myst_enable_extensions = [
    "colon_fence",
    "deflist",
    "fieldlist",
    "substitution",
    "tasklist",
    "attrs_inline",
    "dollarmath",
]
myst_heading_anchors = 3

# Prefix autosectionlabel targets with the document name so identical headings
# across pages (e.g. "Status", "References") do not collide into duplicate
# label warnings.
autosectionlabel_prefix_document = True

html_theme = "alabaster"
html_title = "dag-ml-data"
html_static_path: list[str] = ["_static"]
html_logo = "_static/brand/stacked.png"
html_favicon = "_static/brand/favicon.ico"

ogp_site_url = "https://dag-ml-data.readthedocs.io/en/latest/"
ogp_image = "https://dag-ml-data.readthedocs.io/en/latest/_static/brand/og.png"
