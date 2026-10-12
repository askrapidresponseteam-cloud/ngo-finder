"""Animal welfare and wildlife NGO scraper for India."""

import warnings

# macOS's own Python is built with LibreSSL; urllib3 warns about it on import
# but works fine for the sites this scraper reads.
warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")

__version__ = "3.2.2"
