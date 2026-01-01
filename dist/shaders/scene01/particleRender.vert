uniform sampler2D positionTexture;
uniform sampler2D colorTexture;
uniform float width;
uniform float height;

attribute float size;
attribute vec2 particleUv;

varying vec3 vColor;
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
    // 位置と色をテクスチャから取得
    // UV座標をピクセル中心に調整（最適化：floorを1回だけ）
    float u = (floor(particleUv.x * width) + 0.5) / width;
    float v = (floor(particleUv.y * height) + 0.5) / height;
    vec2 pixelUv = vec2(u, v);
    
    vec4 posData = texture2D(positionTexture, pixelUv);
    vec4 colorData = texture2D(colorTexture, pixelUv);
    
    vec3 position = posData.xyz;
    vColor = colorData.rgb;
    vPosition = position;
    
    // ビルボードの法線を計算（カメラ方向、ビュー空間での法線）
    // ビルボードは常にカメラを向くので、法線はビュー方向（カメラからパーティクルへの方向）
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(-mvPos.xyz);  // カメラからパーティクルへの方向（ビュー空間）
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    
    float pointSize = size * (150.0 / -mvPosition.z);  // パーティクルサイズ（モアレを減らすため小さく）
    gl_PointSize = max(1.0, pointSize);  // 最小サイズを1.0に制限
    gl_Position = projectionMatrix * mvPosition;
}

