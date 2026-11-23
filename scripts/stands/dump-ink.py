# The ink of a row of the panel, as text.
#
# The box of an icon says nothing about the ink: the glyph lives in the viewBox
# of 24 units and the ink of one path sits higher or lower than the ink of
# another. The script prints the ink of a row of the panel as a picture of
# characters, so the optical alignment of an icon and of the words can be
# judged by the eye and not by a guess.
#
#   python analysis\code-review\dump-ink.py file card.png 0 120 0 40
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SCALE = 2  # the screenshots are taken with device_scale_factor 2


def main():
    name = sys.argv[1]
    left = float(sys.argv[2])
    right = float(sys.argv[3])
    top = float(sys.argv[4])
    bottom = float(sys.argv[5])
    image = Image.open(os.path.join(HERE, name)).convert('RGB')
    background = image.getpixel((4, 4))
    print('background', background, 'image', image.size)
    for y in range(int(top * SCALE), int(bottom * SCALE)):
        line = []
        for x in range(int(left * SCALE), int(right * SCALE), 2):
            pixel = image.getpixel((x, y))
            far = abs(pixel[0] - background[0]) > 20 or abs(pixel[1] - background[1]) > 20 \
                or abs(pixel[2] - background[2]) > 20
            near = abs(pixel[0] - background[0]) > 90 or abs(pixel[1] - background[1]) > 90 \
                or abs(pixel[2] - background[2]) > 90
            line.append('#' if near else ('+' if far else '.'))
        print('%6.1f %s' % (y / SCALE, ''.join(line)))


main()
