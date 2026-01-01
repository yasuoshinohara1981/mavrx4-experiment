uniform sampler2D tDiffuse;
uniform float intensity;  // 反転の強度（0.0〜1.0、完全反転のため常に1.0）

varying vec2 vUv;

void main() {
    vec4 color = texture2D(tDiffuse, vUv);
    
    // 色を完全反転（RGBを反転）
    vec3 invertedColor = vec3(1.0) - color.rgb;
    
    // 完全反転
    gl_FragColor = vec4(invertedColor, color.a);
}

