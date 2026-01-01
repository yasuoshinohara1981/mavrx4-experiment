uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float amount;  // 色収差の強度（0.0〜1.0）

varying vec2 vUv;

void main() {
    // 中心からの距離を計算（画面の端ほど強く）
    vec2 center = vec2(0.5, 0.5);
    vec2 dir = normalize(vUv - center);
    float dist = length(vUv - center);
    
    // 距離に応じてオフセットを計算（画面の端ほど強く）
    vec2 offset = dir * dist * amount * 0.05;  // 0.05に変更して控えめに（0.1 → 0.05）
    
    // RGBチャンネルをずらす（放射状にずらす）
    float r = texture2D(tDiffuse, vUv + offset).r;
    float g = texture2D(tDiffuse, vUv).g;
    float b = texture2D(tDiffuse, vUv - offset).b;
    
    gl_FragColor = vec4(r, g, b, 1.0);
}

