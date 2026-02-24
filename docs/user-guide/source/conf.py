# Configuration file for the Sphinx documentation builder.
# nirs4all Studio — User Documentation

from datetime import date

# -- Project information ---------------------------------------------------

project = 'nirs4all Studio'
copyright = f'2025-{date.today().year}, Gregory Beurier'
author = 'Gregory Beurier'
release = '0.1.0'
version = '0.1'

# -- General configuration ------------------------------------------------

extensions = [
    'myst_parser',
    'sphinx_copybutton',
    'sphinx_design',
    'sphinxcontrib.mermaid',
]

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']

source_suffix = {
    '.md': 'markdown',
    '.rst': 'restructuredtext',
}

# -- MyST configuration ---------------------------------------------------

myst_enable_extensions = [
    'colon_fence',
    'deflist',
    'substitution',
    'tasklist',
    'attrs_block',
    'fieldlist',
]
myst_heading_anchors = 3

myst_substitutions = {
    'version': release,
    'app_name': 'nirs4all Studio',
}

# -- Options for HTML output -----------------------------------------------

html_theme = 'sphinx_rtd_theme'
html_static_path = ['_static']

html_logo = '_static/nirs4all_logo.png'
html_favicon = '_static/nirs4all_logo.png'

html_theme_options = {
    'logo_only': False,
    'version_selector': True,
    'style_nav_header_background': '#0d9488',
    'navigation_depth': 3,
    'collapse_navigation': False,
    'sticky_navigation': True,
    'includehidden': True,
    'titles_only': False,
}

html_css_files = ['css/custom.css']

html_context = {
    'display_github': True,
    'github_user': 'gbeurier',
    'github_repo': 'nirs4all',
    'github_version': 'main',
    'conf_py_path': '/nirs4all-webapp/docs/user-guide/source/',
}

suppress_warnings = ['ref.*']
