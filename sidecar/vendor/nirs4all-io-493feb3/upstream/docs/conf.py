# SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
"""Sphinx configuration for the nirs4all-io documentation."""

# -- Project information ----------------------------------------------------- #
project = "nirs4all-io"
author = "G. Beurier"
copyright = "2026, G. Beurier"

# -- General configuration --------------------------------------------------- #
extensions = [
    "myst_parser",
    "sphinx_design",
    "sphinx_copybutton",
    "sphinx.ext.autosectionlabel",
    "sphinx.ext.mathjax",
    "sphinxext.opengraph",
]

root_doc = "index"

source_suffix = {
    ".md": "markdown",
    ".rst": "restructuredtext",
}

exclude_patterns = [
    "_build",
    "Thumbs.db",
    ".DS_Store",
    # Maintainer-only / transient material — not published. These expose
    # internal review trails, EPIC plans, dated acceptance notes and branch
    # names that are not part of the public docs.
    "dev/*",
    "_private/**",
]

# -- MyST configuration ------------------------------------------------------ #
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

# Prefix autosectionlabel targets with the document path so duplicate headings
# across files do not collide.
autosectionlabel_prefix_document = True

# -- HTML output ------------------------------------------------------------- #
html_theme = "furo"
html_title = "nirs4all-io"
html_static_path = ["_static"]
html_favicon = "_static/brand/favicon.ico"
html_theme_options = {
    "light_logo": "brand/horizontal.svg",
    "dark_logo": "brand/horizontal-dark.svg",
}

# -- OpenGraph --------------------------------------------------------------- #
ogp_site_url = "https://nirs4all-io.readthedocs.io/en/latest/"
ogp_image = "https://nirs4all-io.readthedocs.io/en/latest/_static/brand/og.png"
