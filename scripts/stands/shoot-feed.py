# The screenshot of the feed of the panel for a given url of the stand.
#
#   python analysis\code-review\shoot-feed.py cards "theme=dark&steps=0" 0
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]
query = sys.argv[2] if len(sys.argv) > 2 else 'theme=dark'
scroll = sys.argv[3] if len(sys.argv) > 3 else '0'

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 609, 'height': 700}, device_scale_factor=2)
    page.goto('http://localhost:5199/?' + query)
    page.wait_for_selector('.messages')
    page.wait_for_timeout(300)
    feed = page.query_selector('.messages')
    page.evaluate('(y) => { document.querySelector(".messages").scrollTop = y; }', int(scroll))
    page.wait_for_timeout(200)
    feed.screenshot(path=os.path.join(HERE, name + '.png'))
    print('written', name + '.png')
    browser.close()
