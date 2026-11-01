import os
from PIL import Image, ImageDraw, ImageFont

icons_dir = "/Users/eo/.gemini/antigravity/scratch/chrome_carrot_search/icons"
os.makedirs(icons_dir, exist_ok=True)

for size in [16, 48, 128]:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw rounded rectangle in Daangn Carrot Orange (#FF6F0F)
    padding = max(1, size // 16)
    radius = max(3, size // 4)
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=radius,
        fill=(255, 111, 15, 255)
    )
    
    # Draw Carrot shape or letter '당'
    # Carrot body (triangle / polygon)
    cx, cy = size / 2, size / 2
    # Leaf at top
    leaf_top = cy - size * 0.3
    leaf_bottom = cy - size * 0.1
    draw.ellipse([cx - size * 0.15, leaf_top, cx, leaf_bottom], fill=(67, 160, 71, 255))
    draw.ellipse([cx, leaf_top, cx + size * 0.15, leaf_bottom], fill=(102, 187, 106, 255))
    
    # Carrot root (cone)
    carrot_top_y = cy - size * 0.12
    carrot_bot_y = cy + size * 0.35
    w_top = size * 0.22
    points = [
        (cx - w_top, carrot_top_y),
        (cx + w_top, carrot_top_y),
        (cx, carrot_bot_y)
    ]
    draw.polygon(points, fill=(255, 240, 230, 255))
    
    img.save(os.path.join(icons_dir, f"icon{size}.png"))
    print(f"Generated icon{size}.png")
