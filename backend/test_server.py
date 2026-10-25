"""
Quick smoke test for the Live Dressing backend pipeline.
"""
import io
import base64
from PIL import Image, ImageDraw  # type: ignore
from model_pipeline import run_virtual_tryon, get_system_status

def test_pipeline():
    print("--- System Diagnostic ---")
    status = get_system_status()
    for k, v in status.items():
        print(f"  {k}: {v}")

    print("\n--- Generating Mock User & Garment Images ---")
    # 1. Create a dummy user image (blue canvas with a stick figure)
    user_img = Image.new("RGB", (768, 1024), color=(220, 220, 225))
    draw = ImageDraw.Draw(user_img)
    # Head
    draw.ellipse((334, 150, 434, 250), fill=(230, 190, 160))
    # Torso
    draw.rectangle((310, 250, 458, 600), fill=(180, 180, 190))
    # Legs
    draw.rectangle((320, 600, 370, 950), fill=(60, 60, 80))
    draw.rectangle((398, 600, 448, 950), fill=(60, 60, 80))

    # 2. Create a dummy garment image (bright red t-shirt on white background)
    garment_img = Image.new("RGB", (600, 600), color=(255, 255, 255))
    gdraw = ImageDraw.Draw(garment_img)
    # T-shirt shape
    gdraw.polygon(
        [(200, 150), (400, 150), (450, 230), (390, 260), (360, 210), (360, 500), (240, 500), (240, 210), (210, 260), (150, 230)],
        fill=(220, 30, 50)
    )

    print("--- Running Try-On Transformation ---")
    result = run_virtual_tryon(user_img, garment_img, category="upper_body")
    print(f"SUCCESS: Output Image Size = {result.size}, Format = {result.mode}")

    # Save output sample
    result.save("sample_output.jpg")
    print("Saved output to backend/sample_output.jpg")

if __name__ == "__main__":
    test_pipeline()
