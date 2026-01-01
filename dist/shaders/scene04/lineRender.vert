uniform sampler2D positionTexture;
uniform sampler2D colorTexture;
uniform float width;
uniform float height;

attribute float rowIndex;  // 行のインデックス（0〜rows-1）
attribute float colIndex;  // 列のインデックス（0〜cols-1）

varying vec3 vColor;

void main() {
    // UV座標を計算（ピクセル中心に調整）
    float u = (floor(colIndex) + 0.5) / width;
    float v = (floor(rowIndex) + 0.5) / height;
    
    // 位置と色をテクスチャから取得
    vec4 posData = texture2D(positionTexture, vec2(u, v));
    vec4 colorData = texture2D(colorTexture, vec2(u, v));
    
    // 位置と色を使用
    vec3 position = posData.xyz;
    vec3 color = colorData.rgb;
    
    // 色を60%の明度に調整（Processingと同じ）
    vColor = color * 0.6;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
}

