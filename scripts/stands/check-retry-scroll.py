# The scroll of the feed after the repeat of a request.
#
#   python scripts/stands\check-retry-scroll.py
#
# The stand shows a long chat with an old failed turn in the middle of it, so
# the panel shows the button of the repeat there. The reader scrolls up to
# that failure, presses the repeat, and the feed has to go to the end of the
# history and follow the new turn.
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:5199/?theme=dark&retry=1'
GAP = 80


def read_feed(page):
    return page.evaluate(
        """() => {
        const el = document.querySelector('.messages');
        if (!el) return null;
        const last = el.querySelector('.message:last-child');
        const box = last ? last.getBoundingClientRect() : null;
        const mine = el.getBoundingClientRect();
        return {
            scrollTop: Math.round(el.scrollTop),
            scrollHeight: Math.round(el.scrollHeight),
            clientHeight: el.clientHeight,
            messages: el.querySelectorAll('.message').length,
            lastBottom: box ? Math.round(box.bottom - mine.bottom) : null
        };
    }"""
    )


def gap(state):
    if not state:
        return 0
    return state['scrollHeight'] - state['scrollTop'] - state['clientHeight']


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 609, 'height': 760}, device_scale_factor=2)
    page.goto(URL)
    page.wait_for_selector('.messages')
    page.wait_for_timeout(500)
    # The reader scrolls up to the old failure, the button of the repeat.
    page.evaluate(
        """() => {
        const el = document.querySelector('.messages');
        const button = document.querySelector('.message-retry');
        const row = button.closest('.message');
        el.scrollTop = row.offsetTop - 200;
    }"""
    )
    page.wait_for_timeout(400)
    before = read_feed(page)
    page.screenshot(path=os.path.join(HERE, 'retry-scroll-before.png'))
    print('before the repeat:', before, 'gap', gap(before))
    # The request runs again.
    page.click('.message-retry')
    page.wait_for_timeout(1500)
    after = read_feed(page)
    page.screenshot(path=os.path.join(HERE, 'retry-scroll-after.png'))
    print('after the repeat: ', after, 'gap', gap(after))
    failed = []
    if gap(after) > GAP:
        failed.append('the feed is not at the end of the history')
    if after['lastBottom'] is None or after['lastBottom'] > 0:
        failed.append('the new turn is under the fold')
    if failed:
        for line in failed:
            print('FAIL:', line)
        browser.close()
        sys.exit(1)
    print('OK: the feed is at the end and shows the new turn')
    browser.close()
