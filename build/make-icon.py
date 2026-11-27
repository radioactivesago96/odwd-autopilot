# Draws build/icon.ico: a green "play" mark on a dark square.
from pathlib import Path
from PIL import Image, ImageDraw

size = 256
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, size - 8, size - 8), radius=44, fill=(11, 15, 20, 255), outline=(57, 255, 136, 255), width=10)
draw.polygon([(74, 62), (74, 194), (158, 128)], fill=(57, 255, 136, 255))
draw.polygon([(150, 62), (150, 100), (200, 128), (150, 156), (150, 194), (234, 128)], fill=(57, 255, 136, 160))
image.save(Path(__file__).with_name('icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
