uniform sampler2D positionTexture;
uniform float baseRadius;

varying vec2 vUv;

// HSVからRGBへの変換（ProcessingのHSBと同じ）
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    // 現在の位置を取得
    vec4 posData = texture2D(positionTexture, vUv);
    vec3 currentPos = posData.xyz;
    
    // 色を計算（表面からの距離に基づく）
    float currentRadius = length(currentPos);
    float storedBaseRadius = posData.w;
    float radiusOffset = currentRadius - storedBaseRadius;
    // Processingと同じ範囲を使用（-10.0〜10.0）
    float minRadiusOffset = -10.0;
    float maxRadiusOffset = 10.0;
    float normalizedRadius = clamp((radiusOffset - minRadiusOffset) / (maxRadiusOffset - minRadiusOffset), 0.0, 1.0);
    
    // HSVで色を計算（ProcessingのHSBと同じ、内側→青(240度)、外側→赤(0度)）- ヒートマップ
    float hueDegrees = 240.0 - normalizedRadius * 240.0;
    float hue = hueDegrees / 360.0;
    if (hue < 0.0) hue += 1.0;
    if (hue >= 1.0) hue -= 1.0;
    
    if (normalizedRadius >= 0.95) {
        hue = 0.0;  // 赤色
    }
    
    float saturation = (70.0 + normalizedRadius * 10.0) / 100.0;
    float value = (60.0 + normalizedRadius * 30.0) / 100.0;
    
    vec3 hsvColor = vec3(hue, saturation, value);
    vec3 rgbColor = hsv2rgb(hsvColor);
    
    // 色を出力
    gl_FragColor = vec4(rgbColor, 1.0);
}

