# The screenshot of the whole panel of the stand.
#
#   python analysis\code-review\shoot-panel.py panel-steps "theme=dark&steps=1"
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]
query = sys.argv[2] if len(sys.argv) > 2 else 'theme=dark'

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 609, 'height': 760}, device_scale_factor=2)
    page.goto('http://localhost:5199/?' + query)
    page.wait_for_selector('.messages')
    page.wait_for_timeout(300)
    # A click of the mouse leaves a selection of the words of the row, the
    # screenshot would show it as a blue plate.
    page.evaluate('window.getSelection().removeAllRanges()')
    page.screenshot(path=os.path.join(HERE, name + '.png'))
    print('written', name + '.png')
    browser.close()
