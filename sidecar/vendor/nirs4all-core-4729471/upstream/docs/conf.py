# Configuration file for the Sphinx documentation builder.
#
# Full reference: https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------

project = "nirs4all-core"
author = "G. Beurier"
copyright = "2026, G. Beurier"

# -- General configuration ---------------------------------------------------

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
]

# -- MyST configuration ------------------------------------------------------

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

# -- autosectionlabel --------------------------------------------------------

autosectionlabel_prefix_document = True

# -- HTML output -------------------------------------------------------------

html_theme = "furo"
html_title = "nirs4all-core"
html_static_path = ["_static"]
html_favicon = "_static/brand/favicon.ico"
html_theme_options = {
    "light_logo": "brand/horizontal.svg",
    "dark_logo": "brand/horizontal-dark.svg",
}

# -- OpenGraph ---------------------------------------------------------------

ogp_site_url = "https://nirs4all-core.readthedocs.io/en/latest/"
ogp_image = "https://nirs4all-core.readthedocs.io/en/latest/_static/brand/og.png"
