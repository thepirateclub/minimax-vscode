# The screenshot of the open step of the actions.
#
#   python analysis\code-review\shoot-open.py open-steps
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
name = sys.argv[1]

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 609, 'height': 600}, device_scale_factor=2)
    page.goto('http://localhost:5199/?theme=dark&sections=1')
    page.wait_for_selector('.tool-steps-head')
    page.click('.tool-steps-head')
    page.wait_for_timeout(300)
    # A click of the mouse leaves a selection of the words of the row, the
    # screenshot would show it as a blue plate.
    print('the selection:', repr(page.evaluate('window.getSelection().toString()')))
    print('the focus:', page.evaluate('document.activeElement && document.activeElement.className'))
    page.evaluate('''() => {
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.empty();
        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();
        }
    }''')
    page.wait_for_timeout(200)
    feed = page.query_selector('.messages')
    feed.screenshot(path=os.path.join(HERE, name + '.png'))
    print('written', name + '.png')
    browser.close()
