uniform sampler2D positionTexture;
uniform sampler2D colorTexture;
uniform float time;
uniform float baseRadius;

varying vec2 vUv;

void main() {
    // 現在の位置を取得
    vec4 posData = texture2D(positionTexture, vUv);
    vec3 position = posData.xyz;
    
    // 白いメタボール（最初は白）
    vec3 color = vec3(1.0, 1.0, 1.0);  // 白
    
    // 色を出力
    gl_FragColor = vec4(color, 1.0);
}
