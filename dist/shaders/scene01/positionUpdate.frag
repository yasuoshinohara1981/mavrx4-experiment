uniform sampler2D positionTexture;
uniform float time;
uniform float noiseScale;
uniform float noiseStrength;
uniform float baseRadius;
uniform float width;
uniform float height;

varying vec2 vUv;

// ハッシュ関数（簡易版）
float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

// Processingのnoise()関数を模倣（パーリンノイズ風）
// 球体マッピングされた緯度・経度を使ってノイズを計算
// Processingでは noise(latitude * noiseScale, longitude * noiseScale, time * noiseScale) を使用
float smoothNoise(vec3 p) {
    // Processingのnoise()関数に近い実装（パーリンノイズ風）
    // より細かく、より自然なノイズを生成
    
    // 3Dノイズ（簡易パーリンノイズ風）
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
    
    // 3D補間
    float x1 = mix(a, b, f.x);
    float x2 = mix(c, d, f.x);
    float y1 = mix(x1, x2, f.y);
    
    float x3 = mix(e, f1, f.x);
    float x4 = mix(g, h, f.x);
    float y2 = mix(x3, x4, f.y);
    
    return mix(y1, y2, f.z);
}

// 4Dノイズ（経度の周期性を考慮するため）
float smoothNoise4D(vec4 p) {
    // 4Dノイズ（簡易パーリンノイズ風）
    vec4 i = floor(p);
    vec4 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);  // smoothstep
    
    float n = i.x + i.y * 57.0 + i.z * 113.0 + i.w * 199.0;
    
    // 4D補間（16個のコーナー）
    float a = hash(n);
    float b = hash(n + 1.0);
    float c = hash(n + 57.0);
    float d = hash(n + 58.0);
    float e = hash(n + 113.0);
    float f1 = hash(n + 114.0);
    float g = hash(n + 170.0);
    float h = hash(n + 171.0);
    float i1 = hash(n + 199.0);
    float j = hash(n + 200.0);
    float k = hash(n + 256.0);
    float l = hash(n + 257.0);
    float m = hash(n + 312.0);
    float n1 = hash(n + 313.0);
    float o = hash(n + 369.0);
    float p1 = hash(n + 370.0);
    
    // 4D補間
    float x1 = mix(a, b, f.x);
    float x2 = mix(c, d, f.x);
    float x3 = mix(e, f1, f.x);
    float x4 = mix(g, h, f.x);
    float x5 = mix(i1, j, f.x);
    float x6 = mix(k, l, f.x);
    float x7 = mix(m, n1, f.x);
    float x8 = mix(o, p1, f.x);
    
    float y1 = mix(x1, x2, f.y);
    float y2 = mix(x3, x4, f.y);
    float y3 = mix(x5, x6, f.y);
    float y4 = mix(x7, x8, f.y);
    
    float z1 = mix(y1, y2, f.z);
    float z2 = mix(y3, y4, f.z);
    
    return mix(z1, z2, f.w);
}

void main() {
    // グリッド座標を計算（緯度・経度を復元）
    // UV座標をピクセル座標に変換（0.5オフセットでピクセル中心を取得）
    float x = (vUv.x * width) - 0.5;
    float y = (vUv.y * height) - 0.5;
    float latitude = (y / (height - 1.0) - 0.5) * 3.14159265359;
    float longitude = (x / (width - 1.0)) * 3.14159265359 * 2.0;
    
    // 経度の周期性を考慮したノイズ計算（0度と360度の境界を滑らかに）
    // 経度をsin/cosに変換してからノイズに渡すことで、周期性を考慮
    float longitudeSin = sin(longitude);
    float longitudeCos = cos(longitude);
    
    // ノイズ計算（Processingのnoise()関数を模倣）
    // noiseScaleが大きいほど細かいノイズになる
    // 経度の周期性を考慮するため、sin/cosを使った値でノイズを計算
    float noiseValue = smoothNoise4D(vec4(
        latitude * noiseScale,
        longitudeSin * noiseScale,
        longitudeCos * noiseScale,
        time * noiseScale
    ));
    
    // ノイズオフセットを計算（Processingのmap(noiseValue, 0.0, 1.0, -noiseStrength, noiseStrength)を模倣）
    float noiseOffset = (noiseValue - 0.5) * 2.0 * noiseStrength;
    
    // 方向ベクトルを計算
    vec3 direction = vec3(
        cos(latitude) * cos(longitude),
        sin(latitude),
        cos(latitude) * sin(longitude)
    );
    
    // 新しい位置を計算（ノイズオフセット）
    float currentRadius = baseRadius + noiseOffset;
    vec3 newPos = direction * currentRadius;
    
    // 位置を出力（baseRadiusをwに保存）
    gl_FragColor = vec4(newPos, baseRadius);
}

