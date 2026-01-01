uniform sampler2D positionTexture;
uniform float time;
uniform float minZOffset;
uniform float maxZOffset;

varying vec2 vUv;

// HSVからRGBへの変換
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// 簡易ノイズ関数
float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float smoothNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float n = i.x + i.y * 57.0 + i.z * 113.0;
    
    float a = hash(n);
    float b = hash(n + 1.0);
    float c = hash(n + 57.0);
    float d = hash(n + 58.0);
    float e = hash(n + 113.0);
    float f1 = hash(n + 114.0);
    float g = hash(n + 170.0);
    float h = hash(n + 171.0);
    
    float x1 = mix(a, b, f.x);
    float x2 = mix(c, d, f.x);
    float y1 = mix(x1, x2, f.y);
    
    float x3 = mix(e, f1, f.x);
    float x4 = mix(g, h, f.x);
    float y2 = mix(x3, x4, f.y);
    
    return mix(y1, y2, f.z);
}

void main() {
    // 現在の位置を取得
    vec4 posData = texture2D(positionTexture, vUv);
    vec3 currentPos = posData.xyz;
    float baseZ = posData.w;
    
    // 基準位置からのZのオフセットを計算
    float zOffset = currentPos.z - baseZ;
    
    // Z位置を0.0～1.0に正規化
    float normalizedZ = clamp((zOffset - minZOffset) / (maxZOffset - minZOffset), 0.0, 1.0);
    
    // 位置に基づいた色の計算（3D空間での位置から色を決定）
    float distFromCenter = length(currentPos);
    float normalizedDist = distFromCenter / 500.0;  // スケールに応じて調整
    
    // ネオンカラー（マゼンタ、パープル、ターコイズブルー）のグラデーション
    // 時間経過とともに色が変化
    float timeHue = time * 0.1;
    
    // 位置とZ位置の両方を使って色を決定
    float hue1 = (normalizedZ * 0.3 + normalizedDist * 0.2 + timeHue) * 360.0;
    // マゼンタ（300度）、パープル（270度）、ターコイズブルー（180度）の範囲
    hue1 = mod(hue1, 360.0);
    
    // 色相をネオンカラーの範囲にマッピング
    float hue;
    if (hue1 < 60.0) {
        // ターコイズブルー → シアン
        hue = mix(180.0, 200.0, hue1 / 60.0) / 360.0;
    } else if (hue1 < 180.0) {
        // シアン → パープル
        hue = mix(200.0, 270.0, (hue1 - 60.0) / 120.0) / 360.0;
    } else if (hue1 < 300.0) {
        // パープル → マゼンタ
        hue = mix(270.0, 300.0, (hue1 - 180.0) / 120.0) / 360.0;
    } else {
        // マゼンタ → ターコイズブルー
        hue = mix(300.0, 180.0, (hue1 - 300.0) / 60.0) / 360.0;
    }
    
    // ノイズを追加して色に変化を加える
    vec3 noisePos = currentPos * 0.01 + vec3(time * 0.1);
    float noiseValue = smoothNoise(noisePos) * 0.1;
    hue += noiseValue;
    
    // 彩度と明度を高く設定（ネオンカラー）
    float saturation = 0.85 + 0.15 * sin(time * 0.5 + normalizedZ * 3.14159);
    float brightness = 0.9 + 0.1 * cos(time * 0.3 + normalizedDist * 3.14159);
    
    // 位置に応じて明度を調整（中心部を明るく）
    brightness *= (1.0 + 0.2 * (1.0 - normalizedDist));
    
    vec3 hsvColor = vec3(hue, saturation, brightness);
    vec3 rgbColor = hsv2rgb(hsvColor);
    
    // ネオン効果を強化（色を明るく）
    rgbColor = pow(rgbColor, vec3(0.8));  // ガンマ補正で明るく
    
    // 色を出力
    gl_FragColor = vec4(rgbColor, 1.0);
}
