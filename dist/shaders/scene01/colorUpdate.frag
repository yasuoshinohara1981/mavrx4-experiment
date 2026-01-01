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
    // ただし、ノイズ強度が最大200.0なので、実際の範囲は-200.0〜200.0になる可能性がある
    // 色のマッピング範囲は-10.0〜10.0に固定（Processingと同じ）
    // 範囲外の値もclampで0.0〜1.0に制限（これにより赤色が表示される）
    float minRadiusOffset = -10.0;
    float maxRadiusOffset = 10.0;
    // Processingのmapと同じ計算：map(radiusOffset, minRadiusOffset, maxRadiusOffset, 0.0, 1.0)
    // 範囲外の値はclampで0.0〜1.0に制限（radiusOffset > 10.0の場合は1.0になる）
    float normalizedRadius = clamp((radiusOffset - minRadiusOffset) / (maxRadiusOffset - minRadiusOffset), 0.0, 1.0);
    
    // デバッグ：normalizedRadiusが1.0に達しているか確認するため、範囲外の値も1.0にマッピング
    // これにより、ノイズ強度が大きい場合でも赤色が表示される
    
    // HSVで色を計算（ProcessingのHSBと同じ、内側→青(240度)、外側→赤(0度)）- ヒートマップ
    // Processingと同じ計算：lerp(240, 0, normalizedRadius)
    // 240度（青）から0度（赤）へ変化
    float hueDegrees = 240.0 - normalizedRadius * 240.0;
    // HSVの色相は0.0〜1.0の範囲（0.0=赤、0.666...=青）
    // 240度 = 240/360 = 0.666..., 0度 = 0/360 = 0.0
    float hue = hueDegrees / 360.0;
    // 色相が負の値になる場合の処理（HSVでは0.0〜1.0の範囲）
    if (hue < 0.0) hue += 1.0;
    if (hue >= 1.0) hue -= 1.0;
    
    // デバッグ：normalizedRadiusが1.0に達している場合、強制的に赤色（hue=0.0）にする
    if (normalizedRadius >= 0.95) {
        hue = 0.0;  // 赤色
    }
    
    // Processingと同じ：lerp(70, 80, normalizedRadius) → 70〜80%
    float saturation = (70.0 + normalizedRadius * 10.0) / 100.0;
    // Processingと同じ：lerp(60, 90, normalizedRadius) → 60〜90%
    // HSVではValue（明度）が0.9でも白くならない（HSLとは異なる）
    float value = (60.0 + normalizedRadius * 30.0) / 100.0;
    
    vec3 hsvColor = vec3(hue, saturation, value);
    vec3 rgbColor = hsv2rgb(hsvColor);
    
    // 色を出力
    gl_FragColor = vec4(rgbColor, 1.0);
}

