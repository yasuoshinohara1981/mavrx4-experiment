uniform sampler2D positionTexture;
uniform sampler2D colorTexture;
uniform float time;
uniform float deltaTime;
uniform float width;
uniform float height;
uniform float baseRadius;
uniform float noiseScale;
uniform float noiseStrength;
uniform float curlNoiseTimeScale;  // カールノイズの時間スケール（トラック9で変更）

varying vec2 vUv;

// ハッシュ関数
float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

// 3Dノイズ（パーリンノイズ風）
float smoothNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);  // smoothstep
    
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

// カールノイズ関数
vec3 curlNoise(vec3 p, float t, float noiseScale, float noiseStrength) {
    float eps = 0.1;
    
    float n1 = smoothNoise(vec3((p.x + eps) * noiseScale + t, p.y * noiseScale + t, p.z * noiseScale + t));
    float n2 = smoothNoise(vec3((p.x - eps) * noiseScale + t, p.y * noiseScale + t, p.z * noiseScale + t));
    float n3 = smoothNoise(vec3(p.x * noiseScale + t, (p.y + eps) * noiseScale + t, p.z * noiseScale + t));
    float n4 = smoothNoise(vec3(p.x * noiseScale + t, (p.y - eps) * noiseScale + t, p.z * noiseScale + t));
    float n5 = smoothNoise(vec3(p.x * noiseScale + t, p.y * noiseScale + t, (p.z + eps) * noiseScale + t));
    float n6 = smoothNoise(vec3(p.x * noiseScale + t, p.y * noiseScale + t, (p.z - eps) * noiseScale + t));
    
    float dx = (n1 - n2) / (2.0 * eps);
    float dy = (n3 - n4) / (2.0 * eps);
    float dz = (n5 - n6) / (2.0 * eps);
    
    float curlX = dz - dy;
    float curlY = dx - dz;
    float curlZ = dy - dx;
    
    return vec3(curlX, curlY, curlZ) * noiseStrength;
}

void main() {
    // 現在のパーティクルの位置を取得
    vec4 posData = texture2D(positionTexture, vUv);
    vec3 position = posData.xyz;
    
    // 初期位置が(0,0,0)の場合は初期位置に設定
    if (length(position) < 0.001) {
        // 初期位置を計算（UV座標から）
        float u = vUv.x;  // 0.0～1.0
        float v = vUv.y;  // 0.0～1.0
        float initialLongitude = u * 3.14159265359 * 2.0;  // 0～2π
        float initialLatitude = (v - 0.5) * 3.14159265359;  // -π/2～π/2
        vec3 initialDirection = vec3(
            cos(initialLatitude) * cos(initialLongitude),
            sin(initialLatitude),
            cos(initialLatitude) * sin(initialLongitude)
        );
        position = initialDirection * baseRadius;
    }
    
    // カールノイズで滑らかに動かす（トラック9でのみ動く）
    float noiseTime = (curlNoiseTimeScale > 1.0) ? time * curlNoiseTimeScale : 0.0;
    vec3 curlForce = curlNoise(position, noiseTime, noiseScale, noiseStrength);
    position += curlForce * deltaTime;
    
    // 位置を出力
    gl_FragColor = vec4(position, 1.0);  // lifetimeは不要
}
