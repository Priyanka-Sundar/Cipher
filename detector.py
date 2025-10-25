from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import io, random

app = Flask(__name__)
CORS(app)  # <-- allows cross-origin requests from your HTML

@app.route("/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400
    file = request.files["image"]
    try:
        img = Image.open(io.BytesIO(file.read()))
        # Example placeholder analysis
        confidence = random.randint(0, 100)
        if confidence > 65:
            result = "Possible Deepfake ⚠️"
            details = "Irregular lighting, texture mismatches detected."
        else:
            result = "Likely Real ✅"
            details = "No major digital artifacts detected."
        return jsonify({"confidence": confidence, "result": result, "details": details})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)
