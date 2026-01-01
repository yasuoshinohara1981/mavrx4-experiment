uniform sampler2D positionTexture;
uniform float minZOffset;
uniform float maxZOffset;

varying vec2 vUv;

// HSVからRGBへの変換
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    // 現在の位置を取得
    vec4 posData = texture2D(positionTexture, vUv);
    vec3 currentPos = posData.xyz;
    float baseZ = posData.w;  // 基準位置のZ
    
    // 基準位置からのZのオフセットを計算
    float zOffset = currentPos.z - baseZ;
    
    // Z位置を0.0～1.0に正規化（高い位置→赤、低い位置→青）
    float normalizedZ = clamp((zOffset - minZOffset) / (maxZOffset - minZOffset), 0.0, 1.0);
    
    // HSL（HSB）を使って自然なグラデーション
    // 低い位置（normalizedZ = 0）→ 青（240度）
    // 高い位置（normalizedZ = 1）→ 赤（0度）
    float hue = mix(240.0, 0.0, normalizedZ) / 360.0;
    float saturation = mix(70.0, 80.0, normalizedZ) / 100.0;
    float brightness = mix(60.0, 90.0, normalizedZ) / 100.0;
    
    vec3 hsvColor = vec3(hue, saturation, brightness);
    vec3 rgbColor = hsv2rgb(hsvColor);
    
    // 色を出力
    gl_FragColor = vec4(rgbColor, 1.0);
}

