uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float amount;  // グリッチの強度（0.0〜1.0）
uniform float time;  // 時間

varying vec2 vUv;

// ランダム関数
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// ノイズ関数
float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
    vec2 uv = vUv;
    
    // 時間ベースのノイズでランダムな横方向の引き伸ばし
    float noiseValue = noise(vec2(uv.y * 20.0 + time * 10.0, time * 5.0));
    
    // グリッチが発生する領域をランダムに決定
    float glitchThreshold = 0.7;  // グリッチが発生する確率
    float glitchIntensity = step(glitchThreshold, noiseValue) * amount;
    
    // 横方向の引き伸ばし（一部の領域を横にずらす）
    float offsetX = (noiseValue - 0.5) * glitchIntensity * 0.1;  // 横方向のオフセット
    uv.x += offsetX;
    
    // 縦方向のランダムなスライス（一部の行だけを横にずらす）
    // 50.0を大きくするとスライスの縦幅が狭くなる（より細かく分割される）
    float sliceNoise = noise(vec2(floor(uv.y * 100.0) / 100.0, time * 3.0));
    float sliceIntensity = step(0.8, sliceNoise) * amount;
    uv.x += (sliceNoise - 0.5) * sliceIntensity * 0.15;
    
    // 色チャンネルを少しずらしてグリッチ感を出す
    float r = texture2D(tDiffuse, uv + vec2(offsetX * 0.5, 0.0)).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - vec2(offsetX * 0.5, 0.0)).b;
    
    // ランダムな明るさの変化
    float brightness = 1.0 + (noiseValue - 0.5) * glitchIntensity * 0.3;
    
    gl_FragColor = vec4(r * brightness, g * brightness, b * brightness, 1.0);
}

